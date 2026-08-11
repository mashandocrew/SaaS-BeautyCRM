"use client"

import { useEffect, type ReactNode } from "react"
import { X } from "@phosphor-icons/react"

export function Sheet({
  open,
  onClose,
  title,
  side = "right",
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  side?: "right" | "bottom"
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleKey)
    return () => document.removeEventListener("keydown", handleKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div
        className={`sheet-panel sheet-panel-${side}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-header">
          <h2>{title}</h2>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="Cerrar">
            <X size={20} weight="bold" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}
