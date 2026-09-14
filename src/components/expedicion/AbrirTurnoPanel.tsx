import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, LockOpen } from 'lucide-react'
import Button from '@/components/ui/Button'
import Badge from '@/components/common/Badge'
import { useAuth } from '@/context/AuthContext'
import { abrirTurno, SesionYaAbiertaError } from '@/services/cajaSesionService'
import { reportError } from '@/services/observability'
import { formatoARS } from '@/utils/money'
import { horaCorta } from '@/utils/turnoCaja'
import type { CajaSesion } from '@/types'

// Rendición de fondos (2026-09-14): sin turno abierto la ventanilla no vende
// ni cobra (las reglas lo exigen). Este panel reemplaza al formulario en
// Ventanilla y Cobranzas, y es el estado "no abriste turno" de Mi turno.
// Fondo inicial 0: hoy no hay fondo fijo (decisión de Ariel).
export default function AbrirTurnoPanel({ fecha, titulo = 'Abrir mi turno', onAbierta }: {
  fecha: string
  titulo?: string
  /** La sesión recién abierta (o la que ya estaba abierta, si se pisó el botón dos veces). */
  onAbierta?: (s: CajaSesion) => void
}) {
  const { user } = useAuth()
  const [abriendo, setAbriendo] = useState(false)
  const [error, setError] = useState('')

  const abrir = async () => {
    if (!user) return
    if (!user.planta) { setError('Tu usuario no tiene planta asignada: pedile al administrador que te la cargue.'); return }
    setAbriendo(true); setError('')
    try {
      const s = await abrirTurno({ uid: user.uid, nombre: user.nombre }, user.planta, fecha)
      onAbierta?.(s)
    } catch (err) {
      if (err instanceof SesionYaAbiertaError) { onAbierta?.(err.sesion); return }
      reportError(err, { origen: 'AbrirTurnoPanel', accion: 'error al abrir el turno' })
      setError('No se pudo abrir el turno. Revisá la conexión e intentá de nuevo.')
    } finally {
      setAbriendo(false)
    }
  }

  return (
    <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-6 text-center space-y-3">
      <div className="mx-auto w-12 h-12 rounded-full bg-accent/10 text-accent flex items-center justify-center"><LockOpen size={24} /></div>
      <h2 className="text-lg font-semibold text-gray-900">{titulo}</h2>
      <p className="text-sm text-secundario max-w-md mx-auto">
        Todo lo que cobres queda en tu turno hasta que lo cierres y lo rindas a tesorería.
      </p>
      <Button size="lg" onClick={abrir} loading={abriendo} className="w-full sm:w-auto">
        Abrir mi turno · fondo inicial {formatoARS(0)}
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  )
}

/**
 * Chip del turno abierto para la cabecera de la ventanilla: hora de apertura
 * y CANTIDADES (nunca el efectivo: arqueo ciego), más el link para cerrarlo.
 */
export function TurnoAbiertoChip({ sesion, ventas, cobranzas, cerrarHref = '/caja/rendiciones' }: {
  sesion: CajaSesion
  /** Negativo = no mostrar (la pantalla de cobranzas no tiene las ventas a mano). */
  ventas: number
  cobranzas: number
  cerrarHref?: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tono="enCamino" icono={<Clock />} title={`Turno ${sesion.numero} del día, abierto a las ${horaCorta(sesion.abiertaEn)}`}>
        Turno abierto {horaCorta(sesion.abiertaEn)}
      </Badge>
      <span className="text-sm text-secundario tabular-nums">
        {ventas >= 0 ? `${ventas} ${ventas === 1 ? 'venta' : 'ventas'} · ` : ''}{cobranzas} {cobranzas === 1 ? 'cobranza' : 'cobranzas'}
      </span>
      <Link to={cerrarHref} className="text-sm font-medium text-accent hover:underline">Cerrar mi turno</Link>
    </div>
  )
}
