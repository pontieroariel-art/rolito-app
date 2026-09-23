import { useState } from 'react'
import { Check, Clock, PackageX, ShieldCheck, X } from 'lucide-react'
import Button from '@/components/ui/Button'
import { reportError } from '@/services/observability'
import { MOTIVOS_DESVIO_DESCARGA, MOTIVOS_DESVIO_LIQUIDACION, type DesvioDescarga, type MotivoDesvioDescarga } from '@/types'
import { textoFaltante, type FaltanteCalculado } from '@/utils/faltantes'

// El faltante de mercadería del día, en la pantalla de caja (2026-09-13).
//
// Dos caminos, y ninguno traba el turno:
//   · pedir la autorización (camino limpio: alguien con el permiso lo mira);
//   · cerrar con desvío observado, que es el botón de abajo y siempre está.
// Si el pedido se rechaza, el texto dice qué hacer (recontar, buscar la
// mercadería) y caja sigue pudiendo cerrar observado.
export default function PedirAutorizacionDesvio({ faltante, umbral, desvio, onPedir }: {
  faltante: FaltanteCalculado
  umbral: number
  desvio: DesvioDescarga | null
  onPedir: (motivo: MotivoDesvioDescarga, nota: string) => Promise<void>
}) {
  const [abierto, setAbierto] = useState(false)
  const [motivo, setMotivo] = useState<MotivoDesvioDescarga | ''>('')
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const pedir = async () => {
    if (!motivo) { setError('Elegí qué creés que pasó.'); return }
    setGuardando(true); setError('')
    try {
      await onPedir(motivo, nota.trim())
      setAbierto(false)
    } catch (err) {
      reportError(err, { origen: 'PedirAutorizacionDesvio' })
      setError('No se pudo pedir la autorización. Revisá la conexión; podés cerrar con desvío observado igual.')
    } finally {
      setGuardando(false)
    }
  }

  const inputClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'
  const cuando = (ts?: { toDate(): Date }) =>
    ts ? ts.toDate().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''

  return (
    <div className="w-full text-sm text-red-800 bg-red-50 border border-red-300 rounded-lg px-3 py-2 space-y-2">
      <p className="font-semibold flex items-center gap-1.5">
        <PackageX size={16} className="shrink-0" />
        Faltan {textoFaltante(faltante.productos, faltante.bolsasFaltantes)} (umbral: {umbral} unidades).
      </p>
      <p className="tabular-nums">
        {faltante.productos.map((p) => `${p.nombre} −${p.faltan}`).join(' · ')}
        {faltante.bolsasSobrantes > 0 && ` · sobran ${faltante.bolsasSobrantes} de otros productos`}
      </p>

      {/* Ya hay pedido: se muestra en qué quedó. */}
      {desvio?.estado === 'pendiente' && (
        <p className="flex items-center gap-1.5 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
          <Clock size={14} className="shrink-0" />
          Esperando autorización · lo pidió {desvio.solicitadoPor.nombre} {cuando(desvio.solicitadaEn)}. Si no llega, cerrá con desvío observado.
        </p>
      )}
      {desvio?.estado === 'aprobada' && (
        <p className="flex items-center gap-1.5 text-[#0F6B4E] bg-[#E6F5EF] border border-accent/30 rounded-lg px-2 py-1.5">
          <ShieldCheck size={14} className="shrink-0" />
          Autorizado por {desvio.resueltaPor?.nombre} {cuando(desvio.resueltaEn)}{desvio.notaResolucion ? ` · ${desvio.notaResolucion}` : ''}. Ya podés cerrar.
        </p>
      )}
      {desvio?.estado === 'rechazada' && (
        <p className="flex items-center gap-1.5 text-red-800 bg-white border border-red-300 rounded-lg px-2 py-1.5">
          <X size={14} className="shrink-0" />
          Rechazado por {desvio.resueltaPor?.nombre}: {desvio.notaResolucion}
        </p>
      )}

      {!desvio && !abierto && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => { setError(''); setAbierto(true) }}>
            <ShieldCheck size={16} className="mr-1.5" /> Pedir autorización
          </Button>
          <span className="text-xs">
            o cerrá con desvío observado: el cierre se completa y queda marcado en rojo para que lo revisen.
          </span>
        </div>
      )}

      {!desvio && abierto && (
        <div className="space-y-2 bg-white border border-red-200 rounded-lg p-2.5">
          <p className="text-xs text-secundario">Qué creés que pasó (lo va a leer quien autoriza):</p>
          <select value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoDesvioDescarga)} className={inputClass}>
            <option value="">Elegir motivo…</option>
            {MOTIVOS_DESVIO_LIQUIDACION.map((m) => <option key={m} value={m}>{MOTIVOS_DESVIO_DESCARGA[m]}</option>)}
          </select>
          <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} className={inputClass}
            placeholder="Qué averiguaste: con quién hablaste, si se recontó…" />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setAbierto(false)} className="flex-1" disabled={guardando}>Cancelar</Button>
            <Button onClick={pedir} loading={guardando} className="flex-1"><Check size={16} className="mr-1.5" /> Pedir</Button>
          </div>
        </div>
      )}
    </div>
  )
}
