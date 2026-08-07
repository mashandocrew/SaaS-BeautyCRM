import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode } from "react"

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input ${className}`.trim()} {...props} />
}

export function Label({ className = "", ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={`label ${className}`.trim()} {...props} />
}

export function Field({
  label,
  htmlFor,
  children,
  hint,
}: {
  label: string
  htmlFor: string
  children: ReactNode
  hint?: string
}) {
  return (
    <div className="field">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  )
}
