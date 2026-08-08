# BeautyCRM

SaaS multi-tenant de gestión para salones de belleza. Metodología "Software
Amoldable" (ver `docs/arquitectura-saas-salones.md`, fuente de verdad del
modelo de datos y las decisiones de producto).

Backend: Postgres + Supabase Auth + RLS, ya en producción (`migrations/`).
Este repo cubre el frontend: monorepo pnpm con Next.js 14 (App Router).

## Estructura

```
apps/web            Next.js 14 App Router — dashboard dueño, PWA operadora, wizard
packages/supabase    Cliente Supabase tipado (browser + server + middleware)
packages/ui          Componentes compartidos (funcionales, sin pulir todavía)
migrations/          Migraciones SQL versionadas, aplicadas vía Supabase MCP/CLI
docs/                Documento de arquitectura (fuente de verdad)
clientes/            Prompts y specs por cliente piloto
```

## Levantar el proyecto local

Requisitos: Node 20+, pnpm.

```bash
pnpm install
cp .env.example apps/web/.env.local   # completar con los valores reales
pnpm dev                               # http://localhost:3000
```

### Variables de entorno (`apps/web/.env.local`)

| Variable | De dónde sale | Dónde se usa |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Dashboard Supabase → Project Settings → API | cliente browser + server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Ídem (anon/publishable key) | cliente browser + server |
| `SUPABASE_SERVICE_ROLE_KEY` | Ídem (service_role — secreta) | solo server actions puntuales (invitar operadoras). **Nunca** en el cliente, nunca en un commit. |

Google OAuth y magic link ya están habilitados en el proyecto Supabase real
(`xhbrhpfzehshiyjzlxnx`, región `sa-east-1`). Si hace falta reconfigurar el
redirect URI de Google, es en Supabase Dashboard → Authentication →
Providers → Google.

**Dos rutas de verificación de sesión:**
- `/auth/callback` — código PKCE (OAuth de Google, o magic link abierto en
  el mismo navegador que lo pidió).
- `/auth/confirm` — `token_hash` + `verifyOtp` (patrón recomendado por
  Supabase para magic links cross-device: el link se abre en un
  dispositivo distinto al que lo pidió, caso muy común en la vida real).

Ahora mismo la plantilla de email de Supabase (Dashboard → Authentication
→ Email Templates → Magic Link) todavía usa el `{{ .ConfirmationURL }}`
por defecto, que apunta a `/auth/callback` — funciona same-device, pero
cross-device rompe (ver TODO abajo).

## Regenerar los tipos TypeScript

Los tipos en `packages/supabase/src/types.ts` se generan desde el schema
real de Supabase — nunca se editan a mano.

```bash
pnpm types:generate   # requiere supabase CLI logueado (npx supabase login)
```

O regenerarlos vía el MCP de Supabase (`generate_typescript_types`) y pegar
el resultado en ese archivo — así se hizo en esta sesión.

## Correr los tests

```bash
# Aislamiento multi-tenant (RLS) — LA garantía de toda la arquitectura.
# Crea usuarios/tenants descartables contra el proyecto real y los borra
# al final (try/finally), incluso si el test falla.
pnpm --filter @beautycrm/web test:security

# E2E del onboarding completo (Playwright). Requiere el server corriendo
# (pnpm dev en otra terminal) o lo levanta solo si no hay
# PLAYWRIGHT_BASE_URL seteado.
pnpm --filter @beautycrm/web test:e2e

# Build + lint
pnpm build
pnpm lint
```

Ambos tests de arriba corren contra el proyecto Supabase real (no hay
entorno de staging separado en esta sesión) con datos 100% descartables.

## Cómo funciona el schema `app.*` vs `public.*`

`app.*` son funciones helper de uso **interno** (RLS, triggers) y no están
expuestas por PostgREST — solo `public` y `graphql_public` lo están
(Project Settings → Data API → Exposed schemas). Para que el frontend pueda
invocar `provision_tenant`, existe `migrations/0005_public_rpc_wrappers.sql`:
un wrapper delgado en `public` que delega en `app.provision_tenant`. Si en
el futuro hace falta exponer otra función de `app.*`, se agrega un wrapper
puntual ahí — nunca se abre el schema `app` entero vía Dashboard.

## Alcance de esta sesión

Ver `clientes/jacintas-nails/prompt-claude-code-scaffold.md` para el
alcance quirúrgico completo. Resumen: scaffold del monorepo, integración
Supabase, auth (magic link + Google), wizard de onboarding (Pasos 0-4),
dashboard del dueño (funcional, sin diseño final), shell PWA de la
operadora (3 pantallas).

**Fuera de alcance** (TODO explícito): POS/cierre de caja completo, sync
Google Calendar, WhatsApp Cloud API, billing Stripe/MercadoPago, UI
avanzada de multi-sucursal, panel de Supervisor, y el **rediseño visual
final** del dashboard (sesión aparte, dedicada).

### TODOs concretos para la próxima sesión

Resueltos en la sesión de seguimiento (Cowork, ver commits `fix(web):
persiste el progreso del wizard de onboarding`, `feat(web): comisiones en
vivo por Realtime` e `feat(web): invitar operadoras por WhatsApp`):

- ~~Onboarding no resumible~~ — el wizard ahora persiste `{step, ctx}` en
  `localStorage` en cada paso (a partir del Paso 1) y lo limpia al terminar.
- ~~"Mis comisiones" no era en vivo~~ — `commission_ledger` está en la
  publicación `supabase_realtime` (migración `0006`) y la página se
  suscribe por `postgres_changes` filtrado por `operator_id`.
- ~~Invitar operadoras solo por email~~ — `inviteOperator` ahora acepta
  `channel: "email" | "whatsapp"`. El camino WhatsApp usa
  `admin.generateLink` + Meta WhatsApp Cloud API (`apps/web/lib/whatsapp.ts`).
  Requiere configurar `WHATSAPP_CLOUD_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`
  y `WHATSAPP_INVITE_TEMPLATE_NAME` (ver `.env.example`) y tener la
  plantilla de mensaje aprobada en Meta Business Manager — sin eso, el
  wizard avisa con un error claro en vez de fallar en silencio.
- ~~Íconos del PWA faltantes~~ — `apps/web/public/icons/icon-192.png` e
  `icon-512.png` ya existen (monograma "BC" sobre el `theme_color` del
  manifest, `#4f46e5`). Son un placeholder funcional para que el PWA
  instale bien; se reemplazan con el arte final en el rediseño visual
  (punto siguiente).

Pendientes reales:

- Rediseño visual del dashboard (paleta y componentes finales, íconos
  definitivos) — sesión dedicada, con `dashboard-mockup-borrador.html`
  como punto de partida.
- Magic link cross-device: hoy solo funciona 100% si se abre en el mismo
  navegador que lo pidió (PKCE, `/auth/callback`). Para que funcione
  abierto en otro dispositivo (celular, típico) hay que cambiar la
  plantilla de email en el Dashboard de Supabase para que use
  `{{ .TokenHash }}` y apunte a `/auth/confirm` — la ruta ya está
  implementada y probada (así corre el E2E), solo falta el cambio de
  plantilla, que no se puede hacer vía CLI/MCP: Dashboard → Authentication
  → Email Templates → Magic Link.
- Ningún módulo de `FUERA DE ALCANCE` de esta sesión (POS, caja, Calendar,
  Stripe/MP, multi-sucursal avanzado, panel Supervisor) está implementado
  — quedan como TODO explícito, tal como pide el prompt.

### Nota sobre la carpeta del repo

El repo local vive en una carpeta cuyo nombre real en disco es
`SaaS-BeautyCRM` (mayúsculas, igual que en GitHub). Usar una ruta con
otro casing (p. ej. `saas-beautycrm`) funciona para casi todo, pero
confunde al compilador de Next.js (webpack) y puede producir errores
intermitentes. Trabajar siempre parado en la ruta con el casing exacto.
