import { useState, type PointerEvent } from 'react'
import { Delete, LogOut, UserRound, X } from 'lucide-react'
import { loginProduccion } from '@/services/authService'
import { reportError } from '@/services/observability'
import { mensajeErrorLoginProduccion } from '@/utils/errorLoginProduccion'

// Cambiar de operario sin salir de la carga (2026-09-25, pedido de Ariel).
// Antes había que tocar Salir y volver a entrar con el teclado de Android,
// chico para los guantes. Acá: números grandes en pantalla, primero el legajo
// y después el PIN; con el cuarto dígito del PIN entra solo. Cada pallet
// queda a nombre de quien está adentro, por eso importa que cambiar sea fácil.
//
// Entrar con otro legajo reemplaza la sesión (Firebase) y la pantalla de
// carga sigue abierta con el nuevo nombre; la numeración es de la tablet, así
// que los números siguen corridos.
const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'borrar', '0', 'ok'] as const

export interface CambiarOperarioProps {
  onListo:   () => void
  onCerrar:  () => void
  onSalir:   () => void
}

export default function CambiarOperario({ onListo, onCerrar, onSalir }: CambiarOperarioProps) {
  const [paso, setPaso] = useState<'legajo' | 'pin'>('legajo')
  const [legajo, setLegajo] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [entrando, setEntrando] = useState(false)

  const entrar = async (pinFinal: string) => {
    setEntrando(true)
    setError('')
    try {
      await loginProduccion(legajo, pinFinal)
      onListo()
    } catch (err) {
      const { mensaje, inesperado } = mensajeErrorLoginProduccion(err)
      if (inesperado) reportError(err, { origen: 'CambiarOperario', accion: 'login' })
      setError(mensaje)
      setPin('')
      if (mensaje === 'Legajo no encontrado') { setPaso('legajo'); setLegajo('') }
    } finally {
      setEntrando(false)
    }
  }

  const tecla = (t: (typeof TECLAS)[number]) => (e: PointerEvent) => {
    if (e.button !== 0 || entrando) return
    e.preventDefault()
    setError('')
    if (paso === 'legajo') {
      if (t === 'borrar') setLegajo((v) => v.slice(0, -1))
      else if (t === 'ok') { if (legajo) setPaso('pin') }
      else if (legajo.length < 8) setLegajo((v) => v + t)
      return
    }
    if (t === 'borrar') { if (pin) setPin((v) => v.slice(0, -1)); else setPaso('legajo'); return }
    if (t === 'ok') { if (pin.length === 4) void entrar(pin); return }
    if (pin.length >= 4) return
    const nuevo = pin + t
    setPin(nuevo)
    if (nuevo.length === 4) void entrar(nuevo)
  }

  const listoParaOk = paso === 'legajo' ? legajo.length > 0 : pin.length === 4

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-4 print:hidden select-none" role="dialog" aria-modal="true" aria-label="Cambiar operario">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-2xl font-black text-gray-900"><UserRound size={28} /> ¿Quién carga ahora?</h2>
          <button type="button" onClick={onCerrar} aria-label="Cerrar"
            className="h-11 w-11 flex items-center justify-center rounded-xl border border-[#D3D1C7] text-secundario touch-manipulation active:bg-gray-50">
            <X size={24} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className={`rounded-2xl border-[3px] px-4 py-2 ${paso === 'legajo' ? 'border-accent' : 'border-[#D3D1C7]'}`}>
            <p className="text-sm font-bold text-secundario">LEGAJO</p>
            <p className="text-4xl font-black text-gray-900 tabular-nums h-10 leading-10">{legajo || ' '}</p>
          </div>
          <div className={`rounded-2xl border-[3px] px-4 py-2 ${paso === 'pin' ? 'border-accent' : 'border-[#D3D1C7]'}`}>
            <p className="text-sm font-bold text-secundario">PIN</p>
            <p className="text-4xl font-black text-gray-900 tracking-[0.3em] h-10 leading-10">{'•'.repeat(pin.length) || ' '}</p>
          </div>
        </div>

        <p className={`text-base font-bold text-center min-h-6 ${error ? 'text-red-700' : 'text-secundario'}`}>
          {error || (entrando ? 'Entrando…' : paso === 'legajo' ? 'Escribí tu legajo y tocá OK' : 'Ahora tu PIN de 4 números')}
        </p>

        <div className="grid grid-cols-3 gap-3">
          {TECLAS.map((t) => (
            <button
              key={t}
              type="button"
              onPointerDown={tecla(t)}
              disabled={entrando || (t === 'ok' && !listoParaOk)}
              className={`h-[clamp(4rem,8vh,5.5rem)] rounded-2xl text-3xl font-black touch-manipulation disabled:opacity-40 ${
                t === 'ok' ? 'bg-accent text-white active:opacity-90'
                  : t === 'borrar' ? 'bg-[#F1EFE8] text-gray-900 active:bg-[#E7E5DC] flex items-center justify-center'
                    : 'bg-[#F1EFE8] text-gray-900 active:bg-[#E7E5DC] tabular-nums'
              }`}
              aria-label={t === 'borrar' ? 'Borrar' : t === 'ok' ? 'OK' : t}
            >
              {t === 'borrar' ? <Delete size={30} /> : t === 'ok' ? 'OK' : t}
            </button>
          ))}
        </div>

        <button type="button" onClick={onSalir}
          className="flex items-center justify-center gap-2 h-12 rounded-xl border border-[#D3D1C7] text-base font-bold text-secundario touch-manipulation active:bg-gray-50">
          <LogOut size={18} /> Cerrar sesión
        </button>
      </div>
    </div>
  )
}
