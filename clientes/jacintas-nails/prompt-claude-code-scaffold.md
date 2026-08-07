# Prompt para Claude Code — Scaffold BeautyCRM (sesión quirúrgica)

> Pegar esto completo como primer mensaje en Claude Code, parado en el root del repo clonado de `github.com/mashandocrew/SaaS-BeautyCRM.git`.

---

## CONTEXTO PREVIO (leer antes de tocar nada)

Estoy construyendo **BeautyCRM**, un SaaS multi-tenant de gestión para salones de belleza. Metodología de negocio: validar con un solo cliente piloto antes de replicar. El repo ya tiene el **backend completo y en producción** en Supabase — tu trabajo es el frontend, no el schema.

**Antes de escribir una sola línea, leé en este orden:**
1. `docs/arquitectura-saas-salones.md` — es la fuente de verdad de TODO el modelo de datos y las decisiones de producto.
2. `migrations/0001_initial_schema.sql` — schema completo: tablas, enums, RLS, funciones `app.*`.
3. `migrations/0003_provision_tenant.sql` — función `app.provision_tenant()`, el RPC que da de alta un tenant nuevo (Paso 0 del onboarding).
4. `migrations/0004_sale_item_events.sql` — trigger de descuento de stock y liquidación de comisiones al insertar un `sale_item`.

**Proyecto Supabase real (ya deployado, NO recrear el schema):**
- `project_id`: `xhbrhpfzehshiyjzlxnx`
- Región: `sa-east-1`
- `SUPABASE_URL` y `SUPABASE_ANON_KEY`: sacalos vos del dashboard de Supabase (Project Settings → API) o pedímelos — no van en texto plano en ningún prompt ni commit.
- `SUPABASE_SERVICE_ROLE_KEY`: solo se usa server-side (route handlers / server actions), JAMÁS en código que llegue al cliente ni en `.env` versionado.
- Funciones ya disponibles vía RPC: `app.provision_tenant()`, `app.has_role()`, `app.user_tenant_ids()`, `app.user_branch_ids()`.
- Buckets de storage privados: `client-photos`, `tenant-assets`.

**Cliente piloto (dato de referencia SOLO para pruebas manuales, nunca hardcodear en código):**
- Tenant "Jacintas Nails": `43e3325f-9c96-4a0f-8383-c3c190bff0ca`
- Sucursal "Principal": `3c5c1cc7-559d-408b-969a-5c67b192e114`

**Sobre el diseño visual: NO es parte de esta sesión.** El HTML/CSS final del dashboard se va a diseñar a fondo en una sesión aparte, dedicada exclusivamente a eso. Por ahora armá una UI funcional, prolija y simple (componentes básicos, sin pulir), priorizando que ande con datos reales de Supabase. No inviertas tiempo en pixel-perfect todavía — sería trabajo tirado.

---

## ALCANCE QUIRÚRGICO DE ESTA SESIÓN (no expandir sin preguntar)

1. **Scaffold del monorepo**: pnpm workspaces (o Turborepo si lo justificás), Next.js 14+ App Router en `apps/web`, paquete `packages/supabase` con cliente tipado (browser + server, separados), `packages/ui` para componentes compartidos.
2. **Integración Supabase**: variables de entorno, cliente server-side (route handlers/server actions) y client-side, generación de tipos TypeScript desde el proyecto real (`supabase gen types typescript` o el MCP si está disponible).
3. **Auth**: magic link + Google OAuth vía Supabase Auth. Callback y manejo de sesión con el patrón recomendado de `@supabase/ssr`.
4. **Wizard de onboarding low-touch** (Bloque A.4, Pasos 0 a 4): registro → llamada a `app.provision_tenant()` → identidad del negocio → servicios (con plantillas por rubro) → equipo (magic link a operadoras) → primer turno. Los pasos 2 y 3 pueden quedar con datos placeholder editables si el tiempo aprieta, pero el flujo completo (Paso 0 a Paso 4) tiene que cerrar de punta a punta.
5. **Dashboard del Dueño (funcional, no visual)**: datos reales de Supabase (turnos de hoy, ingresos, alertas de stock, comisiones del mes) en una UI básica — no mock data hardcodeada. El rediseño visual final se hace después, en otra sesión.
6. **Shell mobile PWA de la Operadora**: 3 pantallas (Mi día / Mi cliente / Mis comisiones), datos reales, UI simple — no hace falta pulir, sí que funcione.

## FUERA DE ALCANCE PARA ESTA SESIÓN (dejar como TODO explícito, no implementar)

POS/cierre de caja completo, sync con Google Calendar, WhatsApp Cloud API, billing con Stripe/MercadoPago, UI avanzada de multi-sucursal, panel de Supervisor, y **diseño visual final del dashboard** (sesión aparte). Si mientras trabajás ves que algo de esto es un prerrequisito duro, avisá antes de meterte a construirlo.

## REGLAS NO NEGOCIABLES

- RLS ya vive en la base de datos. El frontend nunca decide qué puede ver un usuario — eso ya está resuelto en Postgres. No agregues filtros de `tenant_id` "por las dudas" en el cliente: si hace falta, es señal de que algo está mal en la policy, no un parche a mano.
- `SUPABASE_SERVICE_ROLE_KEY` nunca en un componente cliente, nunca en un commit.
- Toda migración nueva que necesites va versionada en `migrations/000X_nombre.sql`, aplicada vía Supabase CLI/MCP, nunca SQL suelto en el dashboard.
- Commits atómicos por pieza funcional (scaffold, auth, wizard, dashboard, PWA operadora) — no un solo mega-commit al final.
- El documento de arquitectura manda. Si algo en este prompt contradice `docs/arquitectura-saas-salones.md`, seguí el documento y avisame la discrepancia.

## PRUEBAS A EJECUTAR ANTES DE DAR POR TERMINADO

- **Aislamiento multi-tenant (la más crítica)**: un test automatizado que autentique como un usuario del tenant A e intente leer/escribir datos del tenant B, y confirme que RLS lo bloquea (0 filas / error). Esto es LA garantía de toda la arquitectura — no es opcional.
- **E2E del onboarding** (Playwright): registro → wizard completo (Pasos 0-4) → login → dashboard muestra el tenant recién creado con su sucursal "Principal".
- **`provision_tenant` no duplicable**: un usuario que ya es owner de un tenant no puede provisionar uno segundo (la función ya lo bloquea en SQL — el test es que el frontend muestre un error claro, no una pantalla rota).
- `npm run build` y `npm run lint` sin errores ni warnings nuevos.

## REVISIÓN FINAL AUTOMÁTICA (checklist a correr y reportar explícitamente, no asumir)

- [ ] Ningún secreto (`service_role`, keys de terceros) en código cliente ni en el historial de git.
- [ ] Todo acceso a datos pasa por el cliente Supabase con RLS activo — cero queries que bypaseen policies desde el frontend.
- [ ] Tipos TypeScript regenerados y comparados contra el schema real (sin drift).
- [ ] El wizard maneja correctamente el error de `provision_tenant` si el usuario ya tiene un tenant.
- [ ] Con `tenants.mode = 'single'` el selector de sucursal queda oculto en la UI (tal como especifica el Bloque A.3).
- [ ] `README.md` actualizado: cómo levantar el proyecto local, variables de entorno necesarias, cómo regenerar tipos, cómo correr los tests.

## ENTREGABLE AL FINAL DE LA SESIÓN

1. Resumen de los commits hechos (uno por línea, con hash corto).
2. Resultado de cada test corrido (pass/fail, no solo "corrí los tests").
3. El checklist de revisión final, ítem por ítem, marcado.
4. Lista de TODOs concretos para la próxima sesión (lo que quedó fuera de alcance + lo que se descubrió en el camino, incluyendo la sesión de diseño visual del dashboard).
