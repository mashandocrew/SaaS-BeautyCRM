"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button, Card } from "@beautycrm/ui"
import { MiniCalendarField } from "@/components/MiniCalendar"

export function ReportesFilters({
  from,
  to,
  branchId,
  branches,
}: {
  from: string
  to: string
  branchId: string | null
  /** null cuando el rol no puede elegir sucursal (encargada, o tenant mono-sede). */
  branches: { id: string; name: string }[] | null
}) {
  const router = useRouter()
  const [fromValue, setFromValue] = useState(from)
  const [toValue, setToValue] = useState(to)
  const [branchValue, setBranchValue] = useState(branchId ?? "")

  function apply() {
    const params = new URLSearchParams()
    params.set("desde", fromValue)
    params.set("hasta", toValue)
    if (branchValue) params.set("sucursal", branchValue)
    router.push(`/dashboard/reportes?${params.toString()}`)
  }

  return (
    <Card style={{ marginBottom: "var(--space-4)" }}>
      <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-end", flexWrap: "wrap" }}>
        <MiniCalendarField label="Desde" value={fromValue} onChange={setFromValue} />
        <MiniCalendarField label="Hasta" value={toValue} onChange={setToValue} />
        {branches ? (
          <div>
            <label htmlFor="reportes-branch">Sucursal</label>
            <br />
            <select id="reportes-branch" value={branchValue} onChange={(e) => setBranchValue(e.target.value)}>
              <option value="">Todas</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <Button onClick={apply}>Aplicar</Button>
      </div>
    </Card>
  )
}
