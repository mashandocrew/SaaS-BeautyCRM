"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Button, Field, Input, Sheet } from "@beautycrm/ui"
import { inviteOperator } from "@/lib/team-actions"

export function InviteOperatorSheet({
  open,
  onClose,
  tenantId,
  branches,
  rules,
}: {
  open: boolean
  onClose: () => void
  tenantId: string
  /** Vacío en modo single: ahí se usa branches[0] sin mostrar el selector. */
  branches: { id: string; name: string }[]
  rules: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [channel, setChannel] = useState<"email" | "whatsapp">("email")
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "")
  const [commissionRuleId, setCommissionRuleId] = useState(rules[0]?.id ?? "")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!fullName.trim()) {
      setError("El nombre es obligatorio.")
      return
    }
    if (!branchId) {
      setError("Elegí una sucursal.")
      return
    }
    if (!commissionRuleId) {
      setError("Elegí una regla de comisión.")
      return
    }

    setLoading(true)
    const result = await inviteOperator(tenantId, branchId, {
      fullName,
      email,
      commissionRuleId,
      channel,
      phone: channel === "whatsapp" ? phone : undefined,
    })
    setLoading(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    onClose()
    router.refresh()
  }

  return (
    <Sheet open={open} onClose={onClose} title="Invitar operadora" side="right">
      <form onSubmit={handleSubmit} noValidate>
        {error ? <p className="error-banner">{error}</p> : null}
        <p className="field-hint" style={{ marginBottom: "var(--space-3)" }}>
          Le mandamos un link de acceso — sin contraseñas — por email o WhatsApp.
        </p>

        <Field label="Nombre" htmlFor="invite-name">
          <Input id="invite-name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </Field>

        <Field label="Email" htmlFor="invite-email">
          <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>

        <Field label="Cómo le avisamos" htmlFor="invite-channel">
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button
              type="button"
              variant={channel === "email" ? "primary" : "secondary"}
              onClick={() => setChannel("email")}
              style={{ flex: 1 }}
            >
              Email
            </Button>
            <Button
              type="button"
              variant={channel === "whatsapp" ? "primary" : "secondary"}
              onClick={() => setChannel("whatsapp")}
              style={{ flex: 1 }}
            >
              WhatsApp
            </Button>
          </div>
        </Field>

        {channel === "whatsapp" ? (
          <Field label="Teléfono (con código de país)" htmlFor="invite-phone">
            <Input
              id="invite-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+54 9 261 123-4567"
              required
            />
          </Field>
        ) : null}

        {/* Sólo se muestra en multi-sede: en single hay una sola sucursal y
            se asigna sin preguntar (igual que el Paso 3 del onboarding). */}
        {branches.length > 1 ? (
          <Field label="Sucursal" htmlFor="invite-branch">
            <select id="invite-branch" className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </Field>
        ) : null}

        <Field label="Regla de comisión" htmlFor="invite-rule">
          <select
            id="invite-rule"
            className="input"
            value={commissionRuleId}
            onChange={(e) => setCommissionRuleId(e.target.value)}
          >
            {rules.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </Field>

        <Button type="submit" disabled={loading}>
          {loading ? "Invitando..." : "Invitar"}
        </Button>
      </form>
    </Sheet>
  )
}
