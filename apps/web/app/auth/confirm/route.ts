import { createClient } from "@beautycrm/supabase/server"
import { NextResponse } from "next/server"
import type { EmailOtpType } from "@supabase/supabase-js"

function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/"
  }
  return next
}

/**
 * Verificación de magic link vía token_hash (patrón recomendado por
 * Supabase: https://supabase.com/docs/guides/auth/server-side/email-based-auth-with-pkce-flow-for-ssr).
 * A diferencia del flujo de código PKCE en /auth/callback (que solo
 * funciona si el link se abre en el mismo navegador que lo pidió),
 * verifyOtp con token_hash funciona cross-device — el caso real de un
 * magic link que se abre en el celular después de pedirse desde la
 * compu, por ejemplo.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const token_hash = searchParams.get("token_hash")
  const type = searchParams.get("type") as EmailOtpType | null
  const next = safeNextPath(searchParams.get("next"))

  if (token_hash && type) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ type, token_hash })
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`)
}
