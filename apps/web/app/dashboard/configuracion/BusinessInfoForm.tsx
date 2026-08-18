"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Button, Card, Field, Input } from "@beautycrm/ui"
import { updateBusinessInfo } from "@/lib/configuracion-actions"

const CURRENCIES = [
  { value: "ARS", label: "Peso argentino (ARS)" },
  { value: "USD", label: "Dólar estadounidense (USD)" },
]

const TIMEZONES = [
  { value: "America/Argentina/Buenos_Aires", label: "Buenos Aires" },
  { value: "America/Argentina/Cordoba", label: "Córdoba" },
  { value: "America/Argentina/Mendoza", label: "Mendoza" },
]

export function BusinessInfoForm({
  tenantId,
  businessName,
  currency,
  timezone,
}: {
  tenantId: string
  businessName: string
  currency: string
  timezone: string
}) {
  const router = useRouter()
  const [name, setName] = useState(businessName)
  const [currencyValue, setCurrencyValue] = useState(currency)
  const [timezoneValue, setTimezoneValue] = useState(timezone)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(false)

    if (!name.trim()) {
      setError("El nombre es obligatorio.")
      return
    }

    setLoading(true)
    const result = await updateBusinessInfo(tenantId, { businessName: name, currency: currencyValue, timezone: timezoneValue })
    setLoading(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    setSaved(true)
    router.refresh()
  }

  return (
    <Card style={{ marginBottom: "var(--space-4)" }}>
      <h2>Datos del negocio</h2>
      <form onSubmit={handleSubmit} noValidate>
        {error ? <p className="error-banner">{error}</p> : null}
        {saved ? <p style={{ color: "var(--color-success)" }}>Guardado.</p> : null}

        <Field label="Nombre del salón" htmlFor="business-name">
          <Input id="business-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>

        <Field label="Moneda" htmlFor="business-currency">
          <select id="business-currency" value={currencyValue} onChange={(e) => setCurrencyValue(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Zona horaria" htmlFor="business-timezone">
          <select id="business-timezone" value={timezoneValue} onChange={(e) => setTimezoneValue(e.target.value)}>
            {TIMEZONES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>

        <Button type="submit" disabled={loading}>
          {loading ? "Guardando..." : "Guardar cambios"}
        </Button>
      </form>
    </Card>
  )
}
