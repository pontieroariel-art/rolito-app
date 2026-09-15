import { useState } from 'react'
import { Home, ParkingSquare } from 'lucide-react'
import { elegirDarsenaRegreso, marcarRegresoRemito } from '@/services/remitoCargaService'
import { reportError } from '@/services/observability'
import { useMuelleEstado } from '@/hooks/useMuelleEstado'
import type { RemitoCarga } from '@/types'

/**
 * "Llegué a planta" en el hub del chofer (2026-09-13) + "¿en qué dársena estás?" (2026-09-15).
 *
 * Para qué: hasta acá el sistema no sabía que un camión había vuelto. El muelle
 * se enteraba cuando alguien pasaba por la dársena, y el TV no tenía forma de
 * avisar que había un camión esperando que le cuenten la descarga.
 *
 * Lo mismo lo marca seguridad en el portón, que lo ve entrar: el primero que
 * toque gana y el otro deja de ver el botón (las reglas rechazan el segundo).
 * Por eso un rebote no es un error que haya que gritar.
 *
 * Segundo paso (pedido de Ariel): el camión que vuelve estaciona DIRECTO en una
 * boca para descargar, así que después de "volví" el chofer elige la dársena, y
 * se le muestran SOLO las libres (las publica el servidor en `muelleEstado`). Si
 * no hay ninguna libre, queda como "volvió, esperando dársena" y el TV lo lista
 * abajo hasta que se libere una. Se elige una sola vez: la regla no deja cambiarla.
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
  const volvieron  = remitos.filter((r) => r.estado === 'salido' && r.regreso)
  const sinDarsena = volvieron.filter((r) => !r.regreso?.darsena)
  const conDarsena = volvieron.find((r) => r.regreso?.darsena)
  // Solo hace falta el estado del muelle mientras hay una boca por elegir.
  const plantaId = pendientes.length === 0 && sinDarsena.length > 0 ? sinDarsena[0].plantaId : null
  const { libres, cargando, sinDato } = useMuelleEstado(plantaId)

  if (pendientes.length === 0 && volvieron.length === 0) return null

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

  const elegir = async (darsena: number) => {
    if (guardando) return
    setAviso('')
    setGuardando(true)
    try {
      for (const r of sinDarsena) await elegirDarsenaRegreso(r, darsena)
    } catch (err) {
      reportError(err, { origen: 'AvisarRegreso', accion: 'elegir dársena del regreso' })
      setAviso('No se pudo guardar la dársena. Probá de nuevo o avisale al muelle.')
    } finally {
      setGuardando(false)
    }
  }

  if (pendientes.length > 0) {
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

  if (sinDarsena.length > 0) {
    return (
      <section className="bg-white border border-[#D3D1C7] rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex items-center gap-2">
          <ParkingSquare size={18} className="text-accent shrink-0" />
          <p className="text-sm font-semibold text-gray-900">¿En qué dársena estás?</p>
        </div>
        {cargando ? (
          <p className="text-sm text-secundario">Buscando las bocas libres…</p>
        ) : sinDato ? (
          <p className="text-sm text-secundario">
            No pudimos saber qué dársenas están libres. Avisale al muelle dónde estás.
          </p>
        ) : libres.length === 0 ? (
          <p className="text-sm text-secundario">
            No hay ninguna dársena libre. Esperá: cuando se libere una, aparece acá.
            El muelle ya sabe que volviste.
          </p>
        ) : (
          <>
            <div className="flex gap-2">
              {libres.map((n) => (
                <button key={n} type="button" onClick={() => elegir(n)} disabled={guardando}
                  className="flex-1 h-14 rounded-xl border-2 border-accent text-accent text-2xl font-black tabular-nums active:scale-[0.97] transition-transform disabled:opacity-50">
                  {n}
                </button>
              ))}
            </div>
            <p className="text-xs text-secundario text-center">Solo se muestran las bocas libres, como están vistas desde el muelle.</p>
          </>
        )}
        {aviso && <p className="text-xs text-amber-700 text-center">{aviso}</p>}
      </section>
    )
  }

  return (
    <section className="bg-white border border-[#D3D1C7] rounded-2xl p-4 shadow-sm flex items-center gap-3">
      <Home size={18} className="text-accent shrink-0" />
      <p className="text-sm text-gray-700">
        Estás en la dársena <span className="font-bold text-gray-900">{conDarsena?.regreso?.darsena}</span>. El muelle ya lo ve en la pantalla.
      </p>
    </section>
  )
}
