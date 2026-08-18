# Módulo Configuración — Spec de diseño

**Fecha:** 2026-08-17
**Ruta:** `/dashboard/configuracion`
**Estado del esquema:** `tenants.business_name`, `tenants.settings jsonb`
(moneda, zona horaria — doc A.2) y `tenants.subscription_status`/`promo_ends_at`
ya existen desde `0001`, con `tenants_update` ya owner-only. No hace falta
migración nueva.

## Objetivo

Que la dueña pueda editar los datos básicos del salón (nombre, moneda, zona
horaria) y ver de un vistazo el estado de su suscripción, sin tocar la base
a mano.

## Decisiones tomadas

| Decisión | Elegido | Por qué |
|---|---|---|
| Migración nueva | Ninguna | `tenants_update` (owner-only, `0001`) ya alcanza |
| Quién administra | Sólo dueña | Mismo criterio que Comisiones/Sucursales: `tenants_update` ya es owner-only |
| Dónde vive moneda/zona horaria | `tenants.settings` (jsonb), claves `currency` y `timezone` | Ya está previsto en el doc de arquitectura (A.2: "moneda, zona horaria, branding"); no se agrega columna nueva para algo que el esquema ya modeló como jsonb |
| Suscripción | Sólo lectura | `subscription_status`/`stripe_customer_id` los gestiona el flujo de cobro (fuera de alcance, Bloque B "Fase 2"); esta pantalla sólo informa |
| Branding (logo/colores) | Fuera de alcance v1 | Necesita upload de archivos a Storage; el jsonb ya tiene el lugar reservado (`settings.branding`) para cuando se implemente |

## Capa de datos (`apps/web/lib/configuracion-*.ts`)

**Queries:** ninguna nueva — `getCurrentMembership()` ya trae `tenants(*)`
completo (`business_name`, `mode`, `subscription_status`, `promo_ends_at`,
`settings`), que es todo lo que esta pantalla necesita.

**Actions:**
- `updateBusinessInfo(tenantId, { businessName, currency, timezone })` —
  `update tenants set business_name = ..., settings = settings || jsonb`.
  El `||` (merge) en vez de reemplazar `settings` entero: no pisa
  `branding` u otras claves que se agreguen después.

## UI

Una pantalla, `/dashboard/configuracion`.

**Datos del negocio** (`BusinessInfoForm`): nombre, moneda (select con las
monedas de la región — v1: ARS, USD), zona horaria (select con las de
Argentina — v1: `America/Argentina/Buenos_Aires`, `America/Argentina/Mendoza`,
`America/Argentina/Cordoba`). El nombre se refleja en el Sidebar
(`businessName` ya viaja desde `dashboard/layout.tsx`), así que guardar
revalida el layout completo, no sólo la página.

**Suscripción** (`SubscriptionCard`): estado (`trial`/`promo`/`active`/`past_due`/`cancelled`)
traducido a texto, y `promo_ends_at` si corresponde. Sólo lectura.

### Convenciones heredadas

- Sin `useEffect` para sembrar formularios.
- Formularios con `noValidate`.
- Textos en español rioplatense.

## Verificación

### Invariantes contra la base (`test:configuracion`)

1. Una operadora no puede editar `business_name` ni `settings`
2. Una encargada tampoco puede (a diferencia de Sucursales, acá no hay
   excepción: `tenants_update` es estrictamente owner-only)
3. La dueña edita el nombre y `settings` sin pisar claves existentes que no
   tocó (se siembra una clave falsa antes del update y se confirma que
   sobrevive)
4. Un miembro de otro tenant no puede leer ni modificar `tenants` ajeno

### E2E

Dueña cambia el nombre del negocio → se refleja en el Sidebar sin recargar
manualmente.

## Fuera de alcance

- Branding (logo, colores) — necesita Storage, se agrega después
- Gestión de suscripción/facturación (Stripe) — Bloque B, Fase 2
- Invitar/gestionar el equipo (mencionado en el placeholder de Agenda,
  "Invitá a tu equipo desde Configuración") — es un módulo en sí mismo,
  no se improvisa acá
