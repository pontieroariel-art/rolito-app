import { useRef, useState } from 'react'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import SignaturePad, { type SignaturePadHandle } from '@/components/heladeras/SignaturePad'
import { formatoARS } from '@/utils/money'
import { MOTIVOS_DIFERENCIA_LIQUIDACION, MOTIVOS_LIQUIDACION_REPARTIDOR, type MotivoDiferenciaLiquidacion } from '@/types'

export interface DatosCierre {
  diferencia?:            { motivo: MotivoDiferenciaLiquidacion; nota: string }
  firma:                  string
  firmante:               string
  confirmoSinPendientes:  boolean
}

// Textos del cierre según quién rinde: el repartidor (liquidación) o el
// cajero de ventanilla (cierre de caja, 2026-09-09).
export interface TextosCierre {
  titulo: string
  sujeto: string            // "repartidor" | "caja"
  aRendir: string           // "A rendir" | "Efectivo en caja"
  recibido: string          // "Recibido" | "Contado"
  confirmacion: React.ReactNode
  firma: string             // "Firma del repartidor (conformidad con lo rendido)"
  boton: string
  pie: string
}

export const TEXTOS_CIERRE_REPARTIDOR: TextosCierre = {
  titulo: 'Cerrar liquidación', sujeto: 'repartidor', aRendir: 'A rendir', recibido: 'Recibido',
  confirmacion: <>El repartidor confirma que su teléfono <b>no muestra ventas ni cobranzas sin subir</b> (aviso "todavía no subieron" en Mis ventas). Si las hay, esperá a que suban antes de cerrar.</>,
  firma: 'Firma del repartidor (conformidad con lo rendido)',
  boton: 'Cerrar e imprimir',
  pie: 'Al confirmar se guarda el cierre (no se puede editar) y se imprime la liquidación con todo el detalle.',
}

// Cierre con control (2026-09-06): resumen de lo que se cierra, motivo y nota
// obligatorios si el efectivo no cuadra, confirmación de que no quedan
// movimientos sin subir, y la firma de conformidad de quien rinde.
export default function CierreLiquidacionModal({ repartidor, resumen, efectivoARendir, efectivoRecibido, guardando, error, onCancelar, onConfirmar, textos = TEXTOS_CIERRE_REPARTIDOR, motivos = MOTIVOS_LIQUIDACION_REPARTIDOR }: {
  repartidor: string
  resumen: { ventas: number; clientes: number; cobranzas: number }
  efectivoARendir: number
  efectivoRecibido: number
  guardando: boolean
  error: string
  onCancelar: () => void
  onConfirmar: (datos: DatosCierre) => void
  textos?: TextosCierre
  motivos?: MotivoDiferenciaLiquidacion[]
}) {
  const diferencia = efectivoRecibido - efectivoARendir
  const [motivo, setMotivo] = useState<MotivoDiferenciaLiquidacion | ''>('')
  const [nota, setNota] = useState('')
  const [firmante, setFirmante] = useState(repartidor)
  const [confirmo, setConfirmo] = useState(false)
  const [falta, setFalta] = useState('')
  const firmaRef = useRef<SignaturePadHandle>(null)

  const confirmar = () => {
    setFalta('')
    if (diferencia !== 0 && !motivo) { setFalta('Elegí el motivo de la diferencia de efectivo.'); return }
    if (!confirmo) { setFalta(`Confirmá que no quedan movimientos sin subir${textos.sujeto === 'repartidor' ? ' en el teléfono del repartidor' : ''}.`); return }
    const firma = firmaRef.current?.toDataURL()
    if (!firma) { setFalta(`Falta la firma ${textos.sujeto === 'repartidor' ? 'del repartidor' : 'de quien cierra la caja'}.`); return }
    if (!firmante.trim()) { setFalta('Poné el nombre de quien firma.'); return }
    onConfirmar({
      ...(diferencia !== 0 && motivo ? { diferencia: { motivo, nota: nota.trim() } } : {}),
      firma,
      firmante: firmante.trim(),
      confirmoSinPendientes: true,
    })
  }

  const inputClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

  return (
    <Modal open onClose={onCancelar} title={textos.titulo}>
      <div className="space-y-3">
        <p className="text-sm text-gray-700">
          <b>{repartidor}</b> · {resumen.ventas} {resumen.ventas === 1 ? 'venta' : 'ventas'} · {resumen.clientes} {resumen.clientes === 1 ? 'cliente' : 'clientes'} · {resumen.cobranzas} {resumen.cobranzas === 1 ? 'cobranza' : 'cobranzas'}
        </p>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="rounded-lg bg-gray-50 p-2"><p className="text-xs text-gray-500">{textos.aRendir}</p><p className="font-semibold tabular-nums">{formatoARS(efectivoARendir)}</p></div>
          <div className="rounded-lg bg-gray-50 p-2"><p className="text-xs text-gray-500">{textos.recibido}</p><p className="font-semibold tabular-nums">{formatoARS(efectivoRecibido)}</p></div>
          <div className={`rounded-lg p-2 ${diferencia === 0 ? 'bg-[#E6F5EF]' : 'bg-red-50'}`}><p className="text-xs text-gray-500">Diferencia</p><p className={`font-semibold tabular-nums ${diferencia === 0 ? 'text-[#0F6B4E]' : 'text-red-600'}`}>{formatoARS(diferencia)}</p></div>
        </div>

        {diferencia !== 0 && (
          <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-sm font-semibold text-red-700">El efectivo no cuadra. ¿Por qué?</p>
            <select value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoDiferenciaLiquidacion)} className={inputClass}>
              <option value="">Elegir motivo…</option>
              {motivos.map((m) => <option key={m} value={m}>{MOTIVOS_DIFERENCIA_LIQUIDACION[m]}</option>)}
            </select>
            <textarea value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota (opcional): qué pasó, quién lo revisa…" rows={2} className={inputClass} />
          </div>
        )}

        <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer select-none">
          <input type="checkbox" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} className="mt-0.5 accent-[#1D9E75]" />
          <span>{textos.confirmacion}</span>
        </label>

        <div>
          <p className="text-xs text-gray-500 mb-1">{textos.firma}</p>
          <div className="rounded-lg border border-[#D3D1C7] bg-white">
            <SignaturePad ref={firmaRef} />
          </div>
          <div className="mt-2 flex gap-2 items-center">
            <input value={firmante} onChange={(e) => setFirmante(e.target.value)} placeholder="Nombre de quien firma" className={inputClass} />
            <button type="button" onClick={() => firmaRef.current?.clear()} className="text-xs text-gray-500 hover:text-gray-800 whitespace-nowrap">Borrar firma</button>
          </div>
        </div>

        <p className="text-xs text-gray-500">{textos.pie}</p>
        {(falta || error) && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2"><p className="text-red-600 text-sm">{falta || error}</p></div>
        )}
        <div className="flex gap-2 pt-1">
          <Button variant="outline" type="button" onClick={onCancelar} className="flex-1" disabled={guardando}>Cancelar</Button>
          <Button onClick={confirmar} loading={guardando} className="flex-1">{textos.boton}</Button>
        </div>
      </div>
    </Modal>
  )
}
