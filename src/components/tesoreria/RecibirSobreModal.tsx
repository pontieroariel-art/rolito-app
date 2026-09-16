import { useMemo, useRef, useState } from 'react'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import Badge from '@/components/common/Badge'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import SignaturePad, { type SignaturePadHandle } from '@/components/heladeras/SignaturePad'
import ValoresEnPapel from '@/components/expedicion/ValoresEnPapel'
import { formatoARS, parseImporte } from '@/utils/money'
import { decisionesCompletas, type Decisiones, type DecisionValor } from '@/utils/valoresEnPapel'
import { claveDeCheque, claveDeRetencion, conformidadDe, diferenciaRecepcion } from '@/utils/sobres'
import type { DatosRecepcion } from '@/services/sobreService'
import { MOTIVOS_DIFERENCIA_LIQUIDACION, MOTIVOS_ENTREGA_TESORERIA, PLANTAS, type MotivoDiferenciaLiquidacion, type Sobre, type ValorRecibido } from '@/types'

// Recibir un sobre en tesorería (rendición de fondos, 2026-09-14). Tres pasos
// en el orden que impone el ARQUEO CIEGO: primero tesorería cuenta el efectivo
// (sin ninguna pista), después tilda cada cheque y retención que el sistema
// dice que tiene que venir, y recién ahí se REVELA sistema / declaró caja /
// contado por tesorería, por medio. Con diferencia, el motivo y la nota son
// obligatorios. Firma de quien recibe → `recibirSobre` (doble conformidad).

type Paso = 'efectivo' | 'valores' | 'revelacion'

export default function RecibirSobreModal({ sobre, firmante, guardando, error, onCancelar, onRecibir }: {
  sobre: Sobre
  /** Nombre de quien recibe, precargado. */
  firmante: string
  guardando: boolean
  error: string
  onCancelar: () => void
  onRecibir: (datos: DatosRecepcion) => void
}) {
  const { sistema } = sobre
  const hayValores = sistema.cheques.length + sistema.retenciones.length > 0
  const [paso, setPaso] = useState<Paso>('efectivo')
  const [efectivoStr, setEfectivoStr] = useState('')
  const [decisiones, setDecisiones] = useState<Decisiones>({})
  const [motivo, setMotivo] = useState<MotivoDiferenciaLiquidacion | ''>('')
  const [nota, setNota] = useState('')
  const [nombre, setNombre] = useState(firmante)
  const [falta, setFalta] = useState('')
  const firmaRef = useRef<SignaturePadHandle>(null)

  const efectivoContado = parseImporte(efectivoStr)
  const decidir = (clave: string, d: DecisionValor) => setDecisiones((prev) => ({ ...prev, [clave]: d }))

  // Lo tildado, en el formato que guarda el sobre.
  const valores = useMemo(() => {
    const aRecibido = (clave: string): ValorRecibido => {
      const d = decisiones[clave]
      return d && !d.recibido ? { clave, recibido: false, motivoNoRecibido: d.motivo } : { clave, recibido: true }
    }
    return {
      cheques:     sistema.cheques.map((c) => aRecibido(claveDeCheque(c))),
      retenciones: sistema.retenciones.map((r) => aRecibido(claveDeRetencion(r))),
    }
  }, [sistema, decisiones])

  const dif = useMemo(() => diferenciaRecepcion(sistema, { efectivoContado, ...valores }), [sistema, efectivoContado, valores])
  const conformidad = conformidadDe(dif)

  const irAValores = () => {
    setFalta('')
    if (efectivoStr.trim() === '') { setFalta('Contá el efectivo del sobre y escribí lo que hay.'); return }
    setPaso(hayValores ? 'valores' : 'revelacion')
  }
  const irARevelacion = () => {
    setFalta('')
    const chk = decisionesCompletas({ cheques: sistema.cheques, retenciones: sistema.retenciones }, decisiones)
    if (chk.faltanDecidir.length) { setFalta(`Falta tildar ${chk.faltanDecidir.length} valor(es): marcá cada uno como recibido o no recibido.`); return }
    if (chk.sinMotivo.length) { setFalta('Poné el motivo de cada valor no recibido.'); return }
    setPaso('revelacion')
  }
  const recibir = () => {
    setFalta('')
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
  const pasos: Paso[] = hayValores ? ['efectivo', 'valores', 'revelacion'] : ['efectivo', 'revelacion']
  const nPaso = pasos.indexOf(paso) + 1

  return (
    <Modal open onClose={onCancelar} title={`Recibir sobre ${sobre.codigo}`} wide>
      <div className="space-y-3">
        <p className="text-sm text-gray-700">
          {PLANTAS[sobre.plantaId].label} · {sobre.fecha} · rindió <b>{sobre.firmanteRinde}</b> a las {hora(sobre.cerradaEn.toDate())}
          <span className="text-secundario"> · paso {nPaso} de {pasos.length}</span>
        </p>

        {paso === 'efectivo' && (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-gray-900">Contá el efectivo</p>
            <p className="text-xs text-secundario">Arqueo ciego: el sistema no muestra cuánto tiene que haber hasta que escribas lo que contaste.</p>
            <input
              autoFocus inputMode="decimal" value={efectivoStr} onChange={(e) => setEfectivoStr(e.target.value)} placeholder="$ 0,00"
              className={`${inputClass} text-2xl font-bold tabular-nums h-14`}
              onKeyDown={(e) => { if (e.key === 'Enter') irAValores() }}
            />
            {efectivoStr.trim() !== '' && <p className="text-xs text-secundario tabular-nums">Se guarda {formatoARS(efectivoContado)}.</p>}
          </div>
        )}

        {paso === 'valores' && (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-gray-900">Cheques y retenciones del sobre: tildá cada uno</p>
            <p className="text-xs text-secundario">Lo que el sistema dice que tiene que venir. Un valor que no está lleva motivo.</p>
            <ValoresEnPapel cheques={sistema.cheques} retenciones={sistema.retenciones} decisiones={decisiones} onDecision={decidir} />
          </div>
        )}

        {paso === 'revelacion' && (
          <div className="space-y-3">
            <Revelacion sobre={sobre} efectivoContado={efectivoContado} valores={valores} />

            <div className={`flex flex-wrap items-center gap-2 rounded-lg border p-3 ${conformidad === 'conforme' ? 'border-[#AFD9C6] bg-[#F1F9F5]' : 'border-red-200 bg-red-50'}`}>
              <Badge tono={conformidad === 'conforme' ? 'entregado' : 'cancelado'} icono={conformidad === 'conforme' ? <ShieldCheck /> : undefined}>
                {conformidad === 'conforme' ? 'Conforme' : 'Con diferencia'}
              </Badge>
              <p className="text-sm text-gray-800">
                {conformidad === 'conforme'
                  ? 'Lo contado coincide con el sistema.'
                  : <>Diferencia de recepción: <b className={`tabular-nums ${dif.efectivo < 0 ? 'text-red-700' : 'text-amber-700'}`}>{formatoARS(dif.efectivo)}</b>{dif.valoresFaltantes.cantidad > 0 && <> · {dif.valoresFaltantes.cantidad} valor(es) no recibido(s) por <b className="tabular-nums">{formatoARS(dif.valoresFaltantes.total)}</b></>}</>}
              </p>
            </div>

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

            <div>
              <p className="text-xs text-secundario mb-1">Firma de quien recibe (tesorería)</p>
              <div className="rounded-lg border border-[#D3D1C7] bg-white"><SignaturePad ref={firmaRef} /></div>
              <div className="mt-2 flex gap-2 items-center">
                <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre de quien firma" className={inputClass} />
                <button type="button" onClick={() => firmaRef.current?.clear()} className="text-xs text-secundario hover:text-gray-800 whitespace-nowrap">Borrar firma</button>
              </div>
            </div>
            <p className="text-xs text-secundario">Al firmar, el sobre queda recibido a tu nombre, con las dos firmas, y la custodia de la plata pasa a tesorería. No se puede editar: una corrección es otro sobre.</p>
          </div>
        )}

        {(falta || error) && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2"><p className="text-red-600 text-sm">{falta || error}</p></div>
        )}

        <div className="flex gap-2 pt-1">
          {paso === 'efectivo'
            ? <Button variant="outline" type="button" onClick={onCancelar} className="flex-1" disabled={guardando}>Cancelar</Button>
            : <Button variant="outline" type="button" onClick={() => { setFalta(''); setPaso(paso === 'revelacion' && hayValores ? 'valores' : 'efectivo') }} className="flex-1" disabled={guardando}><ArrowLeft size={16} /> Atrás</Button>}
          {paso === 'efectivo' && <Button type="button" onClick={irAValores} className="flex-1">Siguiente</Button>}
          {paso === 'valores' && <Button type="button" onClick={irARevelacion} className="flex-1">Siguiente</Button>}
          {paso === 'revelacion' && <Button type="button" onClick={recibir} loading={guardando} className="flex-1"><ShieldCheck size={16} /> Recibir y firmar</Button>}
        </div>
      </div>
    </Modal>
  )
}

// ── Revelación: sistema / declaró caja / contado por tesorería, por medio ────

function Revelacion({ sobre, efectivoContado, valores }: { sobre: Sobre; efectivoContado: number; valores: { cheques: ValorRecibido[]; retenciones: ValorRecibido[] } }) {
  const { sistema, declarado, diferenciaDeclarada } = sobre
  const total = (xs: { importe: number }[]) => xs.reduce((s, x) => s + x.importe, 0)
  const conClaves = <T,>(xs: T[], claveDe: (x: T) => string, ok: Set<string>) => xs.filter((x) => ok.has(claveDe(x)))
  const presC = new Set(declarado.cheques.filter((v) => v.presente).map((v) => v.clave))
  const presR = new Set(declarado.retenciones.filter((v) => v.presente).map((v) => v.clave))
  const recC  = new Set(valores.cheques.filter((v) => v.recibido).map((v) => v.clave))
  const recR  = new Set(valores.retenciones.filter((v) => v.recibido).map((v) => v.clave))
  const decC = conClaves(sistema.cheques, claveDeCheque, presC), decR = conClaves(sistema.retenciones, claveDeRetencion, presR)
  const conC = conClaves(sistema.cheques, claveDeCheque, recC),  conR = conClaves(sistema.retenciones, claveDeRetencion, recR)

  const cant = (n: number, monto: number) => `${n} · ${formatoARS(monto)}`
  const filas: { medio: string; sistema: string; declaro: string; conte: string; dif: number }[] = [
    { medio: 'Efectivo', sistema: formatoARS(sistema.efectivo), declaro: formatoARS(declarado.efectivo), conte: formatoARS(efectivoContado), dif: Math.round((efectivoContado - sistema.efectivo) * 100) / 100 },
    ...(sistema.cheques.length ? [{ medio: 'Cheques', sistema: cant(sistema.cheques.length, total(sistema.cheques)), declaro: cant(decC.length, total(decC)), conte: cant(conC.length, total(conC)), dif: Math.round((total(conC) - total(sistema.cheques)) * 100) / 100 }] : []),
    ...(sistema.retenciones.length ? [{ medio: 'Retenciones', sistema: cant(sistema.retenciones.length, total(sistema.retenciones)), declaro: cant(decR.length, total(decR)), conte: cant(conR.length, total(conR)), dif: Math.round((total(conR) - total(sistema.retenciones)) * 100) / 100 }] : []),
  ]
  const th = 'text-left text-xs uppercase tracking-wide text-secundario font-semibold py-1.5 px-2 border-b border-[#D3D1C7]'
  const td = 'py-1.5 px-2 border-b border-[#E7E5DC] text-sm'
  const difCaja = diferenciaDeclarada.efectivo

  const pe = sistema.porEmpresa
  return (
    <div className="space-y-2">
      {pe && (
        <p className="text-xs text-secundario tabular-nums">Sistema por empresa: <span className="text-[#14538C] font-semibold">Redonhielo</span> {formatoARS(pe.redonhielo.efectivo)} · <span className="text-[#6B3F94] font-semibold">Rolito</span> {formatoARS(pe.rolito.efectivo)}</p>
      )}
      <p className="text-sm font-semibold text-gray-900">Sistema · declaró caja · contado por tesorería</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px]">
          <thead><tr>
            <th className={th}>Medio</th>
            <th className={`${th} text-right`}>Sistema</th>
            <th className={`${th} text-right`}>Declaró caja</th>
            <th className={`${th} text-right`}>Conté</th>
            <th className={`${th} text-right`}>Dif. de recepción</th>
          </tr></thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.medio}>
                <td className={`${td} text-gray-900`}>{f.medio}</td>
                <td className={`${td} text-right tabular-nums`}>{f.sistema}</td>
                <td className={`${td} text-right tabular-nums`}>{f.declaro}</td>
                <td className={`${td} text-right tabular-nums font-semibold`}>{f.conte}</td>
                <td className={`${td} text-right tabular-nums font-semibold ${f.dif === 0 ? 'text-[#0F6B4E]' : f.dif < 0 ? 'text-red-600' : 'text-amber-700'}`}>{f.dif === 0 ? '✓ 0' : formatoARS(f.dif)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-secundario">
        Diferencia de caja (lo que declaró contra el sistema): <b className={`tabular-nums ${difCaja === 0 ? 'text-[#0F6B4E]' : 'text-red-700'}`}>{formatoARS(difCaja)}</b>
        {diferenciaDeclarada.valoresFaltantes.cantidad > 0 && <> · {diferenciaDeclarada.valoresFaltantes.cantidad} valor(es) que caja marcó ausentes</>}
        {sobre.motivoDiferencia && <> · {MOTIVOS_DIFERENCIA_LIQUIDACION[sobre.motivoDiferencia.motivo]}{sobre.motivoDiferencia.nota ? `: ${sobre.motivoDiferencia.nota}` : ''}</>}
        . La diferencia de recepción se mide contra el sistema, no contra lo declarado: un faltante de caja no se absorbe.
      </p>
    </div>
  )
}

const hora = (d: Date) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
