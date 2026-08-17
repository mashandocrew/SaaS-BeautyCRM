"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Buildings } from "@phosphor-icons/react"
import { Badge, Button, Card, EmptyState } from "@beautycrm/ui"
import { toggleBranchActive } from "@/lib/sucursales-actions"
import type { Branch } from "@/lib/sucursales-types"
import { BranchFormSheet } from "./BranchFormSheet"

export function BranchList({
  tenantId,
  branches,
  canDelete,
}: {
  tenantId: string
  branches: Branch[]
  /** branches_delete es owner-only; acá se usa para decidir si se puede desactivar. */
  canDelete: boolean
}) {
  const router = useRouter()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<Branch | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleToggle(branch: Branch, nextActive: boolean) {
    setError(null)
    setPendingId(branch.id)
    const result = await toggleBranchActive(tenantId, branch.id, nextActive)
    setPendingId(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  return (
    <Card style={{ marginBottom: "var(--space-4)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Sucursales</h2>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={16} weight="bold" /> Nueva sucursal
        </Button>
      </div>

      {error ? <p className="error-banner">{error}</p> : null}

      {branches.length === 0 ? (
        <EmptyState icon={<Buildings size={32} />} title="Todavía no hay sucursales" description="Crear la primera." />
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Dirección</th>
              <th>Teléfono</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {branches.map((b) => (
              <tr key={b.id}>
                <td>{b.name}</td>
                <td>{b.address ?? "—"}</td>
                <td>{b.phone ?? "—"}</td>
                <td>
                  <Badge tone={b.is_active ? "success" : "neutral"}>{b.is_active ? "Activa" : "Inactiva"}</Badge>
                </td>
                <td style={{ display: "flex", gap: "var(--space-2)" }}>
                  <Button variant="secondary" onClick={() => setEditing(b)}>
                    Editar
                  </Button>
                  {canDelete ? (
                    <Button
                      variant={b.is_active ? "danger" : "secondary"}
                      disabled={pendingId === b.id}
                      onClick={() => handleToggle(b, !b.is_active)}
                    >
                      {pendingId === b.id ? "Guardando..." : b.is_active ? "Desactivar" : "Activar"}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <BranchFormSheet open={createOpen} onClose={() => setCreateOpen(false)} tenantId={tenantId} mode="create" />
      {editing ? (
        <BranchFormSheet key={editing.id} open onClose={() => setEditing(null)} tenantId={tenantId} mode="edit" branch={editing} />
      ) : null}
    </Card>
  )
}
