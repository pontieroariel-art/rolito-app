import { useRef, useState } from 'react'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import SignaturePad, { type SignaturePadHandle } from '@/components/heladeras/SignaturePad'
import { formatoARS } from '@/utils/money'
import ValoresEnPapel from '@/components/expedicion/ValoresEnPapel'
import { aRendidos, decisionesCompletas, resumenValores, type Decisiones, type DecisionValor, type ValoresEnPapel as ValoresDePapel } from '@/utils/valoresEnPapel'
import { MOTIVOS_DIFERENCIA_LIQUIDACION, MOTIVOS_LIQUIDACION_REPARTIDOR, type ChequeRendido, type MotivoDiferenciaLiquidacion, type RetencionRendida } from '@/types'

export interface DatosCierre {
  diferencia?:            { motivo: MotivoDiferenciaLiquidacion; nota: string }
  firma:                  string
  firmante:               string
  confirmoSinPendientes:  boolean
  // Firma de quien recibe (si el cierre tiene `receptor`) y valores en papel
  // tildados (si el cierre tiene `valores`), 2026-09-09.
  firmaRecibe?:           string
  firmanteRecibe?:        string
  cheques?:               ChequeRendido[]
  retenciones?:           RetencionRendida[]
  valoresFaltantes?:      { cantidad: number; total: number }
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
  valores?: string          // título del bloque de cheques/retenciones a tildar
  firmaRecibe?: string      // "Firma de quien recibe (caja)"
}

export const TEXTOS_CIERRE_REPARTIDOR: TextosCierre = {
  titulo: 'Cerrar liquidación', sujeto: 'repartidor', aRendir: 'A rendir', recibido: 'Recibido',
  confirmacion: <>El repartidor confirma que su teléfono <b>no muestra ventas ni cobranzas sin subir</b> (aviso "todavía no subieron" en Mis ventas). Si las hay, esperá a que suban antes de cerrar.</>,
  firma: 'Firma del repartidor (conformidad con lo rendido)',
  boton: 'Cerrar e imprimir',
  pie: 'Al confirmar se guarda el cierre (no se puede editar) y se imprime la liquidación con todo el detalle.',
  valores: 'Cheques y retenciones que entrega el repartidor: tildá cada uno al recibirlo',
  firmaRecibe: 'Firma de quien recibe la rendición (caja)',
}

// Cierre con control (2026-09-06): resumen de lo que se cierra, motivo y nota
// obligatorios si el efectivo no cuadra, confirmación de que no quedan
// movimientos sin subir, y la firma de conformidad de quien rinde.
export default function CierreLiquidacionModal({ repartidor, resumen, efectivoARendir, efectivoRecibido, guardando, error, onCancelar, onConfirmar, textos = TEXTOS_CIERRE_REPARTIDOR, motivos = MOTIVOS_LIQUIDACION_REPARTIDOR, valores, receptor }: {
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
  /** Cheques y retenciones a tildar uno por uno (sin decidir no cierra). */
  valores?: ValoresDePapel
  /** Quien recibe la rendición firma también (liquidación del repartidor). */
  receptor?: { nombre: string }
}) {
  const diferencia = efectivoRecibido - efectivoARendir
  const [motivo, setMotivo] = useState<MotivoDiferenciaLiquidacion | ''>('')
  const [nota, setNota] = useState('')
  const [firmante, setFirmante] = useState(repartidor)
  const [firmanteRecibe, setFirmanteRecibe] = useState(receptor?.nombre ?? '')
  const [confirmo, setConfirmo] = useState(false)
  const [falta, setFalta] = useState('')
  const [decisiones, setDecisiones] = useState<Decisiones>({})
  const firmaRef = useRef<SignaturePadHandle>(null)
  const firmaRecibeRef = useRef<SignaturePadHandle>(null)
  const hayValores = !!valores && (valores.cheques.length + valores.retenciones.length) > 0
  const decidir = (clave: string, d: DecisionValor) => setDecisiones((prev) => ({ ...prev, [clave]: d }))

  const confirmar = () => {
    setFalta('')
    if (diferencia !== 0 && !motivo) { setFalta('Elegí el motivo de la diferencia de efectivo.'); return }
    if (hayValores && valores) {
      const chk = decisionesCompletas(valores, decisiones)
      if (chk.faltanDecidir.length) { setFalta(`Falta tildar ${chk.faltanDecidir.length} cheque(s)/retención(es): marcá cada uno como recibido o no entregado.`); return }
      if (chk.sinMotivo.length) { setFalta('Poné el motivo de cada valor no entregado.'); return }
    }
    if (!confirmo) { setFalta(`Confirmá que no quedan movimientos sin subir${textos.sujeto === 'repartidor' ? ' en el teléfono del repartidor' : ''}.`); return }
    const firma = firmaRef.current?.toDataURL()
    if (!firma) { setFalta(`Falta la firma ${textos.sujeto === 'repartidor' ? 'del repartidor' : 'de quien cierra la caja'}.`); return }
    if (!firmante.trim()) { setFalta('Poné el nombre de quien firma.'); return }
    let firmaRecibe: string | undefined
    if (receptor) {
      firmaRecibe = firmaRecibeRef.current?.toDataURL() ?? undefined
      if (!firmaRecibe) { setFalta('Falta la firma de quien recibe la rendición.'); return }
      if (!firmanteRecibe.trim()) { setFalta('Poné el nombre de quien recibe.'); return }
    }
    const rendidos = valores ? aRendidos(valores, decisiones) : undefined
    onConfirmar({
      ...(diferencia !== 0 && motivo ? { diferencia: { motivo, nota: nota.trim() } } : {}),
      firma,
      firmante: firmante.trim(),
      confirmoSinPendientes: true,
      ...(receptor ? { firmaRecibe, firmanteRecibe: firmanteRecibe.trim() } : {}),
      ...(rendidos ? { cheques: rendidos.cheques, retenciones: rendidos.retenciones, valoresFaltantes: resumenValores(rendidos.cheques, rendidos.retenciones).faltantes } : {}),
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

        {hayValores && valores && (
          <div className="space-y-1.5">
            <p className="text-sm font-semibold text-gray-800">{textos.valores ?? 'Cheques y retenciones: tildá cada uno al recibirlo'}</p>
            <ValoresEnPapel cheques={valores.cheques} retenciones={valores.retenciones} decisiones={decisiones} onDecision={decidir} />
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

        {receptor && (
          <div>
            <p className="text-xs text-gray-500 mb-1">{textos.firmaRecibe ?? 'Firma de quien recibe la rendición'}</p>
            <div className="rounded-lg border border-[#D3D1C7] bg-white">
              <SignaturePad ref={firmaRecibeRef} />
            </div>
            <div className="mt-2 flex gap-2 items-center">
              <input value={firmanteRecibe} onChange={(e) => setFirmanteRecibe(e.target.value)} placeholder="Nombre de quien recibe" className={inputClass} />
              <button type="button" onClick={() => firmaRecibeRef.current?.clear()} className="text-xs text-gray-500 hover:text-gray-800 whitespace-nowrap">Borrar firma</button>
            </div>
          </div>
        )}

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
