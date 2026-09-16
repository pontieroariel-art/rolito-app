import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Banknote, ClipboardList, Package, RefreshCw, Scale, Truck } from 'lucide-react'
import PageHeader from '@/components/common/PageHeader'
import StatusStrip from '@/components/common/StatusStrip'
import Badge, { type TonoBadge } from '@/components/common/Badge'
import HistorialTable, { type ColumnaHistorial } from '@/components/common/HistorialTable'
import { useAuth } from '@/context/AuthContext'
import { useDiaActual } from '@/hooks/useDiaActual'
import { useDepositosReparto } from '@/hooks/useDepositosReparto'
import { cargarLiquidacionesAbiertas, DIAS_ATRAS_DEFAULT } from '@/services/liquidacionesAbiertasService'
import { reportError } from '@/services/observability'
import { identidadDeposito } from '@/utils/depositos'
import { formatoARS } from '@/utils/money'
import { totalesAbiertas, type EstadoAbierta, type LiquidacionAbierta } from '@/utils/liquidacionesAbiertas'
import { PLANTAS, type PlantaId } from '@/types'

// Liquidaciones abiertas (2026-09-16, pedido de la oficina): camiones y
// cobradores de cualquier fecha que todavía no se liquidaron, con la
// mercadería pendiente de devolver y la plata pendiente de rendir. Es una
// consulta puntual (botón Actualizar), no un stream: mira hasta 45 días atrás.
// Cada fila lleva a la liquidación de esa persona y ese día para cerrarla.

const ESTADO: Record<EstadoAbierta, { texto: string; tono: TonoBadge }> = {
  en_calle:       { texto: 'En la calle',      tono: 'enCamino' },
  volvio:         { texto: 'Volvió, sin contar', tono: 'pendiente' },
  descargado:     { texto: 'Descarga contada', tono: 'confirmado' },
  solo_cobranzas: { texto: 'Solo cobranzas',   tono: 'neutro' },
}

const plata = (n: number) => <span className="tabular-nums">{formatoARS(n)}</span>
const hora = (d: Date | null) => d ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : ''

export default function LiquidacionesAbiertasPage({ base }: { base: '/caja' | '/tesoreria' }) {
  const { user } = useAuth()
  const hoy = useDiaActual()
  const { depositos } = useDepositosReparto()
  const [filas, setFilas] = useState<LiquidacionAbierta[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(false)
  const [actualizado, setActualizado] = useState<Date | null>(null)
  // Caja ve su planta; tesorería y gerencia, todas o una.
  const [planta, setPlanta] = useState<PlantaId | 'todas'>(user?.planta ?? 'todas')

  const cargar = useCallback(async () => {
    setCargando(true); setError(false)
    try { setFilas(await cargarLiquidacionesAbiertas(hoy)); setActualizado(new Date()) }
    catch (err) { reportError(err, { origen: 'LiquidacionesAbiertasPage' }); setError(true) }
    finally { setCargando(false) }
  }, [hoy])
  useEffect(() => { void cargar() }, [cargar])

  // Código de depósito de Tango de cada persona, para la columna Repartidor.
  const depositoDe = useMemo(() => new Map(depositos.map((d) => [identidadDeposito(d), d.codigo])), [depositos])

  const visibles = useMemo(
    () => planta === 'todas' ? filas : filas.filter((f) => f.plantaId === planta || (f.plantaId === null && user?.planta === planta)),
    [filas, planta, user?.planta],
  )
  const totales = useMemo(() => totalesAbiertas(visibles), [visibles])

  const columnas: ColumnaHistorial<LiquidacionAbierta>[] = [
    { titulo: 'Día', csv: (f) => f.fecha, celda: (f) => (
      <span className="whitespace-nowrap">
        <span className="tabular-nums">{f.fecha.slice(8, 10)}/{f.fecha.slice(5, 7)}</span>
        {f.diasAbierta === 0
          ? <span className="ml-1.5 text-xs text-secundario">hoy</span>
          : <span className="ml-1.5 text-xs font-semibold text-red-700">hace {f.diasAbierta} {f.diasAbierta === 1 ? 'día' : 'días'}</span>}
      </span>
    ) },
    { titulo: 'Repartidor', truncar: true, anchoMax: 240, csv: (f) => `${depositoDe.get(f.choferId) ? `${depositoDe.get(f.choferId)} · ` : ''}${f.choferNombre}`, celda: (f) => (
      <span className="font-medium text-gray-900">{depositoDe.get(f.choferId) && <span className="text-secundario font-normal">{depositoDe.get(f.choferId)} · </span>}{f.choferNombre}</span>
    ) },
    { titulo: 'Planta', csv: (f) => f.plantaId ? PLANTAS[f.plantaId].label : '', celda: (f) => <span className="text-secundario">{f.plantaId ? PLANTAS[f.plantaId].label : '—'}</span> },
    { titulo: 'Remitos', truncar: true, anchoMax: 200, csv: (f) => f.remitos.map((r) => r.codigo).join(' '), celda: (f) => (
      f.remitos.length ? <span className="tabular-nums text-secundario">{f.remitos.map((r) => r.codigo).join(' · ')}</span> : <span className="text-secundario">—</span>
    ) },
    { titulo: 'Estado', csv: (f) => ESTADO[f.estado].texto, celda: (f) => (
      <span className="whitespace-nowrap"><Badge tono={ESTADO[f.estado].tono}>{ESTADO[f.estado].texto}</Badge>{f.estado === 'volvio' && f.regresoHora && <span className="ml-1.5 text-xs text-secundario tabular-nums">{hora(f.regresoHora)}</span>}</span>
    ) },
    { titulo: 'Cargó', alinear: 'der', csv: (f) => f.cargaBultos, celda: (f) => f.cargaBultos || <span className="text-secundario">—</span> },
    { titulo: 'Vendió', alinear: 'der', csv: (f) => f.bultosVendidos, celda: (f) => f.bultosVendidos || <span className="text-secundario">—</span> },
    { titulo: 'Sin devolver', alinear: 'der', csv: (f) => f.bultosSinDevolver, celda: (f) => (
      f.estado === 'solo_cobranzas' ? <span className="text-secundario">—</span>
        : f.hayDescarga
          ? (f.bultosSinDevolver > 0 ? <span className="font-semibold text-red-700">faltan {f.bultosSinDevolver}</span> : <span className="text-secundario">cuadra{f.bultosSobrantes > 0 ? ` (+${f.bultosSobrantes})` : ''}</span>)
          : <span className="font-semibold text-gray-900">{f.bultosSinDevolver}</span>
    ) },
    { titulo: 'Ventas', alinear: 'der', csv: (f) => f.ventasTotal, celda: (f) => f.ventasCantidad ? <span><span className="text-secundario">{f.ventasCantidad} · </span>{plata(f.ventasTotal)}</span> : <span className="text-secundario">—</span> },
    { titulo: 'Cobranzas', alinear: 'der', csv: (f) => f.cobranzasTotal, celda: (f) => f.cobranzasCantidad ? <span><span className="text-secundario">{f.cobranzasCantidad} · </span>{plata(f.cobranzasTotal)}</span> : <span className="text-secundario">—</span> },
    { titulo: 'Efectivo a rendir', alinear: 'der', csv: (f) => f.efectivoARendir, celda: (f) => <span className="font-semibold text-gray-900">{plata(f.efectivoARendir)}</span> },
    { titulo: '', sinCsv: true, celda: (f) => (
      <Link to={`${base}/liquidaciones?fecha=${f.fecha}&repartidor=${encodeURIComponent(f.choferId)}`}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-[#D3D1C7] bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-800 hover:border-accent hover:text-accent">
        <Scale size={13} /> {base === '/caja' ? 'Liquidar' : 'Ver'}
      </Link>
    ) },
  ]

  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2] text-gray-900">
      <main className="max-w-[1600px] mx-auto p-4 space-y-4 pb-10">
        <PageHeader
          titulo="Liquidaciones abiertas"
          icono={<ClipboardList size={22} />}
          contexto={<>Camiones y cobradores sin liquidar · últimos {DIAS_ATRAS_DEFAULT} días{actualizado ? <> · actualizado {hora(actualizado)}</> : null}</>}
          volver={{ to: `${base}/liquidaciones`, etiqueta: 'Liquidaciones' }}
          acciones={(
            <div className="flex items-center gap-2">
              {!user?.planta && (
                <select value={planta} onChange={(e) => setPlanta(e.target.value as PlantaId | 'todas')}
                  className="h-9 rounded-lg border border-[#D3D1C7] bg-white px-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent">
                  <option value="todas">Todas las plantas</option>
                  {(Object.keys(PLANTAS) as PlantaId[]).map((p) => <option key={p} value={p}>{PLANTAS[p].label}</option>)}
                </select>
              )}
              <button type="button" onClick={() => void cargar()} disabled={cargando}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#D3D1C7] bg-white px-3 text-sm font-semibold text-gray-800 hover:border-accent hover:text-accent disabled:opacity-50">
                <RefreshCw size={14} className={cargando ? 'animate-spin' : ''} /> Actualizar
              </button>
            </div>
          )}
        />

        <StatusStrip segmentos={[
          { id: 'abiertas',  etiqueta: 'Abiertas',            valor: totales.abiertas,          icono: <Truck size={16} />,    tono: 'neutro' },
          { id: 'viejas',    etiqueta: 'De días anteriores',  valor: totales.diasAnteriores,    icono: <ClipboardList size={16} />, tono: 'cancelado', alerta: true },
          { id: 'bultos',    etiqueta: 'Bolsas sin devolver', valor: totales.bultosSinDevolver, icono: <Package size={16} />,  tono: 'pendiente', alerta: true },
          { id: 'efectivo',  etiqueta: 'Efectivo sin rendir', valor: totales.efectivoARendir,   icono: <Banknote size={16} />, tono: 'confirmado', formato: formatoARS },
        ]} />

        <HistorialTable
          columnas={columnas}
          filas={visibles}
          claveDe={(f) => f.clave}
          cargando={cargando && filas.length === 0}
          error={error}
          onReintentar={() => void cargar()}
          vacio="No hay liquidaciones abiertas: todos los camiones y cobradores de los últimos días están cerrados."
          filaResaltada={(f) => f.diasAbierta > 0}
          exportar="liquidaciones-abiertas"
          anchoMinimo={1100}
        />

        <p className="text-xs text-secundario">
          "Sin devolver" es carga − ventas − cambios mientras el camión no fue contado por muelle; con la descarga contada pasa a ser lo que falta contra ese conteo.
          El efectivo a rendir suma las ventas en efectivo y las cobranzas en efectivo del día.
        </p>
      </main>
    </div>
  )
}
