"use client"

import { useEffect, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle, Scissors, CalendarBlank } from "@phosphor-icons/react"
import { Button, Field, Input, EmptyState } from "@beautycrm/ui"
import {
  provisionTenant,
  updateTenantSettings,
  saveServices,
  inviteOperator,
  createFirstAppointment,
} from "./actions"
import { RUBROS, SERVICE_TEMPLATES, type Rubro, type ServiceTemplate } from "./templates"
import { createClient } from "@beautycrm/supabase/client"

const TOTAL_STEPS = 5
const STORAGE_KEY = "beautycrm_onboarding_state"

type TenantCtx = { tenantId: string; branchId: string }

export function OnboardingWizard() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [ctx, setCtx] = useState<TenantCtx | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)

  // Restaura el progreso guardado (si lo hay) una vez montado en el cliente.
  // Se hace en un efecto -no en el initializer de useState- para no romper
  // la hidratación: el render del servidor siempre arranca en el Paso 0.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw) as { step: number; ctx: TenantCtx | null }
        if (saved.ctx && typeof saved.step === "number" && saved.step > 0) {
          setCtx(saved.ctx)
          setStep(saved.step)
        }
      }
    } catch {
      // localStorage no disponible o el JSON quedó corrupto: arrancamos
      // desde el Paso 0 sin romper el wizard.
    } finally {
      setHydrated(true)
    }
  }, [])

  // Persiste el progreso en cada cambio de paso, ya con la hidratación
  // resuelta (para no pisar lo guardado con el estado inicial en blanco).
  useEffect(() => {
    if (!hydrated) return
    try {
      if (ctx) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ step, ctx }))
      } else {
        window.localStorage.removeItem(STORAGE_KEY)
      }
    } catch {
      // Si el storage está lleno o bloqueado, seguimos igual: es una
      // mejora de UX, no una dependencia funcional del wizard.
    }
  }, [step, ctx, hydrated])

  function finishOnboarding() {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // no-op
    }
    router.push("/dashboard")
    router.refresh()
  }

  return (
    <div className="container" style={{ maxWidth: 560 }}>
      <div className="progress-steps">
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <span key={i} data-done={i <= step} />
        ))}
      </div>
      <p style={{ color: "var(--color-ink-soft)", fontSize: 13, marginTop: -12 }}>
        Paso {step + 1} de {TOTAL_STEPS}
      </p>

      {error ? <p className="error-banner">{error}</p> : null}

      {step === 0 && (
        <StepBusinessName
          onDone={(next) => {
            setCtx(next)
            setError(null)
            setStep(1)
          }}
          onError={setError}
        />
      )}
      {step === 1 && ctx && (
        <StepIdentity
          ctx={ctx}
          onDone={() => {
            setError(null)
            setStep(2)
          }}
          onError={setError}
        />
      )}
      {step === 2 && ctx && (
        <StepServices
          ctx={ctx}
          onDone={() => {
            setError(null)
            setStep(3)
          }}
          onError={setError}
        />
      )}
      {step === 3 && ctx && (
        <StepTeam
          ctx={ctx}
          onDone={() => {
            setError(null)
            setStep(4)
          }}
          onError={setError}
        />
      )}
      {step === 4 && ctx && (
        <StepFirstAppointment
          ctx={ctx}
          onDone={finishOnboarding}
          onError={setError}
        />
      )}
    </div>
  )
}

function StepBusinessName({
  onDone,
  onError,
}: {
  onDone: (ctx: TenantCtx) => void
  onError: (msg: string) => void
}) {
  const [businessName, setBusinessName] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    const result = await provisionTenant(businessName)
    setLoading(false)

    if (!result.ok) {
      onError(result.error)
      return
    }
    onDone({ tenantId: result.data.tenantId, branchId: result.data.branchId })
  }

  return (
    <div className="card">
      <h1>¿Cómo se llama tu negocio?</h1>
      <p style={{ color: "var(--color-ink-soft)" }}>
        Precio promocional $40/mes durante 90 días, después $100/mes.
      </p>
      <form onSubmit={handleSubmit}>
        <Field label="Nombre del negocio" htmlFor="businessName">
          <Input
            id="businessName"
            required
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="Nombre del negocio o sucursal"
          />
        </Field>
        <Button type="submit" disabled={loading} style={{ width: "100%" }}>
          {loading ? "Creando..." : "Crear mi negocio"}
        </Button>
      </form>
    </div>
  )
}

function StepIdentity({
  ctx,
  onDone,
  onError,
}: {
  ctx: TenantCtx
  onDone: () => void
  onError: (msg: string) => void
}) {
  const [timezone, setTimezone] = useState("America/Argentina/Mendoza")
  const [currency, setCurrency] = useState("ARS")
  const [hours, setHours] = useState("Lun a Sáb, 9 a 19hs")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    const result = await updateTenantSettings(ctx.tenantId, { timezone, currency, hours })
    setLoading(false)
    if (!result.ok) {
      onError(result.error)
      return
    }
    onDone()
  }

  return (
    <div className="card">
      <h1>Identidad del negocio</h1>
      <p style={{ color: "var(--color-ink-soft)" }}>Todo esto lo podés editar después.</p>
      <form onSubmit={handleSubmit}>
        <Field label="Horario de atención" htmlFor="hours">
          <Input id="hours" value={hours} onChange={(e) => setHours(e.target.value)} />
        </Field>
        <Field label="Zona horaria" htmlFor="timezone">
          <Input id="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </Field>
        <Field label="Moneda" htmlFor="currency">
          <Input id="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} />
        </Field>
        <div style={{ display: "flex", gap: 8 }}>
          <Button type="button" variant="secondary" onClick={onDone} disabled={loading}>
            Saltear
          </Button>
          <Button type="submit" disabled={loading} style={{ flex: 1 }}>
            {loading ? "Guardando..." : "Continuar"}
          </Button>
        </div>
      </form>
    </div>
  )
}

function StepServices({
  ctx,
  onDone,
  onError,
}: {
  ctx: TenantCtx
  onDone: () => void
  onError: (msg: string) => void
}) {
  const [rubro, setRubro] = useState<Rubro | null>(null)
  const [services, setServices] = useState<ServiceTemplate[]>([])
  const [loading, setLoading] = useState(false)

  function pickRubro(r: Rubro) {
    setRubro(r)
    setServices(SERVICE_TEMPLATES[r])
  }

  function updateService(i: number, patch: Partial<ServiceTemplate>) {
    setServices((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }

  function removeService(i: number) {
    setServices((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function handleContinue() {
    setLoading(true)
    const result = await saveServices(ctx.tenantId, services)
    setLoading(false)
    if (!result.ok) {
      onError(result.error)
      return
    }
    onDone()
  }

  if (!rubro) {
    return (
      <div className="card">
        <h1>¿A qué rubro te dedicás?</h1>
        <p style={{ color: "var(--color-ink-soft)" }}>
          Te sugerimos servicios típicos con precio de referencia — los editás vos.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {RUBROS.map((r) => (
            <Button key={r} variant="secondary" onClick={() => pickRubro(r)}>
              {r}
            </Button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <h1>Servicios de {rubro}</h1>
      <p style={{ color: "var(--color-ink-soft)" }}>Borrá lo que no ofrecés, ajustá precios.</p>
      <table>
        <thead>
          <tr>
            <th>Servicio</th>
            <th>Min</th>
            <th>Precio</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {services.map((s, i) => (
            <tr key={i}>
              <td>
                <Input
                  value={s.name}
                  onChange={(e) => updateService(i, { name: e.target.value })}
                />
              </td>
              <td>
                <Input
                  type="number"
                  value={s.duration_minutes}
                  style={{ width: 64 }}
                  onChange={(e) =>
                    updateService(i, { duration_minutes: Number(e.target.value) })
                  }
                />
              </td>
              <td>
                <Input
                  type="number"
                  value={s.price}
                  style={{ width: 90 }}
                  onChange={(e) => updateService(i, { price: Number(e.target.value) })}
                />
              </td>
              <td>
                <Button variant="danger" onClick={() => removeService(i)}>
                  ×
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {services.length === 0 ? (
        <EmptyState
          icon={<Scissors size={24} weight="regular" />}
          title="Sin servicios"
          description="Podés continuar igual y cargarlos después desde el dashboard."
        />
      ) : null}
      <Button onClick={handleContinue} disabled={loading} style={{ width: "100%", marginTop: 16 }}>
        {loading ? "Guardando..." : `Continuar con ${services.length} servicios`}
      </Button>
    </div>
  )
}

function StepTeam({
  ctx,
  onDone,
  onError,
}: {
  ctx: TenantCtx
  onDone: () => void
  onError: (msg: string) => void
}) {
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [channel, setChannel] = useState<"email" | "whatsapp">("email")
  const [commissionRuleId, setCommissionRuleId] = useState("")
  const [rules, setRules] = useState<{ id: string; name: string }[]>([])
  const [invited, setInvited] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from("commission_rules")
      .select("id, name")
      .eq("tenant_id", ctx.tenantId)
      .then(({ data }: { data: { id: string; name: string }[] | null }) => {
        if (data) {
          setRules(data)
          setCommissionRuleId(data[0]?.id ?? "")
        }
      })
  }, [ctx.tenantId])

  async function handleInvite(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    const result = await inviteOperator(ctx.tenantId, ctx.branchId, {
      fullName,
      email,
      commissionRuleId,
      channel,
      phone: channel === "whatsapp" ? phone : undefined,
    })
    setLoading(false)
    if (!result.ok) {
      onError(result.error)
      return
    }
    setInvited((prev) => [...prev, channel === "whatsapp" ? `${email} (WhatsApp)` : email])
    setFullName("")
    setEmail("")
    setPhone("")
  }

  return (
    <div className="card">
      <h1>¿Quién trabaja con vos?</h1>
      <p style={{ color: "var(--color-ink-soft)" }}>
        Le mandamos un link de acceso — sin contraseñas — por email o WhatsApp.
      </p>

      {invited.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {invited.map((e) => (
            <li
              key={e}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                color: "var(--color-success)",
                fontSize: 14,
              }}
            >
              <CheckCircle size={16} weight="fill" />
              Invitada: {e}
            </li>
          ))}
        </ul>
      ) : null}

      <form onSubmit={handleInvite}>
        <Field label="Nombre" htmlFor="opName">
          <Input id="opName" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="opEmail">
          <Input
            id="opEmail"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Cómo le avisamos" htmlFor="opChannel">
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              type="button"
              variant={channel === "email" ? "primary" : "secondary"}
              onClick={() => setChannel("email")}
              style={{ flex: 1 }}
            >
              Email
            </Button>
            <Button
              type="button"
              variant={channel === "whatsapp" ? "primary" : "secondary"}
              onClick={() => setChannel("whatsapp")}
              style={{ flex: 1 }}
            >
              WhatsApp
            </Button>
          </div>
        </Field>
        {channel === "whatsapp" && (
          <Field label="Teléfono (con código de país)" htmlFor="opPhone">
            <Input
              id="opPhone"
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+54 9 261 123-4567"
            />
          </Field>
        )}
        <Field label="Regla de comisión" htmlFor="opRule">
          <select
            id="opRule"
            className="input"
            value={commissionRuleId}
            onChange={(e) => setCommissionRuleId(e.target.value)}
          >
            {rules.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        <Button type="submit" variant="secondary" disabled={loading} style={{ width: "100%" }}>
          {loading ? "Invitando..." : "Invitar"}
        </Button>
      </form>

      <Button onClick={onDone} style={{ width: "100%", marginTop: 16 }}>
        Continuar
      </Button>
    </div>
  )
}

function StepFirstAppointment({
  ctx,
  onDone,
  onError,
}: {
  ctx: TenantCtx
  onDone: () => void
  onError: (msg: string) => void
}) {
  const [clientName, setClientName] = useState("")
  const [clientPhone, setClientPhone] = useState("")
  const [serviceId, setServiceId] = useState("")
  const [services, setServices] = useState<{ id: string; name: string; duration_minutes: number }[]>([])
  const [startsAt, setStartsAt] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from("services")
      .select("id, name, duration_minutes")
      .eq("tenant_id", ctx.tenantId)
      .then(
        ({
          data,
        }: {
          data: { id: string; name: string; duration_minutes: number }[] | null
        }) => {
          if (data) {
            setServices(data)
            setServiceId(data[0]?.id ?? "")
          }
        }
      )

    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(10, 0, 0, 0)
    setStartsAt(tomorrow.toISOString().slice(0, 16))
  }, [ctx.tenantId])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const service = services.find((s) => s.id === serviceId)
    if (!service) {
      onError("Elegí un servicio.")
      return
    }
    setLoading(true)
    const result = await createFirstAppointment(ctx.tenantId, ctx.branchId, {
      clientName,
      clientPhone,
      serviceId,
      startsAt,
      durationMinutes: service.duration_minutes,
    })
    setLoading(false)
    if (!result.ok) {
      onError(result.error)
      return
    }
    onDone()
  }

  if (services.length === 0) {
    return (
      <div className="card">
        <EmptyState
          icon={<CalendarBlank size={24} weight="regular" />}
          title="Todavía no cargaste servicios"
          description="Volvé al paso anterior o cargalos después desde el dashboard."
          action={
            <Button onClick={onDone} variant="secondary">
              Terminar onboarding igual
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="card">
      <h1>Cargá tu primer turno</h1>
      <p style={{ color: "var(--color-ink-soft)" }}>Último paso — ¡ya casi!</p>
      <form onSubmit={handleSubmit}>
        <Field label="Cliente" htmlFor="clientName">
          <Input
            id="clientName"
            required
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
          />
        </Field>
        <Field label="Teléfono" htmlFor="clientPhone">
          <Input
            id="clientPhone"
            required
            value={clientPhone}
            onChange={(e) => setClientPhone(e.target.value)}
          />
        </Field>
        <Field label="Servicio" htmlFor="service">
          <select
            id="service"
            className="input"
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
          >
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Fecha y hora" htmlFor="startsAt">
          <Input
            id="startsAt"
            type="datetime-local"
            required
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </Field>
        <Button type="submit" disabled={loading} style={{ width: "100%" }}>
          {loading ? "Cargando..." : "Terminar — ¡listo!"}
        </Button>
      </form>
    </div>
  )
}
