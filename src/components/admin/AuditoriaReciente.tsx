import { ShieldAlert } from 'lucide-react'
import type { HistorialAdminEvento } from '@/services/historialAdminService'
import { haceTexto } from '@/utils/backofficeEstado'
import { tsToDate } from '@/utils/helpers'
import type { Timestamp } from 'firebase/firestore'

// Últimas acciones del historial de auditoría (historialAdmin), que hasta
// ahora solo se escribía y se mandaba por mail. Alto riesgo en rojo: cambios
// de rol, altas/bajas y las entradas "Ver como" del super_admin.

const ACCION: Record<string, string> = {
  creado:              'creó',
  modificado:          'modificó',
  activado:            'activó',
  desactivado:         'desactivó',
  rol_cambiado:        'cambió el rol',
  usuario_creado:      'creó el usuario',
  usuario_desactivado: 'desactivó al usuario',
  impersonacion:       'entró como (Ver como)',
}

export default function AuditoriaReciente({ eventos, ahora }: { eventos: HistorialAdminEvento[]; ahora: Date }) {
  if (eventos.length === 0) return <p className="text-sm text-gray-500">Sin acciones registradas.</p>
  return (
    <ul className="divide-y divide-gray-100">
      {eventos.map((e) => {
        const alto = e.riesgo === 'alto'
        const fecha = e.fecha ? tsToDate(e.fecha as Timestamp) : null
        return (
          <li key={e.id} className="py-2 flex items-start gap-2 text-sm">
            {alto
              ? <ShieldAlert size={15} className="text-red-600 shrink-0 mt-0.5" />
              : <span className="w-[15px] h-[15px] shrink-0 mt-0.5 rounded-full bg-gray-200 inline-block" />}
            <p className="min-w-0 flex-1 text-gray-700">
              <b className="text-gray-900">{e.actor?.nombre || 'Alguien'}</b>{' '}
              {ACCION[e.accion] ?? e.accion}
              {e.detalle ? <> <span className={alto ? 'text-red-700 font-medium' : ''}>{e.detalle}</span></> : null}
              <span className="text-gray-400"> · {e.coleccion}</span>
            </p>
            <span className="text-xs text-gray-400 shrink-0 tabular-nums">{haceTexto(fecha, ahora)}</span>
          </li>
        )
      })}
    </ul>
  )
}
