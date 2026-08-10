"use client"

import { Suspense, useState, type FormEvent } from "react"
import { useSearchParams } from "next/navigation"
import { createClient } from "@beautycrm/supabase/client"
import { Button, Field, Input } from "@beautycrm/ui"

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchParams = useSearchParams()
  const next = searchParams.get("next") ?? "/"

  async function handleMagicLink(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    })

    setLoading(false)
    if (error) {
      setError("No pudimos enviar el link. Probá de nuevo en un minuto.")
      return
    }
    setSent(true)
  }

  async function handleGoogle() {
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    })

    if (error) {
      setLoading(false)
      setError("No pudimos conectar con Google. Probá de nuevo.")
    }
  }

  if (sent) {
    return (
      <div className="auth-shell">
        <AuthBrand />
        <div className="card" style={{ maxWidth: 420, width: "100%" }}>
          <h1>Revisá tu email</h1>
          <p>
            Te mandamos un link de acceso a <strong>{email}</strong>. Tocalo
            para entrar — no hace falta contraseña.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-shell">
      <AuthBrand />
      <div className="card" style={{ maxWidth: 420, width: "100%" }}>
        <h1>Entrar a BeautyCRM</h1>
        {error ? <p className="error-banner">{error}</p> : null}

        <form onSubmit={handleMagicLink}>
          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vos@tunegocio.com"
            />
          </Field>
          <Button type="submit" disabled={loading} style={{ width: "100%" }}>
            {loading ? "Enviando..." : "Enviarme un link mágico"}
          </Button>
        </form>

        <div style={{ margin: "16px 0", textAlign: "center", color: "var(--color-ink-soft)" }}>
          o
        </div>

        <Button
          type="button"
          variant="secondary"
          onClick={handleGoogle}
          disabled={loading}
          style={{ width: "100%" }}
        >
          Continuar con Google
        </Button>
      </div>
    </div>
  )
}

function AuthBrand() {
  return (
    <div className="auth-brand">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-192.png" alt="" />
      <span>BeautyCRM</span>
    </div>
  )
}
