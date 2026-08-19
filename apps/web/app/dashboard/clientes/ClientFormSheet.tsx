"use client"

import { useState, type FormEvent } from "react"
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
  // Sembrado directamente desde `client` en los inicializadores de
  // useState, no con un useEffect: los efectos corren después del pintado,
  // así que había una ventana entre que el formulario se veía en pantalla y
  // que el efecto lo llenaba con los valores reales — cualquier valor que el
  // usuario tipeara en esa ventana se pisaba en silencio. Los padres
  // (ClientesList y ClientDetailView) ahora montan este componente
  // condicionalmente con una `key` por entidad, así que un `client` distinto
  // siempre implica una instancia nueva, y sembrar en el inicializador
  // alcanza.
  const [fullName, setFullName] = useState(client?.full_name ?? "")
  const [phone, setPhone] = useState(client?.phone ?? "")
  const [email, setEmail] = useState(client?.email ?? "")
  const [birthday, setBirthday] = useState(client?.birthday ?? "")
  const [notes, setNotes] = useState(client?.notes ?? "")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!fullName.trim()) {
      setError("El nombre es obligatorio.")
      return
    }
    // Validado acá y no dejado sólo al type="email" nativo: con noValidate
    // en otros forms del módulo la validación siempre vive en JS, y acá
    // sin noValidate igual conviene — un mensaje propio en el banner, no un
    // tooltip del navegador fácil de pasar por alto, sobre todo porque acá
    // el campo es opcional y un mensaje inline no aclara que además falló
    // guardar el resto del cliente.
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("El email no tiene un formato válido.")
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
    let result =
      mode === "create" ? await createClient(tenantId, input) : await updateClient(client!.id, input)

    // Duplicado de teléfono: no es un error duro, es una confirmación. Si
    // acepta, se reintenta la misma creación pidiéndole a la action que no
    // vuelva a chequear.
    if (!result.ok && result.code === "PHONE_DUPLICATE") {
      setLoading(false)
      if (!window.confirm(`${result.error} ¿Crear este cliente igual?`)) return
      setLoading(true)
      result = await createClient(tenantId, input, true)
    }

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
