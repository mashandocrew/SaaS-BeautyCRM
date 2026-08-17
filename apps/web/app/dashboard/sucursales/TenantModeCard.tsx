"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button, Card } from "@beautycrm/ui"
import { setTenantMode } from "@/lib/sucursales-actions"

export function TenantModeCard({ tenantId, mode }: { tenantId: string; mode: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleActivate() {
    if (
      !window.confirm(
        "¿Pasar el salón a multi-sede? Va a aparecer el selector de sucursal en Agenda, Inventario, Caja y Reportes. No se puede deshacer desde acá.",
      )
    )
      return

    setError(null)
    setLoading(true)
    const result = await setTenantMode(tenantId)
    setLoading(false)

    if (!result.ok) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  return (
    <Card>
      <h2>Modo del salón</h2>
      {error ? <p className="error-banner">{error}</p> : null}
      <p>
        Modo actual: <strong>{mode === "multi" ? "Multi-sede" : "Mono-sede"}</strong>
      </p>
      {mode === "multi" ? (
        <p style={{ color: "var(--color-ink-soft)" }}>
          El selector de sucursal ya está activo en el resto de la app.
        </p>
      ) : (
        <>
          <p style={{ color: "var(--color-ink-soft)" }}>
            Con una sola sucursal no hace falta elegir dónde. Si abrís una segunda, pasá el salón a
            multi-sede para que Agenda, Inventario, Caja y Reportes empiecen a pedir cuál.
          </p>
          <Button onClick={handleActivate} disabled={loading}>
            {loading ? "Guardando..." : "Pasar a multi-sede"}
          </Button>
        </>
      )}
    </Card>
  )
}
