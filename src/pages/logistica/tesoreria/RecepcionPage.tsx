import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock, FileText, Inbox, Landmark, ShieldCheck, Truck, Wallet } from 'lucide-react'
import Badge from '@/components/common/Badge'
import HistorialTable, { type ColumnaHistorial } from '@/components/common/HistorialTable'
import PageHeader from '@/components/common/PageHeader'
import StatusStrip, { type SegmentoEstado } from '@/components/common/StatusStrip'
import { CAMPO_FILTRO } from '@/components/common/tabla'
import RecibirSobreModal from '@/components/tesoreria/RecibirSobreModal'
import Button from '@/components/ui/Button'
import { Plegable } from '@/components/ui/Plegable'
import { useAuth } from '@/context/AuthContext'
import { useDiaActual } from '@/hooks/useDiaActual'
import { custodiaTotal, useCustodiaTesoreria } from '@/hooks/useCustodiaTesoreria'
import { reportError } from '@/services/observability'
import { getSobresEnRango, recibirSobre, SobreYaRecibidoError, type DatosRecepcion } from '@/services/sobreService'
import { addDaysStr } from '@/utils/helpers'
import { formatoARS } from '@/utils/money'
import { tieneAlgunRol } from '@/utils/roles'
import { antiguedadHoras } from '@/utils/sobres'
import { imprimirActaSobreCompleta } from '@/services/actaSobreService'
import { MOTIVOS_DIFERENCIA_LIQUIDACION, PLANTAS, type PlantaId, type Sobre } from '@/types'

// Recepción de sobres en tesorería (rendición de fondos, 2026-09-14). Responde
// "¿cuánto me tiene que llegar, dónde está y de quién?" (tira de custodia) y
// recibe cada sobre de ventanilla con arqueo ciego y doble conformidad. Nada de
// "validar" ni "confirmar": tesorería CUENTA y RECIBE. Un sobre de ayer sin
// recibir sigue en la bandeja hasta que alguien lo reciba.

type FiltroPlanta = PlantaId | 'todas'
const PLANTA_IDS = Object.keys(PLANTAS) as PlantaId[]
const nombrePlanta = (p: PlantaId) => PLANTAS[p].label.replace('Planta ', '')
const hora = (d: Date) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
const fechaHora = (d: Date) => d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })

export default function RecepcionPage() {
  const { user } = useAuth()
  const hoy = useDiaActual()
  const [dia, setDia] = useState(hoy)
  const [planta, setPlanta] = useState<FiltroPlanta>('todas')
  const c = useCustodiaTesoreria(dia)
  const [recibiendo, setRecibiendo] = useState<Sobre | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [ultimoRecibido, setUltimoRecibido] = useState<Sobre | null>(null)
  const [aviso, setAviso] = useState('')

  // gerente_general mira; tesorería (y el operador) reciben.
  const puedeRecibir = tieneAlgunRol(user, ['tesoreria', 'super_admin', 'logistica'])

  const custodia = useMemo(() => custodiaTotal(c.porPlanta, planta), [c.porPlanta, planta])
  const pendientes = useMemo(() => c.pendientes.filter((s) => planta === 'todas' || s.plantaId === planta), [c.pendientes, planta])
  const recibidos = useMemo(() => custodia.recibidosHoy.slice().sort((a, b) => (b.recepcion?.en.toMillis() ?? 0) - (a.recepcion?.en.toMillis() ?? 0)), [custodia.recibidosHoy])
  const horasAviso = c.config.horasAvisoSobre
  const hayViejos = custodia.enCamino.some((x) => x.horas >= horasAviso)

  const segmentos: SegmentoEstado[] = [
    { id: 'llegar',   etiqueta: 'Tiene que llegar', valor: custodia.totales.tieneQueLlegar, formato: formatoARS, icono: <Landmark size={14} />, tono: 'neutro', title: 'Sistema de los sobres de ventanilla del día' },
    { id: 'camino',   etiqueta: 'En camino', valor: custodia.totales.enCamino, formato: formatoARS, icono: <Truck size={14} />, tono: hayViejos ? 'pendiente' : 'enCamino', alerta: hayViejos, title: hayViejos ? `Hay sobres sin recibir hace más de ${horasAviso} h` : `${custodia.enCamino.length} sobre(s) sin recibir` },
    { id: 'recibido', etiqueta: dia === hoy ? 'Recibido hoy' : 'Recibido el día', valor: custodia.totales.recibidoHoy, formato: formatoARS, icono: <ShieldCheck size={14} />, tono: 'entregado', title: 'Contado por tesorería' },
    { id: 'falta',    etiqueta: 'Falta', valor: custodia.totales.falta, formato: formatoARS, tono: 'cancelado', alerta: custodia.totales.falta > 0, title: 'Tiene que llegar − recibido' },
    { id: 'cajas',    etiqueta: 'Cajas abiertas', valor: custodia.cajasAbiertas.length, icono: <Wallet size={14} />, tono: 'pendiente', title: custodia.cajasAbiertas.length ? custodia.cajasAbiertas.map((x) => `${x.sesion.cajero.nombre} (${nombrePlanta(x.sesion.plantaId)}, desde ${hora(x.sesion.abiertaEn.toDate())})`).join(' · ') : 'Ninguna caja abierta' },
  ]

  const acta = useCallback((s: Sobre) => {
    setAviso('')
    imprimirActaSobreCompleta(s, 'imprimir').catch((err) => {
      reportError(err, { origen: 'RecepcionPage', accion: 'error al generar el acta' })
      setAviso('No se pudo generar el acta del sobre.')
    })
  }, [])

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

  return (
    <main className="max-w-5xl mx-auto p-4 space-y-4 pb-10">
      <PageHeader
        titulo="Recepción de sobres"
        icono={<Landmark size={22} />}
        contexto={<>Lo que las ventanillas rinden a tesorería. Se cuenta a ciegas, se tilda cada valor y se firma: el sobre queda con las dos firmas.</>}
        acciones={<>
          <select value={planta} onChange={(e) => setPlanta(e.target.value as FiltroPlanta)} aria-label="Planta" className={CAMPO_FILTRO}>
            <option value="todas">Todas las plantas</option>
            {PLANTA_IDS.map((p) => <option key={p} value={p}>{nombrePlanta(p)}</option>)}
          </select>
          <input type="date" value={dia} max={hoy} onChange={(e) => setDia(e.target.value || hoy)} aria-label="Día" className={CAMPO_FILTRO} />
        </>}
      />

      <StatusStrip
        titulo={`Custodia · ${planta === 'todas' ? 'todas las plantas' : nombrePlanta(planta)} · ${dia}`}
        segmentos={segmentos}
        pie={c.error
          ? <p className="text-xs text-red-700">No pudimos leer los sobres o las cajas. Revisá la conexión.</p>
          : <p className="text-xs text-secundario">"Tiene que llegar" es el SISTEMA de los sobres de ventanilla del día, no lo que caja contó: un faltante de caja se ve como faltante. En camino se marca en aviso a partir de {horasAviso} h sin recibir.</p>}
      />

      {aviso && <p className="text-xs text-amber-700">{aviso}</p>}
      {ultimoRecibido && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#AFD9C6] bg-[#F1F9F5] px-4 py-3">
          <p className="text-sm text-gray-900"><ShieldCheck size={16} className="inline text-[#14865C] mr-1.5" />Sobre <b>{ultimoRecibido.codigo}</b> recibido: {ultimoRecibido.recepcion?.conformidad === 'conforme' ? 'conforme' : 'con diferencia'}.</p>
          <span className="flex gap-2">
            <button type="button" onClick={() => acta(ultimoRecibido)} className={btn}><FileText size={12} /> Imprimir acta</button>
            <button type="button" onClick={() => setUltimoRecibido(null)} className={btn}>Cerrar</button>
          </span>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-secundario">Por recibir ({pendientes.length})</h2>
        {c.loading && pendientes.length === 0 && <p className="text-sm text-secundario">Cargando…</p>}
        {!c.loading && pendientes.length === 0 && (
          <div className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm px-4 py-6 text-center">
            <Inbox size={22} className="mx-auto text-inerte mb-2" />
            <p className="text-sm text-secundario">No hay sobres por recibir.</p>
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {pendientes.map((s) => (
            <SobrePendienteCard key={s.id} sobre={s} hoy={hoy} ahora={c.ahora} horasAviso={horasAviso} puedeRecibir={puedeRecibir} onRecibir={() => { setError(''); setRecibiendo(s) }} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-secundario">{dia === hoy ? 'Recibidos hoy' : `Recibidos el ${dia}`} ({recibidos.length})</h2>
        {!c.loading && recibidos.length === 0 && (
          <p className="text-sm text-secundario bg-white rounded-2xl border border-[#D3D1C7] shadow-sm px-4 py-3">
            {custodia.cajasAbiertas.length > 0 || custodia.enCamino.length > 0 ? 'Todavía no se recibió ningún sobre.' : 'Todavía no cerró ninguna caja.'}
          </p>
        )}
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {recibidos.map((s) => <SobreRecibidoCard key={s.id} sobre={s} onActa={() => acta(s)} />)}
        </div>
      </section>

      <Plegable titulo="Historial (30 días)">
        <HistorialSobres hoy={hoy} planta={planta} onActa={acta} />
      </Plegable>

      {recibiendo && user && (
        <RecibirSobreModal
          sobre={recibiendo}
          firmante={user.nombre}
          guardando={guardando}
          error={error}
          onCancelar={() => setRecibiendo(null)}
          onRecibir={recibir}
        />
      )}
    </main>
  )
}

// ── Cards ────────────────────────────────────────────────────────────────────

/** Sin importes a propósito (arqueo ciego): tesorería cuenta primero. */
function SobrePendienteCard({ sobre: s, hoy, ahora, horasAviso, puedeRecibir, onRecibir }: {
  sobre: Sobre; hoy: string; ahora: number; horasAviso: number; puedeRecibir: boolean; onRecibir: () => void
}) {
  const horas = antiguedadHoras(s, ahora)
  const viejo = horas >= horasAviso
  const deOtroDia = s.fecha < hoy
  const nC = s.sistema.cheques.length, nR = s.sistema.retenciones.length
  return (
    <div className={`bg-white rounded-2xl border shadow-sm p-4 space-y-2 ${viejo || deOtroDia ? 'border-[#E9CE92]' : 'border-[#D3D1C7]'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-base font-bold text-gray-900">{s.codigo}</p>
        <span className="flex items-center gap-1.5">
          {deOtroDia && <Badge tono="aviso">De {s.fecha === addDaysStr(hoy, -1) ? 'ayer' : s.fecha}</Badge>}
          <Badge tono={viejo ? 'aviso' : 'enCamino'} icono={<Clock />}>{antiguedadTexto(horas)}</Badge>
        </span>
      </div>
      <p className="text-sm text-gray-800">{nombrePlanta(s.plantaId)} · rindió <b>{s.firmanteRinde}</b> a las {hora(s.cerradaEn.toDate())}</p>
      <p className="text-sm text-secundario tabular-nums">
        {nC + nR === 0 ? 'Sin cheques ni retenciones' : `${nC} cheque${nC === 1 ? '' : 's'} · ${nR} retenci${nR === 1 ? 'ón' : 'ones'}`}
        {s.diferenciaDeclarada.efectivo !== 0 || s.diferenciaDeclarada.valoresFaltantes.cantidad > 0 ? <span className="text-red-700"> · caja declaró diferencia</span> : null}
      </p>
      {puedeRecibir && (
        <div className="flex justify-end pt-1">
          <Button onClick={onRecibir}><ShieldCheck size={16} /> Recibir</Button>
        </div>
      )}
    </div>
  )
}

function SobreRecibidoCard({ sobre: s, onActa }: { sobre: Sobre; onActa: () => void }) {
  const r = s.recepcion
  if (!r) return null
  const conforme = r.conformidad === 'conforme'
  const difEf = r.diferencia?.efectivo ?? 0
  const faltan = r.diferencia?.valoresFaltantes.cantidad ?? 0
  return (
    <div className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-3 space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-gray-900">{s.codigo} <span className="font-normal text-secundario">· {nombrePlanta(s.plantaId)}</span></p>
        <Badge tono={conforme ? 'entregado' : 'cancelado'} icono={conforme ? <ShieldCheck /> : undefined}>{conforme ? 'Conforme' : 'Con diferencia'}</Badge>
      </div>
      <p className="text-sm text-gray-800">Rindió <b>{s.firmanteRinde}</b></p>
      <p className="text-sm text-gray-900 tabular-nums">Contado por tesorería: <b>{formatoARS(r.efectivoContado)}</b>
        {!conforme && <span className={`ml-1 ${difEf < 0 ? 'text-red-700' : 'text-amber-700'}`}>({formatoARS(difEf)}{faltan ? ` · ${faltan} valor(es) sin recibir` : ''})</span>}
      </p>
      {r.diferencia && <p className="text-xs text-red-700">{MOTIVOS_DIFERENCIA_LIQUIDACION[r.diferencia.motivo]}: {r.diferencia.nota}</p>}
      <div className="flex items-center justify-between gap-2 text-xs text-secundario">
        <span>{hora(r.en.toDate())} · recibió {r.firmanteRecibe}</span>
        <button type="button" onClick={onActa} className="inline-flex items-center gap-1 rounded-lg border border-[#D3D1C7] bg-white px-2.5 py-1.5 font-medium text-gray-700 hover:border-accent hover:text-accent"><FileText size={12} /> Acta</button>
      </div>
    </div>
  )
}

const antiguedadTexto = (h: number): string => {
  if (h < 1) return `${Math.round(h * 60)} min`
  if (h < 48) return `${Math.floor(h)} h`
  return `${Math.floor(h / 24)} días`
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
    { titulo: 'Código', celda: (s) => <span className="font-medium">{s.codigo}</span>, csv: (s) => s.codigo },
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
      : <Badge tono="enCamino">En camino</Badge>), csv: (s) => (s.recepcion ? (s.recepcion.conformidad === 'conforme' ? 'Conforme' : 'Con diferencia') : 'En camino') },
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
