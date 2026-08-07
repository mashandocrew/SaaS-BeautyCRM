/**
 * Plantillas precargadas por rubro (Paso 2, Bloque A.4). Nunca se ofrece
 * una pantalla vacía — el dueño borra lo que no ofrece y ajusta precios.
 * Precios de referencia en ARS.
 */
export type ServiceTemplate = {
  name: string
  duration_minutes: number
  price: number
  category: string
}

export const RUBROS = ["Nails", "Peluquería", "Estética integral"] as const
export type Rubro = (typeof RUBROS)[number]

export const SERVICE_TEMPLATES: Record<Rubro, ServiceTemplate[]> = {
  Nails: [
    { name: "Esmaltado semipermanente", duration_minutes: 45, price: 8000, category: "Manos" },
    { name: "Esculpidas", duration_minutes: 90, price: 15000, category: "Manos" },
    { name: "Retiro de esculpidas", duration_minutes: 30, price: 4000, category: "Manos" },
    { name: "Pedicura spa", duration_minutes: 60, price: 10000, category: "Pies" },
    { name: "Esmaltado tradicional pies", duration_minutes: 30, price: 5000, category: "Pies" },
    { name: "Nail art (por uña)", duration_minutes: 10, price: 1000, category: "Manos" },
    { name: "Manicura express", duration_minutes: 20, price: 4500, category: "Manos" },
  ],
  Peluquería: [
    { name: "Corte", duration_minutes: 30, price: 6000, category: "Corte" },
    { name: "Brushing", duration_minutes: 40, price: 7000, category: "Peinado" },
    { name: "Color raíz", duration_minutes: 90, price: 18000, category: "Color" },
    { name: "Color completo", duration_minutes: 120, price: 25000, category: "Color" },
    { name: "Alisado", duration_minutes: 150, price: 35000, category: "Tratamiento" },
    { name: "Peinado para evento", duration_minutes: 60, price: 12000, category: "Peinado" },
  ],
  "Estética integral": [
    { name: "Limpieza facial", duration_minutes: 60, price: 12000, category: "Facial" },
    { name: "Depilación cera (piernas)", duration_minutes: 30, price: 6000, category: "Depilación" },
    { name: "Depilación cera (axilas)", duration_minutes: 15, price: 2500, category: "Depilación" },
    { name: "Masaje descontracturante", duration_minutes: 60, price: 14000, category: "Masajes" },
    { name: "Diseño de cejas", duration_minutes: 20, price: 4000, category: "Cejas" },
    { name: "Extensión de pestañas", duration_minutes: 90, price: 16000, category: "Pestañas" },
  ],
}
