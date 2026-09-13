import { useState } from 'react'
import { Home } from 'lucide-react'
import { marcarRegresoRemito } from '@/services/remitoCargaService'
import { reportError } from '@/services/observability'
import type { RemitoCarga } from '@/types'

/**
 * "Llegué a planta" en el hub del chofer (2026-09-13).
 *
 * Para qué: hasta acá el sistema no sabía que un camión había vuelto. El muelle
 * se enteraba cuando alguien pasaba por la dársena, y el TV no tenía forma de
 * avisar que había un camión esperando que le cuenten la descarga.
 *
 * Lo mismo lo marca seguridad en el portón, que lo ve entrar: el primero que
 * toque gana y el otro deja de ver el botón (las reglas rechazan el segundo).
 * Por eso un rebote no es un error que haya que gritar.
 *
 * Solo aparece con un remito 'salido' sin regreso: antes de salir no tiene
 * sentido, y una vez marcado no se puede correr la hora.
 */
export default function AvisarRegreso({
  remitos, actor,
}: {
  remitos: RemitoCarga[]
  actor: { uid: string; nombre: string }
}) {
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState('')

  const pendientes = remitos.filter((r) => r.estado === 'salido' && !r.regreso)
  const yaMarcado = remitos.find((r) => r.estado === 'salido' && r.regreso)

  if (pendientes.length === 0) {
    if (!yaMarcado?.regreso) return null
    return (
      <section className="bg-white border border-[#D3D1C7] rounded-2xl p-4 shadow-sm flex items-center gap-3">
        <Home size={18} className="text-accent shrink-0" />
        <p className="text-sm text-gray-700">
          Avisaste que llegaste a planta. El muelle ya lo ve en la pantalla.
        </p>
      </section>
    )
  }

  const avisar = async () => {
    if (guardando) return
    setAviso('')
    setGuardando(true)
    try {
      // Si volvió con dos remitos (dos vueltas), se marcan los dos.
      for (const r of pendientes) await marcarRegresoRemito(r, actor)
    } catch (err) {
      reportError(err, { origen: 'AvisarRegreso', accion: 'marcar regreso a planta' })
      setAviso('No se pudo avisar. Si seguridad ya lo marcó en el portón, está hecho igual.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <section className="bg-white border border-[#D3D1C7] rounded-2xl p-4 shadow-sm space-y-2">
      <button type="button" onClick={avisar} disabled={guardando}
        className="w-full h-12 flex items-center justify-center gap-2 rounded-xl bg-accent text-white font-semibold active:scale-[0.99] transition-transform disabled:opacity-50">
        <Home size={18} /> {guardando ? 'Avisando…' : 'Llegué a planta'}
      </button>
      <p className="text-xs text-secundario text-center">
        Avisale al muelle que volviste, así te cuentan la descarga.
      </p>
      {aviso && <p className="text-xs text-amber-700 text-center">{aviso}</p>}
    </section>
  )
}
