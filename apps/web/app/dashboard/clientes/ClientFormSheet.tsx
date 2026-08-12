"use client"

import { useEffect, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Button, Field, Input, Sheet } from "@beautycrm/ui"
import { createClient, updateClient, type ClientInput } from "@/lib/client-actions"
import type { ClientRecord } from "@/lib/client-types"

export function ClientFormSheet({
  open,
  onClose,
  tenantId,
  mode,
  client,
}: {
  open: boolean
  onClose: () => void
  tenantId: string
  mode: "create" | "edit"
  client?: ClientRecord | null
}) {
  const router = useRouter()
  const [fullName, setFullName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [birthday, setBirthday] = useState("")
  const [notes, setNotes] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setFullName(client?.full_name ?? "")
    setPhone(client?.phone ?? "")
    setEmail(client?.email ?? "")
    setBirthday(client?.birthday ?? "")
    setNotes(client?.notes ?? "")
    setError(null)
  }, [open, client])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!fullName.trim()) {
      setError("El nombre es obligatorio.")
      return
    }

    const input: ClientInput = {
      fullName,
      phone: phone.trim() || null,
      email: email.trim() || null,
      birthday: birthday || null,
      notes: notes.trim() || null,
    }

    setLoading(true)
    const result = mode === "create" ? await createClient(tenantId, input) : await updateClient(client!.id, input)
    setLoading(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    onClose()
    router.refresh()
  }

  return (
    <Sheet open={open} onClose={onClose} title={mode === "create" ? "Nuevo cliente" : "Editar cliente"} side="right">
      <form onSubmit={handleSubmit}>
        {error ? <p className="error-banner">{error}</p> : null}

        <Field label="Nombre" htmlFor="client-full-name">
          <Input id="client-full-name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </Field>

        <Field label="Teléfono" htmlFor="client-phone">
          <Input id="client-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>

        <Field label="Email" htmlFor="client-email">
          <Input id="client-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>

        <Field label="Cumpleaños" htmlFor="client-birthday">
          <Input id="client-birthday" type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
        </Field>

        <Field label="Notas" htmlFor="client-notes">
          <textarea id="client-notes" className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <Button type="submit" disabled={loading}>
          {loading ? "Guardando..." : mode === "create" ? "Crear cliente" : "Guardar cambios"}
        </Button>
      </form>
    </Sheet>
  )
}
