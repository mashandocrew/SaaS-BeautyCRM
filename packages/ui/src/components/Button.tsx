import type { ButtonHTMLAttributes } from "react"

type Variant = "primary" | "secondary" | "danger"

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`btn btn-${variant} ${className}`.trim()}
      {...props}
    />
  )
}
