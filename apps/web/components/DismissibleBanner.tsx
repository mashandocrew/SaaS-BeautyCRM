"use client"

import { useState, type ReactNode } from "react"
import { X } from "@phosphor-icons/react"
import { dismissBanner, type BannerKey } from "@/lib/banner-actions"

/**
 * Envuelve un cartel (promoción, tip, tutorial) con una X que lo cierra para
 * siempre: la clave queda guardada en public.users.dismissed_banners, así
 * que no vuelve a aparecer ni al recargar ni en el próximo login, en
 * cualquier dispositivo. El padre (server component) decide si renderizar
 * este wrapper mirando si la clave ya está en dismissed_banners — acá sólo
 * se maneja el cierre optimista y el guardado.
 */
export function DismissibleBanner({ bannerKey, children }: { bannerKey: BannerKey; children: ReactNode }) {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  function handleDismiss() {
    setDismissed(true)
    // Fire-and-forget: el cartel ya se ocultó en esta sesión, y si la
    // escritura fallara (sesión caída, red), a lo sumo vuelve a aparecer en
    // el próximo login — no hace falta bloquear la UI ni mostrar un error
    // por esto.
    void dismissBanner(bannerKey)
  }

  return (
    <div style={{ position: "relative" }}>
      {children}
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Cerrar cartel"
        style={{
          position: "absolute",
          top: "var(--space-2)",
          right: "var(--space-2)",
          background: "transparent",
          border: 0,
          cursor: "pointer",
          display: "flex",
          color: "inherit",
          opacity: 0.7,
        }}
      >
        <X size={16} weight="bold" />
      </button>
    </div>
  )
}
