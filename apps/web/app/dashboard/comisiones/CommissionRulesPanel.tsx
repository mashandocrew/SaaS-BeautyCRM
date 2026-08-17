"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Wallet } from "@phosphor-icons/react"
import { Button, Card, EmptyState } from "@beautycrm/ui"
import { assignCommissionRule } from "@/lib/comisiones-actions"
import type { CommissionRule, TeamCommissionMember } from "@/lib/comisiones-types"
import { CommissionRuleSheet } from "./CommissionRuleSheet"

const ROLE_LABELS: Record<string, string> = {
  owner: "Dueña",
  supervisor: "Encargada",
  operator: "Operadora",
}

function formatPct(n: number): string {
  return `${n}%`
}

export function CommissionRulesPanel({
  tenantId,
  rules,
  team,
}: {
  tenantId: string
  rules: CommissionRule[]
  team: TeamCommissionMember[]
}) {
  const router = useRouter()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<CommissionRule | null>(null)
  const [assigning, setAssigning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleAssign(userId: string, ruleId: string) {
    setError(null)
    setAssigning(userId)
    const result = await assignCommissionRule(userId, ruleId || null)
    setAssigning(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  return (
    <div>
      <Card style={{ marginBottom: "var(--space-4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>Reglas de comisión</h2>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={16} weight="bold" /> Nueva regla
          </Button>
        </div>

        {rules.length === 0 ? (
          <EmptyState
            icon={<Wallet size={32} />}
            title="Todavía no hay reglas de comisión"
            description="Crear la primera → asignarla al equipo → liquidar el mes."
          />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Salario base</th>
                <th>% servicio</th>
                <th>% producto</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.base_salary}</td>
                  <td>{formatPct(r.service_pct)}</td>
                  <td>{formatPct(r.product_sale_pct)}</td>
                  <td>
                    <Button variant="secondary" onClick={() => setEditing(r)}>
                      Editar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <h2>Quién tiene qué regla</h2>
        {error ? <p className="error-banner">{error}</p> : null}
        <table>
          <thead>
            <tr>
              <th>Persona</th>
              <th>Rol</th>
              <th>Regla</th>
            </tr>
          </thead>
          <tbody>
            {team.map((m) => (
              <tr key={m.user_id}>
                <td>{m.name}</td>
                <td>{ROLE_LABELS[m.role] ?? m.role}</td>
                <td>
                  <select
                    aria-label={`Regla de comisión de ${m.name}`}
                    value={m.commission_rule_id ?? ""}
                    disabled={assigning === m.user_id}
                    onChange={(e) => handleAssign(m.user_id, e.target.value)}
                  >
                    <option value="">Sin regla</option>
                    {rules.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <CommissionRuleSheet open={createOpen} onClose={() => setCreateOpen(false)} tenantId={tenantId} mode="create" />
      {editing ? (
        <CommissionRuleSheet
          key={editing.id}
          open
          onClose={() => setEditing(null)}
          tenantId={tenantId}
          mode="edit"
          rule={editing}
        />
      ) : null}
    </div>
  )
}
