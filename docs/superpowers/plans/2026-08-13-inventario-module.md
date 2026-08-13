# Módulo Inventario — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el módulo Inventario de BeautyCRM en `/dashboard/inventario`: catálogos de insumos y productos de reventa, stock por sucursal con alertas de mínimo, y ajustes manuales que quedan registrados en un historial inmutable.

**Architecture:** Next.js 14 App Router + Supabase (RLS), mismo patrón que Agenda, Clientes y Servicios ya en producción: Server Component para la lectura inicial, Client Components para interacción, Server Actions para las mutaciones. **Con migración nueva** (`0012`): tabla `inventory_movements`, dos RPC `security definer` que son el único camino para mover stock, `deleted_at` en ambos catálogos, y la vista `v_inventory`. El saldo vigente sigue viviendo en `inventory.current_stock`, que ya consume el Panel de control.

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript strict, Supabase (`@supabase/ssr`), `@beautycrm/ui`, `@phosphor-icons/react`, Playwright, tsx.

**Spec:** `docs/superpowers/specs/2026-08-13-inventario-module-design.md`

## Global Constraints

- **Nunca contra el tenant real.** Todos los tests provisionan tenants descartables vía admin API y los borran en el `finally`.
- **El stock sólo se mueve por RPC.** `inventory_movements` no lleva policies de `insert`/`update`/`delete`. Escribir el saldo sin dejar movimiento, o al revés, es un bug.
- **Sin `useEffect` para hidratar formularios.** El estado se siembra en los inicializadores de `useState` y el padre monta el Sheet condicionalmente con `key`. Ver `ServiceFormSheet.tsx` y el commit `7173ee8`.
- **Formularios con `noValidate`.** La validación va en el submit y se muestra en el banner del Sheet, nunca con `min`/`step` de HTML5. Ver commit `26388bd`.
- **Sin selector de sucursal.** El tenant es `mode = 'single'`; se auto-selecciona la única sucursal (doc de arquitectura A.3).
- **Fuera de alcance:** BOM (`service_supplies`), transferencias entre sucursales, registrar la venta como movimiento, y el chequeo de saldo negativo en `process_sale_item`.
- Textos de UI en español rioplatense, sin voseo forzado en mensajes de error.

## File Structure

```
migrations/0012_inventory_movements.sql          enum, tabla, deleted_at, 3 RPC, vista
apps/web/tests/security/inventario-behavior.test.ts   invariantes de base (Task 1)
apps/web/lib/inventory-types.ts                  tipos compartidos entre queries/actions/UI
apps/web/lib/inventory-queries.ts                lecturas (server-only)
apps/web/lib/inventory-actions.ts                mutaciones (server actions)
apps/web/app/dashboard/inventario/page.tsx       Server Component, reemplaza el ComingSoon
apps/web/app/dashboard/inventario/InventoryList.tsx     listado + estado de los Sheets
apps/web/app/dashboard/inventario/ItemFormSheet.tsx     alta/edición de insumo o producto
apps/web/app/dashboard/inventario/AdjustStockSheet.tsx  ajuste + historial del ítem
apps/web/components/Sidebar.tsx                  implemented: true
packages/supabase/src/types.ts                   tabla, vista, enum y RPC nuevos
apps/web/package.json                            script test:inventario
package.json                                     script test:inventario
apps/web/tests/e2e/inventario.spec.ts            recorrido completo (Task 4)
```

---

### Task 1: Migración y sus invariantes de base

Escribe primero el test que fija el comportamiento de la base, lo ve fallar, y recién después aplica la migración.

**Files:**
- Create: `apps/web/tests/security/inventario-behavior.test.ts`
- Create: `migrations/0012_inventory_movements.sql`
- Modify: `apps/web/package.json` (scripts)
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `app.has_role(uuid, membership_role[])`, `app.user_tenant_ids()`, `provision_tenant(...)` — ya existen.
- Produces: `public.adjust_stock(p_branch_id, p_item_id, p_item_type, p_delta, p_reason, p_note) returns numeric`; `public.record_stock_count(p_branch_id, p_item_id, p_item_type, p_counted, p_note) returns numeric`; `public.soft_delete_inventory_item(p_item_id, p_item_type) returns void`; vista `public.v_inventory`; tabla `public.inventory_movements`; enum `inventory_movement_reason`.

- [ ] **Step 1: Escribir el test**

Crear `apps/web/tests/security/inventario-behavior.test.ts`:

```ts
/**
 * Invariantes del módulo Inventario a nivel de datos: quién puede tocar los
 * catálogos, quién puede mover stock, y las dos garantías que sostienen el
 * historial — que el registro de movimientos es inmutable, y que el saldo
 * siempre coincide con la suma de los deltas.
 *
 * Mismo patrón que tests/security/servicios-behavior.test.ts: datos 100%
 * descartables contra el proyecto real, borrados en el finally.
 *
 * Ejecutar: pnpm test:inventario (desde apps/web, con .env.local cargado)
 */
import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  console.error("Faltan env vars. Corré con apps/web/.env.local cargado.")
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function createTestUser(label: string) {
  const email = `inventario-test-${label}-${Date.now()}@example.com`
  const password = `Test-${Math.random().toString(36).slice(2)}!`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw new Error(`No pude crear usuario ${label}: ${error?.message}`)
  return { id: data.user.id, email, password }
}

async function signIn(email: string, password: string) {
  const client = createClient(SUPABASE_URL, ANON_KEY)
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`No pude loguear ${email}: ${error.message}`)
  return client
}

async function main() {
  const userIds: string[] = []
  let tenantId: string | undefined
  let branchId: string | undefined
  let otherTenantId: string | undefined
  let otherBranchId: string | undefined
  let failures = 0

  try {
    console.log("Provisionando tenant de prueba...")
    const owner = await createTestUser("owner")
    userIds.push(owner.id)
    const ownerClient = await signIn(owner.email, owner.password)

    const { data: tenantRow, error: tenantError } = await ownerClient.rpc("provision_tenant", {
      p_business_name: "Inventario Test Salon",
    })
    if (tenantError || !tenantRow?.[0]) throw new Error(`provision_tenant falló: ${tenantError?.message}`)
    tenantId = tenantRow[0].tenant_id
    branchId = tenantRow[0].branch_id

    console.log("Creando operadora y supervisora...")
    const operator = await createTestUser("operator")
    userIds.push(operator.id)
    await admin.from("memberships").insert({
      tenant_id: tenantId, user_id: operator.id, branch_id: branchId, role: "operator",
    })
    const operatorClient = await signIn(operator.email, operator.password)

    const supervisor = await createTestUser("supervisor")
    userIds.push(supervisor.id)
    await admin.from("memberships").insert({
      tenant_id: tenantId, user_id: supervisor.id, branch_id: branchId, role: "supervisor",
    })
    const supervisorClient = await signIn(supervisor.email, supervisor.password)

    // --- Test 1: la operadora no puede crear insumos ni productos ---
    console.log("Test 1: la operadora no puede crear insumos ni productos...")
    const { data: opSupply } = await operatorClient
      .from("supplies")
      .insert({ tenant_id: tenantId, name: "Insumo de operadora", unit: "ml", cost_per_unit: 10 })
      .select("id")
    const { data: opProduct } = await operatorClient
      .from("retail_products")
      .insert({ tenant_id: tenantId, name: "Producto de operadora", sale_price: 100, cost: 50 })
      .select("id")
    if ((opSupply && opSupply.length > 0) || (opProduct && opProduct.length > 0)) {
      console.error("  FALLO — la operadora pudo crear en algún catálogo")
      failures++
    } else {
      console.log("  OK — RLS bloqueó ambos inserts")
    }

    // --- Test 2: la supervisora sí puede crear y editar ---
    console.log("Test 2: la supervisora puede crear y editar insumos...")
    const { data: supSupply, error: supSupplyError } = await supervisorClient
      .from("supplies")
      .insert({ tenant_id: tenantId, name: "Esmalte de supervisora", unit: "ml", cost_per_unit: 500 })
      .select()
      .single()
    if (supSupplyError || !supSupply) {
      console.error("  FALLO — la supervisora no pudo crear un insumo:", supSupplyError?.message)
      failures++
    } else {
      const { data: supUpdate, error: supUpdateError } = await supervisorClient
        .from("supplies")
        .update({ cost_per_unit: 600 })
        .eq("id", supSupply.id)
        .select("cost_per_unit")
        .maybeSingle()
      if (supUpdateError || Number(supUpdate?.cost_per_unit) !== 600) {
        console.error("  FALLO — la supervisora no pudo editar el insumo:", supUpdateError?.message)
        failures++
      } else {
        console.log("  OK — creó y editó")
      }
    }

    // El insumo con el que trabajan los tests de stock.
    const { data: supply, error: supplyError } = await ownerClient
      .from("supplies")
      .insert({ tenant_id: tenantId, name: "Esmalte rojo", unit: "ml", cost_per_unit: 800 })
      .select()
      .single()
    if (supplyError || !supply) throw new Error(`No pude crear el insumo base: ${supplyError?.message}`)

    // --- Test 3: la operadora no puede mover stock ---
    console.log("Test 3: la operadora no puede llamar a adjust_stock...")
    const { error: opAdjustError } = await operatorClient.rpc("adjust_stock", {
      p_branch_id: branchId, p_item_id: supply.id, p_item_type: "supply",
      p_delta: 10, p_reason: "compra", p_note: null,
    })
    if (!opAdjustError) {
      console.error("  FALLO — la operadora pudo ajustar stock")
      failures++
    } else if (opAdjustError.code !== "42501") {
      console.error("  FALLO — falló con un código inesperado:", opAdjustError.code, opAdjustError.message)
      failures++
    } else {
      console.log("  OK — rechazada con 42501")
    }

    // --- Test 4: el ajuste que dejaría negativo se rechaza y no deja rastro ---
    console.log("Test 4: un ajuste que dejaría el stock negativo se rechaza sin dejar movimiento...")
    const { error: negativeError } = await ownerClient.rpc("adjust_stock", {
      p_branch_id: branchId, p_item_id: supply.id, p_item_type: "supply",
      p_delta: -5, p_reason: "rotura", p_note: null,
    })
    const { count: movementsAfterNegative } = await admin
      .from("inventory_movements")
      .select("id", { count: "exact", head: true })
      .eq("item_id", supply.id)
    if (!negativeError) {
      console.error("  FALLO — se aceptó un ajuste que deja el stock en negativo")
      failures++
    } else if ((movementsAfterNegative ?? 0) !== 0) {
      console.error("  FALLO — el ajuste rechazado igual dejó un movimiento")
      failures++
    } else {
      console.log("  OK — rechazado y sin movimiento")
    }

    // --- Test 5: el registro de movimientos es inmutable ---
    // Primero un movimiento legítimo para tener algo que intentar tocar.
    console.log("Test 5: inventory_movements no acepta escrituras directas...")
    const { error: buyError } = await ownerClient.rpc("adjust_stock", {
      p_branch_id: branchId, p_item_id: supply.id, p_item_type: "supply",
      p_delta: 10, p_reason: "compra", p_note: "Primera compra",
    })
    if (buyError) throw new Error(`No pude registrar la compra inicial: ${buyError.message}`)

    const { data: movement } = await admin
      .from("inventory_movements")
      .select("id")
      .eq("item_id", supply.id)
      .limit(1)
      .maybeSingle()
    if (!movement) throw new Error("No encontré el movimiento de la compra inicial")

    const { data: forgedInsert } = await ownerClient
      .from("inventory_movements")
      .insert({
        tenant_id: tenantId, branch_id: branchId, item_id: supply.id, item_type: "supply",
        delta: 999, resulting_stock: 999, reason: "ajuste",
      })
      .select("id")
    const { data: forgedUpdate } = await ownerClient
      .from("inventory_movements")
      .update({ delta: 0 })
      .eq("id", movement.id)
      .select("id")
    const { data: forgedDelete } = await ownerClient
      .from("inventory_movements")
      .delete()
      .eq("id", movement.id)
      .select("id")
    if (
      (forgedInsert && forgedInsert.length > 0) ||
      (forgedUpdate && forgedUpdate.length > 0) ||
      (forgedDelete && forgedDelete.length > 0)
    ) {
      console.error("  FALLO — se pudo escribir inventory_movements directo (insert/update/delete)")
      failures++
    } else {
      console.log("  OK — las tres escrituras directas quedaron bloqueadas")
    }

    // --- Test 6: el saldo coincide con la suma de los deltas ---
    console.log("Test 6: el saldo coincide con la suma de los movimientos...")
    await ownerClient.rpc("adjust_stock", {
      p_branch_id: branchId, p_item_id: supply.id, p_item_type: "supply",
      p_delta: -3, p_reason: "rotura", p_note: "Se cayó un frasco",
    })
    const { data: counted, error: countError } = await ownerClient.rpc("record_stock_count", {
      p_branch_id: branchId, p_item_id: supply.id, p_item_type: "supply",
      p_counted: 5, p_note: "Recuento de fin de mes",
    })
    if (countError) {
      console.error("  FALLO — record_stock_count falló:", countError.message)
      failures++
    }

    const { data: inventoryRow } = await admin
      .from("inventory")
      .select("current_stock")
      .eq("branch_id", branchId)
      .eq("item_id", supply.id)
      .eq("item_type", "supply")
      .maybeSingle()
    const { data: allMovements } = await admin
      .from("inventory_movements")
      .select("delta, resulting_stock, created_at")
      .eq("item_id", supply.id)
      .order("created_at", { ascending: true })

    const sumOfDeltas = (allMovements ?? []).reduce((acc, m) => acc + Number(m.delta), 0)
    const lastResulting = Number((allMovements ?? []).at(-1)?.resulting_stock)
    const stock = Number(inventoryRow?.current_stock)

    if (Number(counted) !== 5) {
      console.error("  FALLO — record_stock_count devolvió", counted, "en vez de 5")
      failures++
    } else if (stock !== 5 || sumOfDeltas !== 5 || lastResulting !== 5) {
      console.error(
        `  FALLO — no cuadran: current_stock=${stock}, suma de deltas=${sumOfDeltas}, último resulting_stock=${lastResulting}`,
      )
      failures++
    } else {
      console.log("  OK — 10 − 3 + recuento a 5 → saldo 5, suma 5, resulting 5")
    }

    // --- Test 7: eliminar es owner-only y no borra el historial ---
    console.log("Test 7: la supervisora no puede eliminar; la dueña sí, sin perder movimientos...")
    const { error: supDeleteError } = await supervisorClient.rpc("soft_delete_inventory_item", {
      p_item_id: supply.id, p_item_type: "supply",
    })
    if (!supDeleteError || supDeleteError.code !== "42501") {
      console.error("  FALLO — la supervisora pudo eliminar (o falló con otro código):", supDeleteError?.code)
      failures++
    } else {
      const { error: ownerDeleteError } = await ownerClient.rpc("soft_delete_inventory_item", {
        p_item_id: supply.id, p_item_type: "supply",
      })
      const { data: deletedRow } = await admin
        .from("supplies")
        .select("deleted_at")
        .eq("id", supply.id)
        .maybeSingle()
      const { data: visible } = await ownerClient
        .from("v_inventory")
        .select("item_id")
        .eq("item_id", supply.id)
      const { count: movementsAfterDelete } = await admin
        .from("inventory_movements")
        .select("id", { count: "exact", head: true })
        .eq("item_id", supply.id)

      if (ownerDeleteError) {
        console.error("  FALLO — la dueña no pudo eliminar:", ownerDeleteError.message)
        failures++
      } else if (!deletedRow?.deleted_at) {
        console.error("  FALLO — el insumo no quedó marcado con deleted_at")
        failures++
      } else if (visible && visible.length > 0) {
        console.error("  FALLO — el insumo eliminado sigue apareciendo en v_inventory")
        failures++
      } else if ((movementsAfterDelete ?? 0) === 0) {
        console.error("  FALLO — se perdieron los movimientos al eliminar el insumo")
        failures++
      } else {
        console.log("  OK — supervisora bloqueada, dueña eliminó, historial intacto")
      }
    }

    // --- Test 8: aislamiento cross-tenant ---
    console.log("Test 8: un miembro de otro tenant no ve ni mueve stock ajeno...")
    const ownerB = await createTestUser("owner-b")
    userIds.push(ownerB.id)
    const ownerBClient = await signIn(ownerB.email, ownerB.password)
    const { data: tenantBRow, error: tenantBError } = await ownerBClient.rpc("provision_tenant", {
      p_business_name: "Inventario Test Salon B",
    })
    if (tenantBError || !tenantBRow?.[0]) throw new Error(`provision_tenant B falló: ${tenantBError?.message}`)
    otherTenantId = tenantBRow[0].tenant_id
    otherBranchId = tenantBRow[0].branch_id

    const { data: supplyA } = await ownerClient
      .from("supplies")
      .insert({ tenant_id: tenantId, name: "Insumo del tenant A", unit: "unit", cost_per_unit: 1 })
      .select()
      .single()

    const { error: crossAdjustError } = await ownerBClient.rpc("adjust_stock", {
      p_branch_id: otherBranchId, p_item_id: supplyA!.id, p_item_type: "supply",
      p_delta: 5, p_reason: "compra", p_note: null,
    })
    const { data: leaked } = await ownerBClient.from("v_inventory").select("item_id").eq("tenant_id", tenantId)
    const { data: leakedMovements } = await ownerBClient
      .from("inventory_movements")
      .select("id")
      .eq("tenant_id", tenantId)

    if (!crossAdjustError) {
      console.error("  FALLO — el dueño de otro tenant pudo ajustar stock de un ítem ajeno")
      failures++
    } else if ((leaked?.length ?? 0) > 0 || (leakedMovements?.length ?? 0) > 0) {
      console.error("  FALLO — se filtró inventario o movimientos de otro tenant")
      failures++
    } else {
      console.log("  OK — ajuste rechazado y sin filtración de lectura")
    }
  } finally {
    console.log("Limpiando datos de prueba...")
    for (const tid of [tenantId, otherTenantId].filter((v): v is string => !!v)) {
      const { data: branches } = await admin.from("branches").select("id").eq("tenant_id", tid)
      const branchIds = (branches ?? []).map((b) => b.id)
      if (branchIds.length > 0) {
        await admin.from("inventory").delete().in("branch_id", branchIds)
      }
      await admin.from("inventory_movements").delete().eq("tenant_id", tid)
      await admin.from("supplies").delete().eq("tenant_id", tid)
      await admin.from("retail_products").delete().eq("tenant_id", tid)
      await admin.from("memberships").delete().eq("tenant_id", tid)
      await admin.from("branches").delete().eq("tenant_id", tid)
      await admin.from("commission_rules").delete().eq("tenant_id", tid)
      await admin.from("tenants").delete().eq("id", tid)
    }
    for (const id of userIds) {
      await admin.from("users").delete().eq("id", id)
      await admin.auth.admin.deleteUser(id)
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} test(s) del módulo Inventario FALLARON.`)
    process.exit(1)
  }
  console.log("\nTodos los tests de comportamiento de Inventario pasaron.")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 2: Agregar el script a `apps/web/package.json`**

En `"scripts"`, después de `"test:servicios"`:

```json
"test:inventario": "tsx --env-file=.env.local tests/security/inventario-behavior.test.ts"
```

- [ ] **Step 3: Agregar el script al `package.json` raíz**

Mismo criterio que los otros módulos:

```json
"test:inventario": "pnpm --filter @beautycrm/web test:inventario"
```

- [ ] **Step 4: Correr el test y verificar que falla**

Run: `cd apps/web && pnpm test:inventario`
Expected: FAIL — los RPC `adjust_stock`, `record_stock_count` y `soft_delete_inventory_item` no existen (`PGRST202`), y `inventory_movements` / `v_inventory` tampoco.

- [ ] **Step 5: Escribir `migrations/0012_inventory_movements.sql`**

```sql
-- ============================================================================
-- BeautyCRM — 0012_inventory_movements.sql
-- Registro de movimientos de stock + el único camino para escribirlo.
--
-- El saldo vigente sigue viviendo en inventory.current_stock: ya lo consume
-- el Panel de control (app/dashboard/queries.ts) y lo escribe
-- app.process_sale_item (0004). Este archivo agrega el historial que
-- explica CÓMO llegó a ese número, sin tocar nada de lo anterior.
--
-- Deuda conocida para el módulo Caja: cuando el POS empiece a insertar
-- sale_items, el stock va a bajar sin dejar movimiento. El enum ya incluye
-- 'venta' para que sumarlo sea un insert dentro de app.process_sale_item.
-- ============================================================================

create type inventory_movement_reason as enum
  ('compra', 'rotura', 'recuento', 'ajuste', 'venta');

-- Borrado suave en ambos catálogos, mismo criterio que 0011 para services:
-- inventory_movements.item_id es polimórfico y NO tiene FK, así que un
-- borrado real dejaría movimientos huérfanos sin nombre; y
-- service_supplies.supply_id sí tiene FK NO ACTION, así que borrar un
-- insumo usado en un BOM fallaría con 23503.
alter table public.supplies add column if not exists deleted_at timestamptz;
alter table public.retail_products add column if not exists deleted_at timestamptz;

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  -- Polimórfico igual que inventory.item_id: apunta a supplies o a
  -- retail_products según item_type. Sin FK, por eso el borrado es suave.
  item_id uuid not null,
  item_type inventory_item_type not null,
  delta numeric not null,
  -- Redundante con la suma acumulada, a propósito: es lo que permite
  -- auditar. Si algún día el saldo y el historial no cuadran, esta columna
  -- dice exactamente en qué movimiento se separaron.
  resulting_stock numeric not null,
  reason inventory_movement_reason not null,
  note text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create index idx_inventory_movements_item
  on public.inventory_movements
  using btree (branch_id, item_id, item_type, created_at desc);

alter table public.inventory_movements enable row level security;

-- SOLO select. Sin insert/update/delete: RLS deniega por defecto, así que
-- nadie escribe esta tabla directo, ni siquiera la dueña. El único camino
-- son los RPC de abajo, que escriben saldo y movimiento en la misma
-- transacción — sin eso, un movimiento podría quedar sin su cambio de
-- saldo y el historial pasaría a mentir.
create policy inventory_movements_select on public.inventory_movements for select
  using (tenant_id in (select app.user_tenant_ids()));

-- ---------------------------------------------------------------------------
-- Ajuste por delta (compra, rotura, ajuste manual)
-- ---------------------------------------------------------------------------
create or replace function app.adjust_stock(
  p_branch_id uuid,
  p_item_id   uuid,
  p_item_type inventory_item_type,
  p_delta     numeric,
  p_reason    inventory_movement_reason,
  p_note      text default null
)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id   uuid;
  v_item_tenant uuid;
  v_new_stock   numeric;
begin
  -- 'venta' existe en el enum para el día que Caja registre sus descuentos,
  -- pero no es un ajuste manual: no hay llamador legítimo desde la app.
  if p_reason = 'venta' then
    raise exception 'REASON_NOT_ALLOWED' using errcode = '22023';
  end if;

  select tenant_id into v_tenant_id from branches where id = p_branch_id;
  if v_tenant_id is null then
    raise exception 'BRANCH_NOT_FOUND' using errcode = '22023';
  end if;

  if not app.has_role(v_tenant_id, array['owner','supervisor']::membership_role[]) then
    raise exception 'NOT_ALLOWED_TO_ADJUST_STOCK' using errcode = '42501';
  end if;

  if p_item_type = 'supply' then
    select tenant_id into v_item_tenant from supplies
     where id = p_item_id and deleted_at is null;
  else
    select tenant_id into v_item_tenant from retail_products
     where id = p_item_id and deleted_at is null;
  end if;

  if v_item_tenant is null or v_item_tenant <> v_tenant_id then
    raise exception 'ITEM_NOT_FOUND' using errcode = '22023';
  end if;

  insert into inventory (branch_id, item_id, item_type, current_stock)
  values (p_branch_id, p_item_id, p_item_type, 0)
  on conflict (branch_id, item_id, item_type) do nothing;

  -- FOR UPDATE: dos ajustes simultáneos sobre el mismo ítem tienen que
  -- serializarse. Sin el lock, ambos leerían el mismo saldo y el segundo
  -- pisaría al primero — el stock quedaría mal y el historial mostraría un
  -- resulting_stock que nunca existió.
  select current_stock into v_new_stock from inventory
   where branch_id = p_branch_id and item_id = p_item_id and item_type = p_item_type
   for update;

  v_new_stock := v_new_stock + p_delta;

  if v_new_stock < 0 then
    raise exception 'NEGATIVE_STOCK' using errcode = '22023';
  end if;

  update inventory set current_stock = v_new_stock
   where branch_id = p_branch_id and item_id = p_item_id and item_type = p_item_type;

  insert into inventory_movements
    (tenant_id, branch_id, item_id, item_type, delta, resulting_stock, reason, note, created_by)
  values
    (v_tenant_id, p_branch_id, p_item_id, p_item_type, p_delta, v_new_stock, p_reason,
     nullif(btrim(coalesce(p_note, '')), ''), auth.uid());

  return v_new_stock;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Recuento (cantidad absoluta)
-- ---------------------------------------------------------------------------
-- La resta "contado − saldo" se hace acá adentro y no en el cliente a
-- propósito: si el cliente calculara el delta con un saldo que leyó hace
-- unos segundos, un ajuste concurrente lo volvería incorrecto. Acá el
-- saldo se lee bajo el mismo FOR UPDATE que después se actualiza.
create or replace function app.record_stock_count(
  p_branch_id uuid,
  p_item_id   uuid,
  p_item_type inventory_item_type,
  p_counted   numeric,
  p_note      text default null
)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id   uuid;
  v_item_tenant uuid;
  v_current     numeric;
begin
  if p_counted < 0 then
    raise exception 'NEGATIVE_STOCK' using errcode = '22023';
  end if;

  select tenant_id into v_tenant_id from branches where id = p_branch_id;
  if v_tenant_id is null then
    raise exception 'BRANCH_NOT_FOUND' using errcode = '22023';
  end if;

  if not app.has_role(v_tenant_id, array['owner','supervisor']::membership_role[]) then
    raise exception 'NOT_ALLOWED_TO_ADJUST_STOCK' using errcode = '42501';
  end if;

  if p_item_type = 'supply' then
    select tenant_id into v_item_tenant from supplies
     where id = p_item_id and deleted_at is null;
  else
    select tenant_id into v_item_tenant from retail_products
     where id = p_item_id and deleted_at is null;
  end if;

  if v_item_tenant is null or v_item_tenant <> v_tenant_id then
    raise exception 'ITEM_NOT_FOUND' using errcode = '22023';
  end if;

  insert into inventory (branch_id, item_id, item_type, current_stock)
  values (p_branch_id, p_item_id, p_item_type, 0)
  on conflict (branch_id, item_id, item_type) do nothing;

  select current_stock into v_current from inventory
   where branch_id = p_branch_id and item_id = p_item_id and item_type = p_item_type
   for update;

  update inventory set current_stock = p_counted
   where branch_id = p_branch_id and item_id = p_item_id and item_type = p_item_type;

  insert into inventory_movements
    (tenant_id, branch_id, item_id, item_type, delta, resulting_stock, reason, note, created_by)
  values
    (v_tenant_id, p_branch_id, p_item_id, p_item_type, p_counted - v_current, p_counted, 'recuento',
     nullif(btrim(coalesce(p_note, '')), ''), auth.uid());

  return p_counted;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Borrado suave del ítem
-- ---------------------------------------------------------------------------
-- security definer y no un update común: eliminar es owner-only (igual que
-- supplies_delete / retail_products_delete), pero las policies de update
-- habilitan también a la supervisora. Con un update suelto, marcar
-- deleted_at convertiría eliminar en un permiso que hoy no tiene. Mismo
-- razonamiento que app.soft_delete_service en 0011.
create or replace function app.soft_delete_inventory_item(
  p_item_id   uuid,
  p_item_type inventory_item_type
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id uuid;
begin
  if p_item_type = 'supply' then
    select tenant_id into v_tenant_id from supplies where id = p_item_id and deleted_at is null;
  else
    select tenant_id into v_tenant_id from retail_products where id = p_item_id and deleted_at is null;
  end if;

  if v_tenant_id is null then
    raise exception 'ITEM_NOT_FOUND' using errcode = '22023';
  end if;

  if not app.has_role(v_tenant_id, array['owner']::membership_role[]) then
    raise exception 'NOT_ALLOWED_TO_DELETE_ITEM' using errcode = '42501';
  end if;

  if p_item_type = 'supply' then
    update supplies set deleted_at = now() where id = p_item_id;
  else
    update retail_products set deleted_at = now() where id = p_item_id;
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Wrappers públicos — mismo patrón y misma advertencia que 0005/0008/0011:
-- crear una función deja el execute abierto a PUBLIC (incluido 'anon')
-- salvo que se revoque explícitamente.
-- ---------------------------------------------------------------------------
create or replace function public.adjust_stock(
  p_branch_id uuid, p_item_id uuid, p_item_type inventory_item_type,
  p_delta numeric, p_reason inventory_movement_reason, p_note text default null
)
returns numeric language sql security definer set search_path to 'public'
as $function$
  select app.adjust_stock(p_branch_id, p_item_id, p_item_type, p_delta, p_reason, p_note);
$function$;

create or replace function public.record_stock_count(
  p_branch_id uuid, p_item_id uuid, p_item_type inventory_item_type,
  p_counted numeric, p_note text default null
)
returns numeric language sql security definer set search_path to 'public'
as $function$
  select app.record_stock_count(p_branch_id, p_item_id, p_item_type, p_counted, p_note);
$function$;

create or replace function public.soft_delete_inventory_item(
  p_item_id uuid, p_item_type inventory_item_type
)
returns void language sql security definer set search_path to 'public'
as $function$
  select app.soft_delete_inventory_item(p_item_id, p_item_type);
$function$;

revoke all on function app.adjust_stock(uuid, uuid, inventory_item_type, numeric, inventory_movement_reason, text) from public;
revoke all on function app.record_stock_count(uuid, uuid, inventory_item_type, numeric, text) from public;
revoke all on function app.soft_delete_inventory_item(uuid, inventory_item_type) from public;
revoke all on function public.adjust_stock(uuid, uuid, inventory_item_type, numeric, inventory_movement_reason, text) from public;
revoke all on function public.record_stock_count(uuid, uuid, inventory_item_type, numeric, text) from public;
revoke all on function public.soft_delete_inventory_item(uuid, inventory_item_type) from public;

grant execute on function public.adjust_stock(uuid, uuid, inventory_item_type, numeric, inventory_movement_reason, text) to authenticated;
grant execute on function public.record_stock_count(uuid, uuid, inventory_item_type, numeric, text) to authenticated;
grant execute on function public.soft_delete_inventory_item(uuid, inventory_item_type) to authenticated;

-- ---------------------------------------------------------------------------
-- Vista: catálogos + stock por sucursal
-- ---------------------------------------------------------------------------
-- security_invoker = true: la vista corre con los permisos de quien la
-- consulta, así que respeta las RLS de supplies/retail_products/inventory
-- en vez de saltearlas. Mismo criterio que v_agenda (0007) y
-- v_client_history (0009).
--
-- El join contra branches (en vez de partir de inventory) es lo que hace
-- que un ítem recién creado aparezca con stock 0 en vez de no aparecer
-- hasta su primer ajuste.
create or replace view public.v_inventory
with (security_invoker = true) as
select
  b.tenant_id,
  b.id   as branch_id,
  b.name as branch_name,
  s.id   as item_id,
  'supply'::inventory_item_type as item_type,
  s.name,
  s.unit,
  s.cost_per_unit,
  null::numeric as sale_price,
  coalesce(inv.current_stock, 0)   as current_stock,
  coalesce(inv.min_alert_level, 0) as min_alert_level,
  -- Un mínimo en 0 significa "no me avises", no "avisame siempre": sin el
  -- primer término, todo ítem recién creado (stock 0, mínimo 0) nacería
  -- marcado como bajo.
  coalesce(inv.min_alert_level, 0) > 0
    and coalesce(inv.current_stock, 0) <= coalesce(inv.min_alert_level, 0) as below_minimum
from supplies s
join branches b on b.tenant_id = s.tenant_id
left join inventory inv
  on inv.branch_id = b.id and inv.item_id = s.id and inv.item_type = 'supply'
where s.deleted_at is null

union all

select
  b.tenant_id,
  b.id   as branch_id,
  b.name as branch_name,
  p.id   as item_id,
  'product'::inventory_item_type as item_type,
  p.name,
  null::supply_unit as unit,
  p.cost as cost_per_unit,
  p.sale_price,
  coalesce(inv.current_stock, 0)   as current_stock,
  coalesce(inv.min_alert_level, 0) as min_alert_level,
  coalesce(inv.min_alert_level, 0) > 0
    and coalesce(inv.current_stock, 0) <= coalesce(inv.min_alert_level, 0) as below_minimum
from retail_products p
join branches b on b.tenant_id = p.tenant_id
left join inventory inv
  on inv.branch_id = b.id and inv.item_id = p.id and inv.item_type = 'product'
where p.deleted_at is null;
```

- [ ] **Step 6: Aplicar la migración**

Aplicarla con el MCP de Supabase (`apply_migration`, name `inventory_movements`) sobre el proyecto del `.env.local`, o con la CLI. Es aditiva: crea un tipo, una tabla, dos columnas, tres funciones y una vista. No toca datos existentes.

- [ ] **Step 7: Correr el test y verificar que pasa**

Run: `cd apps/web && pnpm test:inventario`
Expected: PASS — "Todos los tests de comportamiento de Inventario pasaron."

- [ ] **Step 8: Commit**

```bash
git add migrations/0012_inventory_movements.sql apps/web/tests/security/inventario-behavior.test.ts apps/web/package.json package.json
git commit -m "feat(db): registro de movimientos de stock y sus invariantes"
```

---

### Task 2: Capa de datos — tipos, queries y server actions

**Files:**
- Create: `apps/web/lib/inventory-types.ts`
- Create: `apps/web/lib/inventory-queries.ts`
- Create: `apps/web/lib/inventory-actions.ts`
- Modify: `packages/supabase/src/types.ts`

**Interfaces:**
- Consumes: los RPC y la vista de Task 1.
- Produces:
  - `InventoryItem`, `InventoryMovement`, `InventoryItemType`, `SupplyInput`, `ProductInput`, `AdjustmentKind`
  - `getInventory(tenantId: string): Promise<InventoryItem[]>`
  - `getItemMovements(branchId: string, itemId: string, itemType: InventoryItemType): Promise<InventoryMovement[]>`
  - `createSupply(tenantId, input) / updateSupply(supplyId, input)`
  - `createProduct(tenantId, input) / updateProduct(productId, input)`
  - `deleteInventoryItem(itemId, itemType)`
  - `adjustStock(branchId, itemId, itemType, kind, amount, note)`
  - `setMinAlertLevel(branchId, itemId, itemType, level)`

- [ ] **Step 1: Declarar lo nuevo en `packages/supabase/src/types.ts`**

Agregar dentro de `Tables`, en orden alfabético, la tabla `inventory_movements` (`Row`/`Insert`/`Update` con todas las columnas de la migración; `delta`, `resulting_stock` como `number`, `note`/`created_by` nullable, `reason` referenciando el enum). Agregar `deleted_at?: string | null` al `Row`/`Insert`/`Update` de `supplies` y de `retail_products`. Agregar `v_inventory` dentro de `Views`, con las columnas que devuelve la vista. Agregar `inventory_movement_reason` a `Enums`. Y en `Functions`:

```ts
      adjust_stock: {
        Args: {
          p_branch_id: string
          p_delta: number
          p_item_id: string
          p_item_type: Database["public"]["Enums"]["inventory_item_type"]
          p_note?: string | null
          p_reason: Database["public"]["Enums"]["inventory_movement_reason"]
        }
        Returns: number
      }
      record_stock_count: {
        Args: {
          p_branch_id: string
          p_counted: number
          p_item_id: string
          p_item_type: Database["public"]["Enums"]["inventory_item_type"]
          p_note?: string | null
        }
        Returns: number
      }
      soft_delete_inventory_item: {
        Args: {
          p_item_id: string
          p_item_type: Database["public"]["Enums"]["inventory_item_type"]
        }
        Returns: undefined
      }
```

- [ ] **Step 2: Escribir `apps/web/lib/inventory-types.ts`**

```ts
import type { Enums, Tables } from "@beautycrm/supabase/types"

export type InventoryItemType = Enums<"inventory_item_type">
export type SupplyUnit = Enums<"supply_unit">

/** Una fila de v_inventory: el ítem con su stock en una sucursal. */
export type InventoryItem = Tables<"v_inventory">

export type InventoryMovement = Tables<"inventory_movements">

/**
 * Forma que consume el form. camelCase y sin `tenant_id` a propósito: el
 * tenant lo pone la server action desde la sesión, nunca el cliente —
 * mismo criterio que ServiceInput en lib/service-types.ts.
 */
export type SupplyInput = {
  name: string
  unit: SupplyUnit
  costPerUnit: number
}

export type ProductInput = {
  name: string
  salePrice: number
  cost: number
}

/**
 * Los cuatro movimientos que ofrece la UI. No incluye 'venta': eso lo
 * escribe el módulo Caja desde el trigger, no una persona desde un form.
 *
 * 'recuento' es el raro: `amount` es la cantidad CONTADA (absoluta), no un
 * delta. La resta la hace record_stock_count adentro de la transacción.
 */
export type AdjustmentKind = "compra" | "rotura" | "recuento" | "ajuste"
```

- [ ] **Step 3: Escribir `apps/web/lib/inventory-queries.ts`**

```ts
import "server-only"
import { createClient } from "@beautycrm/supabase/server"
import type { InventoryItem, InventoryItemType, InventoryMovement } from "./inventory-types"

/**
 * Todo el inventario del tenant: insumos y productos de reventa, cada uno
 * con su stock en cada sucursal. Los ítems eliminados no vienen — v_inventory
 * ya filtra deleted_at (ver migrations/0012).
 *
 * numeric de Postgres puede llegar como string aunque types.ts lo tipe
 * number — mismo Number() defensivo que ya hacen getServices y
 * getActiveServices.
 */
export async function getInventory(tenantId: string): Promise<InventoryItem[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("v_inventory")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("item_type")
    .order("name")

  return (data ?? []).map((row) => ({
    ...row,
    cost_per_unit: row.cost_per_unit === null ? null : Number(row.cost_per_unit),
    sale_price: row.sale_price === null ? null : Number(row.sale_price),
    current_stock: Number(row.current_stock),
    min_alert_level: Number(row.min_alert_level),
  })) as InventoryItem[]
}

/** Los últimos movimientos de un ítem en una sucursal, del más nuevo al más viejo. */
export async function getItemMovements(
  branchId: string,
  itemId: string,
  itemType: InventoryItemType,
): Promise<InventoryMovement[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("inventory_movements")
    .select("*")
    .eq("branch_id", branchId)
    .eq("item_id", itemId)
    .eq("item_type", itemType)
    .order("created_at", { ascending: false })
    .limit(10)

  return (data ?? []).map((m) => ({
    ...m,
    delta: Number(m.delta),
    resulting_stock: Number(m.resulting_stock),
  })) as InventoryMovement[]
}
```

- [ ] **Step 4: Escribir `apps/web/lib/inventory-actions.ts`**

```ts
"use server"

import { createClient } from "@beautycrm/supabase/server"
import { revalidatePath } from "next/cache"
import type { AdjustmentKind, InventoryItemType, ProductInput, SupplyInput } from "./inventory-types"

// Declarado local en vez de importado de otro módulo: cada módulo declara
// el suyo (service-actions.ts y client-actions.ts hacen lo mismo).
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string | null }

// Revalidar también /dashboard: el Panel muestra las alertas de stock bajo.
function revalidateInventory() {
  revalidatePath("/dashboard/inventario")
  revalidatePath("/dashboard")
}

// Los errores que los RPC levantan a propósito (ver migrations/0012).
function rpcError(code: string | null | undefined, fallback: string): ActionResult<never> {
  if (code === "42501") return { ok: false, error: "No tenés permiso para esta acción.", code }
  if (code === "22023") return { ok: false, error: fallback, code }
  return { ok: false, error: fallback, code }
}

export async function createSupply(tenantId: string, input: SupplyInput): Promise<ActionResult> {
  if (!input.name.trim()) return { ok: false, error: "El nombre es obligatorio." }
  if (!Number.isFinite(input.costPerUnit) || input.costPerUnit < 0) {
    return { ok: false, error: "El costo no puede ser negativo." }
  }

  const supabase = await createClient()
  const { error } = await supabase.from("supplies").insert({
    tenant_id: tenantId,
    name: input.name.trim(),
    unit: input.unit,
    cost_per_unit: input.costPerUnit,
  })
  if (error) return { ok: false, error: "No pudimos crear el insumo.", code: error.code }

  revalidateInventory()
  return { ok: true, data: undefined }
}

export async function updateSupply(supplyId: string, input: SupplyInput): Promise<ActionResult> {
  if (!input.name.trim()) return { ok: false, error: "El nombre es obligatorio." }
  if (!Number.isFinite(input.costPerUnit) || input.costPerUnit < 0) {
    return { ok: false, error: "El costo no puede ser negativo." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("supplies")
    .update({ name: input.name.trim(), unit: input.unit, cost_per_unit: input.costPerUnit })
    .eq("id", supplyId)
    .select("id")
    .maybeSingle()
  if (error) return { ok: false, error: "No pudimos guardar los cambios.", code: error.code }
  if (!data) return { ok: false, error: "No pudimos guardar los cambios. Puede que no tengas permiso." }

  revalidateInventory()
  return { ok: true, data: undefined }
}

export async function createProduct(tenantId: string, input: ProductInput): Promise<ActionResult> {
  if (!input.name.trim()) return { ok: false, error: "El nombre es obligatorio." }
  if (!Number.isFinite(input.salePrice) || input.salePrice < 0) {
    return { ok: false, error: "El precio de venta no puede ser negativo." }
  }
  if (!Number.isFinite(input.cost) || input.cost < 0) {
    return { ok: false, error: "El costo no puede ser negativo." }
  }

  const supabase = await createClient()
  const { error } = await supabase.from("retail_products").insert({
    tenant_id: tenantId,
    name: input.name.trim(),
    sale_price: input.salePrice,
    cost: input.cost,
  })
  if (error) return { ok: false, error: "No pudimos crear el producto.", code: error.code }

  revalidateInventory()
  return { ok: true, data: undefined }
}

export async function updateProduct(productId: string, input: ProductInput): Promise<ActionResult> {
  if (!input.name.trim()) return { ok: false, error: "El nombre es obligatorio." }
  if (!Number.isFinite(input.salePrice) || input.salePrice < 0) {
    return { ok: false, error: "El precio de venta no puede ser negativo." }
  }
  if (!Number.isFinite(input.cost) || input.cost < 0) {
    return { ok: false, error: "El costo no puede ser negativo." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("retail_products")
    .update({ name: input.name.trim(), sale_price: input.salePrice, cost: input.cost })
    .eq("id", productId)
    .select("id")
    .maybeSingle()
  if (error) return { ok: false, error: "No pudimos guardar los cambios.", code: error.code }
  if (!data) return { ok: false, error: "No pudimos guardar los cambios. Puede que no tengas permiso." }

  revalidateInventory()
  return { ok: true, data: undefined }
}

/**
 * Borrado suave vía RPC: la fila tiene que sobrevivir para que el historial
 * de movimientos siga siendo legible (item_id es polimórfico y no tiene FK).
 * El RPC además chequea que sea la dueña. Ver migrations/0012.
 */
export async function deleteInventoryItem(
  itemId: string,
  itemType: InventoryItemType,
): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("soft_delete_inventory_item", {
    p_item_id: itemId,
    p_item_type: itemType,
  })
  if (error) {
    if (error.code === "42501") {
      return { ok: false, error: "Solo el dueño puede eliminar del inventario.", code: error.code }
    }
    return rpcError(error.code, "Ese ítem ya no existe.")
  }

  revalidateInventory()
  return { ok: true, data: undefined }
}

/**
 * Mueve stock. `amount` es siempre positivo salvo en "ajuste", donde puede
 * venir con signo; en "recuento" es la cantidad contada, no un delta, y por
 * eso va por otro RPC que hace la resta bajo el mismo lock.
 *
 * Devuelve el saldo resultante.
 */
export async function adjustStock(
  branchId: string,
  itemId: string,
  itemType: InventoryItemType,
  kind: AdjustmentKind,
  amount: number,
  note: string | null,
): Promise<ActionResult<number>> {
  if (!Number.isFinite(amount)) return { ok: false, error: "La cantidad no es válida." }
  if (kind !== "ajuste" && amount < 0) return { ok: false, error: "La cantidad no puede ser negativa." }
  if (kind !== "ajuste" && amount === 0) return { ok: false, error: "La cantidad tiene que ser mayor a 0." }

  const supabase = await createClient()

  if (kind === "recuento") {
    const { data, error } = await supabase.rpc("record_stock_count", {
      p_branch_id: branchId,
      p_item_id: itemId,
      p_item_type: itemType,
      p_counted: amount,
      p_note: note,
    })
    if (error) return rpcError(error.code, "No pudimos registrar el recuento.")
    revalidateInventory()
    return { ok: true, data: Number(data) }
  }

  const delta = kind === "rotura" ? -amount : amount
  const { data, error } = await supabase.rpc("adjust_stock", {
    p_branch_id: branchId,
    p_item_id: itemId,
    p_item_type: itemType,
    p_delta: delta,
    p_reason: kind,
    p_note: note,
  })
  if (error) {
    if (error.message.includes("NEGATIVE_STOCK")) {
      return { ok: false, error: "El ajuste dejaría el stock en negativo.", code: error.code }
    }
    return rpcError(error.code, "No pudimos registrar el movimiento.")
  }

  revalidateInventory()
  return { ok: true, data: Number(data) }
}

/**
 * El mínimo no mueve stock, así que no es un movimiento: va por un upsert
 * común a inventory, que las policies ya habilitan a dueña y supervisora.
 */
export async function setMinAlertLevel(
  branchId: string,
  itemId: string,
  itemType: InventoryItemType,
  level: number,
): Promise<ActionResult> {
  if (!Number.isFinite(level) || level < 0) return { ok: false, error: "El mínimo no puede ser negativo." }

  const supabase = await createClient()
  const { error } = await supabase
    .from("inventory")
    .upsert(
      { branch_id: branchId, item_id: itemId, item_type: itemType, min_alert_level: level },
      { onConflict: "branch_id,item_id,item_type" },
    )
  if (error) return { ok: false, error: "No pudimos guardar el mínimo.", code: error.code }

  revalidateInventory()
  return { ok: true, data: undefined }
}
```

- [ ] **Step 5: Verificar que compila**

Run: `cd apps/web && pnpm exec tsc --noEmit`
Expected: sin errores. Si `Tables<"v_inventory">` no resuelve, falta declarar la vista dentro de `Views` en `packages/supabase/src/types.ts` (Step 1).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/inventory-types.ts apps/web/lib/inventory-queries.ts apps/web/lib/inventory-actions.ts packages/supabase/src/types.ts
git commit -m "feat(web): capa de datos del módulo Inventario"
```

---

### Task 3: UI — listado, alta/edición y ajuste de stock

**Files:**
- Create: `apps/web/app/dashboard/inventario/InventoryList.tsx`
- Create: `apps/web/app/dashboard/inventario/ItemFormSheet.tsx`
- Create: `apps/web/app/dashboard/inventario/AdjustStockSheet.tsx`
- Modify: `apps/web/app/dashboard/inventario/page.tsx`
- Modify: `apps/web/components/Sidebar.tsx:31`

**Interfaces:**
- Consumes: todo lo que produce Task 2.
- Produces: la ruta `/dashboard/inventario` funcionando.

- [ ] **Step 1: Escribir `ItemFormSheet.tsx`**

```tsx
"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Trash } from "@phosphor-icons/react"
import { Button, Field, Input, Sheet } from "@beautycrm/ui"
import {
  createProduct, createSupply, deleteInventoryItem, updateProduct, updateSupply,
} from "@/lib/inventory-actions"
import type { InventoryItem, InventoryItemType, SupplyUnit } from "@/lib/inventory-types"

const UNITS: { value: SupplyUnit; label: string }[] = [
  { value: "ml", label: "Mililitros (ml)" },
  { value: "gr", label: "Gramos (gr)" },
  { value: "unit", label: "Unidades" },
]

export function ItemFormSheet({
  open, onClose, tenantId, itemType, item, canDelete = false,
}: {
  open: boolean
  onClose: () => void
  tenantId: string
  itemType: InventoryItemType
  /** null = alta. El padre monta este componente con `key` por ítem. */
  item?: InventoryItem | null
  canDelete?: boolean
}) {
  const router = useRouter()
  // Sembrado en los inicializadores de useState, nunca con un useEffect:
  // los efectos corren después del pintado y vuelven a correr cuando cambia
  // la identidad de la prop, así que un árbol revalidado que aterrice con
  // el Sheet abierto pisaría lo que la persona está tipeando. El padre
  // monta este componente condicionalmente con `key`, así que un ítem
  // distinto siempre implica una instancia nueva. Ver commit 7173ee8.
  const [name, setName] = useState(item?.name ?? "")
  const [unit, setUnit] = useState<SupplyUnit>((item?.unit as SupplyUnit) ?? "unit")
  const [costPerUnit, setCostPerUnit] = useState(String(item?.cost_per_unit ?? 0))
  const [salePrice, setSalePrice] = useState(String(item?.sale_price ?? 0))
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isSupply = itemType === "supply"
  const isEdit = !!item

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const cost = Number(costPerUnit)
    const price = Number(salePrice)
    const result = isSupply
      ? isEdit
        ? await updateSupply(item!.item_id!, { name, unit, costPerUnit: cost })
        : await createSupply(tenantId, { name, unit, costPerUnit: cost })
      : isEdit
        ? await updateProduct(item!.item_id!, { name, salePrice: price, cost })
        : await createProduct(tenantId, { name, salePrice: price, cost })

    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onClose()
    router.refresh()
  }

  async function handleDelete() {
    if (!item) return
    if (
      !window.confirm(
        `¿Eliminar "${item.name}"? Va a desaparecer del inventario. Los movimientos que ya registraste quedan intactos.`,
      )
    )
      return

    setError(null)
    setDeleting(true)
    const result = await deleteInventoryItem(item.item_id!, itemType)
    setDeleting(false)
    if (!result.ok) {
      // Se muestra en el banner y no se cierra el Sheet: el error que queda
      // es de permiso, y cerrar haría desaparecer la explicación.
      setError(result.error)
      return
    }
    onClose()
    router.refresh()
  }

  const title = isEdit
    ? isSupply ? "Editar insumo" : "Editar producto"
    : isSupply ? "Nuevo insumo" : "Nuevo producto"

  return (
    <Sheet open={open} onClose={onClose} title={title} side="right">
      {/* noValidate: la validación HTML5 de min/step bloquea el submit
          nativamente y en silencio para valores válidos. La validación real
          vive en la server action y se muestra en este banner. Ver 26388bd. */}
      <form onSubmit={handleSubmit} noValidate>
        {error ? <p className="error-banner">{error}</p> : null}

        <Field label="Nombre" htmlFor="item-name">
          <Input id="item-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>

        {isSupply ? (
          <Field label="Unidad" htmlFor="item-unit">
            <select
              id="item-unit"
              className="input"
              value={unit}
              onChange={(e) => setUnit(e.target.value as SupplyUnit)}
            >
              {UNITS.map((u) => (
                <option key={u.value} value={u.value}>{u.label}</option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="Precio de venta" htmlFor="item-sale-price">
            <Input
              id="item-sale-price"
              type="number"
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
              required
            />
          </Field>
        )}

        <Field
          label={isSupply ? "Costo por unidad" : "Costo"}
          htmlFor="item-cost"
          hint={isSupply ? "Lo que te cuesta cada ml, gr o unidad." : "Lo que te cuesta comprarlo."}
        >
          <Input
            id="item-cost"
            type="number"
            value={costPerUnit}
            onChange={(e) => setCostPerUnit(e.target.value)}
            required
          />
        </Field>

        <Button type="submit" disabled={loading}>
          {loading ? "Guardando..." : isEdit ? "Guardar cambios" : isSupply ? "Crear insumo" : "Crear producto"}
        </Button>

        {isEdit && canDelete ? (
          <>
            {" "}
            <Button type="button" variant="danger" onClick={handleDelete} disabled={deleting}>
              <Trash size={16} weight="bold" /> {deleting ? "Eliminando..." : "Eliminar"}
            </Button>
          </>
        ) : null}
      </form>
    </Sheet>
  )
}
```

- [ ] **Step 2: Escribir `AdjustStockSheet.tsx`**

```tsx
"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Button, Field, Input, Sheet } from "@beautycrm/ui"
import { adjustStock, setMinAlertLevel } from "@/lib/inventory-actions"
import type { AdjustmentKind, InventoryItem, InventoryMovement } from "@/lib/inventory-types"

const KINDS: { value: AdjustmentKind; label: string; amountLabel: string; hint: string }[] = [
  { value: "compra",   label: "Compra",           amountLabel: "Cantidad que entró",  hint: "Suma al stock." },
  { value: "rotura",   label: "Rotura o pérdida", amountLabel: "Cantidad que se perdió", hint: "Resta del stock." },
  { value: "recuento", label: "Recuento",         amountLabel: "Cuánto contaste",     hint: "Es el total que hay, no la diferencia." },
  { value: "ajuste",   label: "Otro ajuste",      amountLabel: "Cantidad (con signo)", hint: "Usá un número negativo para restar." },
]

const REASON_LABELS: Record<string, string> = {
  compra: "Compra",
  rotura: "Rotura o pérdida",
  recuento: "Recuento",
  ajuste: "Ajuste",
  venta: "Venta",
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Mendoza" })
}

export function AdjustStockSheet({
  open, onClose, branchId, item, movements,
}: {
  open: boolean
  onClose: () => void
  branchId: string
  item: InventoryItem
  movements: InventoryMovement[]
}) {
  const router = useRouter()
  // Mismo criterio de siembra que ItemFormSheet: sin useEffect, con el
  // padre montando por `key`.
  const [kind, setKind] = useState<AdjustmentKind>("compra")
  const [amount, setAmount] = useState("")
  const [note, setNote] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [minLevel, setMinLevel] = useState(String(item.min_alert_level ?? 0))
  const [savingMin, setSavingMin] = useState(false)
  const [minError, setMinError] = useState<string | null>(null)

  const selected = KINDS.find((k) => k.value === kind)!

  // El mínimo va en su propio form y no en el de movimientos: no mueve
  // stock, así que no genera un movimiento — y mezclarlo obligaría a
  // registrar un ajuste falso sólo para cambiar el nivel de aviso.
  async function handleSaveMinimum(e: FormEvent) {
    e.preventDefault()
    setMinError(null)
    setSavingMin(true)

    const result = await setMinAlertLevel(branchId, item.item_id!, item.item_type!, Number(minLevel))

    setSavingMin(false)
    if (!result.ok) {
      setMinError(result.error)
      return
    }
    router.refresh()
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const result = await adjustStock(
      branchId, item.item_id!, item.item_type!, kind, Number(amount), note.trim() || null,
    )

    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onClose()
    router.refresh()
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Ajustar stock — ${item.name}`} side="right">
      <form onSubmit={handleSubmit} noValidate>
        {error ? <p className="error-banner">{error}</p> : null}

        <p style={{ color: "var(--color-ink-soft)" }}>Stock actual: {item.current_stock}</p>

        <Field label="Tipo de movimiento" htmlFor="adjust-kind">
          <select
            id="adjust-kind"
            className="input"
            value={kind}
            onChange={(e) => setKind(e.target.value as AdjustmentKind)}
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </Field>

        <Field label={selected.amountLabel} htmlFor="adjust-amount" hint={selected.hint}>
          <Input
            id="adjust-amount"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </Field>

        <Field label="Nota" htmlFor="adjust-note" hint="Opcional. Por ejemplo: proveedor, motivo.">
          <Input id="adjust-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        <Button type="submit" disabled={loading}>
          {loading ? "Registrando..." : "Registrar movimiento"}
        </Button>
      </form>

      <form onSubmit={handleSaveMinimum} noValidate style={{ marginTop: "var(--space-6)" }}>
        <h3>Aviso de stock bajo</h3>
        {minError ? <p className="error-banner">{minError}</p> : null}
        <Field
          label="Avisarme cuando baje de"
          htmlFor="min-alert-level"
          hint="En 0 no te avisa nunca."
        >
          <Input
            id="min-alert-level"
            type="number"
            value={minLevel}
            onChange={(e) => setMinLevel(e.target.value)}
          />
        </Field>
        <Button type="submit" variant="secondary" disabled={savingMin}>
          {savingMin ? "Guardando..." : "Guardar mínimo"}
        </Button>
      </form>

      <h3 style={{ marginTop: "var(--space-6)" }}>Últimos movimientos</h3>
      {movements.length === 0 ? (
        <p style={{ color: "var(--color-ink-soft)" }}>Todavía no hay movimientos de este ítem.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Motivo</th>
              <th>Cambio</th>
              <th>Quedó en</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.id}>
                <td>{formatDate(m.created_at)}</td>
                <td>{REASON_LABELS[m.reason] ?? m.reason}{m.note ? ` — ${m.note}` : ""}</td>
                <td>{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                <td>{m.resulting_stock}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Sheet>
  )
}
```

- [ ] **Step 3: Escribir `InventoryList.tsx`**

```tsx
"use client"

import { useMemo, useState } from "react"
import { Plus, Package } from "@phosphor-icons/react"
import { Badge, Button, Card, EmptyState, StatTile } from "@beautycrm/ui"
import type { InventoryItem, InventoryItemType, InventoryMovement } from "@/lib/inventory-types"
import { ItemFormSheet } from "./ItemFormSheet"
import { AdjustStockSheet } from "./AdjustStockSheet"

const UNIT_LABELS: Record<string, string> = { ml: "ml", gr: "gr", unit: "u." }

function formatPrice(n: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n)
}

export function InventoryList({
  tenantId, branchId, items, movementsByItem, role,
}: {
  tenantId: string
  branchId: string
  items: InventoryItem[]
  /** Movimientos precargados por item_id, para el Sheet de ajuste. */
  movementsByItem: Record<string, InventoryMovement[]>
  role: string
}) {
  const [creating, setCreating] = useState<InventoryItemType | null>(null)
  const [editing, setEditing] = useState<InventoryItem | null>(null)
  const [adjusting, setAdjusting] = useState<InventoryItem | null>(null)

  const canDelete = role === "owner"

  const supplies = useMemo(() => items.filter((i) => i.item_type === "supply"), [items])
  const products = useMemo(() => items.filter((i) => i.item_type === "product"), [items])
  const belowMinimum = useMemo(() => items.filter((i) => i.below_minimum).length, [items])

  function renderTable(rows: InventoryItem[], type: InventoryItemType) {
    return (
      <table>
        <thead>
          <tr>
            <th>{type === "supply" ? "Insumo" : "Producto"}</th>
            <th>{type === "supply" ? "Unidad" : "Precio"}</th>
            <th>Stock</th>
            <th>Mínimo</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.item_id}>
              <td>
                <button type="button" className="link-button" onClick={() => setEditing(item)}>
                  {item.name}
                </button>
                {item.below_minimum ? (
                  <>
                    {" "}
                    <Badge tone="warning">Bajo</Badge>
                  </>
                ) : null}
              </td>
              <td>
                {type === "supply"
                  ? UNIT_LABELS[item.unit ?? "unit"]
                  : formatPrice(Number(item.sale_price ?? 0))}
              </td>
              <td>{item.current_stock}</td>
              <td>{item.min_alert_level}</td>
              <td>
                <Button variant="secondary" onClick={() => setAdjusting(item)}>
                  Ajustar
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <div>
      <div className="stat-grid" style={{ marginBottom: "var(--space-6)" }}>
        <StatTile label="Ítems bajo el mínimo" value={belowMinimum} />
      </div>

      <Card style={{ marginBottom: "var(--space-4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-3)" }}>
          <h2>Insumos</h2>
          <Button onClick={() => setCreating("supply")}>
            <Plus size={16} weight="bold" /> Nuevo insumo
          </Button>
        </div>
        {supplies.length === 0 ? (
          <EmptyState
            icon={<Package size={24} weight="regular" />}
            title="Todavía no hay insumos"
            description="Cargá lo que usás en los servicios para poder controlar su stock."
          />
        ) : (
          renderTable(supplies, "supply")
        )}
      </Card>

      <Card style={{ marginBottom: "var(--space-4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-3)" }}>
          <h2>Productos de reventa</h2>
          <Button onClick={() => setCreating("product")}>
            <Plus size={16} weight="bold" /> Nuevo producto
          </Button>
        </div>
        {products.length === 0 ? (
          <EmptyState
            icon={<Package size={24} weight="regular" />}
            title="Todavía no hay productos"
            description="Cargá lo que vendés al público para poder controlar su stock."
          />
        ) : (
          renderTable(products, "product")
        )}
      </Card>

      {/* Montaje condicional con `key` en vez de dejar los Sheets siempre
          montados con `open` alternando: así cada entidad obtiene una
          instancia nueva y su estado nace ya sembrado, sin ventana de
          carrera. Ver el comentario en ItemFormSheet.tsx. */}
      {creating && (
        <ItemFormSheet
          key={`create-${creating}`}
          open
          onClose={() => setCreating(null)}
          tenantId={tenantId}
          itemType={creating}
        />
      )}
      {editing && (
        <ItemFormSheet
          key={editing.item_id!}
          open
          onClose={() => setEditing(null)}
          tenantId={tenantId}
          itemType={editing.item_type!}
          item={editing}
          canDelete={canDelete}
        />
      )}
      {adjusting && (
        <AdjustStockSheet
          key={`adjust-${adjusting.item_id}`}
          open
          onClose={() => setAdjusting(null)}
          branchId={branchId}
          item={adjusting}
          movements={movementsByItem[adjusting.item_id!] ?? []}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Reemplazar `page.tsx`**

```tsx
import { redirect } from "next/navigation"
import { getCurrentMembership } from "@/lib/session"
import { getInventory, getItemMovements } from "@/lib/inventory-queries"
import type { InventoryMovement } from "@/lib/inventory-types"
import { InventoryList } from "./InventoryList"

export default async function InventarioPage() {
  const { user, membership } = await getCurrentMembership()
  if (!user || !membership) redirect("/login")

  // Sin selector de sucursal: el tenant es mode='single' y el doc de
  // arquitectura (A.3) pide ocultarlo con auto-selección.
  const branchId = membership.branch_id
  if (!branchId) redirect("/dashboard")

  const items = await getInventory(membership.tenant_id)

  // Los movimientos se precargan acá y no dentro del Sheet: el Sheet es un
  // Client Component y no puede hacer queries server-only. A esta escala
  // (decenas de ítems) es una consulta por ítem contra un índice.
  const movementsByItem: Record<string, InventoryMovement[]> = {}
  await Promise.all(
    items.map(async (item) => {
      movementsByItem[item.item_id!] = await getItemMovements(branchId, item.item_id!, item.item_type!)
    }),
  )

  return (
    <div>
      <h1>Inventario</h1>
      {/* role viaja hasta el Sheet para decidir si se muestra "Eliminar":
          el borrado es owner-only. El layout de /dashboard ya sacó a las
          operadoras, así que acá role es owner o supervisor. */}
      <InventoryList
        tenantId={membership.tenant_id}
        branchId={branchId}
        items={items}
        movementsByItem={movementsByItem}
        role={membership.role}
      />
    </div>
  )
}
```

- [ ] **Step 5: Activar el módulo en el sidebar**

En `apps/web/components/Sidebar.tsx`, línea 31, cambiar `implemented: false` por `implemented: true` en el item de Inventario.

- [ ] **Step 6: Verificar que compila**

Run: `cd apps/web && pnpm exec tsc --noEmit`
Expected: sin errores.

- [ ] **Step 7: Verificación manual en el browser**

Levantar `pnpm dev`, entrar a `/dashboard/inventario` con un usuario dueño y confirmar: se crean insumo y producto, aparecen con stock 0 y sin badge "Bajo", el Sheet de ajuste cambia la etiqueta del campo al elegir "Recuento", y después de un ajuste el stock y el historial se actualizan.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/dashboard/inventario apps/web/components/Sidebar.tsx
git commit -m "feat(web): módulo Inventario — catálogos, stock por sucursal y ajustes"
```

---

### Task 4: E2E del recorrido completo

**Files:**
- Create: `apps/web/tests/e2e/inventario.spec.ts`

**Interfaces:**
- Consumes: la ruta `/dashboard/inventario` de Task 3.

- [ ] **Step 1: Escribir el spec**

Crear `apps/web/tests/e2e/inventario.spec.ts`. Setup completo primero:

```ts
import { test, expect } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"

/**
 * E2E del módulo Inventario: alta de un insumo, compra, recuento, historial
 * de movimientos y alerta de mínimo. Mismo patrón que servicios.spec.ts:
 * tenant 100% descartable.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const ownerEmail = `e2e-inventario-owner-${Date.now()}@example.com`
const businessName = `E2E Inventario Salon ${Date.now()}`

let ownerId: string | undefined
let tenantId: string | undefined

test.afterAll(async () => {
  if (tenantId) {
    // El orden importa: inventory y inventory_movements referencian
    // branches, así que van antes que la sucursal.
    const { data: branches } = await admin.from("branches").select("id").eq("tenant_id", tenantId)
    const branchIds = (branches ?? []).map((b) => b.id)
    if (branchIds.length > 0) {
      await admin.from("inventory").delete().in("branch_id", branchIds)
    }
    await admin.from("inventory_movements").delete().eq("tenant_id", tenantId)
    await admin.from("supplies").delete().eq("tenant_id", tenantId)
    await admin.from("retail_products").delete().eq("tenant_id", tenantId)
    await admin.from("memberships").delete().eq("tenant_id", tenantId)
    await admin.from("branches").delete().eq("tenant_id", tenantId)
    await admin.from("commission_rules").delete().eq("tenant_id", tenantId)
    await admin.from("tenants").delete().eq("id", tenantId)
  }
  if (ownerId) {
    await admin.from("users").delete().eq("id", ownerId)
    await admin.auth.admin.deleteUser(ownerId)
  }
})

test.beforeAll(async ({ request }) => {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000"
  await request.get(`${baseURL}/auth/confirm?type=magiclink`).catch(() => {})

  const { data: ownerData, error: ownerError } = await admin.auth.admin.createUser({
    email: ownerEmail,
    email_confirm: true,
  })
  if (ownerError || !ownerData.user) throw new Error(`No pude crear el owner: ${ownerError?.message}`)
  ownerId = ownerData.user.id

  const ownerAnon = createClient(SUPABASE_URL, ANON_KEY)
  const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email: ownerEmail })
  const hashedToken = linkData?.properties?.hashed_token
  if (!hashedToken) throw new Error("No pude generar el magic link del owner")

  const { error: verifyError } = await ownerAnon.auth.verifyOtp({ type: "magiclink", token_hash: hashedToken })
  if (verifyError) throw new Error(`No pude verificar el magic link: ${verifyError.message}`)

  const { data: tenantRow, error: tenantError } = await ownerAnon.rpc("provision_tenant", {
    p_business_name: businessName,
  })
  if (tenantError || !tenantRow?.[0]) throw new Error(`provision_tenant falló: ${tenantError?.message}`)
  tenantId = tenantRow[0].tenant_id
})
```

Y el test:

```ts
test("alta de insumo, compra, recuento, historial y alerta de mínimo", async ({ page }) => {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000"
  const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email: ownerEmail })
  const tokenHash = linkData?.properties?.hashed_token

  await page.goto(`${baseURL}/auth/confirm?token_hash=${tokenHash}&type=magiclink&next=/dashboard/inventario`, {
    waitUntil: "commit",
  })
  await page.waitForURL(/\/dashboard\/inventario$/)
  await expect(page.getByRole("heading", { name: "Inventario" })).toBeVisible()

  // --- Alta de insumo ---
  await page.getByRole("button", { name: "Nuevo insumo" }).click()
  await expect(page.getByRole("heading", { name: "Nuevo insumo" })).toBeVisible()
  await page.getByLabel("Nombre").fill("Esmalte E2E")
  await page.getByLabel("Unidad").selectOption("ml")
  await page.getByLabel("Costo por unidad").fill("800")
  await page.getByRole("button", { name: "Crear insumo" }).click()
  await expect(page.getByRole("heading", { name: "Nuevo insumo" })).toBeHidden()

  // Aparece con stock 0 y SIN badge "Bajo": un mínimo en 0 significa
  // "no me avises", no "avisame siempre".
  const row = page.getByRole("row", { name: /Esmalte E2E/ })
  await expect(row).toBeVisible({ timeout: 10_000 })
  await expect(row.getByText("Bajo")).toHaveCount(0)

  // --- Compra de 10 ---
  await row.getByRole("button", { name: "Ajustar" }).click()
  await expect(page.getByRole("heading", { name: /Ajustar stock/ })).toBeVisible()
  await page.getByLabel("Tipo de movimiento").selectOption("compra")
  await page.getByLabel("Cantidad que entró").fill("10")
  await page.getByRole("button", { name: "Registrar movimiento" }).click()
  await expect(page.getByRole("heading", { name: /Ajustar stock/ })).toBeHidden()
  await expect(page.getByRole("row", { name: /Esmalte E2E/ }).getByText("10")).toBeVisible({ timeout: 10_000 })

  // --- Recuento de 7 ---
  // El campo cambia de etiqueta al elegir "Recuento": pide el total contado,
  // no la diferencia. La resta la hace record_stock_count bajo su lock.
  await page.getByRole("row", { name: /Esmalte E2E/ }).getByRole("button", { name: "Ajustar" }).click()
  await page.getByLabel("Tipo de movimiento").selectOption("recuento")
  await page.getByLabel("Cuánto contaste").fill("7")
  await page.getByRole("button", { name: "Registrar movimiento" }).click()
  await expect(page.getByRole("heading", { name: /Ajustar stock/ })).toBeHidden()
  await expect(page.getByRole("row", { name: /Esmalte E2E/ }).getByText("7")).toBeVisible({ timeout: 10_000 })

  // --- El historial muestra los dos movimientos ---
  await page.getByRole("row", { name: /Esmalte E2E/ }).getByRole("button", { name: "Ajustar" }).click()
  await expect(page.getByRole("heading", { name: "Últimos movimientos" })).toBeVisible()
  await expect(page.getByRole("cell", { name: "Compra" })).toBeVisible()
  await expect(page.getByRole("cell", { name: "Recuento" })).toBeVisible()
  await expect(page.getByRole("cell", { name: "+10", exact: true })).toBeVisible()
  await expect(page.getByRole("cell", { name: "-3", exact: true })).toBeVisible()

  // --- Alerta de mínimo ---
  // El mínimo se guarda en su propio form del mismo Sheet: no mueve stock,
  // así que no genera movimiento. Con el stock en 7 y el mínimo en 8, la
  // fila tiene que pasar a mostrar el badge "Bajo".
  await page.getByLabel("Avisarme cuando baje de").fill("8")
  await page.getByRole("button", { name: "Guardar mínimo" }).click()
  await expect(page.getByRole("row", { name: /Esmalte E2E/ }).getByText("Bajo")).toBeVisible({
    timeout: 10_000,
  })

  // Y el contador de arriba lo refleja.
  await page.getByRole("button", { name: "Cerrar" }).click()
  await expect(page.getByText("Ítems bajo el mínimo")).toBeVisible()
  await expect(page.locator(".stat-tile-value")).toHaveText("1")
})
```

- [ ] **Step 2: Levantar la app y correr el spec**

Run: `cd apps/web && pnpm exec playwright test tests/e2e/inventario.spec.ts`
Expected: PASS.

Si el dev server ya corre en otra terminal, usar `PLAYWRIGHT_BASE_URL=http://localhost:3000` para no levantar uno nuevo — y **verificar que ese server corre desde este worktree**, no desde otro checkout: un server viejo sirve código viejo y el test falla por la razón equivocada.

- [ ] **Step 3: Correr la suite completa**

Run: `cd apps/web && pnpm exec playwright test tests/e2e` y las cuatro suites de seguridad (`test:security`, `test:agenda`, `test:clientes`, `test:servicios`, `test:inventario`).
Expected: todo verde. El Panel de control lee `inventory`, así que un cambio acá podría afectarlo.

- [ ] **Step 4: Commit**

```bash
git add apps/web/tests/e2e/inventario.spec.ts
git commit -m "test(web): E2E de Inventario — alta, compra, recuento e historial"
```

---

## Cobertura de la spec

| Requisito de la spec | Dónde se cumple |
|---|---|
| Tabla `inventory_movements` inmutable | Task 1, Step 5 (sin policies de escritura) + Test 5 |
| `resulting_stock` congelado | Task 1, Step 5 + Test 6 |
| Recuento guardado como delta | Task 1 (`record_stock_count`) + Task 4 (asserts de `+10` y `-3`) |
| RPC único camino, owner/supervisor | Task 1 (`adjust_stock`) + Tests 3 y 5 |
| Rechazo de saldo negativo | Task 1 + Test 4 |
| `deleted_at` en ambos catálogos, borrado owner-only | Task 1 + Test 7 |
| Vista `v_inventory` con `below_minimum` | Task 1, Step 5 |
| `min_alert_level` sin RPC | Task 2 (`setMinAlertLevel`) + Task 3 (form propio en `AdjustStockSheet`) + Task 4 (badge "Bajo") |
| Dos Cards, sin selector de sucursal | Task 3 (`InventoryList`, `page.tsx`) |
| Sheet de ajuste con 4 tipos | Task 3 (`AdjustStockSheet`) |
| Historial dentro del Sheet | Task 3 + Task 4 |
| Sin `useEffect` de siembra, con `key` | Task 3, Steps 1–3 |
| `noValidate` y validación en el submit | Task 3, Steps 1–2 |
| Aislamiento cross-tenant | Task 1, Test 8 |

## Desvío respecto de la spec

La spec decía que el recuento se traduce a `delta = contado − saldo`. El plan mantiene esa semántica pero mueve la resta a un RPC propio (`record_stock_count`) en vez de calcularla en el cliente: si el cliente restara contra un saldo leído unos segundos antes, un ajuste concurrente lo volvería incorrecto. Adentro del RPC el saldo se lee bajo el mismo `FOR UPDATE` con el que después se escribe.
