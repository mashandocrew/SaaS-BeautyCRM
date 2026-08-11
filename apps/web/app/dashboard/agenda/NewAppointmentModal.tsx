"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Button, Field, Input, Sheet } from "@beautycrm/ui"
import type { AgendaAppointment, AgendaOperator, AgendaService } from "@/lib/agenda-types"
import { bookAppointment, createQuickClient, searchClients, type ClientSearchResult } from "@/lib/agenda-actions"
import { rangesOverlap } from "@/lib/agenda-time"

export function NewAppointmentModal({
  open,
  onClose,
  tenantId,
  branchId,
  services,
  operators,
  initialOperatorId,
  initialStartISO,
  dayAppointments,
}: {
  open: boolean
  onClose: () => void
  tenantId: string
  branchId: string
  services: AgendaService[]
  operators: AgendaOperator[]
  initialOperatorId: string
  initialStartISO: string
  dayAppointments: AgendaAppointment[]
}) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<ClientSearchResult[]>([])
  const [selectedClient, setSelectedClient] = useState<ClientSearchResult | null>(null)
  const [showQuickCreate, setShowQuickCreate] = useState(false)
  const [quickName, setQuickName] = useState("")
  const [quickPhone, setQuickPhone] = useState("")
  const [serviceIds, setServiceIds] = useState<string[]>([])
  const [operatorId, setOperatorId] = useState(initialOperatorId)
  const [startISO, setStartISO] = useState(initialStartISO)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setOperatorId(initialOperatorId)
    setStartISO(initialStartISO)
    setQuery("")
    setResults([])
    setSelectedClient(null)
    setShowQuickCreate(false)
    setQuickName("")
    setQuickPhone("")
    setServiceIds([])
    setError(null)
  }, [open, initialOperatorId, initialStartISO])

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([])
      return
    }
    const timer = setTimeout(async () => {
      const found = await searchClients(tenantId, query)
      setResults(found)
    }, 300)
    return () => clearTimeout(timer)
  }, [query, tenantId])

  const selectedServices = useMemo(
    () => services.filter((s) => serviceIds.includes(s.id)),
    [services, serviceIds]
  )
  const durationMinutes = selectedServices.reduce((sum, s) => sum + s.duration_minutes, 0)
  const totalPreview = selectedServices.reduce((sum, s) => sum + s.price, 0)
  const endISO = useMemo(() => {
    if (!startISO || durationMinutes === 0) return startISO
    return new Date(new Date(startISO).getTime() + durationMinutes * 60_000).toISOString()
  }, [startISO, durationMinutes])

  const overlapWarning = useMemo(() => {
    if (!operatorId || durationMinutes === 0) return false
    return dayAppointments.some(
      (a) =>
        a.operator_id === operatorId &&
        a.status !== "cancelled" &&
        a.status !== "no_show" &&
        rangesOverlap(startISO, endISO, a.starts_at, a.ends_at)
    )
  }, [dayAppointments, operatorId, startISO, endISO, durationMinutes])

  function toggleService(id: string) {
    setServiceIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]))
  }

  async function handleQuickCreate() {
    if (!quickName.trim() || !quickPhone.trim()) return
    setLoading(true)
    setError(null)
    const result = await createQuickClient(tenantId, { fullName: quickName, phone: quickPhone })
    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSelectedClient(result.data)
    setShowQuickCreate(false)
    setQuery("")
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (serviceIds.length === 0) {
      setError("Elegí al menos un servicio.")
      return
    }
    if (overlapWarning) {
      setError("Esa persona ya tiene un turno en ese horario.")
      return
    }

    setLoading(true)
    const result = await bookAppointment({
      branchId,
      clientId: selectedClient?.id ?? null,
      operatorId: operatorId || null,
      startsAt: startISO,
      serviceIds,
    })
    setLoading(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    onClose()
    router.refresh()
  }

  return (
    <Sheet open={open} onClose={onClose} title="Nuevo turno" side="right">
      <form onSubmit={handleSubmit}>
        {error ? <p className="error-banner">{error}</p> : null}

        <Field label="Cliente" htmlFor="agenda-client-search">
          {selectedClient ? (
            <div className="agenda-selected-client">
              <span>
                {selectedClient.full_name}
                {selectedClient.phone ? ` · ${selectedClient.phone}` : ""}
              </span>
              <button type="button" onClick={() => setSelectedClient(null)}>
                Cambiar
              </button>
            </div>
          ) : (
            <>
              <Input
                id="agenda-client-search"
                placeholder="Buscar por nombre o teléfono..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {results.length > 0 ? (
                <ul className="agenda-client-results">
                  {results.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedClient(c)
                          setResults([])
                        }}
                      >
                        {c.full_name}
                        {c.phone ? ` · ${c.phone}` : ""}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {query.trim().length >= 2 && results.length === 0 ? (
                <button
                  type="button"
                  className="agenda-quick-create-toggle"
                  onClick={() => {
                    setShowQuickCreate(true)
                    setQuickName(query)
                  }}
                >
                  + Crear cliente nuevo
                </button>
              ) : null}
              {showQuickCreate ? (
                <div className="agenda-quick-create">
                  <Field label="Nombre" htmlFor="quick-name">
                    <Input
                      id="quick-name"
                      value={quickName}
                      onChange={(e) => setQuickName(e.target.value)}
                      required
                    />
                  </Field>
                  <Field label="Teléfono" htmlFor="quick-phone">
                    <Input
                      id="quick-phone"
                      value={quickPhone}
                      onChange={(e) => setQuickPhone(e.target.value)}
                      required
                    />
                  </Field>
                  <Button type="button" variant="secondary" disabled={loading} onClick={handleQuickCreate}>
                    Crear y usar este cliente
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </Field>

        <Field label="Servicios" htmlFor="agenda-services">
          <div id="agenda-services" className="agenda-service-list">
            {services.map((s) => (
              <label key={s.id} className="agenda-service-option">
                <input type="checkbox" checked={serviceIds.includes(s.id)} onChange={() => toggleService(s.id)} />
                <span>
                  {s.name} · {s.duration_minutes} min · ${s.price}
                </span>
              </label>
            ))}
          </div>
        </Field>

        <Field label="Operadora" htmlFor="agenda-operator">
          <select
            id="agenda-operator"
            className="input"
            value={operatorId}
            onChange={(e) => setOperatorId(e.target.value)}
            required
          >
            <option value="">Elegir operadora</option>
            {operators.map((op) => (
              <option key={op.id} value={op.id}>
                {op.full_name ?? "Sin nombre"}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Hora" htmlFor="agenda-start">
          <Input
            id="agenda-start"
            type="datetime-local"
            value={toDatetimeLocal(startISO)}
            onChange={(e) => setStartISO(new Date(e.target.value).toISOString())}
            required
          />
        </Field>

        {durationMinutes > 0 ? (
          <p className="agenda-preview">
            Termina a las {toDatetimeLocal(endISO).slice(11)} · Total ${totalPreview}
          </p>
        ) : null}

        {overlapWarning ? <p className="field-error">Esa persona ya tiene un turno en ese horario.</p> : null}

        <Button type="submit" disabled={loading || overlapWarning} style={{ width: "100%" }}>
          {loading ? "Guardando..." : "Crear turno"}
        </Button>
      </form>
    </Sheet>
  )
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
