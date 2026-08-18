"use client"

import { Button } from "@beautycrm/ui"

/**
 * Sin librería nueva: window.print() + el CSS de impresión en globals.css
 * (que esconde sidebar, topbar y filtros, y muestra el encabezado
 * .print-only con el rango de fechas). El diálogo del navegador ya ofrece
 * "Guardar como PDF" como destino, así que no hace falta generar el PDF a
 * mano.
 */
export function ExportPdfButton() {
  return (
    <Button variant="secondary" onClick={() => window.print()}>
      Exportar PDF
    </Button>
  )
}
