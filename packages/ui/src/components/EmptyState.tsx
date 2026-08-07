import type { ReactNode } from "react"

/**
 * Estado vacío que siempre dice qué hacer (Bloque A.4, "Red de seguridad
 * Low-Touch"): toda pantalla debe responder sola "¿y ahora qué hago?".
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <p className="empty-state-title">{title}</p>
      <p className="empty-state-description">{description}</p>
      {action}
    </div>
  )
}
