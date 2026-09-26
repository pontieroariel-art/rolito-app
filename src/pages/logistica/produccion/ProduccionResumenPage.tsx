import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity, ChevronLeft, ChevronRight, Clock, Database, Factory, Gauge, Printer, Scale, ShieldCheck, Tablet, Users,
} from 'lucide-react'
import { useFirestoreSubscription } from '@/hooks/useFirestoreSubscription'
import { subscribePalletsEnRango } from '@/services/produccionService'
import { subscribeEstadoTablet, subscribeTurnosPlanta, subscribeVentasProducto, type EstadoTablet, type VentasProductoDia } from '@/services/produccionPanelService'
import Badge from '@/components/common/Badge'
import ComparativaTurnos from '@/components/produccion/panel/ComparativaTurnos'
import { Alerta, BarrasPorHora, CARD, Delta, EquipoTurno, Kpi, ProducidoVendido } from '@/components/produccion/panel/PanelPiezas'
import {
  ALERTA_SIN_CARGAR_MIN, compararTurnos, minutosSinCargar, palletsDelDiaProduccion, palletsDelTurno, rangoDelDia, palletsHasta, palletsPorHora, producidoVsVendido, resumirTurno, vendidoDePlanta,
} from '@/utils/panelProduccion'
import { fotoTurno, rangoDeTurno, turnoEn, TURNOS_POR_DEFECTO, type TurnoProduccionDef } from '@/utils/turnosProduccion'
import { PRODUCTOS_HIELO, productosDePlanta } from '@/utils/produccionCatalogo'
import { PLANTAS, type PalletProduccion, type PlantaId } from '@/types'

// Panel del encargado de producción (2026-09-25, rehecho a pedido de Ariel):
// en vivo del turno con KPIs, estado de la tablet y la impresora, Tango,
// equipo del turno (capitán y operarios), calidad de carga, producido contra
// vendido y TRAZABILIDAD: se elige cualquier día y turno y se ve quién
// estuvo, qué se produjo y quién lo cargó. "Ahora" vuelve al turno en curso.
// Lógica pura en utils/panelProduccion.ts.

const aDia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const sumarDias = (dia: string, n: number) => { const d = new Date(`${dia}T12:00:00`); d.setDate(d.getDate() + n); return aDia(d) }
const hhmm = (d: Date) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
const fechaLarga = (dia: string) => new Date(`${dia}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })

type Periodo = 'turno' | 'hoy' | '7d' | '30d'

/** Índice de la selección "Día completo" (los tres turnos del día de producción). */
const DIA_COMPLETO = -1

export default function ProduccionResumenPage() {
  const [planta, setPlanta] = useState<PlantaId>('torcuato')
  const [ahora, setAhora] = useState(() => new Date())
  useEffect(() => { const id = setInterval(() => setAhora(new Date()), 30_000); return () => clearInterval(id) }, [])

  const { data: turnos } = useFirestoreSubscription<TurnoProduccionDef[]>((cb) => subscribeTurnosPlanta(planta, cb), [planta], TURNOS_POR_DEFECTO)
  const { data: tablet } = useFirestoreSubscription<EstadoTablet | null>((cb) => subscribeEstadoTablet(planta, cb), [planta], null)

  // Selección: null = el turno en curso ("Ahora"); si no, un día y un turno.
  // idx = DIA_COMPLETO: los tres turnos del día de producción (2026-09-26).
  const [eleccion, setEleccion] = useState<{ dia: string; idx: number } | null>(null)
  const enCurso = turnoEn(ahora, turnos)
  const dia = eleccion?.dia ?? (enCurso ? aDia(enCurso.inicio) : aDia(ahora))
  const idx = eleccion?.idx ?? Math.max(0, enCurso ? turnos.indexOf(enCurso.turno) : 0)
  const diaCompleto = idx === DIA_COMPLETO
  const turno = diaCompleto ? null : (turnos[idx] ?? turnos[0]!)
  const rango = turno ? rangoDeTurno(dia, turno) : rangoDelDia(dia, turnos)
  const esAhora = turno
    ? !!enCurso && enCurso.turno === turno && aDia(enCurso.inicio) === dia
    : !!rango && ahora >= rango.inicio && ahora < rango.fin
  const nombreSel = turno ? `Turno ${turno.nombre}` : 'Día completo'
  const horarioSel = turno ? `${turno.desde}–${turno.hasta}` : rango ? `${hhmm(rango.inicio)} a ${hhmm(rango.fin)}` : ''

  // Pallets de ayer y hoy de lo elegido (un día antes para comparar, uno después por la noche).
  const desde = useMemo(() => new Date(`${sumarDias(dia, -1)}T00:00:00`), [dia])
  const hasta = useMemo(() => new Date(`${sumarDias(dia, 2)}T12:00:00`), [dia])
  const { data: palletsVentana, loading } = useFirestoreSubscription<PalletProduccion[]>(
    (cb) => subscribePalletsEnRango(desde, hasta, cb), [desde.getTime(), hasta.getTime()], [],
  )
  const dePlanta = useMemo(() => palletsVentana.filter((p) => p.plantaId === planta), [palletsVentana, planta])
  const delTurno = useMemo(() => turno ? palletsDelTurno(dePlanta, dia, turno) : palletsDelDiaProduccion(dePlanta, dia, turnos), [dePlanta, dia, turno, turnos])
  const delTurnoAyer = useMemo(() => turno ? palletsDelTurno(dePlanta, sumarDias(dia, -1), turno) : palletsDelDiaProduccion(dePlanta, sumarDias(dia, -1), turnos), [dePlanta, dia, turno, turnos])
  const resumen = useMemo(() => resumirTurno(delTurno, turno), [delTurno, turno])
  const hoyDia = useMemo(() => resumirTurno(palletsDelDiaProduccion(dePlanta, dia, turnos), null), [dePlanta, dia, turnos])
  // Con el día completo, el segundo KPI es el mejor turno del día.
  const mejorTurno = useMemo(() => diaCompleto
    ? compararTurnos(delTurno, turnos, [dia], (p) => p.turno ?? fotoTurno(p.fechaFabricacion.toDate(), turnos)).turnos[0] ?? null
    : null, [diaCompleto, delTurno, turnos, dia])

  const corte = esAhora ? ahora : (rango?.fin ?? ahora)
  const ayerMismaHora = rango ? palletsHasta(delTurnoAyer, new Date(corte.getTime() - 86_400_000)) : 0
  const porHora = rango ? palletsPorHora(delTurno, rango.inicio, rango.fin) : []
  const porHoraAyer = rango ? palletsPorHora(delTurnoAyer, new Date(rango.inicio.getTime() - 86_400_000), new Date(rango.fin.getTime() - 86_400_000)) : []
  const horaActual = esAhora && rango ? Math.floor((ahora.getTime() - rango.inicio.getTime()) / 3_600_000) : null
  const ultimaHora = horaActual !== null ? porHora[horaActual]?.pallets ?? 0 : null
  const horasCorridas = rango ? Math.max(1, (corte.getTime() - rango.inicio.getTime()) / 3_600_000) : 1
  const promedioHora = Math.round((resumen.pallets / horasCorridas) * 10) / 10
  const sinCargar = minutosSinCargar(resumen.ultimo ?? (esAhora && rango ? rango.inicio : null), ahora)
  const alertaParado = esAhora && sinCargar !== null && sinCargar >= ALERTA_SIN_CARGAR_MIN

  // Producido contra vendido.
  const [periodo, setPeriodo] = useState<Periodo>('hoy')
  const perDesde = periodo === '30d' ? sumarDias(aDia(ahora), -29) : periodo === '7d' ? sumarDias(aDia(ahora), -6) : periodo === 'turno' ? dia : aDia(ahora)
  const perHasta = periodo === 'turno' ? dia : aDia(ahora)
  const { data: ventasDias } = useFirestoreSubscription<VentasProductoDia[]>((cb) => subscribeVentasProducto(perDesde, perHasta, cb), [perDesde, perHasta], [])
  const perIni = useMemo(() => new Date(`${perDesde}T00:00:00`), [perDesde])
  const perFin = useMemo(() => new Date(`${sumarDias(perHasta, 1)}T00:00:00`), [perHasta])
  const { data: palletsPeriodo } = useFirestoreSubscription<PalletProduccion[]>(
    (cb) => subscribePalletsEnRango(perIni, perFin, cb), [perIni.getTime(), perFin.getTime()], [],
  )
  const productos = productosDePlanta(planta).map((p) => p.id)
  const filasPV = useMemo(() => producidoVsVendido(
    periodo === 'turno' ? delTurno : palletsPeriodo.filter((p) => p.plantaId === planta),
    vendidoDePlanta(ventasDias, planta),
    productos,
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `productos` sale de `planta`
  ), [periodo, delTurno, palletsPeriodo, ventasDias, planta])

  // Comparativa de turnos (2026-09-26): los turnos compiten entre sí.
  const [periodoComp, setPeriodoComp] = useState<'hoy' | '7d' | '30d'>('7d')
  const nDias = periodoComp === '30d' ? 30 : periodoComp === '7d' ? 7 : 1
  const diasComp = useMemo(() => Array.from({ length: nDias }, (_, i) => sumarDias(aDia(ahora), i - nDias + 1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se rearma por día, no por cada tick de 30 s
    [nDias, aDia(ahora)])
  const compIni = useMemo(() => new Date(`${diasComp[0]}T00:00:00`), [diasComp])
  const compFin = useMemo(() => new Date(`${sumarDias(diasComp[diasComp.length - 1]!, 1)}T12:00:00`), [diasComp])
  const { data: palletsComp } = useFirestoreSubscription<PalletProduccion[]>(
    (cb) => subscribePalletsEnRango(compIni, compFin, cb), [compIni.getTime(), compFin.getTime()], [],
  )
  const comparativa = useMemo(() => compararTurnos(
    palletsComp.filter((p) => p.plantaId === planta), turnos, diasComp,
    (p) => p.turno ?? fotoTurno(p.fechaFabricacion.toDate(), turnos),
  ), [palletsComp, planta, turnos, diasComp])

  // Tablet: en línea si avisó en los últimos 3 minutos.
  const minTablet = tablet?.ultimaActividad ? Math.floor((ahora.getTime() - tablet.ultimaActividad.toDate().getTime()) / 60_000) : null
  const tabletEnLinea = minTablet !== null && minTablet <= 3
  const zebraOk = tablet?.impresora.estado === 'conectada' || tablet?.impresora.estado === 'imprimiendo'

  const irA = (d: string, i: number) => setEleccion({ dia: d, idx: i })

  return (
    <main className="max-w-[1600px] mx-auto p-4 space-y-4 pb-10">
      {/* Encabezado: planta y selector de turno (trazabilidad). */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Factory size={24} /> Producción</h1>
          <p className="text-secundario text-sm">Panel del encargado · {PLANTAS[planta].label}</p>
        </div>
        <div className="flex items-center gap-2">
          {(Object.keys(PLANTAS) as PlantaId[]).map((p) => (
            <button key={p} type="button" onClick={() => setPlanta(p)}
              className={`h-10 px-4 rounded-xl text-sm font-bold ${planta === p ? 'bg-gray-900 text-white' : 'bg-white border border-[#D3D1C7] text-gray-900'}`}>
              {PLANTAS[p].label}
            </button>
          ))}
        </div>
      </div>

      <div className={`${CARD} p-3 flex flex-wrap items-center gap-3`}>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Día anterior" onClick={() => irA(sumarDias(dia, -1), idx)} className="h-10 w-10 flex items-center justify-center rounded-xl border border-[#D3D1C7]"><ChevronLeft size={20} /></button>
          <input type="date" value={dia} max={aDia(ahora)} onChange={(e) => e.target.value && irA(e.target.value, idx)}
            className="h-10 px-3 rounded-xl border border-[#D3D1C7] text-sm font-semibold" />
          <button type="button" aria-label="Día siguiente" onClick={() => irA(sumarDias(dia, 1), idx)} disabled={dia >= aDia(ahora)} className="h-10 w-10 flex items-center justify-center rounded-xl border border-[#D3D1C7] disabled:opacity-40"><ChevronRight size={20} /></button>
        </div>
        <div className="flex flex-wrap gap-2">
          {turnos.map((t, i) => (
            <button key={t.nombre + i} type="button" onClick={() => irA(dia, i)}
              className={`h-10 px-4 rounded-xl text-sm font-bold ${i === idx ? 'bg-accent text-white' : 'bg-[#F1EFE8] text-gray-900'}`}>
              {t.nombre} <span className="font-semibold opacity-80">{t.desde}–{t.hasta}</span>
            </button>
          ))}
        </div>
        <button type="button" onClick={() => irA(dia, DIA_COMPLETO)}
          className={`h-10 px-4 rounded-xl text-sm font-bold ${diaCompleto ? 'bg-gray-900 text-white' : 'bg-white border-2 border-gray-900 text-gray-900'}`}>
          Día completo
        </button>
        <button type="button" onClick={() => setEleccion(null)} disabled={eleccion === null}
          className="h-10 px-4 rounded-xl text-sm font-bold border-2 border-accent text-[#0F6B4E] disabled:opacity-40">
          ● Ahora
        </button>
        <p className="ml-auto text-sm text-secundario first-letter:uppercase">
          {esAhora ? <><Badge tono="entregado">En curso</Badge>{' '}</> : null}{fechaLarga(dia).replace(/^./, (c) => c.toUpperCase())} · {nombreSel} {horarioSel}
        </p>
      </div>

      {alertaParado && (
        <Alerta>Hace {sinCargar} minutos que no se carga ningún pallet en {PLANTAS[planta].label}. ¿Máquina parada o tablet sin uso?</Alerta>
      )}
      {esAhora && !tabletEnLinea && (
        <Alerta>La tablet de carga no da señales {minTablet !== null ? `hace ${minTablet} minutos` : 'todavía'}. Fijate que esté prendida y con la pantalla de carga abierta.</Alerta>
      )}

      {/* KPIs del turno (o del día completo). */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi etiqueta={diaCompleto ? 'Pallets del día' : 'Pallets del turno'} valor={loading ? '·' : resumen.pallets} icono={<Activity size={14} />}
          pie={<Delta actual={resumen.pallets} antes={ayerMismaHora} sufijo={esAhora ? 'que ayer a esta hora' : diaCompleto ? 'que el día anterior' : 'que el mismo turno ayer'} />} />
        {diaCompleto ? (
          <Kpi etiqueta="Mejor turno del día" valor={mejorTurno && mejorTurno.pallets ? mejorTurno.nombre : '—'} icono={<Database size={14} />}
            tono={mejorTurno && mejorTurno.pallets ? 'bien' : 'normal'}
            pie={<span className="text-sm text-secundario tabular-nums">{mejorTurno && mejorTurno.pallets ? `${mejorTurno.pallets} pallets${mejorTurno.capitan ? ` · capitán ${mejorTurno.capitan}` : ''}` : 'Sin pallets'}</span>} />
        ) : (
          <Kpi etiqueta="Pallets del día" valor={hoyDia.pallets} icono={<Database size={14} />}
            pie={<span className="text-sm text-secundario tabular-nums">{hoyDia.unidades.toLocaleString('es-AR')} bolsas</span>} />
        )}
        <Kpi etiqueta={diaCompleto ? 'Kilos del día' : 'Kilos del turno'} valor={resumen.kilos} unidad="kg" icono={<Scale size={14} />}
          pie={<span className="text-sm text-secundario tabular-nums">{Math.round(resumen.kilos / 100) / 10} toneladas</span>} />
        <Kpi etiqueta="Ritmo" valor={ultimaHora ?? promedioHora} unidad={ultimaHora !== null ? 'en esta hora' : 'por hora'} icono={<Gauge size={14} />}
          pie={<span className="text-sm text-secundario tabular-nums">Promedio {diaCompleto ? 'del día' : 'del turno'}: {promedioHora} por hora</span>} />
        {esAhora ? (
          <Kpi etiqueta="Sin cargar" valor={sinCargar ?? '—'} unidad={sinCargar !== null ? 'min' : undefined} icono={<Clock size={14} />}
            tono={alertaParado ? 'alerta' : 'normal'}
            pie={<span className="text-sm text-secundario">{resumen.ultimo ? `Último pallet ${hhmm(resumen.ultimo)}` : 'Sin pallets todavía'}</span>} />
        ) : (
          // Un turno o un día que ya terminó: la hora del último pallet, no los minutos.
          <Kpi etiqueta="Último pallet" valor={resumen.ultimo ? hhmm(resumen.ultimo) : '—'} icono={<Clock size={14} />}
            pie={<span className="text-sm text-secundario">{resumen.ultimo ? resumen.ultimo.toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' }) : 'Sin pallets'}</span>} />
        )}
      </div>

      {/* Estado: tablet, Tango y calidad. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <section className={`${CARD} p-4`}>
          <h2 className="flex items-center gap-2 text-xs font-bold tracking-wider text-secundario uppercase mb-3"><Tablet size={14} /> Tablet de carga</h2>
          {tablet ? (
            <div className="space-y-2">
              <p className="flex items-center gap-2"><Badge tono={tabletEnLinea ? 'entregado' : 'cancelado'}>{tabletEnLinea ? 'En línea' : 'Sin señal'}</Badge>
                <span className="text-sm text-secundario">{minTablet !== null ? (minTablet === 0 ? 'ahora' : `hace ${minTablet} min`) : ''}</span></p>
              <p className="text-sm text-gray-900">Operario: <b>{tablet.operario.nombre}</b></p>
              <p className="flex items-center gap-2 text-sm"><Printer size={16} />
                <Badge tono={zebraOk ? 'entregado' : 'aviso'}>{zebraOk ? 'Impresora conectada' : 'Impresora desconectada'}</Badge></p>
              <p className={`text-sm font-bold ${tablet.enCola > 0 ? 'text-amber-800' : 'text-secundario'}`}>
                {tablet.enCola > 0 ? `${tablet.enCola} etiqueta${tablet.enCola === 1 ? '' : 's'} esperando la impresora` : 'Sin etiquetas pendientes'}
              </p>
            </div>
          ) : <p className="text-sm text-secundario">La tablet todavía no se conectó con la versión nueva.</p>}
        </section>

        <section className={`${CARD} p-4`}>
          <h2 className="flex items-center gap-2 text-xs font-bold tracking-wider text-secundario uppercase mb-3"><Database size={14} /> Tango (stock)</h2>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-[#E6F5EF] p-2"><p className="text-2xl font-black tabular-nums text-[#0F6B4E]">{resumen.tango.confirmados}</p><p className="text-xs font-bold text-[#0F6B4E]">En Tango</p></div>
            <div className="rounded-xl bg-[#F1EFE8] p-2"><p className="text-2xl font-black tabular-nums text-gray-900">{resumen.tango.pendientes}</p><p className="text-xs font-bold text-secundario">Esperando</p></div>
            <div className={`rounded-xl p-2 ${resumen.tango.errores.length ? 'bg-red-50' : 'bg-[#F1EFE8]'}`}><p className={`text-2xl font-black tabular-nums ${resumen.tango.errores.length ? 'text-red-700' : 'text-gray-900'}`}>{resumen.tango.errores.length}</p><p className="text-xs font-bold text-secundario">Con error</p></div>
          </div>
          {resumen.tango.errores.length > 0 && (
            <ul className="mt-3 space-y-1">
              {resumen.tango.errores.slice(0, 4).map((p) => (
                <li key={p.id} className="text-xs"><Link to={`/produccion/ficha/${p.id}`} className="font-bold text-red-700 hover:underline">{p.codigo}</Link> <span className="text-secundario">{p.tango?.ultimoError}</span></li>
              ))}
            </ul>
          )}
        </section>

        <section className={`${CARD} p-4`}>
          <h2 className="flex items-center gap-2 text-xs font-bold tracking-wider text-secundario uppercase mb-3"><ShieldCheck size={14} /> Calidad de carga</h2>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className={`rounded-xl p-2 ${resumen.anulados.length ? 'bg-amber-50' : 'bg-[#F1EFE8]'}`}><p className="text-2xl font-black tabular-nums">{resumen.anulados.length}</p><p className="text-xs font-bold text-secundario">Anulados</p></div>
            <div className={`rounded-xl p-2 ${resumen.repetidos ? 'bg-amber-50' : 'bg-[#F1EFE8]'}`}><p className="text-2xl font-black tabular-nums">{resumen.repetidos}</p><p className="text-xs font-bold text-secundario">Repetidos confirmados</p></div>
          </div>
          {resumen.anulados.length > 0 && (
            <ul className="mt-3 space-y-1">
              {resumen.anulados.slice(0, 4).map((p) => (
                <li key={p.id} className="text-xs"><Link to={`/produccion/ficha/${p.id}`} className="font-bold text-gray-900 hover:underline">{p.codigo}</Link> <span className="text-secundario">{p.anulacion?.motivo}</span></li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Ritmo por hora y equipo del turno. */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        <section className={`${CARD} p-4 lg:col-span-3`}>
          <h2 className="flex items-center gap-2 text-xs font-bold tracking-wider text-secundario uppercase mb-3"><Activity size={14} /> Pallets por hora · {nombreSel} {horarioSel}</h2>
          {porHora.length ? <BarrasPorHora hoy={porHora} ayer={porHoraAyer} horaActual={horaActual} leyenda={diaCompleto ? ['Este día', 'Día anterior'] : ['Este turno', 'Mismo turno ayer']} /> : <p className="text-sm text-secundario">Horario del turno inválido.</p>}
        </section>
        <section className={`${CARD} p-4 lg:col-span-2`}>
          <h2 className="flex items-center gap-2 text-xs font-bold tracking-wider text-secundario uppercase mb-3"><Users size={14} /> {diaCompleto ? 'Equipo del día' : 'Equipo del turno'}</h2>
          <EquipoTurno equipo={resumen.equipo} />
        </section>
      </div>

      {/* Comparativa de turnos. */}
      <section className={`${CARD} p-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h2 className="text-base font-black text-gray-900">Comparativa de turnos</h2>
          <div className="flex gap-2">
            {([['hoy', 'Hoy'], ['7d', '7 días'], ['30d', '30 días']] as ['hoy' | '7d' | '30d', string][]).map(([p, l]) => (
              <button key={p} type="button" onClick={() => setPeriodoComp(p)}
                className={`h-9 px-3 rounded-xl text-sm font-bold ${periodoComp === p ? 'bg-accent text-white' : 'bg-[#F1EFE8] text-gray-900'}`}>{l}</button>
            ))}
          </div>
        </div>
        <ComparativaTurnos turnos={comparativa.turnos} capitanes={comparativa.capitanes} dias={diasComp} />
      </section>

      {/* Producido contra vendido. */}
      <section className={`${CARD} p-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h2 className="text-base font-black text-gray-900">Producido contra vendido</h2>
          <div className="flex gap-2">
            {([['turno', diaCompleto ? 'Este día' : 'Este turno'], ['hoy', 'Hoy'], ['7d', '7 días'], ['30d', '30 días']] as [Periodo, string][]).map(([p, l]) => (
              <button key={p} type="button" onClick={() => setPeriodo(p)}
                className={`h-9 px-3 rounded-xl text-sm font-bold ${periodo === p ? 'bg-accent text-white' : 'bg-[#F1EFE8] text-gray-900'}`}>{l}</button>
            ))}
          </div>
        </div>
        <ProducidoVendido filas={filasPV} />
        <p className="mt-3 text-xs text-secundario">
          Vendido = ventas reales de la calle y la ventanilla de {PLANTAS[planta].label}, sin anuladas ni cambios, pasadas a pallets. Se actualiza cada 15 minutos.
          La producción se registra en la app desde el 28/09/2026: antes de esa fecha el producido sale en cero.
        </p>
      </section>

      {/* Pallets del turno o del día (trazabilidad). */}
      <section className={`${CARD} p-4`}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-black text-gray-900">{diaCompleto ? 'Pallets del día' : 'Pallets del turno'} ({delTurno.length})</h2>
          <Link to="/produccion/listado" className="toque text-sm font-bold text-[#0F6B4E] hover:underline">Ver listado completo →</Link>
        </div>
        {delTurno.length === 0 ? (
          <p className="text-sm text-secundario">No se cargaron pallets {diaCompleto ? 'este día' : 'en este turno'}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-secundario border-b border-[#E7E5DC]">
                  <th className="py-2 pr-3">Hora</th>{diaCompleto && <th className="py-2 pr-3">Turno</th>}<th className="py-2 pr-3">Código</th><th className="py-2 pr-3">Producto</th>
                  <th className="py-2 pr-3 text-right">Unidades</th><th className="py-2 pr-3">Operario</th><th className="py-2 pr-3">Tango</th><th className="py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {[...delTurno].sort((a, b) => b.fechaFabricacion.toMillis() - a.fechaFabricacion.toMillis()).map((p) => (
                  <tr key={p.id} className="border-b border-[#E7E5DC] last:border-0">
                    <td className="py-2 pr-3 tabular-nums">{hhmm(p.fechaFabricacion.toDate())}</td>
                    {diaCompleto && <td className="py-2 pr-3 font-semibold">{(p.turno ?? fotoTurno(p.fechaFabricacion.toDate(), turnos)).nombre}</td>}
                    <td className="py-2 pr-3"><Link to={`/produccion/ficha/${p.id}`} className={`font-bold text-[#0F6B4E] hover:underline ${p.anulacion ? 'line-through' : ''}`}>{p.codigo}</Link></td>
                    <td className="py-2 pr-3 font-bold" style={{ color: PRODUCTOS_HIELO[p.productoId]?.color }}>{PRODUCTOS_HIELO[p.productoId]?.etiquetaGrilla}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{p.unidades}</td>
                    <td className="py-2 pr-3 truncate max-w-[12rem]" title={p.operador.nombre}>{p.operador.nombre}</td>
                    <td className="py-2 pr-3">
                      {p.tango?.estado === 'confirmado' ? <Badge tono="entregado">{p.tango.numero}</Badge>
                        : p.tango?.estado === 'error' ? <Badge tono="cancelado">Error</Badge>
                          : <Badge tono="pendiente">Esperando</Badge>}
                    </td>
                    <td className="py-2">
                      {p.anulacion ? <Badge tono="cancelado">Anulado</Badge>
                        : p.avisoRepetidoSeg != null ? <Badge tono="aviso">Repetido</Badge>
                          : <Badge tono="entregado">OK</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
