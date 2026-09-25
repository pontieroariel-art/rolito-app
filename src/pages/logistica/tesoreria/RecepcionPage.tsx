import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { CheckCircle2, Clock, FileText, HandCoins, Inbox, Landmark, ShieldCheck } from 'lucide-react'
import Badge from '@/components/common/Badge'
import HistorialTable, { type ColumnaHistorial } from '@/components/common/HistorialTable'
import PageHeader from '@/components/common/PageHeader'
import { CAMPO_FILTRO } from '@/components/common/tabla'
import RecibirSobreModal from '@/components/tesoreria/RecibirSobreModal'
import { subscribeValesDelDia } from '@/services/valeService'
import FranjaRendicionesPendientes from '@/components/tesoreria/FranjaRendicionesPendientes'
import { EfectivoCheques, NOMBRE_EMPRESA, TextoRH } from '@/components/tesoreria/plata'
import Button from '@/components/ui/Button'
import { Plegable } from '@/components/ui/Plegable'
import { useAuth } from '@/context/AuthContext'
import { useDiaActual } from '@/hooks/useDiaActual'
import { custodiaTotal, useCustodiaTesoreria } from '@/hooks/useCustodiaTesoreria'
import { useSobresRecibidosEn } from '@/hooks/useSobres'
import { reportError } from '@/services/observability'
import { getSobresEnRango, recibirSobre, SobreYaRecibidoError, type DatosRecepcion } from '@/services/sobreService'
import { addDaysStr } from '@/utils/helpers'
import { formatoARS } from '@/utils/money'
import { tieneAlgunRol } from '@/utils/roles'
import { anticiposDelTurno, antiguedadHoras, empresaDeAnticipo, esAnticipo, memoriaDiferencias, textoMemoria } from '@/utils/sobres'
import { dondeEstaLaPlata, efectivoDeSobre } from '@/utils/plataDelDia'
import DondeEstaLaPlata from '@/components/tesoreria/DondeEstaLaPlata'
import { useLiveDelDia } from '@/hooks/useLiveDelDia'
import { sumaImportes } from '@/utils/medios'
import { actaSobreBlob } from '@/services/actaSobreService'
import { useVisorComprobante } from '@/components/ui/VisorComprobante'
import { MOTIVOS_DIFERENCIA_LIQUIDACION, PLANTAS, type PlantaId, type Sobre, type ValeCaja } from '@/types'

// Home de tesorería (2026-09-24: reemplazó a "Plata del día", que Ariel no
// entendía). Arriba, la tira "¿Dónde está la plata hoy?" en cuatro lugares;
// abajo, las liquidaciones de caja una por una.
// Sobres de tesorería. Rediseño del 2026-09-23 (maqueta aprobada por Ariel):
// UNA pantalla en tres columnas —por recibir, recibidos hoy, con diferencia—
// donde los anticipos entran en la misma lista. Cada tarjeta dice "Efectivo $…"
// y abajo "Cheques $…". Abrir un sobre muestra los mismos renglones que vio el
// cajero, abierto en Redonhielo y Rolito, y se cuenta fajo por fajo. Se fueron
// "Entregas de caja" y "Validación de cierres": esto es todo lo que tesorería recibe.

type FiltroPlanta = PlantaId | 'todas'
const PLANTA_IDS = Object.keys(PLANTAS) as PlantaId[]
const nombrePlanta = (p: PlantaId) => PLANTAS[p].label.replace('Planta ', '')
const hora = (d: Date) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
const fechaHora = (d: Date) => d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
const diaLargo = (fecha: string) => new Date(`${fecha}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: '2-digit' })

export default function RecepcionPage() {
  const { user } = useAuth()
  const hoy = useDiaActual()
  const [dia, setDia] = useState(hoy)
  const [planta, setPlanta] = useState<FiltroPlanta>('todas')
  const c = useCustodiaTesoreria(dia)
  const [recibiendo, setRecibiendo] = useState<Sobre | null>(null)
  // Vales de caja (2026-09-25): los del día restan de los turnos abiertos.
  const [valesDia, setValesDia] = useState<ValeCaja[]>([])
  useEffect(() => subscribeValesDelDia(dia, setValesDia), [dia])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [ultimoRecibido, setUltimoRecibido] = useState<Sobre | null>(null)
  const [aviso, setAviso] = useState('')
  const { abrir } = useVisorComprobante()
  const sobresMes = useSobresDelMes(hoy)
  // Contados en el día por la hora de la recepción: el sobre de ayer recibido hoy se queda a la vista.
  const recibidosEnElDia = useSobresRecibidosEn(dia)

  // gerente_general mira; tesorería (y el operador) reciben.
  const puedeRecibir = tieneAlgunRol(user, ['tesoreria', 'super_admin', 'logistica'])

  const custodia = useMemo(() => custodiaTotal(c.porPlanta, planta), [c.porPlanta, planta])
  const todosDelDia = useMemo(() => {
    const ids = new Set<string>()
    const out: Sobre[] = []
    for (const p of PLANTA_IDS) for (const x of [...c.porPlanta[p].enCamino.map((e) => e.sobre), ...c.porPlanta[p].recibidosHoy, ...c.porPlanta[p].anticipos]) if (!ids.has(x.id)) { ids.add(x.id); out.push(x) }
    for (const x of [...c.pendientes, ...recibidosEnElDia.sobres]) if (!ids.has(x.id)) { ids.add(x.id); out.push(x) }
    return out.filter((s) => s.rindeA === 'tesoreria' && (planta === 'todas' || s.plantaId === planta))
  }, [c.porPlanta, c.pendientes, recibidosEnElDia.sobres, planta])
  // Los anticipos nacen 'entregada', así que ya vienen en la bandeja de pendientes junto con los sobres.
  // Tres columnas (2026-09-24, pedido de Ariel): lo que caja todavía no entregó
  // en mano (Por recibir), lo que ya está en tesorería con la firma de entrega
  // (A contar y validar) y lo contado. Sin la firma de entrega no se cuenta.
  const pendientes = useMemo(() => todosDelDia.filter((s) => !s.recepcion).sort((a, b) => a.cerradaEn.toMillis() - b.cerradaEn.toMillis()), [todosDelDia])
  const porRecibir = useMemo(() => pendientes.filter((s) => s.estado !== 'entregada' && !esAnticipo(s)), [pendientes])
  const aContar = useMemo(() => pendientes.filter((s) => s.estado === 'entregada' || esAnticipo(s)), [pendientes])
  const recibidos = useMemo(() => todosDelDia.filter((s) => s.recepcion).sort((a, b) => (b.recepcion?.en.toMillis() ?? 0) - (a.recepcion?.en.toMillis() ?? 0)), [todosDelDia])
  const horasAviso = c.config.horasAvisoSobre

  // La tira de arriba: la calle y los turnos abiertos salen del resumen en vivo del día.
  const live = useLiveDelDia(dia)
  const donde = useMemo(() => dondeEstaLaPlata({
    sesiones: live.sesiones, sobres: live.sobres, liquidaciones: live.liquidaciones,
    calle: live.resumen.calle, supervisores: live.resumen.supervisores,
    ventanilla: [...live.resumen.ventanilla.torcuato, ...live.resumen.ventanilla.merlo],
    porRecibir, aContar, contados: recibidos, vales: valesDia,
  }), [live.sesiones, live.sobres, live.liquidaciones, live.resumen, porRecibir, aContar, recibidos, valesDia])

  const acta = useCallback(async (s: Sobre) => {
    setAviso('')
    try {
      const { blob, nombre } = await actaSobreBlob(s)
      abrir({ blob, nombre, titulo: `${esAnticipo(s) ? 'Anticipo' : 'Liquidación de caja'} ${s.codigo}`, subtitulo: `${s.fecha} · ${s.rindio.nombre}` })
    } catch (err) {
      reportError(err, { origen: 'RecepcionPage', accion: 'error al generar el acta' })
      setAviso('No se pudo generar el acta del sobre.')
    }
  }, [abrir])

  const recibir = async (datos: DatosRecepcion) => {
    if (!user || !recibiendo) return
    setGuardando(true); setError('')
    try {
      const s = await recibirSobre(recibiendo.id, datos, { uid: user.uid, nombre: user.nombre, rol: user.rol })
      setRecibiendo(null)
      setUltimoRecibido(s)
    } catch (err) {
      reportError(err, { origen: 'RecepcionPage', accion: 'error al recibir el sobre' })
      setError(err instanceof SobreYaRecibidoError || err instanceof Error ? err.message : 'No se pudo recibir el sobre.')
    } finally {
      setGuardando(false)
    }
  }

  const btn = 'inline-flex items-center gap-1 rounded-lg border border-[#D3D1C7] bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-accent hover:text-accent'
  const suma = (xs: Sobre[]) => ({ efectivo: xs.reduce((a, s) => a + (s.recepcion?.efectivoContado ?? s.sistema.efectivo), 0), cheques: xs.reduce((a, s) => a + sumaImportes(s.sistema.cheques), 0) })
  const cajasAbiertas = custodia.cajasAbiertas

  return (
    <main className="max-w-[1600px] mx-auto p-4 space-y-4 pb-10">
      <PageHeader
        titulo="Recepción de liquidaciones"
        icono={<Landmark size={22} />}
        contexto={`Tesorería · ${diaLargo(dia)} · ${planta === 'todas' ? 'todas las plantas' : nombrePlanta(planta)}`}
        chips={<>
          {pendientes.length > 0 && <Badge tono="aviso" icono={<Clock />}>{pendientes.length} por recibir</Badge>}
          {cajasAbiertas.length > 0 && <Badge tono="enCamino">{cajasAbiertas.length} {cajasAbiertas.length === 1 ? 'caja abierta' : 'cajas abiertas'}: {cajasAbiertas.map((x) => x.sesion.cajero.nombre).join(', ')}</Badge>}
        </>}
        acciones={<>
          <select value={planta} onChange={(e) => setPlanta(e.target.value as FiltroPlanta)} aria-label="Planta" className={CAMPO_FILTRO}>
            <option value="todas">Todas las plantas</option>
            {PLANTA_IDS.map((p) => <option key={p} value={p}>{nombrePlanta(p)}</option>)}
          </select>
          <input type="date" value={dia} max={hoy} onChange={(e) => setDia(e.target.value || hoy)} aria-label="Día" className={CAMPO_FILTRO} />
        </>}
      />

      <DondeEstaLaPlata datos={donde} cargando={c.loading} />
      <FranjaRendicionesPendientes />
      {c.error && <p className="text-xs text-red-700">No pudimos leer los sobres o las cajas. Revisá la conexión.</p>}
      {aviso && <p className="text-xs text-amber-700">{aviso}</p>}
      {ultimoRecibido && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#AFD9C6] bg-[#F1F9F5] px-4 py-3">
          <p className="text-sm text-gray-900"><ShieldCheck size={16} className="inline text-[#14865C] mr-1.5" />{esAnticipo(ultimoRecibido) ? 'Anticipo' : 'Liquidación de caja'} <b>{ultimoRecibido.codigo}</b> contada: {ultimoRecibido.recepcion?.conformidad === 'conforme' ? 'conforme' : 'con diferencia'}.</p>
          <span className="flex gap-2">
            <button type="button" onClick={() => acta(ultimoRecibido)} className={btn}><FileText size={12} /> Ver acta</button>
            <button type="button" onClick={() => setUltimoRecibido(null)} className={btn}>Cerrar</button>
          </span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Columna paso="recibir" numero={1} titulo="Por recibir" cantidad={porRecibir.length} totales={suma(porRecibir)} vacio={c.loading ? 'Cargando…' : 'Nada por recibir: caja no tiene liquidaciones cerradas sin entregar.'}>
          {porRecibir.map((s) => (
            <TarjetaSobre key={s.id} sobre={s} hoy={hoy} ahora={c.ahora} horasAviso={horasAviso} memoria={textoMemoriaDe(sobresMes, s, hoy)}
              accion={<p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">Todavía en la ventanilla. Caja te lo entrega desde su pantalla y ahí firmás que lo recibiste.</p>} />
          ))}
        </Columna>
        <Columna paso="contar" numero={2} titulo="A contar y validar" cantidad={aContar.length} totales={suma(aContar)} vacio={c.loading ? 'Cargando…' : 'Nada en tus manos sin contar.'}>
          {aContar.map((s) => (
            <TarjetaSobre key={s.id} sobre={s} hoy={hoy} ahora={c.ahora} horasAviso={horasAviso} memoria={textoMemoriaDe(sobresMes, s, hoy)}
              accion={puedeRecibir ? <Button onClick={() => { setError(''); setRecibiendo(s) }} className="w-full"><ShieldCheck size={16} /> Contar y validar</Button> : undefined} />
          ))}
        </Columna>
        <Columna paso="listo" numero={3} titulo={dia === hoy ? 'Contadas hoy' : `Contadas el ${dia}`} cantidad={recibidos.length} totales={suma(recibidos)}
          vacio={cajasAbiertas.length || pendientes.length ? 'Todavía no contaste ninguna.' : 'Todavía no cerró ninguna caja.'}>
          {recibidos.map((s) => <TarjetaSobre key={s.id} sobre={s} hoy={hoy} ahora={c.ahora} horasAviso={horasAviso} memoria={s.recepcion?.conformidad === 'con_diferencia' ? textoMemoriaDe(sobresMes, s, hoy) : undefined} onActa={() => acta(s)} />)}
        </Columna>
      </div>

      <Plegable titulo="Historial (30 días)">
        <HistorialSobres hoy={hoy} planta={planta} onActa={acta} />
      </Plegable>

      {recibiendo && user && (
        <RecibirSobreModal
          sobre={recibiendo}
          anticipos={recibiendo.cajaSesionId ? anticiposDelTurno(todosDelDia, recibiendo.cajaSesionId) : []}
          firmante={user.nombre}
          guardando={guardando}
          error={error}
          onCancelar={() => setRecibiendo(null)}
          onRecibir={recibir}
          onActa={() => { void acta(recibiendo) }}
        />
      )}
    </main>
  )
}

/**
 * Los sobres del mes de todos los cajeros, una consulta puntual, para decir en
 * cada tarjeta "este mes: N turnos, M con diferencia" (diferencias con memoria,
 * 2026-09-23). Se pide una vez por día.
 */
function useSobresDelMes(hoy: string): Sobre[] {
  const [sobres, setSobres] = useState<Sobre[]>([])
  useEffect(() => {
    let vivo = true
    getSobresEnRango(`${hoy.slice(0, 7)}-01`, addDaysStr(hoy, 1))
      .then((xs) => { if (vivo) setSobres(xs) })
      .catch((err) => reportError(err, { origen: 'RecepcionPage', accion: 'sobres del mes' }))
    return () => { vivo = false }
  }, [hoy])
  return sobres
}

function textoMemoriaDe(sobresMes: Sobre[], s: Sobre, hoy: string): string | undefined {
  if (esAnticipo(s) || !sobresMes.length) return undefined
  const m = memoriaDiferencias(sobresMes, s.rindio.uid, `${hoy.slice(0, 7)}-01`)
  return m.turnos ? `Este mes: ${textoMemoria(m)}` : undefined
}

// ── Columna y tarjeta ────────────────────────────────────────────────────────

// Tres pasos bien separados (2026-09-24, pedido de Ariel: "títulos vistosos y
// que no haya confusión"): cada columna es un carril con su color, su número
// de paso y su título grande; abajo, los totales de lo que hay en ese paso.
type PasoColumna = 'recibir' | 'contar' | 'listo'
const ESTILO_PASO: Record<PasoColumna, { banda: string; borde: string; fondo: string; icono: ReactNode; subtitulo: string }> = {
  recibir: { banda: 'bg-[#B45309]', borde: 'border-[#EFDCB4]', fondo: 'bg-[#FBF6EA]', icono: <HandCoins size={20} />, subtitulo: 'Caja las cerró y todavía las tiene. Cuando te las entregue, firmás en su pantalla.' },
  contar:  { banda: 'bg-[#14538C]', borde: 'border-[#BFD8EE]', fondo: 'bg-[#EEF4FA]', icono: <ShieldCheck size={20} />, subtitulo: 'Ya están en tus manos con tu firma de entrega. Contá y validá cada una.' },
  listo:   { banda: 'bg-[#0F6B4E]', borde: 'border-[#AFD9C6]', fondo: 'bg-[#EEF7F2]', icono: <CheckCircle2 size={20} />, subtitulo: 'Contadas y validadas. Conformes o con diferencia, con su acta.' },
}

function Columna({ paso, numero, titulo, cantidad, totales, vacio, children }: {
  paso: PasoColumna; numero: number; titulo: string; cantidad: number; totales: { efectivo: number; cheques: number }; vacio: string; children: ReactNode
}) {
  const e = ESTILO_PASO[paso]
  return (
    <section className={`rounded-2xl border ${e.borde} ${e.fondo} overflow-hidden flex flex-col`}>
      <div className={`${e.banda} text-white px-4 py-3`}>
        <div className="flex items-center gap-2.5">
          <span className="shrink-0 w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-base font-black tabular-nums">{numero}</span>
          <span className="shrink-0">{e.icono}</span>
          <h2 className="text-lg font-bold tracking-wide uppercase flex-1 min-w-0 truncate">{titulo}</h2>
          <span className="shrink-0 min-w-[2rem] h-8 px-2.5 rounded-full bg-white text-gray-900 text-base font-black tabular-nums flex items-center justify-center">{cantidad}</span>
        </div>
        <p className="text-xs text-white/85 mt-1.5">{e.subtitulo}</p>
        <p className="text-sm font-semibold tabular-nums mt-1.5">Efectivo {formatoARS(totales.efectivo)} <span className="font-normal text-white/70">·</span> Cheques {formatoARS(totales.cheques)}</p>
      </div>
      <div className="space-y-2 p-2.5">
        {cantidad === 0 && <div className="border-[1.5px] border-dashed border-[#D3D1C7] rounded-xl px-3 py-5 text-center text-xs text-secundario bg-white/60"><Inbox size={18} className="mx-auto mb-1 text-inerte" />{vacio}</div>}
        {children}
      </div>
    </section>
  )
}

function TarjetaSobre({ sobre: s, hoy, ahora, horasAviso, memoria, accion, onActa }: {
  sobre: Sobre; hoy: string; ahora: number; horasAviso: number; memoria?: string; accion?: ReactNode; onActa?: () => void
}) {
  const anticipo = esAnticipo(s)
  const r = s.recepcion
  const horas = antiguedadHoras(s, ahora)
  const viejo = !r && horas >= horasAviso
  const deOtroDia = s.fecha < hoy
  const pe = efectivoDeSobre(s, !!r)
  const cheques = sumaImportes(s.sistema.cheques)
  const conforme = r?.conformidad === 'conforme'
  const tono = r ? (conforme ? 'bien' : 'mal') : 'normal'
  const chequesRecibidos = r ? r.cheques.filter((v) => v.recibido).length : s.sistema.cheques.length
  return (
    <article className={`bg-white rounded-xl border p-3 space-y-2 ${viejo || deOtroDia ? 'border-[#E9CE92]' : r && !conforme ? 'border-red-200' : 'border-[#D3D1C7]'}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-secundario tabular-nums">{anticipo && <span className="text-[#075985]">ANTICIPO · </span>}{s.codigo} · {hora(s.cerradaEn.toDate())}{deOtroDia && <span className="ml-1 text-[#8A5203]">· de {s.fecha === addDaysStr(hoy, -1) ? 'ayer' : s.fecha}</span>}</p>
        {!r && <Badge tono={viejo ? 'aviso' : 'pendiente'} icono={<Clock />}>{horas < 1 ? `${Math.round(horas * 60)} min` : `${Math.floor(horas)} h`}</Badge>}
      </div>
      <EfectivoCheques compacto tono={tono}
        efectivo={r ? r.efectivoContado : s.sistema.efectivo}
        cheques={cheques}
        subEfectivo={<TextoRH redonhielo={pe.redonhielo} rolito={pe.rolito} />}
        subCheques={s.sistema.cheques.length ? `${r ? `${chequesRecibidos} de ` : ''}${s.sistema.cheques.length} cheque${s.sistema.cheques.length === 1 ? '' : 's'}` : undefined} />
      <p className="text-sm text-gray-900"><b>{s.firmanteRinde}</b> <span className="text-secundario">· {nombrePlanta(s.plantaId)}{anticipo ? ` · ${NOMBRE_EMPRESA[empresaDeAnticipo(s)]}` : ''}</span></p>
      <p className={`text-xs ${r ? (conforme ? 'text-[#0F6B4E]' : 'text-red-700') : 'text-secundario'}`}>
        {r
          ? <>{conforme ? 'Recibido, conforme' : <>Con diferencia <b className="tabular-nums">{formatoARS(r.diferencia?.efectivo ?? 0)}</b>{r.diferencia?.valoresFaltantes.cantidad ? ` · ${r.diferencia.valoresFaltantes.cantidad} valor(es) no vinieron` : ''}</>} · {r.firmanteRecibe} {hora(r.en.toDate())}{r.diferencia ? <span className="block">{MOTIVOS_DIFERENCIA_LIQUIDACION[r.diferencia.motivo]}: {r.diferencia.nota}</span> : null}</>
          : anticipo
            ? <>Entregado en mano a <b>{s.entrega?.recibio.nombre ?? s.custodia.nombre}</b> (firmó). Falta contarlo.</>
            : <>Sobre cerrado, sin contar{s.diferenciaDeclarada.efectivo !== 0 || s.diferenciaDeclarada.valoresFaltantes.cantidad > 0 ? <span className="text-red-700"> · caja declaró diferencia</span> : null}</>}
      </p>
      {memoria && <p className="text-xs text-secundario">{memoria}</p>}
      {accion}
      {onActa && <button type="button" onClick={onActa} className="inline-flex items-center gap-1 rounded-lg border border-[#D3D1C7] bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-accent hover:text-accent"><FileText size={12} /> Acta</button>}
    </article>
  )
}

// ── Historial (30 días) ──────────────────────────────────────────────────────

/** Se monta recién al abrir el plegable: una consulta puntual, no un stream. */
function HistorialSobres({ hoy, planta, onActa }: { hoy: string; planta: FiltroPlanta; onActa: (s: Sobre) => void }) {
  const [filas, setFilas] = useState<Sobre[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(false)
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    let vivo = true
    setCargando(true); setError(false)
    getSobresEnRango(addDaysStr(hoy, -30), addDaysStr(hoy, 1), planta === 'todas' ? undefined : planta)
      .then((xs) => { if (vivo) setFilas(xs.filter((s) => s.rindeA === 'tesoreria')) })
      .catch((err) => { reportError(err, { origen: 'RecepcionPage', accion: 'error al cargar el historial de sobres' }); if (vivo) setError(true) })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [hoy, planta, intento])

  const totalValores = (xs: { importe: number }[]) => xs.reduce((s, x) => s + x.importe, 0)
  const difRecepcion = (s: Sobre): number | null => (s.recepcion ? (s.recepcion.diferencia?.efectivo ?? 0) : null)
  const dif = (n: number) => <span className={`font-semibold ${n === 0 ? 'text-secundario' : n < 0 ? 'text-red-600' : 'text-amber-700'}`}>{formatoARS(n)}</span>

  const columnas: ColumnaHistorial<Sobre>[] = [
    { titulo: 'Código', celda: (s) => <span className="font-medium">{esAnticipo(s) ? 'Anticipo ' : ''}{s.codigo}</span>, csv: (s) => s.codigo },
    { titulo: 'Fecha', celda: (s) => s.fecha },
    { titulo: 'Planta', celda: (s) => nombrePlanta(s.plantaId) },
    { titulo: 'Cajero', celda: (s) => s.firmanteRinde, truncar: true, anchoMax: 160 },
    { titulo: 'Sistema', alinear: 'der', celda: (s) => formatoARS(s.sistema.efectivo), csv: (s) => s.sistema.efectivo },
    { titulo: 'Declaró caja', alinear: 'der', celda: (s) => formatoARS(s.declarado.efectivo), csv: (s) => s.declarado.efectivo },
    { titulo: 'Contado por tesorería', alinear: 'der', celda: (s) => (s.recepcion ? formatoARS(s.recepcion.efectivoContado) : '—'), csv: (s) => s.recepcion?.efectivoContado ?? '' },
    { titulo: 'Dif. de caja', alinear: 'der', celda: (s) => dif(s.diferenciaDeclarada.efectivo), csv: (s) => s.diferenciaDeclarada.efectivo },
    { titulo: 'Dif. de recepción', alinear: 'der', celda: (s) => { const d = difRecepcion(s); return d === null ? '—' : dif(d) }, csv: (s) => difRecepcion(s) ?? '' },
    { titulo: 'Valores', alinear: 'der', celda: (s) => { const n = s.sistema.cheques.length + s.sistema.retenciones.length; return n ? `${n} · ${formatoARS(totalValores([...s.sistema.cheques, ...s.sistema.retenciones]))}` : '—' }, csv: (s) => s.sistema.cheques.length + s.sistema.retenciones.length },
    { titulo: 'Conformidad', celda: (s) => (s.recepcion
      ? <Badge tono={s.recepcion.conformidad === 'conforme' ? 'entregado' : 'cancelado'}>{s.recepcion.conformidad === 'conforme' ? 'Conforme' : 'Con diferencia'}</Badge>
      : <Badge tono="enCamino">Por contar</Badge>), csv: (s) => (s.recepcion ? (s.recepcion.conformidad === 'conforme' ? 'Conforme' : 'Con diferencia') : 'Por contar') },
    { titulo: 'Recibió', celda: (s) => (s.recepcion ? <span className="text-xs">{s.recepcion.firmanteRecibe}<span className="block text-secundario">{fechaHora(s.recepcion.en.toDate())}</span></span> : '—'), csv: (s) => (s.recepcion ? `${s.recepcion.firmanteRecibe} ${fechaHora(s.recepcion.en.toDate())}` : '') },
    { titulo: 'Acta', sinCsv: true, celda: (s) => <button type="button" onClick={() => onActa(s)} title="Ver acta" className="inline-flex items-center rounded-lg border border-[#D3D1C7] bg-white p-1.5 text-gray-700 hover:border-accent hover:text-accent"><FileText size={12} /></button> },
  ]

  return (
    <HistorialTable
      columnas={columnas}
      filas={filas}
      claveDe={(s) => s.id}
      cargando={cargando}
      error={error}
      onReintentar={() => setIntento((n) => n + 1)}
      vacio="Ningún sobre en los últimos 30 días."
      anchoMinimo={1100}
      porPagina={25}
      exportar="sobres-tesoreria"
      compacta
      className="!p-0 !border-0 !shadow-none !rounded-none"
    />
  )
}
