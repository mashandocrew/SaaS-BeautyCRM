"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@beautycrm/ui"
import { updateHistoryNotes } from "@/lib/client-actions"
import type { ClientHistoryEntry } from "@/lib/client-types"

// performed_at es timestamptz (trae zona real), pero toLocaleDateString sin
// timeZone explícito igual queda a merced de la zona del entorno donde
// corre (server vs browser) — mismo riesgo de mismatch de hidratación que
// client.birthday en ClientDetailView.tsx. Fijamos "America/Argentina/
// Mendoza" (mismo TZ que next.config.js pinea para todo el proceso), no
// "UTC": un turno que termina entre las 21:00 y las 23:59 locales cae en
// el día siguiente en UTC, lo que mostraría la fecha equivocada.
function formatVisitDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Mendoza" })
}

export function ClientHistoryTable({ history }: { history: ClientHistoryEntry[] }) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function startEdit(entry: ClientHistoryEntry) {
    setEditingId(entry.id)
    setDraft(entry.technical_notes ?? "")
    setError(null)
  }

  async function save(entryId: string) {
    setSavingId(entryId)
    setError(null)
    const result = await updateHistoryNotes(entryId, draft)
    setSavingId(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setEditingId(null)
    router.refresh()
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Servicio</th>
          <th>Operadora</th>
          <th>Nota técnica</th>
        </tr>
      </thead>
      <tbody>
        {history.map((entry) => (
          <tr key={entry.id}>
            <td>{formatVisitDate(entry.performed_at)}</td>
            {/* service_name puede ser null: apps/web/app/o/cliente/actions.ts
                inserta notas de la operadora sin servicio asociado (ver
                spec, sección "Dato real: addTechnicalNote existente"). */}
            <td>{entry.service_name ?? "Nota"}</td>
            <td>{entry.operator_name ?? "—"}</td>
            <td>
              {editingId === entry.id ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                  <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-start" }}>
                    <textarea className="input" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} />
                    <Button type="button" onClick={() => save(entry.id)} disabled={savingId === entry.id}>
                      {savingId === entry.id ? "Guardando..." : "Guardar"}
                    </Button>
                  </div>
                  {error ? <p className="error-banner">{error}</p> : null}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => startEdit(entry)}
                  aria-label={
                    entry.technical_notes
                      ? undefined
                      : `Agregar nota — ${formatVisitDate(entry.performed_at)}, ${entry.service_name ?? "Nota"}`
                  }
                  style={{
                    background: "none",
                    border: "none",
                    textAlign: "left",
                    cursor: "pointer",
                    padding: 0,
                    font: "var(--text-small)",
                  }}
                >
                  {entry.technical_notes ?? <span style={{ color: "var(--color-ink-soft)" }}>Agregar nota</span>}
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
