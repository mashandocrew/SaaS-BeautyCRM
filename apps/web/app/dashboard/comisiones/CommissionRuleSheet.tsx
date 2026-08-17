"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Trash } from "@phosphor-icons/react"
import { Button, Field, Input, Sheet } from "@beautycrm/ui"
import { createCommissionRule, deleteCommissionRule, updateCommissionRule } from "@/lib/comisiones-actions"
import type { CommissionRule, CommissionRuleInput } from "@/lib/comisiones-types"

export function CommissionRuleSheet({
  open,
  onClose,
  tenantId,
  mode,
  rule,
}: {
  open: boolean
  onClose: () => void
  tenantId: string
  mode: "create" | "edit"
  rule?: CommissionRule | null
}) {
  const router = useRouter()
  const [name, setName] = useState(rule?.name ?? "")
  const [baseSalary, setBaseSalary] = useState(String(rule?.base_salary ?? 0))
  const [servicePct, setServicePct] = useState(String(rule?.service_pct ?? 0))
  const [productSalePct, setProductSalePct] = useState(String(rule?.product_sale_pct ?? 0))
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const parsedBase = Number(baseSalary)
    const parsedService = Number(servicePct)
    const parsedProduct = Number(productSalePct)

    if (!name.trim()) {
      setError("El nombre es obligatorio.")
      return
    }
    if (!Number.isFinite(parsedBase) || parsedBase < 0) {
      setError("El salario base no puede ser negativo.")
      return
    }
    if (!Number.isFinite(parsedService) || parsedService < 0 || parsedService > 100) {
      setError("El % de servicio tiene que estar entre 0 y 100.")
      return
    }
    if (!Number.isFinite(parsedProduct) || parsedProduct < 0 || parsedProduct > 100) {
      setError("El % de producto tiene que estar entre 0 y 100.")
      return
    }

    const input: CommissionRuleInput = {
      name,
      baseSalary: parsedBase,
      servicePct: parsedService,
      productSalePct: parsedProduct,
    }

    setLoading(true)
    const result = mode === "create" ? await createCommissionRule(tenantId, input) : await updateCommissionRule(rule!.id, input)
    setLoading(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    onClose()
    router.refresh()
  }

  async function handleDelete() {
    if (!rule) return
    if (!window.confirm(`¿Eliminar la regla "${rule.name}"?`)) return

    setError(null)
    setDeleting(true)
    const result = await deleteCommissionRule(rule.id)
    setDeleting(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    onClose()
    router.refresh()
  }

  return (
    <Sheet open={open} onClose={onClose} title={mode === "create" ? "Nueva regla" : "Editar regla"} side="right">
      <form onSubmit={handleSubmit} noValidate>
        {error ? <p className="error-banner">{error}</p> : null}

        <Field label="Nombre" htmlFor="rule-name" hint="Por ejemplo: Manicurista Senior.">
          <Input id="rule-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>

        <Field label="Salario base" htmlFor="rule-base" hint="Fijo mensual, además de las comisiones. Opcional, 0 si no aplica.">
          <Input
            id="rule-base"
            type="number"
            min={0}
            step={1000}
            value={baseSalary}
            onChange={(e) => setBaseSalary(e.target.value)}
            required
          />
        </Field>

        <Field label="% sobre servicios" htmlFor="rule-service-pct">
          <Input
            id="rule-service-pct"
            type="number"
            min={0}
            max={100}
            step={1}
            value={servicePct}
            onChange={(e) => setServicePct(e.target.value)}
            required
          />
        </Field>

        <Field label="% sobre productos vendidos" htmlFor="rule-product-pct">
          <Input
            id="rule-product-pct"
            type="number"
            min={0}
            max={100}
            step={1}
            value={productSalePct}
            onChange={(e) => setProductSalePct(e.target.value)}
            required
          />
        </Field>

        <Button type="submit" disabled={loading}>
          {loading ? "Guardando..." : mode === "create" ? "Crear regla" : "Guardar cambios"}
        </Button>

        {mode === "edit" ? (
          <>
            <hr style={{ margin: "var(--space-6) 0", border: 0, borderTop: "1px solid var(--color-border)" }} />
            <Button type="button" variant="danger" onClick={handleDelete} disabled={deleting}>
              <Trash size={16} weight="bold" /> {deleting ? "Eliminando..." : "Eliminar regla"}
            </Button>
          </>
        ) : null}
      </form>
    </Sheet>
  )
}
