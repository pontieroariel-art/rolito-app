import { Link } from 'react-router-dom'
import { Plegable } from '@/components/ui/Plegable'
import { ACCESOS } from '@/utils/backofficeAccesos'

// Accesos del panel de control: compactos y plegados por área (antes eran
// 37 tarjetas con descripción ocupando toda la pantalla).
export default function SeccionAccesos() {
  return (
    <div className="space-y-2">
      {ACCESOS.map((g) => (
        <Plegable key={g.id} titulo={g.titulo} extra={<span className="text-xs text-gray-400">{g.accesos.length}</span>}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 pt-1">
            {g.accesos.map((a) => (
              <Link
                key={a.to}
                to={a.to}
                className="flex items-center gap-2 rounded-lg border border-[#D3D1C7] bg-[#F8F7F2] px-3 py-2 text-sm text-gray-800 hover:border-accent/50 hover:text-accent transition-colors"
              >
                <a.icon size={15} className="shrink-0 text-gray-500" />
                <span className="min-w-0 truncate">{a.label}</span>
              </Link>
            ))}
          </div>
        </Plegable>
      ))}
    </div>
  )
}
