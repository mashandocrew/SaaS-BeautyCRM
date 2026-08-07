"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Button, Field } from "@beautycrm/ui"
import { addTechnicalNote } from "./actions"

export function NoteForm({ appointmentId }: { appointmentId: string }) {
  const [notes, setNotes] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const result = await addTechnicalNote({
      appointmentId,
      technicalNotes: notes,
    })
    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setNotes("")
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit}>
      {error ? <p className="error-banner">{error}</p> : null}
      <Field label="Nota técnica" htmlFor="notes">
        <textarea
          id="notes"
          className="input"
          rows={3}
          required
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Tono 7.3, sensibilidad en cutícula..."
        />
      </Field>
      <Button type="submit" disabled={loading} style={{ width: "100%" }}>
        {loading ? "Guardando..." : "Guardar nota"}
      </Button>
    </form>
  )
}
