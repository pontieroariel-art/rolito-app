import { useEffect, useMemo, useState } from 'react'
import { Landmark, Printer, Share2, ShieldCheck } from 'lucide-react'
import { Timestamp } from 'firebase/firestore'
import Button from '@/components/ui/Button'
import { useAuth } from '@/context/AuthContext'
import { useDiaActual } from '@/hooks/useDiaActual'
import { confirmarEntrega, subscribeEntregasEnRango, subscribeEntregasPorConfirmar } from '@/services/entregaTesoreriaService'
import { reportError } from '@/services/observability'
import { addDaysStr } from '@/utils/helpers'
import { formatoARS } from '@/utils/money'
import { tieneAlgunRol } from '@/utils/roles'
import { generateActaEntrega, nombreArchivoActa } from '@/utils/entregaPdf'
import { compartirArchivo, puedeCompartirArchivos } from '@/utils/compartir'
import ValoresEnPapel from '@/components/expedicion/ValoresEnPapel'
import { Plegable } from '@/components/ui/Plegable'
import CierreLiquidacionModal, { type DatosCierre, type TextosCierre } from '@/components/expedicion/liquidacion/CierreLiquidacionModal'
import { MOTIVOS_DIFERENCIA_LIQUIDACION, MOTIVOS_ENTREGA_TESORERIA, PLANTAS, type EntregaTesoreria } from '@/types'
import { TH as th, TD as td } from '@/components/common/tabla'

const TEXTOS_CONFIRMAR: TextosCierre = {
  titulo: 'Confirmar entrega', sujeto: 'tesorería', aRendir: 'Entregado por caja', recibido: 'Contado en tesorería',
  confirmacion: <>Conté el efectivo y revisé <b>cada cheque y retención</b> de esta entrega.</>,
  firma: 'Firma de quien recibe (tesorería)',
  boton: 'Confirmar y firmar',
  pie: 'Al confirmar, el acta queda con las dos firmas y no se puede editar. Lo que falte queda registrado con su motivo.',
  valores: 'Cheques y retenciones de la entrega: tildá cada uno que recibiste',
}

// Entregas de caja para tesorería (2026-09-09): las que caja firmó y todavía
// no se contaron ("Por confirmar") y las confirmadas del mes. Confirmar =
// contar el efectivo, tildar cada valor, firmar → acta con dos firmas.
export default function EntregasTesoreriaPage() {
  const { user } = useAuth()
  const hoy = useDiaActual()
  const [porConfirmar, setPorConfirmar] = useState<EntregaTesoreria[]>([])
  const [delMes, setDelMes] = useState<EntregaTesoreria[]>([])
  const [contados, setContados] = useState<Record<string, string>>({})
  const [confirmando, setConfirmando] = useState<EntregaTesoreria | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')

  useEffect(() => subscribeEntregasPorConfirmar(setPorConfirmar), [])
  useEffect(() => subscribeEntregasEnRango(`${hoy.slice(0, 7)}-01`, addDaysStr(hoy, 1), setDelMes), [hoy])

  const pendientes = useMemo(() => porConfirmar.slice().sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis()), [porConfirmar])
  const confirmadas = useMemo(() => delMes.filter((e) => e.estado === 'confirmada').sort((a, b) => (b.confirmadaEn?.toMillis() ?? 0) - (a.confirmadaEn?.toMillis() ?? 0)), [delMes])
  const puedeConfirmar = tieneAlgunRol(user, ['tesoreria', 'super_admin', 'logistica'])
  const contadoDe = (e: EntregaTesoreria) => parseInt((contados[e.id] ?? '').replace(/\D/g, ''), 10) || 0

  const imprimir = (e: EntregaTesoreria) => generateActaEntrega(e).catch((err) => reportError(err, { origen: 'EntregasTesoreriaPage', accion: 'error al generar el acta' }))
  const enviar = async (e: EntregaTesoreria) => {
    setAviso('')
    try {
      const blob = (await generateActaEntrega(e, { descargar: false })) as Blob
      const res = await compartirArchivo(blob, nombreArchivoActa(e), { titulo: `Entrega a tesorería ${e.codigo}`, texto: `Acta de entrega ${e.codigo} del ${e.fecha}` })
      if (res === 'descargado') setAviso('Este dispositivo no puede compartir archivos: se descargó el acta.')
    } catch (err) {
      reportError(err, { origen: 'EntregasTesoreriaPage', accion: 'error al enviar el acta' })
      setAviso('No se pudo generar el acta.')
    }
  }

  const confirmar = async (datos: DatosCierre) => {
    if (!user || !confirmando) return
    const e = confirmando
    const contado = contadoDe(e)
    setGuardando(true); setError('')
    try {
      await confirmarEntrega(e.id, {
        firmaRecibe: datos.firma, firmanteRecibe: datos.firmante,
        efectivoContado: contado, diferenciaEfectivo: contado - e.efectivoEntregado,
        ...(datos.diferencia ? { diferencia: datos.diferencia } : {}),
        cheques: datos.cheques ?? e.cheques.map((c) => ({ ...c, recibido: true })),
        retenciones: datos.retenciones ?? e.retenciones.map((r) => ({ ...r, recibido: true })),
        valoresFaltantes: datos.valoresFaltantes ?? { cantidad: 0, total: 0 },
      }, { uid: user.uid, nombre: user.nombre })
      setConfirmando(null)
      imprimir({ ...e, estado: 'confirmada', firmaRecibe: datos.firma, firmanteRecibe: datos.firmante, efectivoContado: contado, diferenciaEfectivo: contado - e.efectivoEntregado, diferencia: datos.diferencia, cheques: datos.cheques ?? e.cheques, retenciones: datos.retenciones ?? e.retenciones, valoresFaltantes: datos.valoresFaltantes, recibidoPor: { uid: user.uid, nombre: user.nombre }, confirmadaEn: Timestamp.now() })
    } catch (err) {
      reportError(err, { origen: 'EntregasTesoreriaPage', accion: 'error al confirmar' })
      setError('No se pudo confirmar. ¿Ya estaba confirmada?')
    } finally {
      setGuardando(false)
    }
  }

  const inputClass = 'bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'
  const btn = 'inline-flex items-center gap-1 rounded-lg border border-[#D3D1C7] bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-accent hover:text-accent'
  const dif = (n: number) => <span className={`tabular-nums font-semibold ${n === 0 ? 'text-gray-500' : n < 0 ? 'text-red-600' : 'text-amber-700'}`}>{formatoARS(n)}</span>
  const compartible = puedeCompartirArchivos()

  return (
    <main className="max-w-6xl mx-auto p-4 space-y-4 pb-10">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Landmark size={22} className="text-accent" /> Entregas de caja</h1>
        <p className="text-gray-500 text-sm">Lo que las ventanillas entregan a tesorería. Se cuenta, se tilda cada valor y se firma: el acta queda con las dos firmas.</p>
      </div>
      {aviso && <p className="text-xs text-amber-700">{aviso}</p>}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Por confirmar ({pendientes.length})</h2>
        {pendientes.length === 0 && <p className="text-sm text-gray-500 bg-white rounded-2xl border border-[#D3D1C7] shadow-sm px-4 py-3">No hay entregas esperando.</p>}
        {pendientes.map((e) => {
          const nValores = e.cheques.length + e.retenciones.length
          const contadoStr = contados[e.id] ?? ''
          const d = contadoStr.trim() === '' ? null : contadoDe(e) - e.efectivoEntregado
          return (
            <div key={e.id} className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-gray-800"><b className="text-base">{e.codigo}</b> · {PLANTAS[e.plantaId].label} · {e.fecha} · entregó <b>{e.firmanteEntrega}</b> a las {e.createdAt.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</p>
                <span className="flex gap-2">
                  <button type="button" onClick={() => imprimir(e)} className={btn}><Printer size={12} /> Acta</button>
                  <button type="button" onClick={() => enviar(e)} className={btn}><Share2 size={12} /> {compartible ? 'Enviar' : 'Descargar'}</button>
                </span>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 text-sm">
                <div className="rounded-lg bg-gray-50 p-2"><p className="text-xs text-gray-500">Teórico (caja)</p><p className="font-semibold tabular-nums">{formatoARS(e.efectivo.teorico)}</p><p className="text-[11px] text-gray-500">{formatoARS(e.efectivo.cierresCaja)} cierres · {formatoARS(e.efectivo.liquidacionesSueltas)} sueltas</p></div>
                <div className="rounded-lg bg-gray-50 p-2"><p className="text-xs text-gray-500">Entregado por caja</p><p className="font-semibold tabular-nums">{formatoARS(e.efectivoEntregado)}</p>{e.diferenciaEntrega && <p className="text-[11px] text-red-700">{MOTIVOS_DIFERENCIA_LIQUIDACION[e.diferenciaEntrega.motivo]}{e.diferenciaEntrega.nota ? ` · ${e.diferenciaEntrega.nota}` : ''}</p>}</div>
                <div className="rounded-lg bg-gray-50 p-2"><p className="text-xs text-gray-500">Valores en papel</p><p className="font-semibold tabular-nums">{nValores}</p><p className="text-[11px] text-gray-500">{e.cheques.length} cheques · {e.retenciones.length} retenciones</p></div>
                <div className="rounded-lg bg-gray-50 p-2">
                  <p className="text-xs text-gray-500">Efectivo contado</p>
                  <input inputMode="numeric" value={contadoStr} onChange={(ev) => setContados((prev) => ({ ...prev, [e.id]: ev.target.value }))} placeholder="$" className={`${inputClass} w-full mt-1 font-semibold tabular-nums`} disabled={!puedeConfirmar} />
                </div>
                <div className={`rounded-lg p-2 ${d === null ? 'bg-gray-50' : d === 0 ? 'bg-[#E6F5EF]' : 'bg-red-50'}`}><p className="text-xs text-gray-500">Diferencia</p><p className={`font-semibold tabular-nums ${d === null ? 'text-gray-400' : d === 0 ? 'text-[#0F6B4E]' : 'text-red-600'}`}>{d === null ? '—' : `${formatoARS(d)}${d === 0 ? ' ✓' : ''}`}</p></div>
              </div>

              <Plegable titulo={`De dónde sale (${e.rendiciones.length} cierres · ${e.liquidaciones.length} liquidaciones)`}>
                <ul className="text-sm text-gray-700 grid sm:grid-cols-2 gap-x-6">
                  {e.rendiciones.map((r) => <li key={r.id} className="flex justify-between border-b border-gray-100 py-1"><span>Cierre <b>{r.codigo}</b> · {r.sujetoNombre} · {r.fecha}</span><b className="tabular-nums">{formatoARS(r.efectivoContado)}</b></li>)}
                  {e.liquidaciones.map((l) => <li key={l.id} className="flex justify-between border-b border-gray-100 py-1"><span>Liquidación <b>{l.codigo ?? '—'}</b> · {l.choferNombre} · {l.fecha}{l.incluidaEnCierre ? <span className="text-gray-400"> · en un cierre</span> : null}</span><b className={`tabular-nums ${l.incluidaEnCierre ? 'text-gray-400 line-through' : ''}`}>{formatoARS(l.efectivoRecibido)}</b></li>)}
                </ul>
              </Plegable>

              {nValores > 0 && (
                <Plegable titulo={`Valores en papel (${nValores})`}>
                  <p className="text-xs text-gray-500 mb-2">Se tildan uno por uno al confirmar.</p>
                  <ValoresEnPapel cheques={e.cheques} retenciones={e.retenciones} soloLectura />
                </Plegable>
              )}

              {puedeConfirmar && (
                <div className="flex flex-wrap justify-end gap-2">
                  {error && confirmando?.id === e.id && <p className="w-full text-sm text-red-600">{error}</p>}
                  <Button onClick={() => { setError(''); setConfirmando(e) }} disabled={contadoStr.trim() === ''}><ShieldCheck size={16} className="mr-1.5" /> Confirmar y firmar</Button>
                  {contadoStr.trim() === '' && <p className="w-full text-right text-xs text-gray-500">Cargá el efectivo contado para poder confirmar.</p>}
                </div>
              )}
            </div>
          )
        })}
      </section>

      <Plegable titulo={`Confirmadas este mes (${confirmadas.length})`} abiertoInicial={pendientes.length === 0}>
        <table className="w-full min-w-[820px]">
          <thead><tr>{['Código', 'Fecha', 'Planta', 'Entregó', 'Entregado', 'Contado', 'Diferencia', 'Valores no recibidos', 'Confirmó', 'Acta'].map((h, i) => <th key={h} className={`${th} ${i >= 4 && i <= 7 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
          <tbody>
            {confirmadas.map((e) => (
              <tr key={e.id}>
                <td className={`${td} font-medium`}>{e.codigo}</td>
                <td className={td}>{e.fecha}</td>
                <td className={td}>{PLANTAS[e.plantaId].label.replace('Planta ', '')}</td>
                <td className={td}>{e.firmanteEntrega}</td>
                <td className={`${td} text-right tabular-nums`}>{formatoARS(e.efectivoEntregado)}</td>
                <td className={`${td} text-right tabular-nums`}>{formatoARS(e.efectivoContado ?? 0)}</td>
                <td className={`${td} text-right`}>{dif(e.diferenciaEfectivo ?? 0)}{e.diferencia ? <span className="block text-[11px] text-gray-500">{MOTIVOS_DIFERENCIA_LIQUIDACION[e.diferencia.motivo]}</span> : null}</td>
                <td className={`${td} text-right tabular-nums`}>{e.valoresFaltantes?.cantidad ? <span className="text-red-600 font-semibold">{e.valoresFaltantes.cantidad} · {formatoARS(e.valoresFaltantes.total)}</span> : '—'}</td>
                <td className={`${td} text-xs text-[#0F6B4E]`}><span className="inline-flex items-center gap-1"><ShieldCheck size={13} /> {e.firmanteRecibe ?? e.recibidoPor?.nombre}</span>{e.confirmadaEn ? <span className="block text-gray-500">{e.confirmadaEn.toDate().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span> : null}</td>
                <td className={td}><span className="flex gap-1"><button type="button" onClick={() => imprimir(e)} className={btn} title="Ver acta"><Printer size={12} /></button><button type="button" onClick={() => enviar(e)} className={btn} title="Enviar acta"><Share2 size={12} /></button></span></td>
              </tr>
            ))}
            {confirmadas.length === 0 && <tr><td className={`${td} text-gray-500`} colSpan={10}>Sin entregas confirmadas este mes.</td></tr>}
          </tbody>
        </table>
      </Plegable>

      {confirmando && user && (
        <CierreLiquidacionModal
          repartidor={user.nombre}
          resumen={{ ventas: 0, clientes: 0, cobranzas: 0 }}
          resumenTexto={<>{confirmando.codigo} · {PLANTAS[confirmando.plantaId].label} · entregó {confirmando.firmanteEntrega}</>}
          efectivoARendir={confirmando.efectivoEntregado}
          efectivoRecibido={contadoDe(confirmando)}
          guardando={guardando}
          error={error}
          onCancelar={() => setConfirmando(null)}
          onConfirmar={confirmar}
          textos={TEXTOS_CONFIRMAR}
          motivos={MOTIVOS_ENTREGA_TESORERIA}
          valores={{ cheques: confirmando.cheques, retenciones: confirmando.retenciones }}
        />
      )}
    </main>
  )
}
