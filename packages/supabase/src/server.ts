import "server-only"
import { createServerClient } from "@supabase/ssr"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"
import type { Database } from "./types"

/**
 * Cliente Supabase para Server Components, Route Handlers y Server Actions.
 * Usa el ANON key + la sesión del usuario (via cookies) — respeta RLS siempre.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll puede llamarse desde un Server Component: se ignora
            // porque el middleware ya se encarga de refrescar la sesión.
          }
        },
      },
    }
  )
}

/**
 * Cliente con SERVICE_ROLE_KEY — bypasea RLS por completo.
 * SOLO server-side (route handlers / server actions). NUNCA importar
 * este módulo desde un componente marcado "use client".
 * Uso real: ninguno en el alcance de esta sesión (se deja preparado
 * para tareas admin futuras, p. ej. webhooks de Stripe).
 */
export function createServiceRoleClient() {
  if (typeof window !== "undefined") {
    throw new Error(
      "createServiceRoleClient nunca debe ejecutarse en el cliente"
    )
  }

  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
