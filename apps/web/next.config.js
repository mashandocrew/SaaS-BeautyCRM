// INVARIANTE DE DEPLOY — módulo Agenda: las ventanas de "hoy" (apps/web/app/o/page.tsx)
// y "esta semana" (apps/web/app/dashboard/agenda/page.tsx) se calculan con
// `new Date()` + `.setHours(...)` / `startOfWeek()`, que corren en el
// timezone del proceso Node, no en el del tenant. En un host que por
// default usa UTC (Vercel sin TZ seteado, por ejemplo) eso desalinea esas
// ventanas ~3hs respecto al horario real del negocio (ART, UTC-3): "Mi
// día" puede esconder turnos de la noche y mostrar los de la madrugada
// del día anterior; la semana del dashboard puede arrancar el día
// equivocado. Fijamos TZ acá (mismo default que usa provision_tenant en
// migrations/0003 y 0005) para que dev/build/start siempre corran en el
// horario del negocio. Es un fix a nivel de proceso — todos los tenants
// comparten este timezone — no lectura dinámica de
// tenants.settings.timezone por request (fuera de alcance del fix wave
// que agregó este comentario; ver README.md, sección "Variables de
// entorno", para el detalle). Si el entorno de deploy ya define TZ
// explícitamente, ese valor gana.
process.env.TZ = process.env.TZ || "America/Argentina/Mendoza"

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@beautycrm/supabase", "@beautycrm/ui"],
}

module.exports = nextConfig
