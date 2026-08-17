"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card } from "@beautycrm/ui"
import { setCashPermission } from "@/lib/caja-actions"
import type { TeamMember } from "@/lib/caja-types"

const ROLE_LABELS: Record<string, string> = {
  owner: "Dueña",
  supervisor: "Encargada",
  operator: "Operadora",
}

export function CashPermissionPanel({
  tenantId,
  team,
}: {
  tenantId: string
  team: TeamMember[]
}) {
  const router = useRouter()
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggle(member: TeamMember, next: boolean) {
    setError(null)
    setSaving(member.user_id)
    const result = await setCashPermission(tenantId, member.user_id, next)
    setSaving(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  return (
    <Card style={{ marginBottom: "var(--space-4)" }}>
      <h2>Quién puede cobrar</h2>
      <p style={{ color: "var(--color-ink-soft)" }}>
        La dueña y la encargada pueden cobrar siempre. A una operadora se lo podés dar y sacar
        cuando quieras — anular una venta sigue siendo solo de la dueña.
      </p>
      {error ? <p className="error-banner">{error}</p> : null}

      <table>
        <thead>
          <tr>
            <th>Persona</th>
            <th>Rol</th>
            <th>Puede cobrar</th>
          </tr>
        </thead>
        <tbody>
          {team.map((m) => (
            <tr key={m.user_id}>
              <td>{m.name}</td>
              <td>{ROLE_LABELS[m.role] ?? m.role}</td>
              <td>
                <label
                  style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}
                >
                  <input
                    type="checkbox"
                    aria-label={`Permitir que ${m.name} cobre`}
                    checked={m.can_operate_cash}
                    /* Deshabilitado para dueña y encargada: lo tienen por el
                       rol, no por este flag. Dejarlo activo sugeriría que se
                       les puede sacar acá, y no es así. */
                    disabled={m.locked || saving === m.user_id}
                    onChange={(e) => toggle(m, e.target.checked)}
                  />
                  {m.locked ? "Por su rol" : saving === m.user_id ? "Guardando..." : null}
                </label>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}
