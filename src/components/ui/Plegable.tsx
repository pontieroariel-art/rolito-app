import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

// Sección plegable (card blanca con título): la usan la liquidación detallada
// y la ficha del cliente del supervisor. `extra` va a la derecha del título
// (un chip de deuda, un contador) y se ve aun con la sección cerrada.
export function Plegable({ titulo, children, abiertoInicial = false, extra }: {
  titulo: string
  children: ReactNode
  abiertoInicial?: boolean
  extra?: ReactNode
}) {
  const [abierto, setAbierto] = useState(abiertoInicial)
  return (
    <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm">
      <button type="button" onClick={() => setAbierto((a) => !a)} className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left">
        <span className="font-semibold text-gray-900">{titulo}</span>
        <span className="flex items-center gap-2 shrink-0">
          {extra}
          {abierto ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
        </span>
      </button>
      {abierto && <div className="px-4 pb-4 overflow-x-auto">{children}</div>}
    </section>
  )
}

export default Plegable
