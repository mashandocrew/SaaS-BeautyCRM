# Módulo Caja / POS — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el módulo Caja/POS en `/dashboard/caja`: cobro de turnos de la agenda y ventas de mostrador, con pagos mixtos, anulación con compensación contable, y apertura/cierre de caja con arqueo.

**Architecture:** Next.js 14 App Router + Supabase (RLS), mismo patrón que Agenda, Clientes, Servicios e Inventario. **Con migración nueva** (`0013`). Las tablas del motor financiero ya existen desde `0001` y el trigger `on_sale_item_inserted` desde `0004`: este módulo agrega el camino de escritura (4 RPC `security definer`), la anulación, y cierra las policies para que los RPC sean el único camino. Además paga la deuda que dejó Inventario: `process_sale_item` pasa a escribir `inventory_movements`.

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript strict, Supabase (`@supabase/ssr`), `@beautycrm/ui`, `@phosphor-icons/react`, Playwright, tsx.

**Spec:** `docs/superpowers/specs/2026-08-14-caja-pos-module-design.md`

## Global Constraints

- **Nunca contra el tenant real.** Todos los tests provisionan tenants descartables vía admin API y los borran en el `finally`.
- **Las ventas sólo se escriben por RPC.** Después de la Task 3, `sales`, `sale_items` y `payments` no llevan policies de `insert`/`update`/`delete`. Escribir una venta sin pasar por `confirm_sale` es un bug.
- **Una venta es un documento contable.** Se confirma o no existe; se anula con asientos que compensan, nunca se edita ni se borra.
- **El precio lo pone el servidor.** `confirm_sale` no recibe `unit_price`. Para ítems de un turno usa `appointment_services.price_snapshot`; si no, el catálogo.
- **El descuento no reduce la comisión.** Se calcula sobre `unit_price * quantity`.
- **Vender nunca se bloquea por falta de stock.** El saldo puede quedar negativo. Deliberadamente opuesto a `adjust_stock`.
- **Sólo el efectivo cuenta para el arqueo.**
- **Sin `useEffect` para hidratar formularios.** Estado en los inicializadores de `useState`, montaje condicional con `key`. Ver `ItemFormSheet.tsx` y el commit `7173ee8`.
- **Formularios con `noValidate`.** Validación en el submit, mostrada en el banner del Sheet. Ver commit `26388bd`.
- **Sin selector de sucursal**, con el fallback a `getDefaultBranch`: la membresía de la dueña tiene `branch_id = null` por diseño de `provision_tenant` (0003:58). Ver `inventario/page.tsx` y el commit `917abae`.
- **Fuera de alcance:** liquidación de comisiones (`settled`), reportes, impresión de ticket, devolución parcial, y procesar el cobro por Mercado Pago (`method = 'mp'` sólo registra).
- Textos de UI en español rioplatense.

## File Structure

```
migrations/0013_caja_pos.sql                     apply_stock_delta, voided_at, RPCs, policies
apps/web/tests/security/caja-behavior.test.ts    invariantes de base (Tasks 1-3)
apps/web/lib/caja-types.ts                       tipos compartidos
apps/web/lib/caja-queries.ts                     lecturas (server-only)
apps/web/lib/caja-actions.ts                     mutaciones (server actions)
apps/web/app/dashboard/caja/page.tsx             Server Component, reemplaza el ComingSoon
apps/web/app/dashboard/caja/CajaScreen.tsx       los tres estados de la caja
apps/web/app/dashboard/caja/SaleForm.tsx         carrito, descuento y pagos
apps/web/app/dashboard/caja/SalesList.tsx        ventas del turno + anular
apps/web/app/dashboard/agenda/...                botón "Cobrar" en el turno
apps/web/components/Sidebar.tsx:32               implemented: true
packages/supabase/src/types.ts                   columnas y RPC nuevos
apps/web/package.json                            script test:caja
package.json                                     script test:caja
apps/web/tests/e2e/caja.spec.ts                  recorrido completo
```

---

### Task 1: El stock de una venta deja rastro

Paga la deuda que dejó Inventario. Hoy `app.process_sale_item` hace `update inventory set current_stock = ... - n` directo, sin escribir `inventory_movements`. Se extrae de `app.adjust_stock` un helper interno sin chequeo de permisos y lo usan los dos.

Task independiente y valiosa por sí sola: arregla el historial de stock aunque el resto del módulo no exista todavía.

**Files:**
- Create: `apps/web/tests/security/caja-behavior.test.ts`
- Create: `migrations/0013_caja_pos.sql`
- Modify: `apps/web/package.json` (scripts)
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `app.adjust_stock` y `app.process_sale_item` (ya existen), `inventory_movement_reason` con `'venta'` (0012).
- Produces: `app.apply_stock_delta(p_tenant_id uuid, p_branch_id uuid, p_item_id uuid, p_item_type inventory_item_type, p_delta numeric, p_reason inventory_movement_reason, p_note text, p_allow_negative boolean) returns numeric`.

- [ ] **Step 1: Escribir el test**

Crear `apps/web/tests/security/caja-behavior.test.ts`. En esta task sólo el andamiaje y el primer test; las Tasks 2 y 3 le agregan más.

```ts
/**
 * Invariantes del módulo Caja a nivel de datos: quién puede cobrar, que el
 * precio lo pone el servidor, que los pagos cierran, que anular compensa en
 * vez de borrar, y que el arqueo sólo cuenta el efectivo.
 *
 * Mismo patrón que tests/security/inventario-behavior.test.ts: datos 100%
 * descartables contra el proyecto real, borrados en el finally.
 *
 * Ejecutar: pnpm test:caja (desde apps/web, con .env.local cargado)
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
  const email = `caja-test-${label}-${Date.now()}@example.com`
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
  let failures = 0

  try {
    console.log("Provisionando tenant de prueba...")
    const owner = await createTestUser("owner")
    userIds.push(owner.id)
    const ownerClient = await signIn(owner.email, owner.password)

    const { data: tenantRow, error: tenantError } = await ownerClient.rpc("provision_tenant", {
      p_business_name: "Caja Test Salon",
    })
    if (tenantError || !tenantRow?.[0]) {
      throw new Error(`provision_tenant falló: ${tenantError?.message}`)
    }
    tenantId = tenantRow[0].tenant_id
    branchId = tenantRow[0].branch_id

    // --- Catálogo mínimo: un producto de reventa con stock ---
    const { data: product, error: productError } = await ownerClient
      .from("retail_products")
      .insert({ tenant_id: tenantId, name: "Shampoo Caja Test", sale_price: 5000, cost: 2000 })
      .select("id")
      .single()
    if (productError || !product) throw new Error(`No pude crear el producto: ${productError?.message}`)
    const productId = product.id

    await ownerClient.rpc("adjust_stock", {
      p_branch_id: branchId,
      p_item_id: productId,
      p_item_type: "product",
      p_delta: 10,
      p_reason: "compra",
      p_note: "carga inicial",
    })

    // --- Test 1 ---
    console.log("Test 1: vender un producto descuenta stock y deja movimiento 'venta'...")
    {
      // Se insertan la venta y el ítem con service_role a propósito: en esta
      // task confirm_sale todavía no existe, y lo que se está probando es el
      // trigger, no el camino de escritura. La Task 3 cierra las policies.
      const { data: sale, error: saleError } = await admin
        .from("sales")
        .insert({ tenant_id: tenantId, branch_id: branchId, total: 5000 })
        .select("id")
        .single()
      if (saleError || !sale) throw new Error(`No pude crear la venta: ${saleError?.message}`)

      const { error: itemError } = await admin.from("sale_items").insert({
        sale_id: sale.id,
        item_type: "product",
        item_id: productId,
        quantity: 1,
        unit_price: 5000,
      })
      if (itemError) throw new Error(`No pude crear el sale_item: ${itemError.message}`)

      const { data: inv } = await admin
        .from("inventory")
        .select("current_stock")
        .eq("branch_id", branchId)
        .eq("item_id", productId)
        .eq("item_type", "product")
        .single()

      const { data: movements } = await admin
        .from("inventory_movements")
        .select("delta, reason, resulting_stock")
        .eq("item_id", productId)
        .eq("reason", "venta")

      const stockOk = Number(inv?.current_stock) === 9
      const movementOk =
        movements?.length === 1 &&
        Number(movements[0].delta) === -1 &&
        Number(movements[0].resulting_stock) === 9

      if (stockOk && movementOk) {
        console.log("  OK — stock 10 → 9 y un movimiento 'venta' de -1")
      } else {
        failures++
        console.error(
          `  FALLO — stock=${inv?.current_stock} (esperaba 9), movimientos=${JSON.stringify(movements)}`,
        )
      }
    }
  } catch (err) {
    failures++
    console.error("Error inesperado:", err instanceof Error ? err.message : err)
  } finally {
    console.log("Limpiando datos de prueba...")
    if (tenantId) {
      const { data: branches } = await admin.from("branches").select("id").eq("tenant_id", tenantId)
      const branchIds = (branches ?? []).map((b) => b.id)
      const { data: sales } = await admin.from("sales").select("id").eq("tenant_id", tenantId)
      const saleIds = (sales ?? []).map((s) => s.id)
      if (saleIds.length > 0) {
        await admin.from("commission_ledger").delete().eq("tenant_id", tenantId)
        await admin.from("payments").delete().in("sale_id", saleIds)
        await admin.from("sale_items").delete().in("sale_id", saleIds)
      }
      await admin.from("sales").delete().eq("tenant_id", tenantId)
      await admin.from("cash_sessions").delete().eq("tenant_id", tenantId)
      await admin.from("inventory_movements").delete().eq("tenant_id", tenantId)
      if (branchIds.length > 0) await admin.from("inventory").delete().in("branch_id", branchIds)
      await admin.from("appointment_services").delete().in("appointment_id",
        ((await admin.from("appointments").select("id").eq("tenant_id", tenantId)).data ?? []).map((a) => a.id))
      await admin.from("appointments").delete().eq("tenant_id", tenantId)
      await admin.from("service_supplies").delete().in("service_id",
        ((await admin.from("services").select("id").eq("tenant_id", tenantId)).data ?? []).map((s) => s.id))
      await admin.from("services").delete().eq("tenant_id", tenantId)
      await admin.from("supplies").delete().eq("tenant_id", tenantId)
      await admin.from("retail_products").delete().eq("tenant_id", tenantId)
      await admin.from("clients").delete().eq("tenant_id", tenantId)
      await admin.from("memberships").delete().eq("tenant_id", tenantId)
      await admin.from("branches").delete().eq("tenant_id", tenantId)
      await admin.from("commission_rules").delete().eq("tenant_id", tenantId)
      await admin.from("tenants").delete().eq("id", tenantId)
    }
    for (const id of userIds) {
      await admin.from("users").delete().eq("id", id)
      await admin.auth.admin.deleteUser(id)
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} test(s) de Caja fallaron.`)
    process.exit(1)
  }
  console.log("\nTodos los tests de comportamiento de Caja pasaron.")
}

main()
```

- [ ] **Step 2: Agregar el script a `apps/web/package.json`**

Después de `test:inventario`, mismo formato:

```json
"test:caja": "tsx --env-file=.env.local tests/security/caja-behavior.test.ts",
```

- [ ] **Step 3: Agregar el script al `package.json` raíz**

Después de `test:inventario`:

```json
"test:caja": "pnpm --filter @beautycrm/web test:caja",
```

- [ ] **Step 4: Correr el test y verificar que falla**

Run: `cd apps/web && pnpm test:caja`
Expected: FALLO en el Test 1 — el stock baja a 9 (el trigger de `0004` ya lo hace) pero `movimientos=[]`, porque `process_sale_item` todavía no escribe `inventory_movements`. Ése es exactamente el bug que la migración arregla.

- [ ] **Step 5: Escribir la primera parte de `migrations/0013_caja_pos.sql`**

```sql
-- ============================================================================
-- BeautyCRM — 0013_caja_pos.sql
-- Módulo Caja / POS: el camino de escritura de una venta, la anulación con
-- compensación contable, y el arqueo de caja.
--
-- Además paga una deuda de 0012: app.process_sale_item descontaba
-- inventory.current_stock sin escribir inventory_movements, así que apenas
-- el POS vendiera algo el historial de stock habría empezado a mentir.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) La mecánica del stock, en un solo lugar
-- ---------------------------------------------------------------------------
-- Se extrae de app.adjust_stock (0012) la parte que no depende de quién
-- llama: tomar el lock, mover el saldo, escribir el movimiento. Sin chequeo
-- de permisos — eso es responsabilidad de cada puerta de entrada.
--
-- p_allow_negative existe porque las dos puertas necesitan reglas opuestas:
-- un ajuste manual NO puede dejar el stock negativo (la persona está
-- declarando un número y puede corregirlo), pero una venta SÍ (el servicio
-- ya se prestó, y negarse a cobrarlo porque un número no cuadra es peor que
-- el número en negativo).
create or replace function app.apply_stock_delta(
  p_tenant_id      uuid,
  p_branch_id      uuid,
  p_item_id        uuid,
  p_item_type      inventory_item_type,
  p_delta          numeric,
  p_reason         inventory_movement_reason,
  p_note           text,
  p_allow_negative boolean
)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_new_stock numeric;
begin
  insert into inventory (branch_id, item_id, item_type, current_stock)
  values (p_branch_id, p_item_id, p_item_type, 0)
  on conflict (branch_id, item_id, item_type) do nothing;

  -- FOR UPDATE: dos escrituras simultáneas sobre el mismo ítem tienen que
  -- serializarse. Sin el lock, ambas leerían el mismo saldo y la segunda
  -- pisaría a la primera — el stock quedaría mal y el historial mostraría
  -- un resulting_stock que nunca existió.
  select current_stock into v_new_stock from inventory
   where branch_id = p_branch_id and item_id = p_item_id and item_type = p_item_type
   for update;

  v_new_stock := v_new_stock + p_delta;

  if v_new_stock < 0 and not p_allow_negative then
    raise exception 'NEGATIVE_STOCK' using errcode = '22023';
  end if;

  update inventory set current_stock = v_new_stock
   where branch_id = p_branch_id and item_id = p_item_id and item_type = p_item_type;

  insert into inventory_movements
    (tenant_id, branch_id, item_id, item_type, delta, resulting_stock, reason, note, created_by)
  values
    (p_tenant_id, p_branch_id, p_item_id, p_item_type, p_delta, v_new_stock, p_reason,
     nullif(btrim(coalesce(p_note, '')), ''), auth.uid());

  return v_new_stock;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2) adjust_stock pasa a delegar la mecánica
-- ---------------------------------------------------------------------------
-- Mismo comportamiento externo que en 0012 (mismos errores, mismo retorno):
-- lo único que cambia es que el lock y el movimiento ahora viven en
-- apply_stock_delta. La firma pública no se toca.
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
begin
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

  -- allow_negative = false: un ajuste manual no puede dejar el stock negativo.
  return app.apply_stock_delta(
    v_tenant_id, p_branch_id, p_item_id, p_item_type, p_delta, p_reason, p_note, false
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3) process_sale_item deja rastro
-- ---------------------------------------------------------------------------
-- Idéntico a 0004 salvo el descuento de stock, que ahora pasa por
-- apply_stock_delta con reason='venta' y allow_negative=true.
create or replace function app.process_sale_item()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id uuid;
  v_branch_id uuid;
  v_rule      commission_rules%rowtype;
  v_pct       numeric;
  v_amount    numeric;
  r           record;
begin
  select tenant_id, branch_id into v_tenant_id, v_branch_id
  from sales where id = new.sale_id;

  if v_tenant_id is null then
    raise exception 'sale_id % no corresponde a ninguna venta', new.sale_id;
  end if;

  -- 1) Descuento de inventario
  if new.item_type = 'service' then
    for r in
      select supply_id, quantity_consumed
      from service_supplies
      where service_id = new.item_id
    loop
      perform app.apply_stock_delta(
        v_tenant_id, v_branch_id, r.supply_id, 'supply',
        -(r.quantity_consumed * new.quantity), 'venta',
        'Consumo por venta ' || new.sale_id, true
      );
    end loop;

  elsif new.item_type = 'product' then
    perform app.apply_stock_delta(
      v_tenant_id, v_branch_id, new.item_id, 'product',
      -new.quantity, 'venta',
      'Venta ' || new.sale_id, true
    );
  end if;

  -- 2) Liquidación de comisión (si hay operador)
  --    Sobre unit_price * quantity: el descuento de la venta lo absorbe el
  --    salón, no la operadora.
  if new.operator_id is not null then
    select cr.* into v_rule
    from memberships m
    join commission_rules cr on cr.id = m.commission_rule_id
    where m.tenant_id = v_tenant_id
      and m.user_id = new.operator_id
    order by (m.branch_id = v_branch_id) desc, (m.branch_id is null) desc
    limit 1;

    if found then
      v_pct := case new.item_type
                 when 'service' then v_rule.service_pct
                 when 'product' then v_rule.product_sale_pct
                 else 0
               end;
      v_amount := (new.unit_price * new.quantity) * (v_pct / 100.0);

      insert into commission_ledger
        (tenant_id, operator_id, sale_item_id, amount, rule_snapshot, period, settled)
      values
        (v_tenant_id, new.operator_id, new.id, v_amount, to_jsonb(v_rule),
         to_char(now(), 'YYYY-MM'), false);
    end if;
  end if;

  return new;
end;
$function$;
```

- [ ] **Step 6: Aplicar la migración**

Usar `mcp__plugin_supabase_supabase__apply_migration` con `project_id: "xhbrhpfzehshiyjzlxnx"` y `name: "caja_pos"`. Enviar exactamente el mismo SQL que quedó versionado en el archivo.

- [ ] **Step 7: Correr el test y verificar que pasa**

Run: `cd apps/web && pnpm test:caja`
Expected: PASS — "stock 10 → 9 y un movimiento 'venta' de -1".

Correr también `pnpm test:inventario`: la refactorización tocó `adjust_stock`, y sus 8 tests tienen que seguir en verde sin cambios.

- [ ] **Step 8: Commit**

```bash
git add migrations/0013_caja_pos.sql apps/web/tests/security/caja-behavior.test.ts apps/web/package.json package.json
git commit -m "feat(db): el descuento de stock de una venta deja movimiento"
```

---

### Task 2: Sesiones de caja y arqueo

Abrir y cerrar caja. Sin esto no se puede confirmar ninguna venta (Task 3), así que va antes.

**Files:**
- Modify: `migrations/0013_caja_pos.sql` (agrega al final)
- Modify: `apps/web/tests/security/caja-behavior.test.ts` (agrega Tests 2 y 3)

**Interfaces:**
- Consumes: `app.has_role`, tabla `cash_sessions` (0001).
- Produces: `public.open_cash_session(p_branch_id uuid, p_opening_amount numeric) returns uuid`; `public.close_cash_session(p_session_id uuid, p_counted_total numeric) returns table(expected_total numeric, counted_total numeric, difference numeric)`.

- [ ] **Step 1: Agregar los tests**

En `caja-behavior.test.ts`, después del Test 1 y antes del `catch`:

```ts
    // --- Test 2 ---
    console.log("Test 2: sólo hay una caja abierta por sucursal a la vez...")
    {
      const { data: first, error: firstError } = await ownerClient.rpc("open_cash_session", {
        p_branch_id: branchId,
        p_opening_amount: 1000,
      })
      const { error: secondError } = await ownerClient.rpc("open_cash_session", {
        p_branch_id: branchId,
        p_opening_amount: 2000,
      })

      if (!firstError && first && secondError) {
        console.log("  OK — la primera abrió, la segunda fue rechazada")
      } else {
        failures++
        console.error(
          `  FALLO — primera=${JSON.stringify(firstError ?? first)}, segunda=${JSON.stringify(secondError)}`,
        )
      }
    }

    // --- Test 3 ---
    console.log("Test 3: la operadora no puede abrir ni cerrar caja...")
    {
      const operator = await createTestUser("operator")
      userIds.push(operator.id)
      await admin.from("memberships").insert({
        tenant_id: tenantId,
        user_id: operator.id,
        branch_id: branchId,
        role: "operator",
      })
      const operatorClient = await signIn(operator.email, operator.password)

      const { error } = await operatorClient.rpc("open_cash_session", {
        p_branch_id: branchId,
        p_opening_amount: 500,
      })

      if (error?.code === "42501") {
        console.log("  OK — rechazada con 42501")
      } else {
        failures++
        console.error(`  FALLO — esperaba 42501, llegó: ${JSON.stringify(error)}`)
      }
    }
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd apps/web && pnpm test:caja`
Expected: FALLO en los Tests 2 y 3 con `PGRST202` — `public.open_cash_session` todavía no existe.

- [ ] **Step 3: Agregar el índice y los RPC a `migrations/0013_caja_pos.sql`**

```sql
-- ---------------------------------------------------------------------------
-- 4) Una sola caja abierta por sucursal
-- ---------------------------------------------------------------------------
-- En la base y no en la aplicación: dos pestañas abiertas saltean cualquier
-- chequeo hecho con un select previo.
create unique index if not exists one_open_session_per_branch
  on public.cash_sessions (branch_id) where closed_at is null;

create or replace function app.open_cash_session(
  p_branch_id      uuid,
  p_opening_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id  uuid;
  v_session_id uuid;
begin
  select tenant_id into v_tenant_id from branches where id = p_branch_id;
  if v_tenant_id is null then
    raise exception 'BRANCH_NOT_FOUND' using errcode = '22023';
  end if;

  if not app.has_role(v_tenant_id, array['owner','supervisor']::membership_role[]) then
    raise exception 'NOT_ALLOWED_TO_OPEN_SESSION' using errcode = '42501';
  end if;

  if coalesce(p_opening_amount, 0) < 0 then
    raise exception 'NEGATIVE_OPENING_AMOUNT' using errcode = '22023';
  end if;

  if exists (select 1 from cash_sessions
              where branch_id = p_branch_id and closed_at is null) then
    raise exception 'SESSION_ALREADY_OPEN' using errcode = '22023';
  end if;

  insert into cash_sessions (tenant_id, branch_id, opened_by, opening_amount)
  values (v_tenant_id, p_branch_id, auth.uid(), coalesce(p_opening_amount, 0))
  returning id into v_session_id;

  return v_session_id;
end;
$function$;

create or replace function app.close_cash_session(
  p_session_id    uuid,
  p_counted_total numeric
)
returns table(expected_total numeric, counted_total numeric, difference numeric)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session  cash_sessions%rowtype;
  v_expected numeric;
  v_diff     numeric;
begin
  select * into v_session from cash_sessions where id = p_session_id for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND' using errcode = '22023';
  end if;

  if not app.has_role(v_session.tenant_id, array['owner','supervisor']::membership_role[]) then
    raise exception 'NOT_ALLOWED_TO_CLOSE_SESSION' using errcode = '42501';
  end if;

  if v_session.closed_at is not null then
    raise exception 'SESSION_ALREADY_CLOSED' using errcode = '22023';
  end if;

  if coalesce(p_counted_total, 0) < 0 then
    raise exception 'NEGATIVE_COUNTED_TOTAL' using errcode = '22023';
  end if;

  -- Sólo efectivo: tarjeta, transferencia y MP no están en el cajón, y
  -- meterlos en el esperado haría que el arqueo nunca cierre.
  --
  -- Y sólo ventas no anuladas: si una venta anulada contara, el efectivo
  -- que entró y salió del cajón quedaría sumado dos veces.
  select v_session.opening_amount + coalesce(sum(pay.amount), 0)
    into v_expected
    from payments pay
    join sales s on s.id = pay.sale_id
   where s.cash_session_id = p_session_id
     and s.voided_at is null
     and pay.method = 'cash';

  v_diff := coalesce(p_counted_total, 0) - v_expected;

  update cash_sessions
     set closed_by      = auth.uid(),
         closed_at      = now(),
         expected_total = v_expected,
         counted_total  = coalesce(p_counted_total, 0),
         difference     = v_diff
   where id = p_session_id;

  return query select v_expected, coalesce(p_counted_total, 0), v_diff;
end;
$function$;
```

Nota: `close_cash_session` referencia `sales.voided_at`, que crea la Task 3. Agregar la columna acá, arriba de estos RPC, para que la migración sea aplicable de una sola vez:

```sql
alter table public.sales add column if not exists voided_at  timestamptz;
alter table public.sales add column if not exists voided_by  uuid references public.users(id);
alter table public.sales add column if not exists void_reason text;
```

- [ ] **Step 4: Agregar los wrappers públicos**

```sql
create or replace function public.open_cash_session(
  p_branch_id uuid, p_opening_amount numeric
) returns uuid
language sql security definer set search_path to 'public'
as $$ select app.open_cash_session(p_branch_id, p_opening_amount) $$;

revoke all on function public.open_cash_session(uuid, numeric) from public;
grant execute on function public.open_cash_session(uuid, numeric) to authenticated;

create or replace function public.close_cash_session(
  p_session_id uuid, p_counted_total numeric
) returns table(expected_total numeric, counted_total numeric, difference numeric)
language sql security definer set search_path to 'public'
as $$ select * from app.close_cash_session(p_session_id, p_counted_total) $$;

revoke all on function public.close_cash_session(uuid, numeric) from public;
grant execute on function public.close_cash_session(uuid, numeric) to authenticated;
```

- [ ] **Step 5: Aplicar la migración**

Usar `mcp__plugin_supabase_supabase__apply_migration` con `project_id: "xhbrhpfzehshiyjzlxnx"`, `name: "caja_pos_sessions"`, enviando **sólo el SQL agregado en los Steps 3 y 4** (la primera parte ya se aplicó en la Task 1).

- [ ] **Step 6: Correr los tests y verificar que pasan**

Run: `cd apps/web && pnpm test:caja`
Expected: PASS en los Tests 1, 2 y 3.

- [ ] **Step 7: Commit**

```bash
git add migrations/0013_caja_pos.sql apps/web/tests/security/caja-behavior.test.ts
git commit -m "feat(db): apertura y cierre de caja con arqueo de efectivo"
```

---

### Task 3: Confirmar y anular una venta

El corazón del módulo. `confirm_sale` es el único camino de escritura; `void_sale` compensa sin borrar; y las policies se cierran para que no exista otra puerta.

**Files:**
- Modify: `migrations/0013_caja_pos.sql` (agrega al final)
- Modify: `apps/web/tests/security/caja-behavior.test.ts` (agrega Tests 4 a 9)

**Interfaces:**
- Consumes: `app.apply_stock_delta` (Task 1), `app.open_cash_session` (Task 2).
- Produces: `public.confirm_sale(p_branch_id uuid, p_client_id uuid, p_appointment_id uuid, p_items jsonb, p_payments jsonb, p_discount numeric) returns table(sale_id uuid, total numeric)`; `public.void_sale(p_sale_id uuid, p_reason text) returns void`.

Forma de `p_items`: `[{"item_id": uuid, "item_type": "service"|"product", "quantity": numeric, "operator_id": uuid|null}]`
Forma de `p_payments`: `[{"method": "cash"|"card"|"transfer"|"mp"|"other", "amount": numeric}]`

- [ ] **Step 1: Agregar los tests**

En `caja-behavior.test.ts`, después del Test 3:

```ts
    // --- Test 4 ---
    console.log("Test 4: el precio lo pone el servidor, no el cliente...")
    {
      // No hay forma de mandar unit_price: confirm_sale no lo acepta. El
      // test verifica que lo cobrado sale del catálogo (5000), no de lo que
      // el cliente quisiera.
      const { data, error } = await ownerClient.rpc("confirm_sale", {
        p_branch_id: branchId,
        p_client_id: null,
        p_appointment_id: null,
        p_items: [{ item_id: productId, item_type: "product", quantity: 1, operator_id: null }],
        p_payments: [{ method: "cash", amount: 5000 }],
        p_discount: 0,
      })

      if (!error && Number(data?.[0]?.total) === 5000) {
        console.log("  OK — cobró 5000, el precio del catálogo")
      } else {
        failures++
        console.error(`  FALLO — data=${JSON.stringify(data)}, error=${JSON.stringify(error)}`)
      }
    }

    // --- Test 5 ---
    console.log("Test 5: los pagos tienen que sumar el total...")
    {
      const { error } = await ownerClient.rpc("confirm_sale", {
        p_branch_id: branchId,
        p_client_id: null,
        p_appointment_id: null,
        p_items: [{ item_id: productId, item_type: "product", quantity: 1, operator_id: null }],
        p_payments: [{ method: "cash", amount: 3000 }],
        p_discount: 0,
      })

      const { count } = await admin
        .from("sales")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)

      // Sólo tienen que existir las 2 ventas de los Tests 1 y 4: la
      // rechazada no puede haber dejado nada a medio escribir.
      if (error?.message?.includes("PAYMENTS_DONT_MATCH_TOTAL") && count === 2) {
        console.log("  OK — rechazado y sin venta a medio escribir")
      } else {
        failures++
        console.error(`  FALLO — error=${JSON.stringify(error)}, ventas=${count} (esperaba 2)`)
      }
    }

    // --- Test 6 ---
    console.log("Test 6: nadie escribe sales, sale_items ni payments directo...")
    {
      const { error: saleError } = await ownerClient
        .from("sales")
        .insert({ tenant_id: tenantId, branch_id: branchId, total: 1 })

      const { data: existing } = await admin
        .from("sales").select("id").eq("tenant_id", tenantId).limit(1).single()

      const { error: itemError } = await ownerClient.from("sale_items").insert({
        sale_id: existing!.id, item_type: "product", item_id: productId,
        quantity: 1, unit_price: 1,
      })
      const { error: payError } = await ownerClient
        .from("payments")
        .insert({ sale_id: existing!.id, method: "cash", amount: 1 })

      if (saleError && itemError && payError) {
        console.log("  OK — las tres escrituras directas quedaron bloqueadas")
      } else {
        failures++
        console.error(
          `  FALLO — sale=${JSON.stringify(saleError)}, item=${JSON.stringify(itemError)}, pay=${JSON.stringify(payError)}`,
        )
      }
    }

    // --- Test 7 ---
    console.log("Test 7: anular devuelve el stock y revierte la comisión sin borrar nada...")
    {
      const { data: before } = await admin
        .from("inventory").select("current_stock")
        .eq("branch_id", branchId).eq("item_id", productId).eq("item_type", "product").single()

      const { data: sales } = await admin
        .from("sales").select("id").eq("tenant_id", tenantId)
        .is("voided_at", null).order("created_at", { ascending: false }).limit(1)
      const saleId = sales![0].id

      const { error } = await ownerClient.rpc("void_sale", {
        p_sale_id: saleId,
        p_reason: "cobrada por error",
      })

      const { data: after } = await admin
        .from("inventory").select("current_stock")
        .eq("branch_id", branchId).eq("item_id", productId).eq("item_type", "product").single()

      const { data: sale } = await admin
        .from("sales").select("voided_at, void_reason").eq("id", saleId).single()

      const { count: itemsLeft } = await admin
        .from("sale_items").select("id", { count: "exact", head: true }).eq("sale_id", saleId)

      const stockVolvio = Number(after?.current_stock) === Number(before?.current_stock) + 1

      if (!error && stockVolvio && sale?.voided_at && sale.void_reason === "cobrada por error" && itemsLeft === 1) {
        console.log("  OK — stock devuelto, venta marcada anulada, ítems intactos")
      } else {
        failures++
        console.error(
          `  FALLO — error=${JSON.stringify(error)}, stock ${before?.current_stock}→${after?.current_stock}, sale=${JSON.stringify(sale)}, items=${itemsLeft}`,
        )
      }
    }

    // --- Test 8 ---
    console.log("Test 8: una venta anulada no cuenta en el arqueo...")
    {
      const { data: session } = await admin
        .from("cash_sessions").select("id, opening_amount")
        .eq("branch_id", branchId).is("closed_at", null).single()

      const { data, error } = await ownerClient.rpc("close_cash_session", {
        p_session_id: session!.id,
        p_counted_total: 1000,
      })

      // Sólo quedó la venta del Test 4 (5000 en efectivo), pero se anuló en
      // el Test 7. Así que el esperado es sólo el monto de apertura: 1000.
      const expected = Number(data?.[0]?.expected_total)
      if (!error && expected === 1000 && Number(data?.[0]?.difference) === 0) {
        console.log("  OK — esperado 1000 (sólo la apertura), diferencia 0")
      } else {
        failures++
        console.error(`  FALLO — data=${JSON.stringify(data)}, error=${JSON.stringify(error)}`)
      }
    }

    // --- Test 9 ---
    console.log("Test 9: un miembro de otro tenant no puede cobrar acá...")
    {
      const intruder = await createTestUser("intruder")
      userIds.push(intruder.id)
      const intruderClient = await signIn(intruder.email, intruder.password)
      await intruderClient.rpc("provision_tenant", { p_business_name: "Otro Salon Caja" })

      const { error } = await intruderClient.rpc("confirm_sale", {
        p_branch_id: branchId,
        p_client_id: null,
        p_appointment_id: null,
        p_items: [{ item_id: productId, item_type: "product", quantity: 1, operator_id: null }],
        p_payments: [{ method: "cash", amount: 5000 }],
        p_discount: 0,
      })

      if (error?.code === "42501") {
        console.log("  OK — rechazado con 42501")
      } else {
        failures++
        console.error(`  FALLO — esperaba 42501, llegó: ${JSON.stringify(error)}`)
      }
    }
```

```ts
    // --- Test 10 ---
    console.log("Test 10: un turno se cobra al precio que se le cotizó, y una sola vez...")
    {
      // Un servicio que se agendó a 8000 y después subió a 12000 en el
      // catálogo: cobrar el catálogo actual sería cobrarle al cliente
      // distinto de lo que se le dijo al agendar.
      const { data: service } = await ownerClient
        .from("services")
        .insert({ tenant_id: tenantId, name: "Corte Caja Test", price: 8000, duration_minutes: 30 })
        .select("id")
        .single()

      const { data: client } = await ownerClient
        .from("clients")
        .insert({ tenant_id: tenantId, full_name: "Clienta Caja Test" })
        .select("id")
        .single()

      const { data: appt } = await admin
        .from("appointments")
        .insert({
          tenant_id: tenantId, branch_id: branchId, client_id: client!.id,
          starts_at: new Date().toISOString(),
          ends_at: new Date(Date.now() + 30 * 60_000).toISOString(),
          status: "in_progress",
        })
        .select("id")
        .single()

      await admin.from("appointment_services").insert({
        appointment_id: appt!.id, service_id: service!.id, price_snapshot: 8000,
      })

      // El catálogo sube DESPUÉS de agendar.
      await ownerClient.from("services").update({ price: 12000 }).eq("id", service!.id)

      await ownerClient.rpc("open_cash_session", { p_branch_id: branchId, p_opening_amount: 0 })

      const { data: charged, error: chargeError } = await ownerClient.rpc("confirm_sale", {
        p_branch_id: branchId,
        p_client_id: client!.id,
        p_appointment_id: appt!.id,
        p_items: [{ item_id: service!.id, item_type: "service", quantity: 1, operator_id: null }],
        p_payments: [{ method: "cash", amount: 8000 }],
        p_discount: 0,
      })

      // Y cobrarlo de nuevo tiene que fallar.
      const { error: dobleError } = await ownerClient.rpc("confirm_sale", {
        p_branch_id: branchId,
        p_client_id: client!.id,
        p_appointment_id: appt!.id,
        p_items: [{ item_id: service!.id, item_type: "service", quantity: 1, operator_id: null }],
        p_payments: [{ method: "cash", amount: 8000 }],
        p_discount: 0,
      })

      const { data: apptAfter } = await admin
        .from("appointments").select("status").eq("id", appt!.id).single()

      const precioOk = !chargeError && Number(charged?.[0]?.total) === 8000
      const dobleOk = dobleError?.message?.includes("APPOINTMENT_ALREADY_CHARGED")
      const cerradoOk = apptAfter?.status === "done"

      if (precioOk && dobleOk && cerradoOk) {
        console.log("  OK — cobró 8000 (el cotizado), rechazó el doble cobro, y cerró el turno")
      } else {
        failures++
        console.error(
          `  FALLO — total=${charged?.[0]?.total} (esperaba 8000), doble=${JSON.stringify(dobleError)}, status=${apptAfter?.status}`,
        )
      }
    }

    // --- Test 11 ---
    console.log("Test 11: sin caja abierta no se puede cobrar...")
    {
      const { data: open } = await admin
        .from("cash_sessions").select("id").eq("branch_id", branchId).is("closed_at", null)
      for (const s of open ?? []) {
        await ownerClient.rpc("close_cash_session", { p_session_id: s.id, p_counted_total: 0 })
      }

      const { error } = await ownerClient.rpc("confirm_sale", {
        p_branch_id: branchId,
        p_client_id: null,
        p_appointment_id: null,
        p_items: [{ item_id: productId, item_type: "product", quantity: 1, operator_id: null }],
        p_payments: [{ method: "cash", amount: 5000 }],
        p_discount: 0,
      })

      if (error?.message?.includes("NO_OPEN_SESSION")) {
        console.log("  OK — rechazado por caja cerrada")
      } else {
        failures++
        console.error(`  FALLO — esperaba NO_OPEN_SESSION, llegó: ${JSON.stringify(error)}`)
      }
    }
```

Los Tests 10 y 11 van **después** del Test 8 y **antes** del Test 9: el 11 cierra la caja, y el 8 necesita encontrarla abierta.

El `finally` ya limpia el tenant del intruso? No: `provision_tenant` le crea uno propio. Agregar al `finally`, antes del borrado del tenant principal:

```ts
      const { data: strayTenants } = await admin
        .from("tenants").select("id").eq("business_name", "Otro Salon Caja")
      for (const t of strayTenants ?? []) {
        await admin.from("memberships").delete().eq("tenant_id", t.id)
        await admin.from("branches").delete().eq("tenant_id", t.id)
        await admin.from("commission_rules").delete().eq("tenant_id", t.id)
        await admin.from("tenants").delete().eq("id", t.id)
      }
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd apps/web && pnpm test:caja`
Expected: FALLO en los Tests 4 a 11. El 4, 5, 7, 9, 10 y 11 con `PGRST202` (`confirm_sale` / `void_sale` no existen). El 6 falla porque hoy las policies **sí** dejan escribir directo — ése es el agujero que esta task cierra.

- [ ] **Step 3: Escribir `confirm_sale`**

Agregar al final de `migrations/0013_caja_pos.sql`:

```sql
-- ---------------------------------------------------------------------------
-- 5) Confirmar una venta
-- ---------------------------------------------------------------------------
-- Todo en una transacción. Cuatro escrituras acopladas (sales, sale_items —
-- que dispara el trigger que descuenta stock y liquida comisión —, y
-- payments): encadenarlas desde el cliente las pondría en transacciones
-- distintas, y una falla intermedia dejaría stock descontado sin venta
-- cobrada.
--
-- No recibe unit_price a propósito: si el precio viajara desde el browser,
-- cualquiera con la sesión abierta cobraría un servicio a $0.
create or replace function app.confirm_sale(
  p_branch_id      uuid,
  p_client_id      uuid,
  p_appointment_id uuid,
  p_items          jsonb,
  p_payments       jsonb,
  p_discount       numeric default 0
)
returns table(sale_id uuid, total numeric)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id  uuid;
  v_session_id uuid;
  v_sale_id    uuid;
  v_subtotal   numeric := 0;
  v_discount   numeric := coalesce(p_discount, 0);
  v_total      numeric;
  v_paid       numeric := 0;
  v_price      numeric;
  v_qty        numeric;
  v_op         uuid;
  it           jsonb;
  pay          jsonb;
begin
  select tenant_id into v_tenant_id from branches where id = p_branch_id;
  if v_tenant_id is null then
    raise exception 'BRANCH_NOT_FOUND' using errcode = '22023';
  end if;

  if not app.has_role(v_tenant_id, array['owner','supervisor']::membership_role[]) then
    raise exception 'NOT_ALLOWED_TO_SELL' using errcode = '42501';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_SALE' using errcode = '22023';
  end if;

  if v_discount < 0 then
    raise exception 'NEGATIVE_DISCOUNT' using errcode = '22023';
  end if;

  -- Toda venta necesita caja abierta: no existe el efectivo que entra al
  -- cajón sin quedar en ningún cierre.
  select id into v_session_id from cash_sessions
   where branch_id = p_branch_id and closed_at is null;
  if v_session_id is null then
    raise exception 'NO_OPEN_SESSION' using errcode = '22023';
  end if;

  if p_appointment_id is not null then
    if not exists (select 1 from appointments
                    where id = p_appointment_id and tenant_id = v_tenant_id) then
      raise exception 'APPOINTMENT_NOT_FOUND' using errcode = '22023';
    end if;
    -- Un turno se cobra una sola vez. Sin esto, un doble click cobra dos
    -- veces, descuenta stock dos veces y liquida comisión dos veces.
    if exists (select 1 from sales
                where appointment_id = p_appointment_id and voided_at is null) then
      raise exception 'APPOINTMENT_ALREADY_CHARGED' using errcode = '22023';
    end if;
  end if;

  insert into sales (tenant_id, branch_id, appointment_id, client_id,
                     total, discount, cash_session_id, created_by)
  values (v_tenant_id, p_branch_id, p_appointment_id, p_client_id,
          0, v_discount, v_session_id, auth.uid())
  returning id into v_sale_id;

  for it in select * from jsonb_array_elements(p_items)
  loop
    v_qty := coalesce((it->>'quantity')::numeric, 1);
    if v_qty <= 0 then
      raise exception 'INVALID_QUANTITY' using errcode = '22023';
    end if;

    v_op := nullif(it->>'operator_id', '')::uuid;
    if v_op is not null and not exists (
      select 1 from memberships where tenant_id = v_tenant_id and user_id = v_op
    ) then
      raise exception 'OPERATOR_NOT_IN_TENANT' using errcode = '22023';
    end if;

    v_price := null;

    -- 1) Si el ítem viene de un turno, gana el precio que se le cotizó al
    --    cliente al agendar. Cobrarle el catálogo actual sería cobrarle
    --    distinto de lo que se le dijo.
    if p_appointment_id is not null and (it->>'item_type') = 'service' then
      select price_snapshot into v_price
        from appointment_services
       where appointment_id = p_appointment_id
         and service_id = (it->>'item_id')::uuid;
    end if;

    -- 2) Si no, el catálogo. Un ítem que viene de un turno no pasa por el
    --    filtro de is_active / deleted_at: se agendó cuando el servicio
    --    estaba activo, y desactivarlo después no puede dejar un turno sin
    --    poder cobrarse.
    if v_price is null then
      if (it->>'item_type') = 'service' then
        select price into v_price from services
         where id = (it->>'item_id')::uuid and tenant_id = v_tenant_id and is_active;
      else
        select sale_price into v_price from retail_products
         where id = (it->>'item_id')::uuid and tenant_id = v_tenant_id and deleted_at is null;
      end if;
    end if;

    if v_price is null then
      raise exception 'ITEM_NOT_FOUND' using errcode = '22023';
    end if;

    insert into sale_items (sale_id, item_type, item_id, quantity, unit_price, operator_id)
    values (v_sale_id, (it->>'item_type')::sale_item_type, (it->>'item_id')::uuid,
            v_qty, v_price, v_op);

    v_subtotal := v_subtotal + (v_price * v_qty);
  end loop;

  if v_discount > v_subtotal then
    raise exception 'DISCOUNT_EXCEEDS_TOTAL' using errcode = '22023';
  end if;

  v_total := v_subtotal - v_discount;

  for pay in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb))
  loop
    if (pay->>'amount')::numeric <= 0 then
      raise exception 'INVALID_PAYMENT_AMOUNT' using errcode = '22023';
    end if;
    insert into payments (sale_id, method, amount)
    values (v_sale_id, (pay->>'method')::payment_method, (pay->>'amount')::numeric);
    v_paid := v_paid + (pay->>'amount')::numeric;
  end loop;

  if v_paid <> v_total then
    raise exception 'PAYMENTS_DONT_MATCH_TOTAL' using errcode = '22023';
  end if;

  update sales set total = v_total where id = v_sale_id;

  -- Cobrar es la señal más confiable de que el servicio se prestó. Pedir que
  -- además se marque a mano garantiza agendas llenas de turnos cobrados que
  -- figuran pendientes.
  if p_appointment_id is not null then
    update appointments set status = 'done'
     where id = p_appointment_id and status <> 'done';
  end if;

  return query select v_sale_id, v_total;
end;
$function$;
```

- [ ] **Step 4: Escribir `void_sale`**

```sql
-- ---------------------------------------------------------------------------
-- 6) Anular una venta
-- ---------------------------------------------------------------------------
-- La venta no se borra ni se edita: se marca anulada y se escriben asientos
-- que compensan. Si se borrara, el efectivo que sí entró y salió del cajón
-- desaparecería del arqueo.
create or replace function app.void_sale(
  p_sale_id uuid,
  p_reason  text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sale   sales%rowtype;
  it       record;
  r        record;
  led      record;
begin
  select * into v_sale from sales where id = p_sale_id for update;
  if not found then
    raise exception 'SALE_NOT_FOUND' using errcode = '22023';
  end if;

  if not app.has_role(v_sale.tenant_id, array['owner']::membership_role[]) then
    raise exception 'NOT_ALLOWED_TO_VOID' using errcode = '42501';
  end if;

  if v_sale.voided_at is not null then
    raise exception 'SALE_ALREADY_VOIDED' using errcode = '22023';
  end if;

  -- El motivo es obligatorio: sin él, la diferencia de arqueo del mes que
  -- viene no se puede explicar.
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'VOID_REASON_REQUIRED' using errcode = '22023';
  end if;

  -- 1) Devolver el stock, con su movimiento en el historial.
  for it in select * from sale_items where sale_id = p_sale_id
  loop
    if it.item_type = 'service' then
      for r in select supply_id, quantity_consumed from service_supplies
                where service_id = it.item_id
      loop
        perform app.apply_stock_delta(
          v_sale.tenant_id, v_sale.branch_id, r.supply_id, 'supply',
          r.quantity_consumed * it.quantity, 'ajuste',
          'Anulación de la venta ' || p_sale_id, true
        );
      end loop;
    else
      perform app.apply_stock_delta(
        v_sale.tenant_id, v_sale.branch_id, it.item_id, 'product',
        it.quantity, 'ajuste',
        'Anulación de la venta ' || p_sale_id, true
      );
    end if;
  end loop;

  -- 2) Revertir la comisión con un asiento negativo. El original NO se
  --    toca: es lo que mantiene auditable una liquidación pasada.
  for led in
    select cl.* from commission_ledger cl
     join sale_items si on si.id = cl.sale_item_id
    where si.sale_id = p_sale_id
      and cl.amount > 0
  loop
    insert into commission_ledger
      (tenant_id, operator_id, sale_item_id, amount, rule_snapshot, period, settled)
    values
      (led.tenant_id, led.operator_id, led.sale_item_id, -led.amount,
       jsonb_build_object('reversal_of', led.id, 'reason', p_reason),
       led.period, false);
  end loop;

  update sales
     set voided_at   = now(),
         voided_by   = auth.uid(),
         void_reason = btrim(p_reason)
   where id = p_sale_id;
end;
$function$;
```

- [ ] **Step 5: Wrappers públicos y cierre de policies**

```sql
create or replace function public.confirm_sale(
  p_branch_id uuid, p_client_id uuid, p_appointment_id uuid,
  p_items jsonb, p_payments jsonb, p_discount numeric default 0
) returns table(sale_id uuid, total numeric)
language sql security definer set search_path to 'public'
as $$ select * from app.confirm_sale(p_branch_id, p_client_id, p_appointment_id,
                                     p_items, p_payments, p_discount) $$;

revoke all on function public.confirm_sale(uuid, uuid, uuid, jsonb, jsonb, numeric) from public;
grant execute on function public.confirm_sale(uuid, uuid, uuid, jsonb, jsonb, numeric) to authenticated;

create or replace function public.void_sale(p_sale_id uuid, p_reason text)
returns void
language sql security definer set search_path to 'public'
as $$ select app.void_sale(p_sale_id, p_reason) $$;

revoke all on function public.void_sale(uuid, text) from public;
grant execute on function public.void_sale(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) El único camino de escritura son los RPC
-- ---------------------------------------------------------------------------
-- Las policies de 0001 habilitaban insert/update a cualquier miembro del
-- tenant, incluida la operadora. Eso convertía "sólo dueña y supervisora
-- cobran" en una regla de la UI que se saltea con un curl.
drop policy if exists sales_insert     on public.sales;
drop policy if exists sales_update     on public.sales;
drop policy if exists sale_items_all   on public.sale_items;
drop policy if exists payments_all     on public.payments;

create policy sale_items_select on public.sale_items for select
  using (exists (select 1 from sales s
                 where s.id = sale_items.sale_id
                   and s.tenant_id in (select app.user_tenant_ids())));

create policy payments_select on public.payments for select
  using (exists (select 1 from sales s
                 where s.id = payments.sale_id
                   and s.tenant_id in (select app.user_tenant_ids())));
```

`sales_select` de `0001` se deja como está: la lectura sigue abierta a todo el tenant.

- [ ] **Step 6: Aplicar la migración**

Usar `mcp__plugin_supabase_supabase__apply_migration` con `project_id: "xhbrhpfzehshiyjzlxnx"`, `name: "caja_pos_sales"`, enviando **sólo el SQL agregado en los Steps 3, 4 y 5**.

- [ ] **Step 7: Correr los tests**

Run: `cd apps/web && pnpm test:caja`
Expected: PASS en los 11 tests.

Correr también `pnpm test:inventario` y `pnpm test:security`: la refactorización de `adjust_stock` y el cierre de policies pueden haber roto algo.

- [ ] **Step 8: Commit**

```bash
git add migrations/0013_caja_pos.sql apps/web/tests/security/caja-behavior.test.ts
git commit -m "feat(db): confirmar y anular ventas por RPC, con las policias cerradas"
```

---

### Task 4: Capa de datos — tipos, queries y server actions

**Files:**
- Create: `apps/web/lib/caja-types.ts`
- Create: `apps/web/lib/caja-queries.ts`
- Create: `apps/web/lib/caja-actions.ts`
- Modify: `packages/supabase/src/types.ts`

**Interfaces:**
- Consumes: los 4 RPC de las Tasks 2 y 3.
- Produces: `CashSession`, `SaleRecord`, `SaleLineInput`, `PaymentInput`, `CatalogItem`, `AppointmentCharge`, `OperatorOption`; `getOpenSession`, `getLastClosedSession`, `getSessionSales`, `getCatalog`, `getOperators`, `getAppointmentCharge`; `openCashSession`, `closeCashSession`, `confirmSale`, `voidSale`.

- [ ] **Step 1: Declarar lo nuevo en `packages/supabase/src/types.ts`**

Agregar `voided_at: string | null`, `voided_by: string | null` y `void_reason: string | null` al `Row`/`Insert`/`Update` de `sales` (en orden alfabético dentro de cada bloque). Y en `Functions`, en orden alfabético:

```ts
      close_cash_session: {
        Args: {
          p_counted_total: number
          p_session_id: string
        }
        Returns: {
          counted_total: number
          difference: number
          expected_total: number
        }[]
      }
      confirm_sale: {
        Args: {
          p_appointment_id?: string | null
          p_branch_id: string
          p_client_id?: string | null
          p_discount?: number
          p_items: Json
          p_payments: Json
        }
        Returns: {
          sale_id: string
          total: number
        }[]
      }
      open_cash_session: {
        Args: {
          p_branch_id: string
          p_opening_amount: number
        }
        Returns: string
      }
      void_sale: {
        Args: {
          p_reason: string
          p_sale_id: string
        }
        Returns: undefined
      }
```

- [ ] **Step 2: Escribir `apps/web/lib/caja-types.ts`**

```ts
import type { Enums, Tables } from "@beautycrm/supabase/types"

export type PaymentMethod = Enums<"payment_method">
export type SaleItemType = Enums<"sale_item_type">

export type CashSession = Tables<"cash_sessions">

/** Un ítem vendible del catálogo, unificando servicios y productos. */
export type CatalogItem = {
  id: string
  type: SaleItemType
  name: string
  price: number
}

export type OperatorOption = {
  id: string
  name: string
}

/**
 * Lo que la UI manda al confirmar. Sin unit_price a propósito: el precio lo
 * resuelve el RPC (ver migrations/0013). Si viajara desde el browser,
 * cualquiera con la sesión abierta cobraría un servicio a $0.
 */
export type SaleLineInput = {
  item_id: string
  item_type: SaleItemType
  quantity: number
  operator_id: string | null
}

export type PaymentInput = {
  method: PaymentMethod
  amount: number
}

/** Una venta del turno, con lo necesario para listarla y anularla. */
export type SaleRecord = {
  id: string
  total: number
  discount: number
  created_at: string
  voided_at: string | null
  void_reason: string | null
  client_name: string | null
  items: { name: string; quantity: number; unit_price: number }[]
  payments: { method: PaymentMethod; amount: number }[]
}

/** Un turno listo para cobrar, con el precio que se le cotizó al cliente. */
export type AppointmentCharge = {
  appointment_id: string
  client_id: string | null
  client_name: string | null
  operator_id: string | null
  lines: SaleLineInput[]
  /** Sólo para mostrar: el que vale es el que resuelve el RPC. */
  preview: { name: string; price: number }[]
}
```

- [ ] **Step 3: Escribir `apps/web/lib/caja-queries.ts`**

```ts
import "server-only"
import { createClient } from "@beautycrm/supabase/server"
import type {
  AppointmentCharge, CashSession, CatalogItem, OperatorOption, SaleRecord,
} from "./caja-types"

/** La caja abierta de la sucursal, o null. Hay a lo sumo una (índice único). */
export async function getOpenSession(branchId: string): Promise<CashSession | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("cash_sessions")
    .select("*")
    .eq("branch_id", branchId)
    .is("closed_at", null)
    .maybeSingle()
  return data ?? null
}

/** El último cierre, para mostrar el arqueo cuando no hay caja abierta. */
export async function getLastClosedSession(branchId: string): Promise<CashSession | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("cash_sessions")
    .select("*")
    .eq("branch_id", branchId)
    .not("closed_at", "is", null)
    .order("closed_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ?? null
}

type SaleJoin = {
  id: string
  total: number
  discount: number
  created_at: string
  voided_at: string | null
  void_reason: string | null
  clients: { full_name: string } | null
  sale_items: { item_type: string; item_id: string; quantity: number; unit_price: number }[]
  payments: { method: string; amount: number }[]
}

/**
 * Las ventas de una sesión, de la más nueva a la más vieja.
 *
 * sale_items.item_id es polimórfico y no tiene FK, así que el nombre del ítem
 * no se puede traer con un join de Postgrest: se resuelve con dos consultas
 * más y un mapa. Mismo criterio que v_inventory en 0012.
 */
export async function getSessionSales(sessionId: string): Promise<SaleRecord[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("sales")
    .select(
      "id, total, discount, created_at, voided_at, void_reason, clients(full_name), sale_items(item_type, item_id, quantity, unit_price), payments(method, amount)",
    )
    .eq("cash_session_id", sessionId)
    .order("created_at", { ascending: false })
    .returns<SaleJoin[]>()

  const sales = data ?? []
  const serviceIds = [...new Set(sales.flatMap((s) => s.sale_items.filter((i) => i.item_type === "service").map((i) => i.item_id)))]
  const productIds = [...new Set(sales.flatMap((s) => s.sale_items.filter((i) => i.item_type === "product").map((i) => i.item_id)))]

  const names = new Map<string, string>()
  if (serviceIds.length > 0) {
    const { data: rows } = await supabase.from("services").select("id, name").in("id", serviceIds)
    for (const r of rows ?? []) names.set(r.id, r.name)
  }
  if (productIds.length > 0) {
    const { data: rows } = await supabase.from("retail_products").select("id, name").in("id", productIds)
    for (const r of rows ?? []) names.set(r.id, r.name)
  }

  return sales.map((s) => ({
    id: s.id,
    total: Number(s.total),
    discount: Number(s.discount),
    created_at: s.created_at,
    voided_at: s.voided_at,
    void_reason: s.void_reason,
    client_name: s.clients?.full_name ?? null,
    items: s.sale_items.map((i) => ({
      name: names.get(i.item_id) ?? "Ítem eliminado",
      quantity: Number(i.quantity),
      unit_price: Number(i.unit_price),
    })),
    payments: s.payments.map((p) => ({ method: p.method as never, amount: Number(p.amount) })),
  }))
}

/** Todo lo vendible: servicios activos y productos no eliminados. */
export async function getCatalog(tenantId: string): Promise<CatalogItem[]> {
  const supabase = await createClient()
  const [services, products] = await Promise.all([
    supabase.from("services").select("id, name, price").eq("tenant_id", tenantId).eq("is_active", true).order("name"),
    supabase.from("retail_products").select("id, name, sale_price").eq("tenant_id", tenantId).is("deleted_at", null).order("name"),
  ])

  return [
    ...(services.data ?? []).map((s) => ({ id: s.id, type: "service" as const, name: s.name, price: Number(s.price) })),
    ...(products.data ?? []).map((p) => ({ id: p.id, type: "product" as const, name: p.name, price: Number(p.sale_price) })),
  ]
}

/** Quiénes pueden llevarse la comisión de una línea. */
export async function getOperators(tenantId: string): Promise<OperatorOption[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("memberships")
    .select("user_id, users(full_name)")
    .eq("tenant_id", tenantId)
    .returns<{ user_id: string; users: { full_name: string | null } | null }[]>()

  return (data ?? []).map((m) => ({ id: m.user_id, name: m.users?.full_name ?? "Sin nombre" }))
}

/**
 * Un turno listo para cobrar. `preview` usa el price_snapshot cotizado al
 * agendar, que es también el que va a cobrar el RPC.
 */
export async function getAppointmentCharge(appointmentId: string): Promise<AppointmentCharge | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("appointments")
    .select("id, client_id, operator_id, clients(full_name), appointment_services(service_id, price_snapshot, services(name))")
    .eq("id", appointmentId)
    .maybeSingle()
    .returns<{
      id: string
      client_id: string | null
      operator_id: string | null
      clients: { full_name: string } | null
      appointment_services: { service_id: string; price_snapshot: number; services: { name: string } | null }[]
    } | null>()

  if (!data) return null

  return {
    appointment_id: data.id,
    client_id: data.client_id,
    client_name: data.clients?.full_name ?? null,
    operator_id: data.operator_id,
    lines: data.appointment_services.map((a) => ({
      item_id: a.service_id,
      item_type: "service" as const,
      quantity: 1,
      operator_id: data.operator_id,
    })),
    preview: data.appointment_services.map((a) => ({
      name: a.services?.name ?? "Servicio",
      price: Number(a.price_snapshot),
    })),
  }
}
```

- [ ] **Step 4: Escribir `apps/web/lib/caja-actions.ts`**

```ts
"use server"

import { createClient } from "@beautycrm/supabase/server"
import { revalidatePath } from "next/cache"
import type { PaymentInput, SaleLineInput } from "./caja-types"

// Declarado local en vez de importado de otro módulo: cada módulo declara
// el suyo (inventory-actions.ts y service-actions.ts hacen lo mismo).
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string | null }

// Revalidar también /dashboard y /dashboard/inventario: el Panel muestra la
// facturación del día y las alertas de stock, e Inventario el saldo, y una
// venta mueve las tres cosas.
function revalidateCaja() {
  revalidatePath("/dashboard/caja")
  revalidatePath("/dashboard")
  revalidatePath("/dashboard/inventario")
}

/**
 * Los RPC de 0013 levantan errores de dominio con `raise ... using errcode`,
 * usando sólo dos códigos: 42501 permisos, 22023 regla de negocio. El que
 * discrimina es el MENSAJE. Mismo criterio que inventory-actions.ts.
 */
const RPC_MESSAGES: Record<string, string> = {
  NO_OPEN_SESSION: "Abrí la caja antes de cobrar.",
  SESSION_ALREADY_OPEN: "Ya hay una caja abierta en esta sucursal.",
  SESSION_ALREADY_CLOSED: "Esta caja ya está cerrada.",
  SESSION_NOT_FOUND: "Esa caja no existe.",
  PAYMENTS_DONT_MATCH_TOTAL: "Los pagos no suman el total de la venta.",
  EMPTY_SALE: "Agregá al menos un ítem antes de cobrar.",
  APPOINTMENT_ALREADY_CHARGED: "Este turno ya fue cobrado.",
  APPOINTMENT_NOT_FOUND: "Ese turno no existe.",
  DISCOUNT_EXCEEDS_TOTAL: "El descuento no puede ser mayor al total.",
  NEGATIVE_DISCOUNT: "El descuento no puede ser negativo.",
  NEGATIVE_OPENING_AMOUNT: "El monto de apertura no puede ser negativo.",
  NEGATIVE_COUNTED_TOTAL: "Lo contado no puede ser negativo.",
  INVALID_QUANTITY: "La cantidad tiene que ser mayor a 0.",
  INVALID_PAYMENT_AMOUNT: "Cada pago tiene que ser mayor a 0.",
  OPERATOR_NOT_IN_TENANT: "Esa persona no trabaja en este salón.",
  SALE_ALREADY_VOIDED: "Esta venta ya está anulada.",
  SALE_NOT_FOUND: "Esa venta no existe.",
  VOID_REASON_REQUIRED: "Contá por qué la anulás.",
  ITEM_NOT_FOUND: "Alguno de los ítems ya no está disponible.",
  BRANCH_NOT_FOUND: "Esa sucursal no existe.",
  NOT_ALLOWED_TO_SELL: "No tenés permiso para cobrar.",
  NOT_ALLOWED_TO_VOID: "Solo el dueño puede anular una venta.",
  NOT_ALLOWED_TO_OPEN_SESSION: "No tenés permiso para abrir la caja.",
  NOT_ALLOWED_TO_CLOSE_SESSION: "No tenés permiso para cerrar la caja.",
}

function rpcError(
  error: { message: string; code?: string | null },
  fallback: string,
): ActionResult<never> {
  for (const [needle, text] of Object.entries(RPC_MESSAGES)) {
    if (error.message.includes(needle)) return { ok: false, error: text, code: error.code }
  }
  if (error.code === "42501") {
    return { ok: false, error: "No tenés permiso para esta acción.", code: error.code }
  }
  return { ok: false, error: fallback, code: error.code }
}

export async function openCashSession(
  branchId: string,
  openingAmount: number,
): Promise<ActionResult<string>> {
  if (!Number.isFinite(openingAmount) || openingAmount < 0) {
    return { ok: false, error: "El monto de apertura no puede ser negativo." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("open_cash_session", {
    p_branch_id: branchId,
    p_opening_amount: openingAmount,
  })
  if (error) return rpcError(error, "No pudimos abrir la caja.")

  revalidateCaja()
  return { ok: true, data: data as string }
}

export async function closeCashSession(
  sessionId: string,
  countedTotal: number,
): Promise<ActionResult<{ expected: number; counted: number; difference: number }>> {
  if (!Number.isFinite(countedTotal) || countedTotal < 0) {
    return { ok: false, error: "Lo contado no puede ser negativo." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("close_cash_session", {
    p_session_id: sessionId,
    p_counted_total: countedTotal,
  })
  if (error) return rpcError(error, "No pudimos cerrar la caja.")

  revalidateCaja()
  const row = data?.[0]
  return {
    ok: true,
    data: {
      expected: Number(row?.expected_total ?? 0),
      counted: Number(row?.counted_total ?? 0),
      difference: Number(row?.difference ?? 0),
    },
  }
}

export async function confirmSale(
  branchId: string,
  clientId: string | null,
  appointmentId: string | null,
  lines: SaleLineInput[],
  payments: PaymentInput[],
  discount: number,
): Promise<ActionResult<{ saleId: string; total: number }>> {
  if (lines.length === 0) return { ok: false, error: "Agregá al menos un ítem antes de cobrar." }
  if (!Number.isFinite(discount) || discount < 0) {
    return { ok: false, error: "El descuento no puede ser negativo." }
  }
  if (payments.length === 0) return { ok: false, error: "Agregá al menos un pago." }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("confirm_sale", {
    p_branch_id: branchId,
    p_client_id: clientId,
    p_appointment_id: appointmentId,
    p_items: lines,
    p_payments: payments,
    p_discount: discount,
  })
  if (error) return rpcError(error, "No pudimos registrar la venta.")

  revalidateCaja()
  const row = data?.[0]
  return { ok: true, data: { saleId: row!.sale_id, total: Number(row!.total) } }
}

export async function voidSale(saleId: string, reason: string): Promise<ActionResult> {
  if (!reason.trim()) return { ok: false, error: "Contá por qué la anulás." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("void_sale", { p_sale_id: saleId, p_reason: reason.trim() })
  if (error) return rpcError(error, "No pudimos anular la venta.")

  revalidateCaja()
  return { ok: true, data: undefined }
}
```

- [ ] **Step 5: Verificar que compila**

Run: `cd apps/web && pnpm exec tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/caja-types.ts apps/web/lib/caja-queries.ts apps/web/lib/caja-actions.ts packages/supabase/src/types.ts
git commit -m "feat(web): capa de datos del módulo Caja"
```

---

### Task 5: UI — los tres estados de la caja

**Files:**
- Create: `apps/web/app/dashboard/caja/SaleForm.tsx`
- Create: `apps/web/app/dashboard/caja/SalesList.tsx`
- Create: `apps/web/app/dashboard/caja/CajaScreen.tsx`
- Modify: `apps/web/app/dashboard/caja/page.tsx`
- Modify: `apps/web/components/Sidebar.tsx:32`

**Interfaces:**
- Consumes: todo lo que produce la Task 4.
- Produces: la ruta `/dashboard/caja` funcionando, y `/dashboard/caja?turno=<id>` con el carrito precargado.

- [ ] **Step 1: Escribir `SaleForm.tsx`**

```tsx
"use client"

import { useMemo, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Plus, Trash } from "@phosphor-icons/react"
import { Button, Field, Input } from "@beautycrm/ui"
import { confirmSale } from "@/lib/caja-actions"
import type {
  AppointmentCharge, CatalogItem, OperatorOption, PaymentInput, PaymentMethod,
} from "@/lib/caja-types"

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Efectivo" },
  { value: "card", label: "Tarjeta" },
  { value: "transfer", label: "Transferencia" },
  { value: "mp", label: "Mercado Pago" },
  { value: "other", label: "Otro" },
]

type Line = {
  key: string
  item_id: string
  item_type: "service" | "product"
  name: string
  price: number
  quantity: number
  operator_id: string | null
}

function formatPrice(n: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n)
}

export function SaleForm({
  branchId, catalog, operators, charge,
}: {
  branchId: string
  catalog: CatalogItem[]
  operators: OperatorOption[]
  /** Turno a cobrar, si se entró con ?turno=<id>. */
  charge: AppointmentCharge | null
}) {
  const router = useRouter()

  // Sembrado en los inicializadores de useState, nunca con un useEffect: el
  // padre monta este componente con `key` por turno, así que un turno
  // distinto siempre implica una instancia nueva. Ver commit 7173ee8.
  const [lines, setLines] = useState<Line[]>(() =>
    (charge?.lines ?? []).map((l, i) => ({
      key: `charge-${i}`,
      item_id: l.item_id,
      item_type: l.item_type,
      name: charge!.preview[i]?.name ?? "Servicio",
      price: charge!.preview[i]?.price ?? 0,
      quantity: l.quantity,
      operator_id: l.operator_id,
    })),
  )
  const [payments, setPayments] = useState<PaymentInput[]>([{ method: "cash", amount: 0 }])
  const [discount, setDiscount] = useState("0")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + l.price * l.quantity, 0),
    [lines],
  )
  const total = Math.max(0, subtotal - (Number(discount) || 0))
  const paid = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
  const pending = total - paid

  function addItem(id: string) {
    const item = catalog.find((c) => c.id === id)
    if (!item) return
    setLines((prev) => [
      ...prev,
      {
        key: `${item.id}-${Date.now()}`,
        item_id: item.id,
        item_type: item.type,
        name: item.name,
        price: item.price,
        quantity: 1,
        operator_id: null,
      },
    ])
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const result = await confirmSale(
      branchId,
      charge?.client_id ?? null,
      charge?.appointment_id ?? null,
      lines.map((l) => ({
        item_id: l.item_id,
        item_type: l.item_type,
        quantity: l.quantity,
        operator_id: l.operator_id,
      })),
      payments.filter((p) => Number(p.amount) > 0).map((p) => ({ method: p.method, amount: Number(p.amount) })),
      Number(discount) || 0,
    )

    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }

    setLines([])
    setPayments([{ method: "cash", amount: 0 }])
    setDiscount("0")
    // Si veníamos de un turno, sacamos el ?turno= de la URL: ya está cobrado.
    router.replace("/dashboard/caja")
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <h2>{charge ? `Cobrar turno — ${charge.client_name ?? "Sin cliente"}` : "Nueva venta"}</h2>
      {error ? <p className="error-banner">{error}</p> : null}

      <Field label="Agregar ítem" htmlFor="catalog-picker" hint="Servicios y productos de reventa.">
        <select
          id="catalog-picker"
          className="input"
          value=""
          onChange={(e) => {
            addItem(e.target.value)
            e.target.value = ""
          }}
        >
          <option value="">Elegí un servicio o producto...</option>
          {catalog.map((c) => (
            <option key={`${c.type}-${c.id}`} value={c.id}>
              {c.name} — {formatPrice(c.price)}
            </option>
          ))}
        </select>
      </Field>

      {lines.length === 0 ? (
        <p style={{ color: "var(--color-ink-soft)" }}>El carrito está vacío.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Ítem</th>
              <th>Cant.</th>
              <th>Precio</th>
              <th>Quién lo hizo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <td>{l.name}</td>
                <td>
                  <Input
                    aria-label={`Cantidad de ${l.name}`}
                    type="number"
                    value={String(l.quantity)}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((p) => (p.key === l.key ? { ...p, quantity: Number(e.target.value) } : p)),
                      )
                    }
                  />
                </td>
                <td>{formatPrice(l.price * l.quantity)}</td>
                <td>
                  {/* Arranca vacío a propósito: vacío significa "sin
                      comisión". Asignarle una venta a alguien por descuido
                      le cambia la liquidación del mes. */}
                  <select
                    aria-label={`Quién hizo ${l.name}`}
                    className="input"
                    value={l.operator_id ?? ""}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((p) =>
                          p.key === l.key ? { ...p, operator_id: e.target.value || null } : p,
                        ),
                      )
                    }
                  >
                    <option value="">Sin comisión</option>
                    {operators.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <Button
                    type="button"
                    variant="secondary"
                    aria-label={`Quitar ${l.name}`}
                    onClick={() => setLines((prev) => prev.filter((p) => p.key !== l.key))}
                  >
                    <Trash size={16} weight="bold" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Field label="Descuento" htmlFor="sale-discount" hint="En pesos, sobre el total. No reduce la comisión.">
        <Input id="sale-discount" type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} />
      </Field>

      <p>
        Total: <strong className="sale-total">{formatPrice(total)}</strong>
      </p>

      <h3>Pagos</h3>
      {payments.map((p, i) => (
        <div key={i} style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-2)" }}>
          <select
            aria-label={`Medio de pago ${i + 1}`}
            className="input"
            value={p.method}
            onChange={(e) =>
              setPayments((prev) =>
                prev.map((q, j) => (i === j ? { ...q, method: e.target.value as PaymentMethod } : q)),
              )
            }
          >
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <Input
            aria-label={`Monto del pago ${i + 1}`}
            type="number"
            value={String(p.amount)}
            onChange={(e) =>
              setPayments((prev) =>
                prev.map((q, j) => (i === j ? { ...q, amount: Number(e.target.value) } : q)),
              )
            }
          />
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        onClick={() => setPayments((prev) => [...prev, { method: "card", amount: 0 }])}
      >
        <Plus size={16} weight="bold" /> Otro medio de pago
      </Button>

      <p className="sale-pending">
        {pending === 0 ? "Los pagos cierran." : `Falta asignar ${formatPrice(pending)}`}
      </p>

      <Button type="submit" disabled={loading || lines.length === 0 || pending !== 0}>
        {loading ? "Cobrando..." : "Cobrar"}
      </Button>
    </form>
  )
}
```

- [ ] **Step 2: Escribir `SalesList.tsx`**

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Badge, Button } from "@beautycrm/ui"
import { voidSale } from "@/lib/caja-actions"
import type { SaleRecord } from "@/lib/caja-types"

const METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia",
  mp: "Mercado Pago", other: "Otro",
}

function formatPrice(n: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n)
}

// Timezone fijo por el mismo motivo que ClientHistoryTable.tsx: sin él, el
// server (UTC) y el browser formatean distinto y la hidratación no coincide.
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", {
    timeZone: "America/Argentina/Mendoza", hour: "2-digit", minute: "2-digit",
  })
}

export function SalesList({ sales, canVoid }: { sales: SaleRecord[]; canVoid: boolean }) {
  const router = useRouter()
  const [voiding, setVoiding] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleVoid(sale: SaleRecord) {
    const reason = window.prompt(
      `¿Por qué anulás esta venta de ${formatPrice(sale.total)}? El motivo queda registrado.`,
    )
    if (reason === null) return

    setError(null)
    setVoiding(sale.id)
    const result = await voidSale(sale.id, reason)
    setVoiding(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  if (sales.length === 0) {
    return <p style={{ color: "var(--color-ink-soft)" }}>Todavía no hay ventas en este turno.</p>
  }

  return (
    <>
      {error ? <p className="error-banner">{error}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Hora</th>
            <th>Cliente</th>
            <th>Ítems</th>
            <th>Pago</th>
            <th>Total</th>
            {canVoid ? <th></th> : null}
          </tr>
        </thead>
        <tbody>
          {sales.map((s) => (
            <tr key={s.id}>
              <td>{formatTime(s.created_at)}</td>
              <td>{s.client_name ?? "Mostrador"}</td>
              <td>{s.items.map((i) => `${i.name} ×${i.quantity}`).join(", ")}</td>
              <td>{s.payments.map((p) => METHOD_LABELS[p.method] ?? p.method).join(" + ")}</td>
              <td>
                {formatPrice(s.total)}
                {s.voided_at ? (
                  <>
                    {" "}
                    <Badge tone="danger">Anulada</Badge>
                  </>
                ) : null}
              </td>
              {canVoid ? (
                <td>
                  {s.voided_at ? (
                    <span title={s.void_reason ?? ""} style={{ color: "var(--color-ink-soft)" }}>
                      {s.void_reason}
                    </span>
                  ) : (
                    <Button
                      variant="danger"
                      disabled={voiding === s.id}
                      onClick={() => handleVoid(s)}
                    >
                      {voiding === s.id ? "Anulando..." : "Anular"}
                    </Button>
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
```

- [ ] **Step 3: Escribir `CajaScreen.tsx`**

```tsx
"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Button, Card, Field, Input, StatTile } from "@beautycrm/ui"
import { closeCashSession, openCashSession } from "@/lib/caja-actions"
import type {
  AppointmentCharge, CashSession, CatalogItem, OperatorOption, SaleRecord,
} from "@/lib/caja-types"
import { SaleForm } from "./SaleForm"
import { SalesList } from "./SalesList"

function formatPrice(n: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n)
}

export function CajaScreen({
  branchId, session, lastClosed, sales, catalog, operators, charge, role,
}: {
  branchId: string
  /** La caja abierta, o null si está cerrada. */
  session: CashSession | null
  lastClosed: CashSession | null
  sales: SaleRecord[]
  catalog: CatalogItem[]
  operators: OperatorOption[]
  charge: AppointmentCharge | null
  role: string
}) {
  const router = useRouter()
  const [opening, setOpening] = useState("0")
  const [counted, setCounted] = useState("0")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canVoid = role === "owner"

  async function handleOpen(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const result = await openCashSession(branchId, Number(opening))
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  async function handleClose(e: FormEvent) {
    e.preventDefault()
    if (!session) return
    setError(null)
    setBusy(true)
    const result = await closeCashSession(session.id, Number(counted))
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  // --- Caja cerrada ---
  if (!session) {
    return (
      <div>
        {lastClosed ? (
          <div className="stat-grid" style={{ marginBottom: "var(--space-6)" }}>
            <StatTile label="Último cierre — esperado" value={formatPrice(Number(lastClosed.expected_total ?? 0))} />
            <StatTile label="Contado" value={formatPrice(Number(lastClosed.counted_total ?? 0))} />
            <StatTile label="Diferencia" value={formatPrice(Number(lastClosed.difference ?? 0))} />
          </div>
        ) : null}

        <Card>
          <h2>Abrir caja</h2>
          {error ? <p className="error-banner">{error}</p> : null}
          <form onSubmit={handleOpen} noValidate>
            <Field label="Con cuánto arrancás" htmlFor="opening-amount" hint="El efectivo que ya hay en el cajón.">
              <Input id="opening-amount" type="number" value={opening} onChange={(e) => setOpening(e.target.value)} />
            </Field>
            <Button type="submit" disabled={busy}>{busy ? "Abriendo..." : "Abrir caja"}</Button>
          </form>
        </Card>
      </div>
    )
  }

  // --- Caja abierta ---
  const cashTaken = sales
    .filter((s) => !s.voided_at)
    .flatMap((s) => s.payments)
    .filter((p) => p.method === "cash")
    .reduce((sum, p) => sum + p.amount, 0)

  return (
    <div>
      <div className="stat-grid" style={{ marginBottom: "var(--space-6)" }}>
        <StatTile label="Apertura" value={formatPrice(Number(session.opening_amount))} />
        <StatTile label="Efectivo cobrado" value={formatPrice(cashTaken)} />
        <StatTile label="Ventas del turno" value={sales.filter((s) => !s.voided_at).length} />
      </div>

      {error ? <p className="error-banner">{error}</p> : null}

      <Card style={{ marginBottom: "var(--space-4)" }}>
        {/* `key` por turno: entrar a cobrar otro turno monta una instancia
            nueva, con el carrito ya sembrado. Ver el comentario en SaleForm. */}
        <SaleForm
          key={charge?.appointment_id ?? "mostrador"}
          branchId={branchId}
          catalog={catalog}
          operators={operators}
          charge={charge}
        />
      </Card>

      <Card style={{ marginBottom: "var(--space-4)" }}>
        <h2>Ventas del turno</h2>
        <SalesList sales={sales} canVoid={canVoid} />
      </Card>

      <Card>
        <h2>Cerrar caja</h2>
        <form onSubmit={handleClose} noValidate>
          <Field
            label="Cuánto contaste"
            htmlFor="counted-total"
            hint="Sólo el efectivo del cajón. Tarjeta y transferencia no cuentan."
          >
            <Input id="counted-total" type="number" value={counted} onChange={(e) => setCounted(e.target.value)} />
          </Field>
          <Button type="submit" variant="secondary" disabled={busy}>
            {busy ? "Cerrando..." : "Cerrar caja"}
          </Button>
        </form>
      </Card>
    </div>
  )
}
```

- [ ] **Step 4: Reemplazar `page.tsx`**

```tsx
import { redirect } from "next/navigation"
import { getCurrentMembership } from "@/lib/session"
import { getDefaultBranch } from "@/lib/agenda-queries"
import {
  getAppointmentCharge, getCatalog, getLastClosedSession, getOpenSession,
  getOperators, getSessionSales,
} from "@/lib/caja-queries"
import { CajaScreen } from "./CajaScreen"

export default async function CajaPage({
  searchParams,
}: {
  searchParams: Promise<{ turno?: string }>
}) {
  const { user, membership } = await getCurrentMembership()
  if (!user || !membership) redirect("/login")

  // Sin selector de sucursal (doc A.3). El fallback a getDefaultBranch NO es
  // defensivo: provision_tenant (0003:58) crea la membresía de la dueña con
  // branch_id = null a propósito. Ver commit 917abae.
  const branchId = membership.branch_id ?? (await getDefaultBranch(membership.tenant_id))?.id ?? null
  if (!branchId) redirect("/dashboard")

  const params = await searchParams
  const session = await getOpenSession(branchId)

  const [lastClosed, sales, catalog, operators, charge] = await Promise.all([
    session ? Promise.resolve(null) : getLastClosedSession(branchId),
    session ? getSessionSales(session.id) : Promise.resolve([]),
    getCatalog(membership.tenant_id),
    getOperators(membership.tenant_id),
    params.turno ? getAppointmentCharge(params.turno) : Promise.resolve(null),
  ])

  return (
    <div>
      <h1>Caja</h1>
      <CajaScreen
        branchId={branchId}
        session={session}
        lastClosed={lastClosed}
        sales={sales}
        catalog={catalog}
        operators={operators}
        charge={charge}
        role={membership.role}
      />
    </div>
  )
}
```

- [ ] **Step 5: Activar el módulo en el sidebar**

En `apps/web/components/Sidebar.tsx`, línea 32, cambiar `implemented: false` por `implemented: true` en el item de Caja / POS.

- [ ] **Step 6: Verificar que compila**

Run: `cd apps/web && pnpm exec tsc --noEmit`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/dashboard/caja apps/web/components/Sidebar.tsx
git commit -m "feat(web): módulo Caja — cobro de turnos, mostrador y arqueo"
```

---

### Task 6: Entrada desde la agenda y E2E

**Files:**
- Modify: `apps/web/app/dashboard/agenda/AppointmentDetailPanel.tsx`
- Create: `apps/web/tests/e2e/caja.spec.ts`

**Interfaces:**
- Consumes: la ruta `/dashboard/caja?turno=<id>` de la Task 5.

- [ ] **Step 1: Agregar el botón "Cobrar" en la agenda**

En `apps/web/app/dashboard/agenda/AppointmentDetailPanel.tsx`, agregar el import:

```tsx
import Link from "next/link"
```

Y en el bloque de acciones —el que hoy renderiza el botón de `next.label` y los de "no vino" / "cancelar", alrededor de la línea 70— agregar antes de ellos:

```tsx
{/* Link y no un botón con router.push: es navegación, y un link se
    puede abrir en otra pestaña o copiar. Sólo para turnos que ya
    empezaron: cobrar algo que todavía no se prestó no tiene sentido. */}
{appointment.status === "in_progress" || appointment.status === "done" ? (
  <Link className="btn btn-primary" href={`/dashboard/caja?turno=${appointmentId}`}>
    Cobrar
  </Link>
) : null}
```

Usar `appointmentId`, que es la prop que el componente ya recibe (la usa en `updateAppointmentStatus`), y no `appointment.id`.

- [ ] **Step 2: Escribir el E2E**

Crear `apps/web/tests/e2e/caja.spec.ts`. El `beforeAll` sigue el mismo patrón que `inventario.spec.ts` (owner por magic link + `provision_tenant`), y además crea un producto con stock:

```ts
import { test, expect } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"

/**
 * E2E del módulo Caja: abrir caja, venta de mostrador con pago mixto,
 * anulación, y cierre con arqueo. Tenant 100% descartable.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const ownerEmail = `e2e-caja-owner-${Date.now()}@example.com`
const businessName = `E2E Caja Salon ${Date.now()}`

let ownerId: string | undefined
let tenantId: string | undefined
let branchId: string | undefined

test.afterAll(async () => {
  if (tenantId) {
    const { data: sales } = await admin.from("sales").select("id").eq("tenant_id", tenantId)
    const saleIds = (sales ?? []).map((s) => s.id)
    await admin.from("commission_ledger").delete().eq("tenant_id", tenantId)
    if (saleIds.length > 0) {
      await admin.from("payments").delete().in("sale_id", saleIds)
      await admin.from("sale_items").delete().in("sale_id", saleIds)
    }
    await admin.from("sales").delete().eq("tenant_id", tenantId)
    await admin.from("cash_sessions").delete().eq("tenant_id", tenantId)
    await admin.from("inventory_movements").delete().eq("tenant_id", tenantId)
    const { data: branches } = await admin.from("branches").select("id").eq("tenant_id", tenantId)
    const branchIds = (branches ?? []).map((b) => b.id)
    if (branchIds.length > 0) await admin.from("inventory").delete().in("branch_id", branchIds)
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
  branchId = tenantRow[0].branch_id

  const { data: product } = await ownerAnon
    .from("retail_products")
    .insert({ tenant_id: tenantId, name: "Shampoo E2E", sale_price: 5000, cost: 2000 })
    .select("id")
    .single()

  await ownerAnon.rpc("adjust_stock", {
    p_branch_id: branchId,
    p_item_id: product!.id,
    p_item_type: "product",
    p_delta: 10,
    p_reason: "compra",
    p_note: null,
  })
})

test("abrir caja, cobrar con pago mixto, anular y cerrar con arqueo", async ({ page }) => {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000"
  const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email: ownerEmail })
  const tokenHash = linkData?.properties?.hashed_token

  await page.goto(`${baseURL}/auth/confirm?token_hash=${tokenHash}&type=magiclink&next=/dashboard/caja`, {
    waitUntil: "commit",
  })
  await page.waitForURL(/\/dashboard\/caja$/)
  await expect(page.getByRole("heading", { name: "Caja" })).toBeVisible()

  // --- Abrir caja con $1000 ---
  await page.getByLabel("Con cuánto arrancás").fill("1000")
  await page.getByRole("button", { name: "Abrir caja" }).click()
  await expect(page.getByRole("heading", { name: "Nueva venta" })).toBeVisible({ timeout: 10_000 })

  // --- Venta de mostrador con pago mixto: 3000 efectivo + 2000 tarjeta ---
  await page.getByLabel("Agregar ítem").selectOption({ label: /Shampoo E2E/ })
  await expect(page.locator(".sale-total")).toHaveText("$ 5.000,00")

  await page.getByLabel("Monto del pago 1").fill("3000")
  await page.getByRole("button", { name: "Otro medio de pago" }).click()
  await page.getByLabel("Medio de pago 2").selectOption("card")
  await page.getByLabel("Monto del pago 2").fill("2000")
  await expect(page.getByText("Los pagos cierran.")).toBeVisible()

  await page.getByRole("button", { name: "Cobrar", exact: true }).click()
  await expect(page.getByRole("cell", { name: /Shampoo E2E ×1/ })).toBeVisible({ timeout: 10_000 })

  // --- Anular ---
  page.once("dialog", (d) => d.accept("cobrada por error"))
  await page.getByRole("button", { name: "Anular" }).click()
  await expect(page.getByText("Anulada")).toBeVisible({ timeout: 10_000 })

  // --- Cerrar caja ---
  // La venta se anuló, así que el esperado es sólo la apertura: 1000.
  // Contamos 1000 → diferencia 0.
  await page.getByLabel("Cuánto contaste").fill("1000")
  await page.getByRole("button", { name: "Cerrar caja" }).click()
  await expect(page.getByText("Último cierre — esperado")).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole("heading", { name: "Abrir caja" })).toBeVisible()
})
```

- [ ] **Step 3: Correr el spec**

Run: `cd apps/web && PLAYWRIGHT_BASE_URL=<url-del-worktree> pnpm exec playwright test tests/e2e/caja.spec.ts`

**Verificar que el server de esa URL corre desde este worktree** antes de correr:

```bash
lsof -a -p $(lsof -ti :<puerto>) -d cwd -Fn | grep '^n'
```

Un server viejo sirve código viejo y el test falla por la razón equivocada. Sin `PLAYWRIGHT_BASE_URL`, el config usa `:3000` con `reuseExistingServer` — que es el checkout de main.

Expected: PASS.

- [ ] **Step 4: Correr la suite completa**

Run: `pnpm exec playwright test tests/e2e` y las seis suites de seguridad (`test:security`, `test:agenda`, `test:clientes`, `test:servicios`, `test:inventario`, `test:caja`).
Expected: todo verde. El cierre de policies de la Task 3 y la refactorización de `adjust_stock` de la Task 1 tocan cosas que otros módulos usan.

- [ ] **Step 5: Commit**

```bash
git add apps/web/tests/e2e/caja.spec.ts apps/web/app/dashboard/agenda
git commit -m "test(web): E2E de Caja — apertura, pago mixto, anulación y arqueo"
```

---

## Cobertura de la spec

| Requisito de la spec | Dónde se cumple |
|---|---|
| El precio lo pone el servidor | Task 3 (`confirm_sale` no recibe `unit_price`) + Test 4 |
| Precio de un turno = `price_snapshot` cotizado | Task 3, Step 3 (rama 1 de resolución de precio) + Test 10 |
| Atomicidad de la venta | Task 3 (todo dentro de `confirm_sale`) + Test 5 |
| Toda venta necesita caja abierta | Task 3 (`NO_OPEN_SESSION`) + Test 11 |
| Un turno se cobra una sola vez | Task 3 (`APPOINTMENT_ALREADY_CHARGED`) + Test 10 |
| Cobrar cierra el turno | Task 3, Step 3 (`update appointments set status = 'done'`) + Test 10 |
| Pagos que suman el total | Task 3 (`PAYMENTS_DONT_MATCH_TOTAL`) + Test 5 |
| El stock de una venta deja movimiento | Task 1 (`apply_stock_delta`) + Test 1 |
| Vender no se bloquea por stock negativo | Task 1 (`p_allow_negative`) |
| El descuento no reduce la comisión | Task 1 (`process_sale_item` calcula sobre `unit_price * quantity`) |
| Anulación con compensación, sin borrar | Task 3 (`void_sale`) + Test 7 |
| Venta anulada fuera del arqueo | Task 2 (`close_cash_session`) + Test 8 |
| Sólo efectivo en el arqueo | Task 2 (`and pay.method = 'cash'`) |
| Una caja abierta por sucursal | Task 2 (índice único parcial) + Test 2 |
| Escritura sólo por RPC | Task 3, Step 5 (policies) + Test 6 |
| Dueña y supervisora operan; anular es owner-only | Tasks 2 y 3 (`has_role`) + Tests 3 y 9 |
| Los tres estados de la caja | Task 5 (`CajaScreen`) |
| Carrito con operadora por línea | Task 5 (`SaleForm`) |
| Pagos mixtos con pendiente visible | Task 5 (`SaleForm`) + E2E |
| Entrada desde la agenda | Task 6, Step 1 |
| Sin selector de sucursal, con fallback | Task 5, Step 4 |
