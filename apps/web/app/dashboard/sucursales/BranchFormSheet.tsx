"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Button, Field, Input, Sheet } from "@beautycrm/ui"
import { createBranch, updateBranch } from "@/lib/sucursales-actions"
import type { Branch, BranchInput } from "@/lib/sucursales-types"

export function BranchFormSheet({
  open,
  onClose,
  tenantId,
  mode,
  branch,
}: {
  open: boolean
  onClose: () => void
  tenantId: string
  mode: "create" | "edit"
  branch?: Branch | null
}) {
  const router = useRouter()
  const [name, setName] = useState(branch?.name ?? "")
  const [address, setAddress] = useState(branch?.address ?? "")
  const [phone, setPhone] = useState(branch?.phone ?? "")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError("El nombre es obligatorio.")
      return
    }

    const input: BranchInput = { name, address: address.trim() || null, phone: phone.trim() || null }

    setLoading(true)
    const result = mode === "create" ? await createBranch(tenantId, input) : await updateBranch(branch!.id, input)
    setLoading(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    onClose()
    router.refresh()
  }

  return (
    <Sheet open={open} onClose={onClose} title={mode === "create" ? "Nueva sucursal" : "Editar sucursal"} side="right">
      <form onSubmit={handleSubmit} noValidate>
        {error ? <p className="error-banner">{error}</p> : null}

        <Field label="Nombre" htmlFor="branch-name">
          <Input id="branch-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>

        <Field label="Dirección" htmlFor="branch-address" hint="Opcional.">
          <Input id="branch-address" value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>

        <Field label="Teléfono" htmlFor="branch-phone" hint="Opcional.">
          <Input id="branch-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>

        <Button type="submit" disabled={loading}>
          {loading ? "Guardando..." : mode === "create" ? "Crear sucursal" : "Guardar cambios"}
        </Button>
      </form>
    </Sheet>
  )
}
