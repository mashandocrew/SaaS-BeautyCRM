import type { HTMLAttributes } from "react"

type Tone = "neutral" | "success" | "warning" | "danger"

export function Badge({
  tone = "neutral",
  className = "",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={`badge badge-${tone} ${className}`.trim()} {...props} />
}
