import type { HTMLAttributes, ReactNode } from "react"

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`card ${className}`.trim()} {...props} />
}

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string
  value: ReactNode
  hint?: string
}) {
  return (
    <Card className="stat-tile">
      <p className="stat-tile-label">{label}</p>
      <p className="stat-tile-value">{value}</p>
      {hint ? <p className="stat-tile-hint">{hint}</p> : null}
    </Card>
  )
}
