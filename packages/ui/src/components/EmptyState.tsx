import type { ReactNode } from "react"

/**
 * Estado vacío que siempre dice qué hacer (Bloque A.4, "Red de seguridad
 * Low-Touch"): toda pantalla debe responder sola "¿y ahora qué hago?".
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      {icon ? <div className="empty-state-icon">{icon}</div> : null}
      <p className="empty-state-title">{title}</p>
      <p className="empty-state-description">{description}</p>
      {action}
    </div>
  )
}
