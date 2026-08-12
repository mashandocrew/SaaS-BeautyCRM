# Sistema de Diseño UI — BeautyCRM

**Estado:** aprobado (dirección validada 2026-08-10), pendiente de implementación en código real (Fase 3).

## Cómo leer este documento (para sesiones futuras)

Este documento tiene dos capas, y la distinción es la decisión de arquitectura más
importante de todo el sistema:

1. **Tokens estructurales** (spacing, radios, escala tipográfica, familias de
   fuente, timing de motion, y la especificación de cada componente con sus
   estados) — son **fijos**. No cambian entre clientes. Son la plantilla.
2. **Tokens de marca** (color primario, color de acento, temperatura de los
   semánticos, logo) — son **por cliente**. Cambian completo entre clientes,
   la estructura no se toca.

Si estás leyendo esto para un cliente nuevo (no Jacintas Nails): andá directo a
la sección **"Tokens por cliente"** al final. Ahí está la lista exacta de
variables a reemplazar y el proceso de descubrimiento a repetir. No hace falta
releer todo el documento — la Sección 1-8 no cambia.

Si estás implementando la Fase 3 de esta misma sesión (Jacintas Nails): todo
este documento aplica tal cual, con los valores concretos ya definidos en cada
sección.

---

## 1. Principios de dirección

- **Tono:** boutique/spa cálido — femenino, higiénico, cercano. No es un SaaS
  frío tipo Linear/Notion, tampoco es informal/juguetón. Es elegante sin ser
  distante.
- **Lógica de color:** un acento de marca (no color-por-módulo) + color por
  estado. Los tres semánticos (éxito/alerta/error) se **afinan de temperatura
  por cliente** — no son un verde/ámbar/rojo genérico fijo entre todos los
  clientes, pero la convención de qué representa cada uno (verde=ok,
  dorado/ámbar=atención, terracota/rojo=urgente) sí es fija.
- **Densidad:** espaciosa y legible, no "panel de control". Prioriza que el
  dueño y las empleadas — que no son técnicos — entiendan la pantalla al
  primer vistazo. "Que no sea enredado" es un criterio de diseño explícito,
  no solo estético.
- **Iconografía:** un set consistente (Phosphor), nunca emoji.
- **Motion:** funcional, no decorativo. Este es un software de uso diario en
  contexto de trabajo (salón, mostrador, mobile con las manos ocupadas) — no
  una landing page. Priorizá claridad sobre espectáculo.
- **Accesibilidad:** no es un extra — es un requisito de cada componente
  nuevo, no una pasada final. En la práctica: foco de teclado visible en
  todo elemento interactivo (spec concreta en la sección 9, Botón/Input) y
  respeto a `prefers-reduced-motion` (spec en la sección 8, Motion). Un
  módulo nuevo que no cumple esto no está terminado.

### Dials de diseño (referencia interna, no se exponen al usuario final)

| Dial | Valor | Nota |
|---|---|---|
| Variance (asimetría de layout) | 3/10 | Predecible, grilla clara. Consistencia > originalidad. |
| Motion intensity | 4/10 | Transiciones suaves en hover/carga (200-300ms). Sin animación perpetua ni coreografía compleja. |
| Density | 4/10 | Espacioso pero funcional — sigue siendo software con tablas de datos reales, no una landing vacía. |

---

## 2. Paleta — tokens estructurales

Nombres de variable **fijos** entre clientes. Los valores hex de esta tabla
son los de **Jacintas Nails**; para un cliente nuevo se reemplazan los
valores, nunca los nombres.

```css
:root {
  /* Superficie */
  --color-bg: #F7F3EC;           /* fondo de página — crudo cálido, nunca blanco puro */
  --color-surface: #FFFDF9;      /* cards/paneles — un tono más claro que --bg */
  --color-border: #E6DECE;       /* bordes, divisores */

  /* Texto */
  --color-ink: #241F1A;          /* texto principal — casi-negro cálido, nunca #000 */
  --color-ink-soft: #78695A;     /* texto secundario, labels, metadata */
  --color-on-primary: #FBF8F2;   /* texto sobre fondo --color-primary */

  /* Marca (por cliente) */
  --color-primary: #1A3A2C;
  --color-primary-hover: #234C39;
  --color-accent: #B8873A;       /* detalles premium — uso deliberadamente escaso */

  /* Semánticos (temperatura por cliente, convención fija) */
  --color-success: #3F7A5C;
  --color-success-bg: #E7F1EB;
  --color-warning: #B8873A;
  --color-warning-bg: #F5EBD8;
  --color-danger: #A6503C;
  --color-danger-bg: #F5E6E1;
}
```

**Regla de contraste:** todo par texto/fondo de esta tabla cumple 4.5:1
mínimo (AA). Si en Fase 3 se ajusta un hex, reverificar contraste antes de
mergear — no asumir.

**Por qué `--color-success` no es el mismo verde que `--color-primary`:**
son de la misma familia cromática (coherencia con la marca) pero
deliberadamente distintos en luminosidad/saturación. Si un badge "Confirmado"
usara exactamente `--color-primary`, se confundiría visualmente con elementos
de marca (sidebar, botón primario) que no comunican estado.

---

## 3. Tipografía

```css
:root {
  --font-display: 'Fraunces', Georgia, serif;
  --font-sans: 'Manrope', -apple-system, 'Segoe UI', sans-serif;
}
```

- **Fraunces** (variable, optical size baja, peso 400-500): exclusivo para
  `<h1>` de página (ej. "Panel de control", "Agenda") y títulos de empty
  state. Nunca en tablas, botones, badges, ni texto funcional. Es una
  elección deliberada de "serif suave boutique", no un serif corporativo
  rígido — pero igual se restringe a títulos grandes para no perder
  legibilidad en el resto de la interfaz.
- **Manrope**: todo lo demás — cuerpo, labels, botones, tablas, navegación.
  Tiene numerales tabulares disponibles (usarlos en columnas de precio/stock
  para que no salten de ancho al cambiar el valor).
- El wordmark real de la marca ("jacintas" en script + "nails & co." en
  serif versalitas) **no se recrea en web font** — vive únicamente en el
  isotipo/imagen de marca. En la UI, el nombre del negocio se escribe en
  `--font-display`, no se imita la caligrafía del logo.

### Escala tipográfica

| Token | Tamaño | Peso | Fuente | Uso |
|---|---|---|---|---|
| `--text-display` | 32px / 1.15 | 500 | display | `<h1>` de página |
| `--text-h2` | 20px / 1.3 | 600 | sans | Títulos de sección/panel |
| `--text-h3` | 16px / 1.4 | 600 | sans | Sub-títulos, cabeceras de card |
| `--text-body` | 16px / 1.6 | 400 | sans | Texto de cuerpo, inputs |
| `--text-small` | 14px / 1.5 | 400 | sans | Metadata, hints, texto secundario |
| `--text-micro` | 12px / 1.4 | 600 | sans | Labels de tabla (uppercase, tracking .03em), badges |

Mínimo 16px en inputs (evita el auto-zoom de iOS en la PWA operadora).

---

## 4. Espaciado

Escala base 4px, aplicada consistente en padding/gap/margin:

```css
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
  --space-16: 64px;
}
```

- Padding interno de card/panel: `--space-6` (24px).
- Gap entre KPIs/stat tiles: `--space-4` (16px).
- Separación entre secciones de una página: `--space-8` a `--space-12`.
- Gap entre campos de un formulario: `--space-4`.

---

## 5. Radios

```css
:root {
  --radius-sm: 8px;    /* inputs, chips pequeños */
  --radius-md: 12px;   /* botones */
  --radius-lg: 20px;   /* cards, paneles, modales */
  --radius-full: 999px; /* badges, pills, avatares */
}
```

Radios generosos deliberadamente — hacen eco de las curvas del medallón del
isotipo sin volverse infantiles. No usar esquinas rectas en ningún
contenedor visible salvo tablas (`th`/`td` quedan rectos).

---

## 6. Sombras / Elevación

Tintadas hacia el verde de marca, nunca gris neutro puro — a esta densidad
(espaciosa, pocas cards apiladas) la sombra debe insinuar profundidad sin
"efecto plástico".

```css
:root {
  --shadow-sm: 0 1px 2px rgba(26, 58, 44, 0.05);
  --shadow-md: 0 8px 24px -8px rgba(26, 58, 44, 0.14);
}
```

- Card estática: `--shadow-sm`.
- Card interactiva en hover, dropdown, modal: `--shadow-md`.
- Nunca combinar `--shadow-md` con `--radius-full` (glow feo en elementos
  circulares/pill) — en esos casos, borde de 1px alcanza.

---

## 7. Iconografía

**Phosphor** (`@phosphor-icons/react`), nunca `duotone`. Peso según tamaño,
no al gusto de cada componente:

- `20px`–`24px` (default en botones/nav/empty states): peso `regular`.
- `16px` (flechas de navegación, cerrar de un Sheet, cualquier ícono chico
  de acción ajustada): peso `bold` — a ese tamaño `regular` pierde
  legibilidad, `bold` la recupera sin cambiar de familia visual.
- `fill` solo para marcar un estado ya completado/confirmado (ej. check de
  paso terminado en el wizard) — nunca como reemplazo genérico de `regular`.

Nunca emoji — ni en código, ni en contenido, ni en alt text.

---

## 8. Motion

```css
:root {
  --duration-fast: 150ms;
  --duration-base: 220ms;
  --easing-out: cubic-bezier(0.16, 1, 0.3, 1);
  --easing-in: cubic-bezier(0.7, 0, 0.84, 0);
}
```

- Hover/focus de botones e inputs: `--duration-fast`, transform/opacity
  únicamente (nunca `width`/`height`/`top`/`left`).
- Aparición de contenido (cards al cargar, pasos del wizard): fade + subtle
  translateY(4px), `--duration-base`, `--easing-out`.
- Feedback táctil en botones: `active:scale-[0.98]` o `translateY(1px)`.
- Sin animación perpetua (pulse/shimmer infinito) salvo en skeleton
  loaders mientras carga data real.
- Respetar `prefers-reduced-motion: reduce` — desactivar transform/opacity
  transitions no esenciales, mantener solo cambios de estado instantáneos.

---

## 9. Componentes base y sus estados

### Botón

| Variante | Fondo | Texto | Hover | Disabled | Loading |
|---|---|---|---|---|---|
| `primary` | `--color-primary` | `--color-on-primary` | `--color-primary-hover` | opacity .5, cursor not-allowed | spinner + texto "Verbo + -ando..." (ya es el patrón usado, ej. "Guardando...") |
| `secondary` | `--color-surface` + borde `--color-border` | `--color-ink` | `--color-bg` | opacity .5 | ídem |
| `danger` | `--color-danger` | `--color-on-primary` | oscurecer 10% | opacity .5 | ídem |

Focus visible obligatorio: ring de 2px en `--color-accent`, offset 2px,
en **todas** las variantes — no solo la primaria.

### Card / Panel

Fondo `--color-surface`, borde 1px `--color-border`, `--radius-lg`, padding
`--space-6`, `--shadow-sm`. Si es interactiva (clickeable): `--shadow-md` +
`translateY(-1px)` en hover, transición `--duration-fast`.

### Input / Field

Label siempre visible arriba del input (nunca placeholder-only). Estados:

- Default: borde `--color-border`.
- Focus: borde `--color-primary` + ring sutil del mismo color al 15% opacidad.
- Error: borde `--color-danger`, mensaje de error en `--color-danger`
  **debajo** del input (nunca solo arriba del formulario).
- Disabled: opacity .6, `--color-bg` de fondo, cursor not-allowed.

### Badge

Pill (`--radius-full`), padding `4px 12px`, `--text-micro`.

| Tone | Fondo | Texto |
|---|---|---|
| `neutral` | `--color-border` | `--color-ink-soft` |
| `success` | `--color-success-bg` | `--color-success` |
| `warning` | `--color-warning-bg` | `--color-warning` |
| `danger` | `--color-danger-bg` | `--color-danger` |

### Tabla

Header: `--text-micro`, uppercase, `--color-ink-soft`, borde inferior
`--color-border`. Filas: borde inferior 1px más suave. Hover de fila:
`--color-bg`. Vacía: usar el componente `EmptyState` dentro del contenedor
de la tabla, nunca una tabla con headers y cero filas sin explicación.

### Navegación — Sidebar (dueño)

Fondo `--color-primary` (no gradiente — un verde sólido lee más premium y
más legible que el degradé violeta del borrador). Ítem:

- Default: texto `--color-on-primary` al 72% opacidad.
- Hover: fondo blanco al 6% opacidad.
- Activo: fondo blanco al 10%, texto 100% opacidad, peso 600, borde
  izquierdo de 3px en `--color-accent`.
- Módulo sin implementar aún ("Próximamente"): texto al 40% opacidad,
  cursor not-allowed, badge pequeño "Pronto" en `neutral` tone adaptado a
  fondo oscuro. Nunca ocultar el módulo — mostrarlo deshabilitado comunica
  que existe una hoja de ruta.

### Navegación — Bottom nav (PWA operadora)

Fondo `--color-surface`, borde superior `--color-border`. Tab activo:
ícono + texto en `--color-primary`, peso 600. Inactivo: `--color-ink-soft`.
Target táctil mínimo 48px de alto por ítem — el contexto de uso (celular,
manos ocupadas) pesa más que la elegancia del ícono.

### Empty State

Ícono Phosphor 24px en `--color-ink-soft`, título en `--text-h3` /
`--color-ink`, descripción `--text-small` / `--color-ink-soft`, acción
opcional como botón `secondary`. Regla de origen (Bloque A.4 de la
arquitectura): toda pantalla vacía debe responder "¿y ahora qué hago?" —
nunca un empty state genérico sin acción sugerida.

### Banners (promo / error)

- Promo: fondo `--color-warning-bg`, texto `--color-warning` — reusa el
  dorado de marca en vez de un indigo genérico.
- Error: fondo `--color-danger-bg`, borde 1px `--color-danger` al 30%,
  texto `--color-danger`.

---

## 10. Estructura de navegación (dueño)

Set de 10 módulos, confirmado:

1. Panel de control *(implementado)*
2. Agenda *(pendiente)*
3. Clientes *(pendiente)*
4. Servicios *(pendiente)*
5. Inventario *(pendiente)*
6. Caja / POS *(pendiente)*
7. Comisiones *(pendiente)*
8. Reportes *(pendiente)*
9. Sucursales *(pendiente)*
10. Configuración *(pendiente)*

Los módulos "pendiente" se implementan en Fase 3 de esta sesión como shell
de navegación + pantalla "Próximamente" (ver sección 9, estado deshabilitado
del ítem de sidebar) — no como páginas funcionales. Construir la
funcionalidad de cada módulo queda fuera de alcance, tal como pide el
prompt original.

PWA operadora mantiene su propio set, ya implementado: Mi día, Mi cliente,
Mis comisiones — sin cambios de estructura, solo de skin visual.

---

## 11. Tokens por cliente — cómo reusar esta plantilla

Para un cliente nuevo, **no se toca** nada de las secciones 1 (excepto la
tabla de dials si el rubro lo justifica), 3 a 9. Se repite el proceso de
descubrimiento de la Fase 1 (cuestionario + logo real del cliente) solo
para producir un nuevo bloque de valores para estas variables:

```
--color-primary
--color-primary-hover
--color-accent
--color-success       (temperatura, no la convención)
--color-success-bg
--color-warning
--color-warning-bg
--color-danger
--color-danger-bg
```

Más el asset del logo/isotipo real del cliente (reemplaza el ícono de marca
en sidebar/favicon/PWA manifest).

`--color-bg`, `--color-surface`, `--color-border`, `--color-ink`,
`--color-ink-soft` normalmente **no** cambian entre clientes — son la base
neutra cálida de la plantilla. Solo se ajustan si el logo del cliente exige
un fondo distinto (ej. una marca con paleta fría no combinaría con un crudo
cálido) — evaluar caso por caso, no cambiar por defecto.

**TODO explícito fuera de esta sesión:** formulario de auto-servicio para
que el cliente cargue su propia identidad (logo + colores) sin intervención
manual de una sesión de Claude Code. Por ahora, el proceso es manual:
sesión de descubrimiento tipo Fase 1 + edición directa de estas variables.

---

## 12. Assets de marca — Jacintas Nails

- Isotipo real (medallón + "J" caligráfica) provisto por el cliente:
  `clientes/jacintas-nails/assets/75abe88a-4484-4e53-9089-b2b6da9fa76d_IMG-2870.jpeg`
  (1160×1160, cuadrado, sin necesidad de recorte).
- Generado a partir de ese archivo: `apps/web/public/icons/icon-192.png`,
  `icon-512.png` y `apps/web/public/favicon.png` (vía `sips`, sin
  reprocesar color — el verde de fondo del archivo original **es**
  `--color-primary`).
- Es un JPEG, no SVG — válido para íconos PWA (fondo sólido, sin
  transparencia que perder) pero **pendiente**: pedirle al cliente el
  archivo vectorial original si existe, para cualquier uso a mayor escala
  (impresos, favicon en alta densidad) donde el JPEG podría mostrar
  artefactos de compresión.
- `manifest.json` actualizado: `background_color` → `--color-bg`,
  `theme_color` → `--color-primary`.

---

## 13. Fuera de alcance de esta sesión (confirmado)

POS/cierre de caja completo, sync Google Calendar, WhatsApp Cloud API,
billing Stripe/MercadoPago, UI avanzada de multi-sucursal, panel de
Supervisor, formulario de auto-servicio de identidad por cliente. Estos
módulos reciben shell de navegación ("Próximamente") pero no
funcionalidad.
