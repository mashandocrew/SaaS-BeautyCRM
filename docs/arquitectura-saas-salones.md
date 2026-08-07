# Especificación de Arquitectura — SaaS de Gestión para Salones de Belleza
### Metodología "Software Amoldable" · Multi-tenant · Desktop Admin + Mobile Operativo

---

# BLOQUE A — Arquitectura de Software Amoldable

## A.1 Principios de diseño

1. **Multi-tenancy por fila (Row-Level Security):** todos los registros llevan `tenant_id`. Un solo esquema de base de datos sirve a todos los clientes, con aislamiento garantizado a nivel de motor (Postgres RLS), no a nivel de aplicación. Esto elimina la clase entera de bugs de fuga de datos entre salones.
2. **La sucursal como abstracción universal:** *todo* salón tiene al menos una sucursal, incluso el mono-sede. El flag "amoldable" no cambia el modelo de datos, solo la interfaz. Así, migrar de mono-sede a franquicia es cambiar un booleano, no una migración de datos.
3. **Roles como membresías, no como atributos del usuario:** una persona puede ser Operadora en la sucursal A y Supervisora en la B. El rol vive en la relación usuario↔sucursal, no en el usuario.
4. **Eventos desacoplados:** el POS no descuenta stock directamente; emite un evento `service_completed` que el módulo de inventario consume. Esto permite activar/desactivar módulos por tenant sin romper nada.

## A.2 Modelado de Datos (Esquema conceptual relacional)

### Núcleo de identidad y tenancy

```sql
-- El salón como negocio (el "tenant")
tenants (
  id uuid PK,
  business_name text,
  mode enum('single','multi') DEFAULT 'single',  -- ⭐ el flag "amoldable"
  subscription_status enum('trial','promo','active','past_due','cancelled'),
  promo_ends_at date,          -- fin de los 3 meses a $40
  settings jsonb               -- moneda, zona horaria, branding
)

branches (
  id uuid PK,
  tenant_id uuid FK → tenants,
  name text,                   -- en modo 'single' se autogenera "Principal"
  address text, phone text,
  is_active boolean
)

users (
  id uuid PK,                  -- espejo del proveedor de Auth
  full_name text, email text, phone text,
  avatar_url text
)

-- ⭐ El rol vive en la MEMBRESÍA, no en el usuario
memberships (
  id uuid PK,
  tenant_id uuid FK,
  user_id uuid FK,
  branch_id uuid FK NULL,      -- NULL = alcance global (Dueño)
  role enum('owner','supervisor','operator'),
  commission_rule_id uuid FK NULL,
  google_calendar_token jsonb NULL,   -- OAuth2 por operador (cifrado)
  UNIQUE(tenant_id, user_id, branch_id)
)
```

**Regla de acceso derivada del modelo:**

| Rol | branch_id en membership | Alcance efectivo |
|---|---|---|
| `owner` | NULL | Todo el tenant, finanzas consolidadas |
| `supervisor` | X | Todo dentro de la sucursal X |
| `operator` | X | Solo su agenda, sus clientes del día, sus comisiones |

### Catálogo, clientes e historial estético

```sql
services (
  id uuid PK, tenant_id uuid FK,
  name text, duration_minutes int, price numeric,
  category text, is_active boolean
)

-- Qué insumos consume cada servicio (BOM: Bill of Materials)
service_supplies (
  service_id uuid FK,
  supply_id uuid FK,
  quantity_consumed numeric      -- ej. 15ml de esmalte
)

supplies (                        -- insumos internos
  id uuid PK, tenant_id uuid FK,
  name text, unit enum('ml','gr','unit'), cost_per_unit numeric
)

retail_products (                 -- productos para venta al cliente
  id uuid PK, tenant_id uuid FK,
  name text, sale_price numeric, cost numeric
)

-- Stock SIEMPRE por sucursal (en mono-sede hay una sola fila)
inventory (
  branch_id uuid FK,
  item_id uuid,                  -- polimórfico: supply o retail_product
  item_type enum('supply','product'),
  current_stock numeric,
  min_alert_level numeric,
  PRIMARY KEY(branch_id, item_id, item_type)
)

clients (
  id uuid PK, tenant_id uuid FK,  -- ⭐ cliente a nivel tenant, no sucursal:
  full_name text, phone text,     --    puede atenderse en cualquier sede
  email text, birthday date,
  notes text
)

-- Historial estético: una fila por servicio realizado
client_history (
  id uuid PK,
  client_id uuid FK,
  appointment_id uuid FK,
  service_id uuid FK,
  operator_id uuid FK → users,
  branch_id uuid FK,
  performed_at timestamptz,
  technical_notes text,          -- "tono 7.3, sensibilidad en cutícula"
  photos jsonb                   -- URLs en storage (antes/después)
)
```

### Agenda y operación

```sql
appointments (
  id uuid PK, tenant_id uuid FK, branch_id uuid FK,
  client_id uuid FK,
  operator_id uuid FK → users,
  starts_at timestamptz, ends_at timestamptz,
  status enum('booked','confirmed','in_progress','done','no_show','cancelled'),
  google_event_id text NULL,     -- para sync bidireccional
  source enum('internal','google','online_booking')
)

appointment_services (           -- un turno puede incluir varios servicios
  appointment_id uuid FK,
  service_id uuid FK,
  price_snapshot numeric         -- congela el precio al momento de reservar
)
```

### Motor financiero: comisiones, POS y caja

```sql
commission_rules (
  id uuid PK, tenant_id uuid FK,
  name text,                     -- "Manicurista Senior"
  base_salary numeric DEFAULT 0,
  service_pct numeric DEFAULT 0,   -- % sobre servicios realizados
  product_sale_pct numeric DEFAULT 0,
  rules jsonb                    -- excepciones: % distinto por servicio puntual
)

sales (                          -- transacción de POS / cierre de turno
  id uuid PK, tenant_id uuid FK, branch_id uuid FK,
  appointment_id uuid FK NULL,   -- NULL si es venta directa de mostrador
  client_id uuid FK NULL,
  total numeric, discount numeric,
  cash_session_id uuid FK,
  created_by uuid FK, created_at timestamptz
)

sale_items (
  sale_id uuid FK,
  item_type enum('service','product'),
  item_id uuid, quantity numeric, unit_price numeric,
  operator_id uuid FK            -- ⭐ quién lo hizo/vendió → base de la comisión
)

payments (
  sale_id uuid FK,
  method enum('cash','card','transfer','mp','other'),
  amount numeric                 -- permite pagos mixtos
)

-- Libro mayor de comisiones: se calcula al confirmar la venta (evento)
commission_ledger (
  id uuid PK, tenant_id uuid FK,
  operator_id uuid FK, sale_item_id uuid FK,
  amount numeric, rule_snapshot jsonb,   -- auditabilidad total
  period text,                   -- '2026-07' para liquidación mensual
  settled boolean DEFAULT false
)

cash_sessions (                  -- apertura y cierre de caja por sucursal
  id uuid PK, branch_id uuid FK,
  opened_by uuid FK, opened_at timestamptz, opening_amount numeric,
  closed_by uuid FK NULL, closed_at timestamptz NULL,
  expected_total numeric, counted_total numeric, difference numeric
)
```

### Por qué este modelo no tiene redundancia

- El historial estético referencia `appointment_id` y `service_id`: nunca duplica datos del servicio, solo agrega las notas técnicas que son propias del evento.
- `price_snapshot` y `rule_snapshot` parecen redundancia pero son **inmutabilidad contable**: si el dueño cambia un precio o una comisión, las liquidaciones pasadas no se reescriben.
- El flag `tenants.mode` no bifurca tablas: mono-sede y franquicia usan exactamente el mismo esquema.

## A.3 Comportamiento "Amoldable" en la interfaz

| Elemento de UI | `mode = 'single'` | `mode = 'multi'` |
|---|---|---|
| Selector de sucursal | Oculto (auto-selección) | Visible en header, persistente |
| Dashboard del Dueño | KPIs directos del negocio | KPIs consolidados + comparativa por sede |
| Inventario | Lista simple | Filtro por sede + transferencias entre sedes |
| Reportes | Un solo nivel | Drill-down: consolidado → sucursal → operador |
| Alta de Supervisor | No se ofrece el rol | Wizard de asignación de sede |

La activación de `multi` es autoservicio: en Configuración → "Agregar sucursal" convierte el modo automáticamente, sin intervención de soporte.

**UI por rol (enfoque de dispositivo):**
- **Dueño:** Desktop-first. Dashboards, configuración, finanzas.
- **Supervisor:** Híbrido. Cierre de caja y stock en desktop/tablet, agenda en mobile.
- **Operadora:** 100% Mobile PWA. Tres pantallas y nada más: *Mi día* (agenda), *Mi cliente* (historial + notas de la persona que está por atender), *Mis comisiones* (acumulado del período en tiempo real).

## A.4 Flujo de Onboarding Autónomo (el Wizard "Low-Touch")

Objetivo: del registro al primer turno agendado en **menos de 15 minutos, sin contacto humano**.

**Paso 0 — Registro y activación de promo**
Email/Google → se crea `tenant` en modo `single` con sucursal "Principal" autogenerada, `subscription_status = 'promo'`, `promo_ends_at = hoy + 90 días`. Banner permanente y honesto: "Precio promocional $40/mes hasta el 4 de octubre, luego $100/mes".

**Paso 1 — Identidad del negocio (2 min)**
Nombre, logo (opcional), horario de atención, zona horaria y moneda detectadas por defecto. Todo salteable; todo editable después.

**Paso 2 — Servicios (3 min)**
Plantillas precargadas por rubro: al elegir "Nails / Peluquería / Estética integral" se sugieren 10–15 servicios típicos con duración y precio de referencia editables inline. El dueño borra lo que no ofrece, ajusta precios y sigue. *Nunca* arranca de una pantalla vacía — la pantalla vacía es el principal generador de tickets de soporte.

**Paso 3 — Equipo (3 min)**
"¿Quién trabaja con vos?" → nombre + celular/email por operadora. El sistema envía un **magic link** por WhatsApp/email: la operadora toca el link, pone su nombre y foto, y ya está adentro con rol `operator` y su agenda vacía. Sin contraseñas que soportar, sin instalación de app (PWA instalable).
En este paso también se le asigna a cada una una regla de comisión con tres presets: *Solo sueldo / % por servicio / Mixto* — configuración avanzada disponible pero no obligatoria.

**Paso 4 — Primer turno (2 min, gamificado)**
El wizard termina pidiendo cargar un turno real de mañana. Drag sobre el calendario, cliente nuevo con solo nombre y teléfono. Checklist de progreso visible ("4 de 5 completado") — el clásico patrón que empuja a terminar.

**Paso 5 — Conexiones opcionales (diferido)**
Google Calendar, recordatorios por WhatsApp e inventario inicial se ofrecen como tarjetas "Mejorá tu salón" en el dashboard, *después* del onboarding. Meter integraciones OAuth en el wizard inicial mata la conversión.

**Red de seguridad Low-Touch:** tooltips contextuales en primer uso de cada módulo, un centro de ayuda con videos de 30 segundos por tarea, y estados vacíos que siempre dicen qué hacer ("Todavía no cargaste insumos → Cargar el primero"). Toda pantalla debe responder sola la pregunta "¿y ahora qué hago?".

---

# BLOQUE B — Roadmap de Infraestructura, Servicios y Cuentas

## B.1 Stack recomendado (resumen ejecutivo)

| Capa | Proveedor | Costo fase inicial | Por qué |
|---|---|---|---|
| Base de datos + Auth + Storage + RLS | **Supabase** | $0 → $25/mes (Pro) | Postgres relacional real (el modelo de arriba entra nativo), RLS para multi-tenancy, Auth con magic links incluido |
| Frontend + API | **Next.js en Vercel** | $0 → $20/mes | SSR + PWA, serverless functions, deploy por git push |
| Sincronización Calendar | **Google Cloud Console** | $0 | Calendar API es gratuita en estos volúmenes |
| Notificaciones WhatsApp | **Meta WhatsApp Cloud API** (o Twilio) | ~$0.01–0.07 por conversación | Canal dominante en LATAM para recordatorios de turnos |
| Email transaccional | **Resend** | $0 (3.000 emails/mes) | Magic links, recibos, invitaciones |
| Cobro de la suscripción | **Stripe** (global) + **Mercado Pago** (LATAM) | % por transacción | Stripe Billing maneja nativamente el cupón "60% off × 3 meses" |
| Monitoreo de errores | **Sentry** | $0 (plan dev) | Detectar problemas antes de que el cliente llame — pilar del Low-Touch |

**Costo fijo total fase inicial: $0–45/mes.** Con 10 clientes pagando la promo ($400/mes) el margen ya supera el 88%; a precio pleno con 20 clientes ($2.000/mes), la infraestructura representa menos del 3% del ingreso.

## B.2 Evaluación de alternativas (coste/beneficio)

**Supabase vs. Firebase:** Firebase (Firestore) es NoSQL — el modelo relacional de comisiones, liquidaciones e inventario con integridad referencial se vuelve doloroso y caro en lecturas. Supabase es Postgres puro: joins reales, transacciones ACID para el cierre de caja, y RLS que implementa el aislamiento multi-tenant en el motor. Veredicto: **Supabase, sin dudas, para este dominio.**

**Supabase Auth vs. Auth0:** Auth0 cobra por usuario activo mensual y escala mal en precio para un SaaS B2B2C donde cada salón trae 3–10 operadoras. Supabase Auth viene incluido, soporta magic links (clave del onboarding del Paso 3) y OAuth de Google. Auth0 solo se justificaría con requisitos enterprise (SAML) que este mercado no pide. Veredicto: **Supabase Auth.**

**Vercel vs. VPS propio:** un VPS es más barato en papel pero exige mantenimiento, y el objetivo es margen *y* bajo esfuerzo operativo. Serverless escala a cero y el tier gratuito cubre los primeros meses completos. Migrar después es trivial porque Next.js no ata a Vercel.

## B.3 Roadmap de creación de cuentas — paso a paso cronológico

**Semana 1 — Fundaciones**
1. **GitHub:** cuenta de organización + repo privado. Todo lo demás se conecta acá.
2. **Supabase:** crear proyecto (región `sa-east-1`, São Paulo — menor latencia para Argentina). Ejecutar el esquema del Bloque A. Activar RLS en *todas* las tablas desde el día 1 (retrofitear RLS después es una pesadilla). Configurar Auth: proveedor Email (magic link) + Google.
3. **Vercel:** cuenta conectada al repo. Variables de entorno: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (esta última solo en server-side, jamás expuesta al cliente).
4. **Dominio:** comprar en Cloudflare Registrar (precio de costo) y usar Cloudflare como DNS/CDN gratuito. Estructura sugerida: `app.tudominio.com` (aplicación) y `tudominio.com` (landing de venta).

**Semana 2–3 — Integraciones**
5. **Google Cloud Console:** crear proyecto → habilitar **Google Calendar API** → crear credenciales **OAuth 2.0** (tipo Web) con redirect URI hacia la app.
   - *Decisión técnica:* usar **OAuth2 por operadora**, no Service Accounts. Las Service Accounts sirven para calendarios corporativos de Google Workspace; las manicuristas usan Gmail personal, donde solo OAuth2 funciona. Cada operadora conecta su calendario desde su perfil (flujo opcional del Paso 5 del onboarding).
   - Configurar la pantalla de consentimiento OAuth y prever el proceso de **verificación de Google** (necesario al pasar de "testing" a producción con más de 100 usuarios; toma 2–6 semanas — iniciarlo temprano).
   - Sync bidireccional: webhooks de Calendar (push notifications con canal renovable) para Google→App, y llamadas directas a la API para App→Google, guardando `google_event_id` para idempotencia.
6. **Resend:** cuenta + verificación del dominio (registros SPF/DKIM en Cloudflare). Templates: magic link, invitación de operadora, recibo de pago.
7. **Meta for Developers (WhatsApp Cloud API):** crear app de negocio, verificar el negocio en Meta Business Manager (puede demorar días — iniciar temprano), registrar número emisor y plantillas de mensaje ("Hola {{nombre}}, te recordamos tu turno mañana a las {{hora}}"). Alternativa con menos fricción administrativa pero mayor costo por mensaje: Twilio WhatsApp.

**Semana 3–4 — Monetización**
8. **Stripe:** cuenta + producto "Suscripción Salón" a $100/mes + **cupón del 60% con duración de 3 meses** (Stripe Billing lo automatiza: cobra $40 los tres primeros ciclos y pasa a $100 solo, sin código). Webhooks hacia la app para actualizar `subscription_status`.
9. **Mercado Pago (si el mercado inicial es Argentina/LATAM):** suscripciones con débito automático en moneda local — reduce el rechazo de tarjetas frente al cobro en USD. Estrategia razonable: MP para LATAM, Stripe para el resto.
10. **Sentry:** conectar SDK en frontend y backend. Alertas a tu email/Slack.

**Fase 2 (post-tracción, no gastar antes de tiempo)**
- Supabase Pro ($25/mes) al superar los límites del tier gratuito (500MB DB / 1GB storage) — aproximadamente al llegar a 15–25 salones activos.
- Backups point-in-time de Supabase (add-on) cuando haya datos financieros de terceros en producción.
- Posthog o Plausible para analítica de producto (detectar dónde se traban los usuarios = menos soporte).

## B.4 Diagrama de arquitectura final

```
                    ┌─────────────────────────────┐
                    │   Next.js PWA (Vercel)      │
                    │  Desktop Admin │ Mobile Op  │
                    └──────┬──────────────┬───────┘
                           │              │
              ┌────────────▼───┐   ┌──────▼────────────┐
              │   Supabase     │   │ Serverless Funcs  │
              │  Postgres+RLS  │   │ (Vercel/Edge)     │
              │  Auth ─ Storage│   │  · Sync Calendar  │
              └────────┬───────┘   │  · Eventos stock  │
                       │           │  · Comisiones     │
                       │           └──────┬────────────┘
                       │                  │
        ┌──────────────┼──────────────────┼──────────────┐
        │              │                  │              │
   ┌────▼────┐   ┌─────▼─────┐   ┌────────▼──┐   ┌───────▼──────┐
   │ Stripe/ │   │  Google   │   │ WhatsApp  │   │   Resend     │
   │   MP    │   │ Calendar  │   │ Cloud API │   │   (email)    │
   └─────────┘   └───────────┘   └───────────┘   └──────────────┘
```
