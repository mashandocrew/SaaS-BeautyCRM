# Cuestionario — Diseño de interfaz del CRM (BeautyCRM)

Este cuestionario tiene dos objetivos:

1. Definir la **plantilla estructural** de la interfaz (layout, tipografía,
   componentes, lógica de color) — esto se decide **una sola vez** y se
   reutiliza para todos los clientes.
2. Definir la **identidad visual de Jacintas Nails** (paleta, tono) como
   primer caso de uso de esa plantilla.

Ya existe un punto de partida en el repo: `clientes/jacintas-nails/dashboard-mockup-borrador.html`,
marcado explícitamente como "borrador, pendiente de sesión de diseño
dedicada". Tiene una dirección ya explorada (sidebar violeta oscuro,
acentos en rosa/dorado/verde, cards con íconos de emoji) — las preguntas
de abajo asumen que se puede partir de ahí, refinarlo, o descartarlo.

Responda en el orden que le resulte más cómodo — no hace falta contestar
todo de una.

---

## 1. Identidad visual de Jacintas Nails (y de cada cliente futuro)

1.1. ¿Jacintas Nails tiene logo, isotipo o colores de marca ya definidos
(Instagram, cartelería, uñas de muestra, lo que sea)? Si tiene, ¿puede
pasarme una foto/link/captura? Si no tiene nada formal, ¿lo definimos
nosotros como parte de este trabajo?

1.2. Si ya hay colores dando vueltas (aunque sea informalmente, tipo "el
violeta y rosa que usamos en las redes"), ¿cuáles son? ¿Coinciden con el
violeta/rosa/dorado del mockup borrador, o van para otro lado?

1.3. Tres palabras que describan cómo se quiere sentir el negocio al
verlo (ej: "elegante, cálido, profesional" / "moderno, minimalista,
serio" / "divertido, colorido, cercano"). Esto es lo que más orienta la
paleta y la tipografía.

1.4. Para clientes futuros (no Jacintas): ¿el criterio va a ser "cada
cliente manda su logo y colores y nosotros los adaptamos a la plantilla",
o van a ser paletas que armamos nosotros a partir de su rubro/nombre?
Esto define qué tan flexible tiene que ser el sistema de color en el
documento final.

## 2. Tono y personalidad visual (decisión de plantilla, universal)

2.1. Punto de partida: ¿seguimos afinando la línea del mockup borrador
(sidebar oscura, gradientes suaves, cards redondeadas, íconos tipo
emoji), arrancamos de un estilo más "SaaS prolijo" (mucho blanco,
acentos sutiles, tipo Linear/Notion), o algo más "boutique/spa" (cálido,
tipografía con carácter, texturas suaves)?

2.2. Densidad: ¿preferís que el dashboard muestre mucha información de
un vistazo (más denso, tipo panel de control), o que priorice
legibilidad y espacio en blanco aunque eso signifique un scroll más para
ver todo?

2.3. Iconografía: ¿emojis como en el borrador (rápido, informal, ya
está armado así) o un set de íconos consistente tipo Lucide/Feather
(más prolijo, más "SaaS serio", pero es trabajo adicional)?

## 3. Lógica de color (decisión de plantilla, universal)

El borrador ya usa dos lógicas mezcladas: color por **módulo** (KPI de
plata = verde, turnos = violeta, ticket = rosa, ocupación = dorado) y
color por **estado** (confirmado = verde, pendiente = dorado, en curso =
violeta, stock bajo = rojo). Para el documento final necesito que el
sistema quede explícito:

3.1. ¿Mantenemos color-por-módulo + color-por-estado como en el
borrador, o simplificamos a un solo acento de marca (el color principal
del cliente) y dejamos el color-por-estado como la única variación
semántica (verde=ok, ámbar=atención, rojo=urgente)?

3.2. Si mantenemos color-por-módulo: ¿ese mapeo de módulo→color es fijo
para todos los clientes (agenda siempre en el tono X de la paleta,
plata siempre en el tono Y), o se recalcula por cliente según su paleta?

3.3. Los colores semánticos (éxito/alerta/error) hoy en `globals.css`
son genéricos (verde/ámbar/rojo estándar) y en el borrador tienen otra
temperatura (dorado en vez de ámbar puro, por ejemplo). ¿Los semánticos
quedan siempre iguales entre clientes (para no perder la convención
"rojo=urgente" pase lo que pase), o también se adaptan al tono de marca?

## 4. Estructura y navegación

4.1. Sidebar fija en desktop (como el borrador) — ¿se mantiene, o
preferís que sea colapsable a solo-íconos para ganar espacio?

4.2. Los módulos del borrador son: Dashboard, Agenda, Clientes,
Servicios, Inventario, Caja/POS, Comisiones, Reportes, Sucursales,
Configuración. ¿Este es el set definitivo de secciones del dueño, falta
algo, sobra algo?

4.3. La PWA de la operadora (3 pantallas: Mi día / Mi cliente / Mis
comisiones) hoy tiene su propio `nav-bottom` simple, sin la paleta del
borrador todavía. ¿Debe compartir exactamente la misma identidad visual
que el dashboard del dueño, o puede ser más simple/liviana por ser
mobile-first?

## 5. Tipografía

5.1. Hoy el proyecto usa la fuente del sistema (`system-ui`). ¿Sumamos
una tipografía con más personalidad (vía Google Fonts, ej. algo con
carácter para títulos + una neutra para texto), o seguimos con
system-ui por performance y simpleza?

## 6. Accesibilidad y modos

6.1. ¿Hace falta modo oscuro además del claro, o con uno solo (claro)
alcanza por ahora?

6.2. Dado que las operadoras van a usar la PWA desde el celular en el
salón (a veces con las manos recién lavadas, con guantes, con poca luz),
¿priorizamos contraste alto y targets táctiles grandes por sobre lo
puramente estético?

## 7. Referencias e inspiración

7.1. ¿Hay algún SaaS, app o sitio (de belleza o no) cuya interfaz le
guste como referencia de "así me gustaría que se sienta"? Con 2-3
ejemplos alcanza — no hace falta que sean del mismo rubro.

7.2. ¿Algo que definitivamente NO quiera? (ej. "nada de fondo blanco
puro", "que no parezca una planilla de Excel", "nada infantil")

---

## Cómo se usa esto

Con sus respuestas armo `docs/ui-design-system.md` en el repo: la
plantilla estructural completa (layout, componentes, tipografía, reglas
de color) más una sección de "tokens por cliente" con la paleta
concreta de Jacintas Nails ya aplicada. Ese documento queda en el
contexto del proyecto para reusarlo con cada cliente nuevo, cambiando
solo los tokens de color/marca y manteniendo la misma estructura.
