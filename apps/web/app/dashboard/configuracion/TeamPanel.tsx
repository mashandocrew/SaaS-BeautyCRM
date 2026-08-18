"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Users } from "@phosphor-icons/react"
import { Badge, Button, Card, EmptyState } from "@beautycrm/ui"
import { setCashPermission } from "@/lib/caja-actions"
import type { TeamMember } from "@/lib/team-queries"
import { InviteOperatorSheet } from "./InviteOperatorSheet"

const ROLE_LABEL: Record<string, string> = { owner: "Dueño/a", supervisor: "Encargada", operator: "Operadora" }
const ROLE_TONE: Record<string, "success" | "warning" | "neutral"> = {
  owner: "success", supervisor: "warning", operator: "neutral",
}

export function TeamPanel({
  tenantId,
  members,
  branches,
  rules,
}: {
  tenantId: string
  members: TeamMember[]
  branches: { id: string; name: string }[]
  rules: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [inviting, setInviting] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggleCash(member: TeamMember, next: boolean) {
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-3)" }}>
        <h2>Equipo</h2>
        <Button onClick={() => setInviting(true)} disabled={rules.length === 0}>
          <Plus size={16} weight="bold" /> Invitar operadora
        </Button>
      </div>

      {rules.length === 0 ? (
        <p className="field-hint" style={{ marginBottom: "var(--space-3)" }}>
          Creá al menos una regla de comisión en Comisiones antes de invitar — toda operadora necesita una asignada.
        </p>
      ) : null}

      {error ? <p className="error-banner">{error}</p> : null}

      {members.length === 0 ? (
        <EmptyState
          icon={<Users size={24} weight="regular" />}
          title="Todavía no hay equipo"
          description="Invitá a tu primera operadora para que pueda entrar y cargar turnos."
        />
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Email</th>
              <th>Rol</th>
              <th>Sucursal</th>
              <th>Puede cobrar en caja</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.user_id}>
                <td>{m.name}</td>
                <td>{m.email ?? "—"}</td>
                <td><Badge tone={ROLE_TONE[m.role] ?? "neutral"}>{ROLE_LABEL[m.role] ?? m.role}</Badge></td>
                <td>{m.branch_name ?? "Todas"}</td>
                <td>
                  {/* Deshabilitado para dueña y encargada: cobran por su rol,
                      no por este flag — dejarlo activo sugeriría que se les
                      puede sacar acá, y no es así. Pensado para el caso de
                      operadoras que rotan quién abre/cierra caja. */}
                  <label style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <input
                      type="checkbox"
                      aria-label={`Permitir que ${m.name} cobre en caja`}
                      checked={m.can_operate_cash}
                      disabled={m.cashPermissionLocked || saving === m.user_id}
                      onChange={(e) => toggleCash(m, e.target.checked)}
                    />
                    {m.cashPermissionLocked ? "Por su rol" : saving === m.user_id ? "Guardando..." : null}
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {inviting ? (
        <InviteOperatorSheet
          open
          onClose={() => setInviting(false)}
          tenantId={tenantId}
          branches={branches}
          rules={rules}
        />
      ) : null}
    </Card>
  )
}
