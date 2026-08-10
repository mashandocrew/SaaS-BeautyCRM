import { Clock } from "@phosphor-icons/react/dist/ssr"
import { EmptyState } from "@beautycrm/ui"

export function ComingSoon({ module }: { module: string }) {
  return (
    <div>
      <h1>{module}</h1>
      <div className="card">
        <EmptyState
          icon={<Clock size={24} weight="regular" />}
          title="Todavía no está disponible"
          description={`El módulo de ${module.toLowerCase()} está en la hoja de ruta — no forma parte del alcance de esta sesión.`}
        />
      </div>
    </div>
  )
}
