import { useMemo, useRef, useState } from 'react'
import { FileText, ShieldCheck } from 'lucide-react'
import Badge from '@/components/common/Badge'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import SignaturePad, { type SignaturePadHandle } from '@/components/heladeras/SignaturePad'
import TablaConteoBilletes from '@/components/common/TablaConteoBilletes'
import { NOMBRE_EMPRESA, TEXTO_EMPRESA, TablaCheques, type DecisionCheque } from '@/components/tesoreria/plata'
import LiquidacionComoCaja from '@/components/tesoreria/LiquidacionComoCaja'
import { formatoARS } from '@/utils/money'
import { desgloseContado, desgloseVacio } from '@/utils/billetes'
import { claveDeCheque, claveDeRetencion, conformidadDe, diferenciaRecepcion, empresaDeAnticipo, esAnticipo } from '@/utils/sobres'
import type { DatosRecepcion } from '@/services/sobreService'
import { MOTIVOS_DIFERENCIA_LIQUIDACION, MOTIVOS_ENTREGA_TESORERIA, PLANTAS, type DesgloseBilletes, type MotivoDiferenciaLiquidacion, type Sobre, type ValorRecibido } from '@/types'

// Recibir un sobre en tesorería. Rediseño del 2026-09-23 (maqueta aprobada por
// Ariel): una sola pantalla. Arriba, los MISMOS renglones que vio el cajero,
// abiertos en Redonhielo y Rolito; después los cheques con quién los cobró;
// y abajo se cuenta FAJO POR FAJO. La app dice al instante si cada fajo
// cuadra. Solo si no cuadra pide contar ese fajo billete por billete y un
// motivo antes de firmar. Un anticipo se cuenta con un solo fajo.

const hora = (d: Date) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
const r2 = (n: number) => Math.round(n * 100) / 100

export default function RecibirSobreModal({ sobre, anticipos = [], firmante, guardando, error, onCancelar, onRecibir, onActa }: {
  sobre: Sobre
  /** Los anticipos del mismo turno, para que la tabla de conceptos los muestre (ya salieron del cajón). */
  anticipos?: Sobre[]
  /** Nombre de quien recibe, precargado. */
  firmante: string
  guardando: boolean
  error: string
  onCancelar: () => void
  onRecibir: (datos: DatosRecepcion) => void
  /** Abre el acta de caja en el visor: el mismo PDF que vio el cajero al cerrar (2026-09-24). */
  onActa?: () => void
}) {
  const { sistema } = sobre
  const anticipo = esAnticipo(sobre)
  // Un solo conteo (2026-09-24, pedido de Ariel): caja junta todo el efectivo en
  // un sobre y la liquidación ya dice de dónde viene cada peso; tesorería cuenta
  // el total y listo. Si no cuadra, lo cuenta billete por billete.
  // Directamente la tabla de billetes (pedido de Ariel): tesorería va poniendo
  // las cantidades y el total sale solo.
  const esperadoTotal = sistema.efectivo
  const [billetes, setBilletes] = useState<DesgloseBilletes>(desgloseVacio())
  const [decisiones, setDecisiones] = useState<Record<string, DecisionCheque | undefined>>({})
  const [motivo, setMotivo] = useState<MotivoDiferenciaLiquidacion | ''>('')
  const [nota, setNota] = useState('')
  const [nombre, setNombre] = useState(firmante)
  const [falta, setFalta] = useState('')
  const firmaRef = useRef<SignaturePadHandle>(null)

  const efectivoContado = r2(billetes.total)
  const contoTodo = desgloseContado(billetes)
  const cuadra = contoTodo && r2(efectivoContado - esperadoTotal) === 0

  const valores = useMemo(() => {
    const aRecibido = (clave: string): ValorRecibido => {
      const d = decisiones[clave]
      return d && !d.recibido ? { clave, recibido: false, motivoNoRecibido: d.motivo } : { clave, recibido: true }
    }
    // Las retenciones no se tildan (2026-09-24, Ariel: van por otro lado): quedan como recibidas.
    return { cheques: sistema.cheques.map((c) => aRecibido(claveDeCheque(c))), retenciones: sistema.retenciones.map((r) => ({ clave: claveDeRetencion(r), recibido: true })) }
  }, [sistema, decisiones])
  const dif = useMemo(() => diferenciaRecepcion(sistema, { efectivoContado, ...valores }), [sistema, efectivoContado, valores])
  const conformidad = contoTodo ? conformidadDe(dif) : null
  const decidir = (clave: string, d: DecisionCheque) => setDecisiones((prev) => ({ ...prev, [clave]: d }))

  const recibir = () => {
    setFalta('')
    if (!contoTodo) { setFalta('Contá el efectivo billete por billete. Si no hay nada, marcá "No hay efectivo".'); return }
    const claves = sistema.cheques.map(claveDeCheque)
    const sinDecidir = claves.filter((k) => !decisiones[k])
    if (sinDecidir.length) { setFalta(`Falta tildar ${sinDecidir.length} cheque(s): marcá cada uno como recibido o no vino.`); return }
    const sinMotivo = claves.filter((k) => { const d = decisiones[k]; return d && !d.recibido && !d.motivo.trim() })
    if (sinMotivo.length) { setFalta('Poné el motivo de cada cheque que no vino.'); return }
    if (conformidad === 'con_diferencia') {
      if (!motivo) { setFalta('Hay diferencia: elegí el motivo.'); return }
      if (!nota.trim()) { setFalta('Hay diferencia: escribí una nota con qué pasó.'); return }
    }
    const firma = firmaRef.current?.toDataURL()
    if (!firma) { setFalta('Falta la firma de quien recibe.'); return }
    if (!nombre.trim()) { setFalta('Poné el nombre de quien firma.'); return }
    onRecibir({
      efectivoContado,
      ...valores,
      ...(conformidad === 'con_diferencia' && motivo ? { motivo, nota: nota.trim() } : {}),
      firmaRecibe: firma,
      firmanteRecibe: nombre.trim(),
    })
  }

  const inputClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'
  const hayValores = sistema.cheques.length > 0

  return (
    <Modal open onClose={onCancelar} title={anticipo ? `Contar y validar el anticipo ${sobre.codigo}` : `Contar y validar la liquidación ${sobre.codigo}`} extraAncho variant="light">
      <div className="space-y-4">
        <p className="text-sm text-gray-700">
          {PLANTAS[sobre.plantaId].label} · {sobre.fecha} · {anticipo ? 'lo entregó' : 'rindió'} <b>{sobre.firmanteRinde}</b> a las {hora(sobre.cerradaEn.toDate())}
          {anticipo && sobre.entrega ? <> · lo recibió <b>{sobre.entrega.recibio.nombre}</b> (firmó en la tablet del cajero)</> : null}
        </p>
        {onActa && !anticipo && (
          <Button variant="outline" onClick={onActa}><FileText size={16} className="mr-1.5" /> Ver el acta de caja, tal cual la cerró</Button>
        )}

        {/* La misma liquidación que vio el cajero (2026-09-24): tarjetas y bloques iguales, en lectura. */}
        {!anticipo && (
          <div className="space-y-2">
            <LiquidacionComoCaja sobre={sobre} anticipos={anticipos} />
            <p className="text-xs text-secundario tabular-nums">El cajero contó <b>{formatoARS(sobre.declarado.efectivo)}</b> en total{sobre.diferenciaDeclarada.efectivo === 0 ? ', sin diferencia.' : <>, con una diferencia de <b className="text-red-700">{formatoARS(sobre.diferenciaDeclarada.efectivo)}</b>{sobre.motivoDiferencia ? ` (${MOTIVOS_DIFERENCIA_LIQUIDACION[sobre.motivoDiferencia.motivo]}${sobre.motivoDiferencia.nota ? `: ${sobre.motivoDiferencia.nota}` : ''})` : ''}.</>}</p>
          </div>
        )}
        {anticipo && (
          <section className="rounded-xl border border-[#D3D1C7] bg-white p-3">
            <p className="text-sm text-gray-800">Anticipo de <b className="tabular-nums">{formatoARS(sistema.efectivo)}</b> de <b className={TEXTO_EMPRESA[empresaDeAnticipo(sobre)]}>{NOMBRE_EMPRESA[empresaDeAnticipo(sobre)]}</b>, entregado antes del cierre del turno. Contalo y confirmá.</p>
          </section>
        )}

        {hayValores && (
          <section className="rounded-xl border border-[#D3D1C7] bg-white p-3 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-secundario">Cheques entregados, tildá cada uno</h3>
            <TablaCheques cheques={sistema.cheques} decisiones={decisiones} onDecision={decidir} />
          </section>
        )}

        {/* Contar, fajo por fajo. */}
        <section className="rounded-xl border border-[#D3D1C7] bg-white p-3 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-secundario">Efectivo recibido</h3>
          <TablaConteoBilletes empresa={null} valor={billetes} onChange={setBilletes} />
          <div className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${contoTodo ? (cuadra ? 'border-[#B3DDD3] bg-[#F1F9F5]' : 'border-red-200 bg-red-50') : 'border-[#D3D1C7]'}`}>
            <span className="text-sm font-bold text-gray-900">Total recibido</span>
            <span className="text-xl font-bold tabular-nums">{formatoARS(efectivoContado)}</span>
            <span className={`text-right text-xs font-semibold ${contoTodo ? (cuadra ? 'text-[#0F6B4E]' : 'text-red-700') : 'text-secundario'}`}>
              {contoTodo ? (cuadra ? 'cuadra' : `${efectivoContado - esperadoTotal > 0 ? '+' : ''}${formatoARS(r2(efectivoContado - esperadoTotal))}`) : `esperado ${formatoARS(esperadoTotal)}`}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm pt-1">
            <div className="rounded-lg bg-[#F8F7F2] px-3 py-2"><p className="text-xs text-secundario">{anticipo ? 'Entregado' : 'Declaró caja'}</p><p className="font-semibold tabular-nums">{formatoARS(sobre.declarado.efectivo)}</p></div>
            <div className={`rounded-lg px-3 py-2 ${!contoTodo ? 'bg-[#F8F7F2]' : dif.efectivo === 0 ? 'bg-[#E6F5EF]' : 'bg-red-50'}`}><p className="text-xs text-secundario">Diferencia</p><p className={`font-semibold tabular-nums ${!contoTodo ? 'text-secundario' : dif.efectivo === 0 ? 'text-[#0F6B4E]' : 'text-red-700'}`}>{contoTodo ? `${dif.efectivo > 0 ? '+' : ''}${formatoARS(dif.efectivo)}` : '—'}</p></div>
          </div>
          {conformidad && (
            <div className={`flex flex-wrap items-center gap-2 rounded-lg border p-2.5 ${conformidad === 'conforme' ? 'border-[#AFD9C6] bg-[#F1F9F5]' : 'border-red-200 bg-red-50'}`}>
              <Badge tono={conformidad === 'conforme' ? 'entregado' : 'cancelado'} icono={conformidad === 'conforme' ? <ShieldCheck /> : undefined}>{conformidad === 'conforme' ? 'Conforme' : 'Con diferencia'}</Badge>
              <p className="text-sm text-gray-800">
                {conformidad === 'conforme' ? 'Lo contado coincide con el sistema.' : <>Diferencia: <b className={`tabular-nums ${dif.efectivo < 0 ? 'text-red-700' : 'text-amber-700'}`}>{formatoARS(dif.efectivo)}</b>{dif.valoresFaltantes.cantidad > 0 && <> · {dif.valoresFaltantes.cantidad} valor(es) que no vinieron por <b className="tabular-nums">{formatoARS(dif.valoresFaltantes.total)}</b></>}.</>}
              </p>
            </div>
          )}
          {conformidad === 'con_diferencia' && (
            <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-sm font-semibold text-red-700">¿Por qué hay diferencia? Motivo y nota obligatorios.</p>
              <select value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoDiferenciaLiquidacion)} className={inputClass}>
                <option value="">Elegir motivo…</option>
                {MOTIVOS_ENTREGA_TESORERIA.map((m) => <option key={m} value={m}>{MOTIVOS_DIFERENCIA_LIQUIDACION[m]}</option>)}
              </select>
              <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} className={inputClass} placeholder="Qué pasó, con quién se habló, qué se va a revisar…" />
            </div>
          )}
        </section>

        <div>
          <p className="text-xs text-secundario mb-1">Firma de quien contó y validó (tesorería)</p>
          <div className="rounded-lg border border-[#D3D1C7] bg-white"><SignaturePad ref={firmaRef} /></div>
          <div className="mt-2 flex gap-2 items-center">
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre de quien firma" className={inputClass} />
            <button type="button" onClick={() => firmaRef.current?.clear()} className="text-xs text-secundario hover:text-gray-800 whitespace-nowrap">Borrar firma</button>
          </div>
        </div>

        {(falta || error) && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2"><p className="text-red-600 text-sm">{falta || error}</p></div>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="outline" type="button" onClick={onCancelar} className="flex-1" disabled={guardando}>Cancelar</Button>
          <Button type="button" onClick={recibir} loading={guardando} className="flex-1"><ShieldCheck size={16} /> {conformidad === 'con_diferencia' ? (anticipo ? 'Validar el anticipo con diferencia' : 'Validar la liquidación con diferencia') : anticipo ? 'Validar el anticipo, conforme' : 'Validar la liquidación, conforme'}</Button>
        </div>
      </div>
    </Modal>
  )
}
