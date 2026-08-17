"use client"

import { Button } from "@beautycrm/ui"
import type { SalesExportRow } from "@/lib/reportes-types"

function toCsv(rows: SalesExportRow[]): string {
  const header = ["Fecha", "Ítem", "Tipo", "Cantidad", "Precio unitario", "Operador", "Medios de pago"]
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`

  const lines = rows.map((r) =>
    [
      escape(r.date),
      escape(r.item_name),
      escape(r.item_type === "service" ? "Servicio" : "Producto"),
      String(r.quantity),
      String(r.unit_price),
      escape(r.operator_name ?? ""),
      escape(r.payment_methods),
    ].join(","),
  )

  return [header.map(escape).join(","), ...lines].join("\n")
}

export function ExportCsvButton({ rows, from, to }: { rows: SalesExportRow[]; from: string; to: string }) {
  function handleExport() {
    const csv = toCsv(rows)
    // Se antepone ﻿: sin el BOM, Excel en Windows interpreta el CSV
    // como Latin-1 y descompone los acentos ("Peluquería" → "PeluquerÃ­a").
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `ventas_${from}_a_${to}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Button variant="secondary" onClick={handleExport} disabled={rows.length === 0}>
      Exportar CSV
    </Button>
  )
}
