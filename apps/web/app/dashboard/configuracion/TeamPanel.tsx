"use client"

import { useState } from "react"
import { Plus, Users } from "@phosphor-icons/react"
import { Badge, Button, Card, EmptyState } from "@beautycrm/ui"
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
  const [inviting, setInviting] = useState(false)

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
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.user_id}>
                <td>{m.name}</td>
                <td>{m.email ?? "—"}</td>
                <td><Badge tone={ROLE_TONE[m.role] ?? "neutral"}>{ROLE_LABEL[m.role] ?? m.role}</Badge></td>
                <td>{m.branch_name ?? "Todas"}</td>
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
