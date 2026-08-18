import Link from "next/link"
import { CalendarBlank } from "@phosphor-icons/react/dist/ssr"
import { EmptyState } from "@beautycrm/ui"

/**
 * Pantalla que reemplaza al módulo entero cuando la dueña todavía no eligió
 * sucursal en multi-sede (su membership trae branch_id null a propósito —
 * no está atada a ninguna). Antes de esto, algunos módulos mostraban un
 * cartel de "elegí una sucursal" sin ninguna forma real de elegirla.
 */
export function BranchPickerEmptyState({
  title,
  basePath,
  paramName = "sucursal",
  branches,
}: {
  title: string
  basePath: string
  paramName?: string
  branches: { id: string; name: string }[]
}) {
  return (
    <div>
      <h1>{title}</h1>
      <div className="card">
        {branches.length > 0 ? (
          <>
            <h2 style={{ marginBottom: "var(--space-3)" }}>Elegí una sucursal</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
              {branches.map((b) => (
                <Link key={b.id} href={`${basePath}?${paramName}=${b.id}`} className="btn btn-secondary">
                  {b.name}
                </Link>
              ))}
            </div>
          </>
        ) : (
          <EmptyState
            icon={<CalendarBlank size={24} weight="regular" />}
            title="Todavía no hay sucursales"
            description="Creá una sucursal en Sucursales para poder usar este módulo."
          />
        )}
      </div>
    </div>
  )
}
