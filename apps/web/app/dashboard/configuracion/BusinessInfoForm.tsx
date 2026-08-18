"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Button, Card, Field, Input } from "@beautycrm/ui"
import { updateBusinessInfo } from "@/lib/configuracion-actions"

const CURRENCIES = [
  { value: "ARS", label: "Peso argentino (ARS)" },
  { value: "USD", label: "Dólar estadounidense (USD)" },
]

/**
 * Agrupadas por país y no por provincia: las tres provincias argentinas que
 * había antes (Buenos Aires, Córdoba, Mendoza) comparten el mismo horario
 * real (GMT-3, sin horario de verano desde 2009) — dividir por provincia no
 * describía ninguna diferencia horaria real, sólo confundía. Un negocio con
 * varias sucursales en el mismo país comparte esta única zona horaria.
 */
const TIMEZONE_GROUPS: { country: string; zones: { value: string; label: string }[] }[] = [
  { country: "Argentina", zones: [{ value: "America/Argentina/Buenos_Aires", label: "Argentina (GMT-3)" }] },
  { country: "Chile", zones: [{ value: "America/Santiago", label: "Chile (GMT-4/-3)" }] },
  { country: "Uruguay", zones: [{ value: "America/Montevideo", label: "Uruguay (GMT-3)" }] },
  { country: "Paraguay", zones: [{ value: "America/Asuncion", label: "Paraguay (GMT-4/-3)" }] },
  { country: "Brasil", zones: [{ value: "America/Sao_Paulo", label: "Brasil — São Paulo (GMT-3)" }] },
  { country: "Bolivia", zones: [{ value: "America/La_Paz", label: "Bolivia (GMT-4)" }] },
  { country: "Perú", zones: [{ value: "America/Lima", label: "Perú (GMT-5)" }] },
  { country: "Colombia", zones: [{ value: "America/Bogota", label: "Colombia (GMT-5)" }] },
  { country: "Ecuador", zones: [{ value: "America/Guayaquil", label: "Ecuador (GMT-5)" }] },
  { country: "México", zones: [{ value: "America/Mexico_City", label: "México — Ciudad de México (GMT-6)" }] },
  { country: "España", zones: [{ value: "Europe/Madrid", label: "España — Madrid (GMT+1/+2)" }] },
  {
    country: "Estados Unidos",
    zones: [
      { value: "America/New_York", label: "Estados Unidos — Este (Nueva York)" },
      { value: "America/Chicago", label: "Estados Unidos — Central (Chicago)" },
      { value: "America/Denver", label: "Estados Unidos — Montaña (Denver)" },
      { value: "America/Los_Angeles", label: "Estados Unidos — Pacífico (Los Ángeles)" },
    ],
  },
]

// Los tenants que ya tenían Córdoba o Mendoza guardado (la versión anterior
// del selector) no tienen que ver un <select> vacío: las tres comparten
// offset real, así que se normalizan a la opción de Argentina en cuanto se
// abre el form. Si la dueña ni toca el campo y guarda, el valor pasa a ser
// el mismo para las tres — sin sorpresas, porque siguen siendo la misma
// hora.
const LEGACY_TIMEZONE_ALIASES: Record<string, string> = {
  "America/Argentina/Cordoba": "America/Argentina/Buenos_Aires",
  "America/Argentina/Mendoza": "America/Argentina/Buenos_Aires",
}

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
  const [timezoneValue, setTimezoneValue] = useState(LEGACY_TIMEZONE_ALIASES[timezone] ?? timezone)
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
            {TIMEZONE_GROUPS.map((group) => (
              <optgroup key={group.country} label={group.country}>
                {group.zones.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
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
