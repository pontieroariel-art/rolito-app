import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Landmark, Printer, Share2 } from 'lucide-react'
import Button from '@/components/ui/Button'
import { useAuth } from '@/context/AuthContext'
import { useDiaActual } from '@/hooks/useDiaActual'
import { subscribeLiquidacionesEnRango } from '@/services/liquidacionService'
import { subscribeRendicionesEnRango } from '@/services/rendicionService'
import { crearEntrega, EntregaYaIncluidaError, subscribeEntregasEnRango } from '@/services/entregaTesoreriaService'
import { reportError } from '@/services/observability'
import { addDaysStr } from '@/utils/helpers'
import { formatoARS } from '@/utils/money'
import { armarEntrega, pendientesDeEntrega } from '@/utils/entregaTesoreria'
import { generateActaEntrega, nombreArchivoActa } from '@/utils/entregaPdf'
import { compartirArchivo, puedeCompartirArchivos } from '@/utils/compartir'
import ValoresEnPapel from '@/components/expedicion/ValoresEnPapel'
import { Plegable } from '@/components/ui/Plegable'
import CierreLiquidacionModal, { type DatosCierre, type TextosCierre } from '@/components/expedicion/liquidacion/CierreLiquidacionModal'
import { MOTIVOS_DIFERENCIA_LIQUIDACION, MOTIVOS_ENTREGA_TESORERIA, PLANTAS, type EntregaTesoreria, type Liquidacion, type Rendicion } from '@/types'
import { TH as th, TD as td } from '@/components/common/tabla'

const TEXTOS_ENTREGA: TextosCierre = {
  titulo: 'Entregar a tesorería', sujeto: 'caja', aRendir: 'Teórico a entregar', recibido: 'Efectivo que entrego',
  confirmacion: <>Tengo en mano el efectivo declarado y <b>todos los cheques y retenciones listados</b>, y los entrego a tesorería.</>,
  firma: 'Firma de quien entrega (caja)',
  boton: 'Firmar y generar el acta',
  pie: 'Al confirmar se registra la entrega (no se puede editar) y se genera el acta. Tesorería la cuenta, tilda cada valor y la confirma con su firma.',
}

// Entrega de caja a tesorería (2026-09-09): la ventanilla junta lo pendiente
// (liquidaciones de repartidores que recibió + cierres de caja), declara el
// efectivo que manda, firma y sale el acta. Todo lo incluido queda marcado
// con entregaId (no vuelve a salir). Lógica pura en utils/entregaTesoreria.ts.
export default function EntregasPage() {
  const { user } = useAuth()
  const hoy = useDiaActual()
  const planta = user?.planta
  const [liqs, setLiqs] = useState<Liquidacion[]>([])
  const [rends, setRends] = useState<Rendicion[]>([])
  const [entregas, setEntregas] = useState<EntregaTesoreria[]>([])
  const [excluidos, setExcluidos] = useState<Set<string>>(new Set())
  const [efectivoEntregado, setEfectivoEntregado] = useState('')
  const [confirmando, setConfirmando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [ultima, setUltima] = useState<EntregaTesoreria | null>(null)

  useEffect(() => {
    if (!planta) return
    const desde = addDaysStr(hoy, -7), hasta = addDaysStr(hoy, 1)
    const offL = subscribeLiquidacionesEnRango(desde, hasta, setLiqs, planta)
    const offR = subscribeRendicionesEnRango(desde, hasta, setRends)
    const offE = subscribeEntregasEnRango(`${hoy.slice(0, 7)}-01`, hasta, setEntregas)
    return () => { offL(); offR(); offE() }
  }, [planta, hoy])

  const pend = useMemo(() => (planta ? pendientesDeEntrega(liqs, rends, planta) : { liquidaciones: [], rendiciones: [] }), [liqs, rends, planta])
  const sel = useMemo(() => ({
    liquidaciones: pend.liquidaciones.filter((l) => !excluidos.has(l.id)).sort((a, b) => a.fecha.localeCompare(b.fecha)),
    rendiciones:   pend.rendiciones.filter((r) => !excluidos.has(r.id)).sort((a, b) => a.fecha.localeCompare(b.fecha)),
  }), [pend, excluidos])
  const armada = useMemo(() => armarEntrega(sel.liquidaciones, sel.rendiciones), [sel])
  const cubiertaPor = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of sel.rendiciones) for (const id of r.liquidacionesIds ?? []) m.set(id, r.sujetoNombre)
    return m
  }, [sel.rendiciones])
  const entregado = parseInt(efectivoEntregado.replace(/\D/g, ''), 10) || 0
  const diferencia = efectivoEntregado.trim() === '' ? null : entregado - armada.efectivo.teorico
  const nValores = armada.cheques.length + armada.retenciones.length
  const haySeleccion = sel.liquidaciones.length + sel.rendiciones.length > 0
  const toggle = (id: string) => setExcluidos((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const misEntregas = useMemo(() => entregas.filter((e) => e.plantaId === planta).sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis()), [entregas, planta])

  const imprimir = (e: EntregaTesoreria) => generateActaEntrega(e).catch((err) => reportError(err, { origen: 'EntregasPage', accion: 'error al generar el acta' }))
  const enviar = async (e: EntregaTesoreria) => {
    setAviso('')
    try {
      const blob = (await generateActaEntrega(e, { descargar: false })) as Blob
      const res = await compartirArchivo(blob, nombreArchivoActa(e), { titulo: `Entrega a tesorería ${e.codigo}`, texto: `Acta de entrega ${e.codigo} del ${e.fecha}` })
      if (res === 'descargado') setAviso('Este dispositivo no puede compartir archivos: se descargó el acta.')
    } catch (err) {
      reportError(err, { origen: 'EntregasPage', accion: 'error al enviar el acta' })
      setAviso('No se pudo generar el acta.')
    }
  }

  const entregar = async (datos: DatosCierre) => {
    if (!user || !planta) return
    setGuardando(true); setError('')
    try {
      const e = await crearEntrega({
        fecha: hoy, plantaId: planta, ...armada, efectivoEntregado: entregado,
        ...(datos.diferencia ? { diferenciaEntrega: datos.diferencia } : {}),
        firmaEntrega: datos.firma, firmanteEntrega: datos.firmante,
      }, { uid: user.uid, nombre: user.nombre })
      setConfirmando(false); setEfectivoEntregado(''); setExcluidos(new Set()); setUltima(e)
      imprimir(e)
    } catch (err) {
      if (err instanceof EntregaYaIncluidaError) setError(err.message)
      else { reportError(err, { origen: 'EntregasPage', accion: 'error al registrar la entrega' }); setError('No se pudo registrar la entrega. Revisá e intentá de nuevo.') }
    } finally {
      setGuardando(false)
    }
  }

  const inputClass = 'bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'
  const btn = 'inline-flex items-center gap-1 rounded-lg border border-[#D3D1C7] bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-accent hover:text-accent'
  const compartible = puedeCompartirArchivos()

  if (!planta) return <main className="max-w-5xl mx-auto p-4"><p className="text-sm text-red-600">Tu usuario no tiene planta asignada.</p></main>

  return (
    <main className="max-w-5xl mx-auto p-4 space-y-4 pb-10">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Landmark size={22} className="text-accent" /> Entrega a tesorería · {PLANTAS[planta].label}</h1>
        <p className="text-gray-500 text-sm">Lo que caja recibió de repartidores y cerró en sus cajas, y todavía no salió hacia tesorería. Se entrega con acta y firma; tesorería la cuenta y confirma.</p>
      </div>

      {ultima && (
        <section className="bg-accent/5 border border-accent/30 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-800 flex items-center gap-2"><CheckCircle2 size={18} className="text-[#1D9E75]" /> Entrega <b>{ultima.codigo}</b> registrada · {formatoARS(ultima.efectivoEntregado)} en efectivo · {ultima.cheques.length + ultima.retenciones.length} valor(es) en papel. Tesorería la ve para confirmarla.</p>
          <span className="flex gap-2">
            <button type="button" onClick={() => imprimir(ultima)} className={btn}><Printer size={12} /> Acta</button>
            <button type="button" onClick={() => enviar(ultima)} className={btn}><Share2 size={12} /> {compartible ? 'Enviar' : 'Descargar'}</button>
          </span>
        </section>
      )}
      {aviso && <p className="text-xs text-amber-700">{aviso}</p>}

      <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 space-y-4 overflow-x-auto">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Pendiente de entregar (últimos 7 días)</h2>
        {pend.liquidaciones.length + pend.rendiciones.length === 0 ? (
          <p className="text-sm text-gray-500">No hay nada pendiente de entregar.</p>
        ) : (
          <>
            {pend.rendiciones.length > 0 && (
              <table className="w-full min-w-[560px]">
                <thead><tr>{['', 'Cierre de caja', 'Fecha', 'Cajero', 'Contado', 'Tesorería'].map((h, i) => <th key={h || 'x'} className={`${th} ${i === 4 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                <tbody>
                  {pend.rendiciones.map((r) => (
                    <tr key={r.id} className={excluidos.has(r.id) ? 'opacity-50' : ''}>
                      <td className={td}><input type="checkbox" checked={!excluidos.has(r.id)} onChange={() => toggle(r.id)} /></td>
                      <td className={`${td} font-medium`}>{r.codigo}</td>
                      <td className={td}>{r.fecha}</td>
                      <td className={td}>{r.sujetoNombre}</td>
                      <td className={`${td} text-right tabular-nums`}>{formatoARS(r.efectivoContado)}{r.diferenciaEfectivo !== 0 && <span className="text-red-600 text-xs"> ({formatoARS(r.diferenciaEfectivo)})</span>}</td>
                      <td className={`${td} text-xs`}>{r.validacion ? <span className="text-[#0F6B4E]">validada</span> : <span className="text-amber-700">sin validar</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {pend.liquidaciones.length > 0 && (
              <table className="w-full min-w-[560px]">
                <thead><tr>{['', 'Liquidación', 'Fecha', 'Repartidor', 'Recibido', 'Efectivo'].map((h, i) => <th key={h || 'x'} className={`${th} ${i === 4 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                <tbody>
                  {pend.liquidaciones.map((l) => (
                    <tr key={l.id} className={excluidos.has(l.id) ? 'opacity-50' : ''}>
                      <td className={td}><input type="checkbox" checked={!excluidos.has(l.id)} onChange={() => toggle(l.id)} /></td>
                      <td className={`${td} font-medium`}>{l.codigo ?? '—'}</td>
                      <td className={td}>{l.fecha}</td>
                      <td className={td}>{l.choferNombre}</td>
                      <td className={`${td} text-right tabular-nums`}>{formatoARS(l.efectivoRecibido)}{l.diferenciaEfectivo !== 0 && <span className="text-red-600 text-xs"> ({formatoARS(l.diferenciaEfectivo)})</span>}</td>
                      <td className={`${td} text-xs text-gray-500`}>{cubiertaPor.has(l.id) ? `ya está en el cierre de ${cubiertaPor.get(l.id)}` : 'suelto (no está en ningún cierre)'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4"><p className="text-xs text-gray-500">Cierres de caja</p><p className="text-2xl font-bold tabular-nums text-gray-900">{formatoARS(armada.efectivo.cierresCaja)}</p><p className="text-xs text-gray-500">{sel.rendiciones.length} cierre(s)</p></div>
        <div className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4"><p className="text-xs text-gray-500">Liquidaciones sueltas</p><p className="text-2xl font-bold tabular-nums text-gray-900">{formatoARS(armada.efectivo.liquidacionesSueltas)}</p><p className="text-xs text-gray-500">{armada.liquidaciones.filter((l) => !l.incluidaEnCierre).length} de {sel.liquidaciones.length}</p></div>
        <div className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4"><p className="text-xs text-gray-500">Teórico a entregar</p><p className="text-2xl font-bold tabular-nums text-gray-900">{formatoARS(armada.efectivo.teorico)}</p><p className="text-xs text-gray-500">{nValores} valor(es) en papel</p></div>
        <div className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4">
          <p className="text-xs text-gray-500">Efectivo que entrego</p>
          <input inputMode="numeric" value={efectivoEntregado} onChange={(e) => setEfectivoEntregado(e.target.value)} placeholder="$" className={`${inputClass} w-full mt-1 text-lg font-semibold tabular-nums`} disabled={!haySeleccion} />
        </div>
        <div className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4">
          <p className="text-xs text-gray-500">Diferencia</p>
          {diferencia === null ? <p className="text-2xl font-bold text-gray-400">—</p> : <p className={`text-2xl font-bold tabular-nums ${diferencia === 0 ? 'text-[#0F6B4E]' : 'text-red-600'}`}>{formatoARS(diferencia)}{diferencia === 0 ? ' ✓' : ''}</p>}
        </div>
      </section>

      {nValores > 0 && (
        <Plegable titulo={`Valores en papel que viajan (${nValores})`} abiertoInicial>
          <p className="text-xs text-gray-500 mb-2">Los tildó caja al recibirlos; tesorería los vuelve a tildar al confirmar la entrega.</p>
          <ValoresEnPapel cheques={armada.cheques} retenciones={armada.retenciones} soloLectura />
        </Plegable>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {error && <p className="w-full text-sm text-red-600">{error}</p>}
        <Button onClick={() => setConfirmando(true)} disabled={!haySeleccion || efectivoEntregado.trim() === ''}>
          <Landmark size={16} className="mr-1.5" /> Entregar y firmar el acta
        </Button>
        {haySeleccion && efectivoEntregado.trim() === '' && <p className="w-full text-right text-xs text-gray-500">Cargá el efectivo que entregás para poder firmar.</p>}
      </div>

      <Plegable titulo={`Entregas del mes (${misEntregas.length})`}>
        <table className="w-full min-w-[640px]">
          <thead><tr>{['Código', 'Fecha', 'Entregó', 'Efectivo', 'Valores', 'Estado', 'Acta'].map((h, i) => <th key={h} className={`${th} ${i === 3 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
          <tbody>
            {misEntregas.map((e) => (
              <tr key={e.id}>
                <td className={`${td} font-medium`}>{e.codigo}</td>
                <td className={td}>{e.fecha}</td>
                <td className={td}>{e.firmanteEntrega}</td>
                <td className={`${td} text-right tabular-nums`}>{formatoARS(e.efectivoEntregado)}</td>
                <td className={td}>{e.cheques.length + e.retenciones.length}</td>
                <td className={`${td} text-xs`}>
                  {e.estado === 'confirmada'
                    ? <span className="text-[#0F6B4E]">Confirmada por {e.firmanteRecibe ?? e.recibidoPor?.nombre}{e.diferenciaEfectivo ? <span className="text-red-600"> · dif. {formatoARS(e.diferenciaEfectivo)}</span> : ''}{e.valoresFaltantes?.cantidad ? <span className="text-red-600"> · {e.valoresFaltantes.cantidad} valor(es) no recibido(s)</span> : ''}{e.diferencia ? <span className="text-gray-500"> · {MOTIVOS_DIFERENCIA_LIQUIDACION[e.diferencia.motivo]}</span> : ''}</span>
                    : <span className="text-amber-700">Entregada · esperando a tesorería</span>}
                </td>
                <td className={td}><span className="flex gap-1"><button type="button" onClick={() => imprimir(e)} className={btn} title="Ver acta"><Printer size={12} /></button><button type="button" onClick={() => enviar(e)} className={btn} title="Enviar acta"><Share2 size={12} /></button></span></td>
              </tr>
            ))}
            {misEntregas.length === 0 && <tr><td className={`${td} text-gray-500`} colSpan={7}>Sin entregas este mes.</td></tr>}
          </tbody>
        </table>
      </Plegable>

      {confirmando && user && (
        <CierreLiquidacionModal
          repartidor={user.nombre}
          resumen={{ ventas: 0, clientes: 0, cobranzas: 0 }}
          resumenTexto={`${sel.rendiciones.length} cierre(s) de caja · ${sel.liquidaciones.length} liquidación(es) · ${nValores} valor(es) en papel`}
          efectivoARendir={armada.efectivo.teorico}
          efectivoRecibido={entregado}
          guardando={guardando}
          error={error}
          onCancelar={() => setConfirmando(false)}
          onConfirmar={entregar}
          textos={TEXTOS_ENTREGA}
          motivos={MOTIVOS_ENTREGA_TESORERIA}
        />
      )}
    </main>
  )
}
