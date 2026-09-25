import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import SignaturePad, { type SignaturePadHandle } from '@/components/common/SignaturePad'
import TablaConteoBilletes from '@/components/common/TablaConteoBilletes'
import { textoCheque } from '@/components/expedicion/SobresCaja'
import { TablaCheques } from '@/components/tesoreria/plata'
import { formatoARS } from '@/utils/money'
import { desgloseContado, desgloseVacio } from '@/utils/billetes'
import { claveDeCheque, claveDeRetencion, diferenciaDeclarada, hayDiferencia, valoresSinDecidir } from '@/utils/sobres'
import { MOTIVOS_CIERRE_MOSTRADOR, MOTIVOS_DIFERENCIA_LIQUIDACION, type DesgloseBilletes, type MotivoDiferenciaLiquidacion, type SobreDeclarado, type SobreSistema } from '@/types'

export interface DatosCierreTurnoModal {
  declarado:         SobreDeclarado
  motivoDiferencia?: { motivo: MotivoDiferenciaLiquidacion; nota: string }
  firmaRinde:        string
  firmanteRinde:     string
}

// Asistente de cierre del turno de caja con ARQUEO CIEGO (rendición de
// fondos, 2026-09-14). Cuatro pasos: (a) el cajero cuenta TODO el efectivo de
// la caja billete por billete, en una sola tabla (2026-09-16, Ariel: "la caja
// junta todo el efectivo en una caja"); (b) tilda uno por uno los cheques y
// retenciones que tiene en mano; (c) recién ahí se revela el sistema y la
// diferencia; (d) firma y rinde. El detalle por empresa se ve en Mi turno.
export default function CierreTurnoModal({ cajero, sistema, resumen, guardando, error, onCancelar, onConfirmar }: {
  cajero: string
  sistema: SobreSistema
  resumen: { ventas: number; cobranzas: number; liquidaciones: number }
  guardando: boolean
  error: string
  onCancelar: () => void
  onConfirmar: (datos: DatosCierreTurnoModal) => void
}) {
  // Solo los cheques se tildan (2026-09-24, pedido de Ariel): las retenciones
  // son certificados que ya quedaron registrados con el recibo, no se
  // confirman en el cierre. Van al sobre como presentes.
  const valores = useMemo(() => [
    ...sistema.cheques.map((ch) => ({ clave: claveDeCheque(ch), texto: textoCheque(ch), detalle: `acredita ${ch.fechaAcreditacion || '—'} · ${ch.clienteNombre}${ch.numeroRecibo ? ` · ${ch.numeroRecibo}` : ''}`, importe: ch.importe, empresa: ch.empresa, tipo: 'cheque' as const })),
  ], [sistema])
  const retencionesDeclaradas = useMemo(() => sistema.retenciones.map((re) => ({ clave: claveDeRetencion(re), presente: true })), [sistema])
  const hayValores = valores.length > 0
  const pasos = hayValores ? [1, 2, 3, 4] : [1, 3, 4]

  const [paso, setPaso] = useState<1 | 2 | 3 | 4>(1)
  const [conteo, setConteo] = useState<DesgloseBilletes>(desgloseVacio)
  const [presentes, setPresentes] = useState<Record<string, boolean>>({})
  // El motivo de cada cheque que NO se tiene (2026-09-24: el campo se tipeaba y no escribía porque no se guardaba).
  const [motivos, setMotivos] = useState<Record<string, string>>({})
  const [motivo, setMotivo] = useState<MotivoDiferenciaLiquidacion | ''>('')
  const [nota, setNota] = useState('')
  const [firmante, setFirmante] = useState(cajero)
  const [falta, setFalta] = useState('')
  const firmaRef = useRef<SignaturePadHandle>(null)

  const declarado: SobreDeclarado = useMemo(() => ({
    efectivo:       conteo.total,
    conteoBilletes: conteo,
    cheques:        sistema.cheques.map((ch) => { const k = claveDeCheque(ch); const presente = presentes[k] === true; return { clave: k, presente, ...(!presente && motivos[k]?.trim() ? { motivo: motivos[k].trim() } : {}) } }),
    retenciones:    retencionesDeclaradas,
  }), [conteo, presentes, motivos, sistema, retencionesDeclaradas])
  const diferencia = useMemo(() => diferenciaDeclarada(sistema, declarado), [sistema, declarado])
  const conDiferencia = hayDiferencia(diferencia)
  const faltantes = valores.filter((v) => presentes[v.clave] === false)

  const siguiente = () => {
    setFalta('')
    if (paso === 1) {
      if (!desgloseContado(conteo)) { setFalta('Contá el efectivo billete por billete. Si no hay nada, marcá "No hay efectivo en la caja".'); return }
      setPaso(hayValores ? 2 : 3); return
    }
    if (paso === 2) {
      const sinDecidir = valoresSinDecidir(sistema, [...valores.filter((v) => presentes[v.clave] !== undefined).map((v) => ({ clave: v.clave, presente: presentes[v.clave] })), ...retencionesDeclaradas])
      if (sinDecidir.length) { setFalta(`Falta decidir ${sinDecidir.length} cheque(s): marcá cada uno como "Lo tengo" o "No lo tengo".`); return }
      const sinMotivo = valores.filter((v) => presentes[v.clave] === false && !(motivos[v.clave] ?? '').trim())
      if (sinMotivo.length) { setFalta(`Escribí el motivo de ${sinMotivo.length === 1 ? 'el cheque que no tenés' : `los ${sinMotivo.length} cheques que no tenés`}.`); return }
      setPaso(3); return
    }
    if (paso === 3) {
      if (conDiferencia && !motivo) { setFalta('Hay diferencia: elegí el motivo.'); return }
      if (conDiferencia && !nota.trim()) { setFalta('Hay diferencia: escribí qué pasó.'); return }
      setPaso(4)
    }
  }
  const atras = () => { setFalta(''); setPaso((p) => (p === 4 ? 3 : p === 3 ? (hayValores ? 2 : 1) : 1)) }

  const confirmar = () => {
    setFalta('')
    const firma = firmaRef.current?.toDataURL()
    if (!firma) { setFalta('Falta tu firma.'); return }
    if (!firmante.trim()) { setFalta('Poné el nombre de quien firma.'); return }
    onConfirmar({
      declarado,
      ...(conDiferencia && motivo ? { motivoDiferencia: { motivo, nota: nota.trim() } } : {}),
      firmaRinde: firma,
      firmanteRinde: firmante.trim(),
    })
  }

  const inputClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'
  const indice = pasos.indexOf(paso) + 1
  const difClase = (n: number) => (n === 0 ? 'text-[#0F6B4E]' : n < 0 ? 'text-red-600' : 'text-amber-700')
  const signo = (n: number) => `${n > 0 ? '+' : ''}${formatoARS(n)}`

  return (
    <Modal open onClose={onCancelar} title="Cerrar liquidación" extraAncho>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 text-sm">
          <p className="text-gray-700"><b>{cajero}</b> · {resumen.ventas} {resumen.ventas === 1 ? 'venta' : 'ventas'} · {resumen.cobranzas} {resumen.cobranzas === 1 ? 'cobranza' : 'cobranzas'} · {resumen.liquidaciones} {resumen.liquidaciones === 1 ? 'liquidación recibida' : 'liquidaciones recibidas'}</p>
          <span className="text-xs text-secundario whitespace-nowrap tabular-nums">Paso {indice} de {pasos.length}</span>
        </div>

        {paso === 1 && (
          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-gray-900">Contá todo el efectivo de la caja</h3>
            <p className="text-sm text-secundario">Todo junto: lo tuyo y lo que recibiste de los choferes y cobradores, billete por billete. La app te dice cuánto tenía que haber recién después.</p>
            <TablaConteoBilletes empresa={null} valor={conteo} onChange={setConteo} titulo="Toda la caja" />
          </div>
        )}

        {paso === 2 && (
          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-gray-900">Cheques que van en el sobre, tildá cada uno</h3>
            <p className="text-sm text-secundario">Estos son los cheques que tendrías que tener en mano: de dónde salió cada uno, cuándo se paga y quién lo cobró.</p>
            {sistema.cheques.length > 0 && (
              <TablaCheques cheques={sistema.cheques} etiquetaSi="Lo tengo" etiquetaNo="No lo tengo"
                decisiones={Object.fromEntries(sistema.cheques.map((ch) => { const k = claveDeCheque(ch); const p = presentes[k]; return [k, p === undefined ? undefined : p ? { recibido: true } : { recibido: false, motivo: motivos[k] ?? '' }] }))}
                onDecision={(clave, d) => { setPresentes((p) => ({ ...p, [clave]: d.recibido })); if (!d.recibido) setMotivos((m) => ({ ...m, [clave]: d.motivo })) }} />
            )}
          </div>
        )}

        {paso === 3 && (
          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-gray-900">Sistema vs. lo que contaste</h3>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="rounded-lg bg-[#F8F7F2] p-3"><p className="text-xs text-secundario">A rendir (sistema)</p><p className="font-semibold tabular-nums text-lg">{formatoARS(sistema.efectivo)}</p></div>
              <div className="rounded-lg bg-[#F8F7F2] p-3"><p className="text-xs text-secundario">Contaste</p><p className="font-semibold tabular-nums text-lg">{formatoARS(declarado.efectivo)}</p></div>
              <div className={`rounded-lg p-3 ${diferencia.efectivo === 0 ? 'bg-[#E6F5EF]' : 'bg-red-50'}`}>
                <p className="text-xs text-secundario">Diferencia de caja</p>
                <p className={`font-semibold tabular-nums text-lg ${difClase(diferencia.efectivo)}`}>{signo(diferencia.efectivo)}</p>
              </div>
            </div>


            {sistema.detalle && (
              <p className="text-xs text-secundario tabular-nums">
                Fondo inicial {formatoARS(sistema.detalle.fondoInicial)} + ventas en efectivo {formatoARS(sistema.detalle.ventasEfectivo)} + cobranzas en efectivo {formatoARS(sistema.detalle.cobranzasEfectivo)} + recibido de choferes {formatoARS(sistema.detalle.recibidoDeLiquidaciones)}{sistema.detalle.anticipos ? ` − anticipos a tesorería ${formatoARS(sistema.detalle.anticipos)}` : ''}
              </p>
            )}
            {sistema.porEmpresa && diferencia.efectivo === 0 && (
              <p className="text-sm text-[#0F6B4E] tabular-nums">Cuadra. Armá dos fajos: <b>Redonhielo {formatoARS(sistema.porEmpresa.redonhielo.efectivo)}</b> y <b>Rolito {formatoARS(sistema.porEmpresa.rolito.efectivo)}</b>.</p>
            )}
            {hayValores && (
              <div className={`rounded-lg border p-3 text-sm ${faltantes.length ? 'border-red-200 bg-red-50' : 'border-[#B3DDD3] bg-[#E6F5EF]/40'}`}>
                {faltantes.length === 0
                  ? <p className="inline-flex items-center gap-1.5 text-[#0F6B4E] font-medium"><CheckCircle2 size={16} /> Los {valores.length} valores en papel están en mano.</p>
                  : (
                    <div className="space-y-1">
                      <p className="inline-flex items-center gap-1.5 text-red-700 font-semibold"><AlertTriangle size={16} /> Faltan {faltantes.length} de {valores.length} valores ({formatoARS(diferencia.valoresFaltantes.total)}):</p>
                      <ul className="text-red-800 space-y-0.5">
                        {faltantes.map((v) => <li key={v.clave} className="flex justify-between gap-3"><span className="truncate" title={`${v.texto} · ${v.detalle}`}>{v.texto} · {v.detalle}</span><b className="tabular-nums shrink-0">{formatoARS(v.importe)}</b></li>)}
                      </ul>
                    </div>
                  )}
              </div>
            )}
            {conDiferencia && (
              <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-sm font-semibold text-red-700">Hay diferencia. ¿Por qué?</p>
                <select value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoDiferenciaLiquidacion)} className={inputClass}>
                  <option value="">Elegir motivo…</option>
                  {MOTIVOS_CIERRE_MOSTRADOR.map((m) => <option key={m} value={m}>{MOTIVOS_DIFERENCIA_LIQUIDACION[m]}</option>)}
                </select>
                <textarea value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Qué pasó, con quién se habló… (obligatorio)" rows={2} className={inputClass} />
              </div>
            )}
          </div>
        )}

        {paso === 4 && (
          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-gray-900">Firmar y rendir</h3>
            <p className="text-sm text-gray-700">
              Rendís <b className="tabular-nums">{formatoARS(declarado.efectivo)}</b> en efectivo
              {hayValores ? <> y <b>{valores.length - faltantes.length}</b> de {valores.length} valores en papel</> : null}
              {conDiferencia ? <span className="text-red-700"> con una diferencia declarada</span> : null}. Cerrar el turno es entregar el sobre: tesorería lo ve al instante y lo cuenta.
            </p>
            <div>
              <p className="text-xs text-secundario mb-1">Firma de quien rinde</p>
              <div className="rounded-lg border border-[#D3D1C7] bg-white"><SignaturePad ref={firmaRef} /></div>
              <div className="mt-2 flex gap-2 items-center">
                <input value={firmante} onChange={(e) => setFirmante(e.target.value)} placeholder="Nombre de quien firma" className={inputClass} />
                <button type="button" onClick={() => firmaRef.current?.clear()} className="text-xs text-secundario hover:text-gray-800 whitespace-nowrap">Borrar firma</button>
              </div>
            </div>
            <p className="text-xs text-secundario">Al firmar se guarda el sobre (no se puede editar), el turno queda cerrado y se abre el acta.</p>
          </div>
        )}

        {(falta || error) && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2"><p className="text-red-600 text-sm">{falta || error}</p></div>
        )}
        <div className="flex gap-2 pt-1">
          {paso === 1
            ? <Button variant="outline" type="button" onClick={onCancelar} className="flex-1" disabled={guardando}>Cancelar</Button>
            : <Button variant="outline" type="button" onClick={atras} className="flex-1" disabled={guardando}>Atrás</Button>}
          {paso === 4
            ? <Button onClick={confirmar} loading={guardando} className="flex-1">Firmar y rendir</Button>
            : <Button onClick={siguiente} className="flex-1">Siguiente</Button>}
        </div>
      </div>
    </Modal>
  )
}
