import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, History } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { subscribeLiquidacionesEnRango } from '@/services/liquidacionService'
import { formatoARS } from '@/utils/money'
import { coincideBusqueda } from '@/utils/busqueda'
import { codigoDeEntregaId } from '@/utils/entregaTesoreria'
import { useDiaActual } from '@/hooks/useDiaActual'
import { Liquidacion, MOTIVOS_DIFERENCIA_LIQUIDACION, PLANTAS } from '@/types'
import AnuladasDespuesDeCerrar from '@/components/expedicion/AnuladasDespuesDeCerrar'
import HistorialTable, { BarraHistorial, type ColumnaHistorial } from '@/components/common/HistorialTable'

// Historial de liquidaciones (2026-09-06): mes × repartidor, con la diferencia
// de efectivo de cada cierre y los totales por repartidor, para ver quién
// viene con faltantes repetidos. Cada fila abre el cierre en modo lectura.
// La tabla, el vacío, el paginador y el CSV salen de HistorialTable (fase 3.2).

interface PorRepartidor {
  id: string; nombre: string; deposito?: string; cierres: number
  aRendir: number; recibido: number; diferencia: number; conDiferencia: number; valoresFaltantes: number
}

const dif = (n: number) => (
  <span className={`tabular-nums font-semibold ${n === 0 ? 'text-gray-500' : n < 0 ? 'text-red-600' : 'text-amber-700'}`}>{formatoARS(n)}</span>
)
const plata = (n: number) => <span className="tabular-nums">{formatoARS(n)}</span>

export default function LiquidacionesHistorialPage({ base }: { base: '/caja' | '/tesoreria' }) {
  const { user } = useAuth()
  const hoy = useDiaActual()
  const [mes, setMes] = useState(hoy.slice(0, 7))
  const [liquidaciones, setLiquidaciones] = useState<Liquidacion[]>([])
  const [cargando, setCargando] = useState(true)
  const [filtroChofer, setFiltroChofer] = useState('')
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    setCargando(true)
    const desde = `${mes}-01`
    const [y, m] = mes.split('-').map(Number)
    const hasta = `${new Date(y, m, 1).getFullYear()}-${String(new Date(y, m, 1).getMonth() + 1).padStart(2, '0')}-01`
    return subscribeLiquidacionesEnRango(desde, hasta, (l) => { setLiquidaciones(l); setCargando(false) }, user?.planta)
  }, [mes, user?.planta])

  const porRepartidor = useMemo(() => {
    const m = new Map<string, PorRepartidor>()
    for (const l of liquidaciones) {
      let r = m.get(l.choferId)
      if (!r) { r = { id: l.choferId, nombre: l.choferNombre, deposito: l.depositoTango, cierres: 0, aRendir: 0, recibido: 0, diferencia: 0, conDiferencia: 0, valoresFaltantes: 0 }; m.set(l.choferId, r) }
      r.cierres++
      r.aRendir += l.efectivoARendir
      r.recibido += l.efectivoRecibido
      r.diferencia += l.diferenciaEfectivo
      r.valoresFaltantes += l.valoresFaltantes?.cantidad ?? 0
      if (l.diferenciaEfectivo !== 0) r.conDiferencia++
    }
    return [...m.values()].sort((a, b) => a.diferencia - b.diferencia || a.nombre.localeCompare(b.nombre, 'es'))
  }, [liquidaciones])

  const filas = useMemo(
    () => liquidaciones
      .filter((l) => !filtroChofer || l.choferId === filtroChofer)
      .filter((l) => !busqueda.trim() || coincideBusqueda(busqueda, l.choferNombre, l.codigo, l.depositoTango, l.fecha, l.cerradaPor.nombre))
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || a.choferNombre.localeCompare(b.choferNombre, 'es')),
    [liquidaciones, filtroChofer, busqueda],
  )
  const totalDiferencia = liquidaciones.reduce((s, l) => s + l.diferenciaEfectivo, 0)

  const columnasResumen: ColumnaHistorial<PorRepartidor>[] = [
    { titulo: 'Repartidor', csv: (r) => `${r.deposito ? `${r.deposito} · ` : ''}${r.nombre}`, celda: (r) => (
      <button type="button" onClick={() => setFiltroChofer(filtroChofer === r.id ? '' : r.id)} className="text-left hover:text-accent">
        {r.deposito ? <span className="text-gray-500 mr-1.5">{r.deposito}</span> : null}{r.nombre}
      </button>
    ) },
    { titulo: 'Cierres',   alinear: 'der', csv: (r) => r.cierres,   celda: (r) => <span className="tabular-nums">{r.cierres}</span> },
    { titulo: 'A rendir',  alinear: 'der', csv: (r) => r.aRendir,   celda: (r) => plata(r.aRendir) },
    { titulo: 'Recibido',  alinear: 'der', csv: (r) => r.recibido,  celda: (r) => plata(r.recibido) },
    { titulo: 'Diferencia', alinear: 'der', csv: (r) => r.diferencia, celda: (r) => dif(r.diferencia) },
    { titulo: 'Con diferencia', alinear: 'der', csv: (r) => r.conDiferencia, celda: (r) => (
      <span className="tabular-nums">{r.conDiferencia ? <span className="text-red-600 font-semibold">{r.conDiferencia}</span> : '0'}</span>
    ) },
    { titulo: 'Valores faltantes', alinear: 'der', csv: (r) => r.valoresFaltantes, celda: (r) => (
      <span className="tabular-nums">{r.valoresFaltantes ? <span className="text-red-600 font-semibold">{r.valoresFaltantes}</span> : '0'}</span>
    ) },
  ]

  const columnasCierres: ColumnaHistorial<Liquidacion>[] = [
    { titulo: 'Fecha', csv: (l) => l.fecha, celda: (l) => (
      <Link to={`${base}/liquidaciones?fecha=${l.fecha}&repartidor=${encodeURIComponent(l.choferId)}`} className="text-accent underline underline-offset-2">{l.fecha}</Link>
    ) },
    { titulo: 'Código', csv: (l) => l.codigo ?? '', celda: (l) => <span className="text-gray-600">{l.codigo ?? '—'}</span> },
    { titulo: 'Repartidor', csv: (l) => `${l.depositoTango ? `${l.depositoTango} · ` : ''}${l.choferNombre}`, celda: (l) => (
      <>{l.depositoTango ? <span className="text-gray-500 mr-1.5">{l.depositoTango}</span> : null}{l.choferNombre}</>
    ) },
    { titulo: 'Ventas',    alinear: 'der', csv: (l) => l.cantidadVentas ?? '', celda: (l) => <span className="tabular-nums">{l.cantidadVentas ?? '—'}</span> },
    { titulo: 'Cobranzas', alinear: 'der', csv: (l) => l.cantidadCobranzas ?? l.cobranzasCalle?.cantidad ?? '', celda: (l) => (
      <span className="tabular-nums">{l.cantidadCobranzas ?? l.cobranzasCalle?.cantidad ?? '—'}</span>
    ) },
    { titulo: 'A rendir',  alinear: 'der', csv: (l) => l.efectivoARendir,  celda: (l) => plata(l.efectivoARendir) },
    { titulo: 'Recibido',  alinear: 'der', csv: (l) => l.efectivoRecibido, celda: (l) => plata(l.efectivoRecibido) },
    { titulo: 'Diferencia', alinear: 'der', csv: (l) => l.diferenciaEfectivo, celda: (l) => dif(l.diferenciaEfectivo) },
    { titulo: 'Valores falt.', alinear: 'der', csv: (l) => l.valoresFaltantes?.cantidad ?? '', celda: (l) => (
      <span className="tabular-nums">{l.valoresFaltantes?.cantidad
        ? <span className="text-red-600 font-semibold">{l.valoresFaltantes.cantidad} · {formatoARS(l.valoresFaltantes.total)}</span>
        : '—'}</span>
    ) },
    { titulo: 'Motivo', csv: (l) => (l.diferencia ? `${MOTIVOS_DIFERENCIA_LIQUIDACION[l.diferencia.motivo]}${l.diferencia.nota ? ` · ${l.diferencia.nota}` : ''}` : ''), celda: (l) => (
      <span className="text-gray-600">
        {l.diferencia ? `${MOTIVOS_DIFERENCIA_LIQUIDACION[l.diferencia.motivo]}${l.diferencia.nota ? ` · ${l.diferencia.nota}` : ''}` : ''}
        {l.anulacionesPosteriores?.length ? <span className="block"><AnuladasDespuesDeCerrar anulaciones={l.anulacionesPosteriores} compacto /></span> : null}
      </span>
    ) },
    { titulo: 'Cerró', csv: (l) => `${l.cerradaPor.nombre}${l.firmanteRepartidor ? ' · firmó' : ''}${l.firmaRecibe ? ' · recibió' : ''}`, celda: (l) => (
      <span className="text-gray-600">{l.cerradaPor.nombre}{l.firmanteRepartidor ? ' · firmó' : ''}{l.firmaRecibe ? ' · recibió' : ''}</span>
    ) },
    { titulo: 'Entrega', csv: (l) => (l.entregaId ? codigoDeEntregaId(l.entregaId) : l.entregaId === null ? 'en caja' : ''), celda: (l) => (
      <span className="text-xs">{l.entregaId
        ? <span className="text-[#0F6B4E]">{codigoDeEntregaId(l.entregaId)}</span>
        : l.entregaId === null ? <span className="text-amber-700">en caja</span> : '—'}</span>
    ) },
  ]

  const planta = user?.planta ? PLANTAS[user.planta].label : 'Todas las plantas'

  return (
    <main className="max-w-5xl mx-auto p-4 space-y-4 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to={`${base}/liquidaciones`} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-accent mb-1"><ArrowLeft size={14} /> Liquidación del día</Link>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><History size={22} className="text-accent" /> Historial de liquidaciones</h1>
          <p className="text-gray-500 text-sm">{planta} · todos los cierres del mes, con su diferencia de efectivo</p>
        </div>
        <BarraHistorial
          mes={{ valor: mes, max: hoy.slice(0, 7), onChange: (m) => { setMes(m); setFiltroChofer('') } }}
          selects={[{
            valor: filtroChofer,
            onChange: setFiltroChofer,
            etiqueta: 'Repartidor',
            opciones: [{ value: '', label: 'Todos los repartidores' }, ...porRepartidor.map((r) => ({ value: r.id, label: `${r.deposito ? `${r.deposito} · ` : ''}${r.nombre}` }))],
          }]}
          buscador={{ valor: busqueda, onChange: setBusqueda, placeholder: 'Repartidor, código, fecha…' }}
        />
      </div>

      <HistorialTable
        titulo="Por repartidor"
        resumen={<span className="text-sm text-gray-600">{liquidaciones.length} cierres · diferencia del mes {dif(totalDiferencia)}</span>}
        columnas={columnasResumen}
        filas={porRepartidor}
        claveDe={(r) => r.id}
        cargando={cargando}
        filaResaltada={(r) => filtroChofer === r.id}
        vacio="Sin liquidaciones cerradas en este mes."
        anchoMinimo={640}
        exportar={`Liquidaciones por repartidor ${mes}`}
      />

      <HistorialTable
        titulo="Cierres"
        columnas={columnasCierres}
        filas={filas}
        claveDe={(l) => l.id}
        cargando={cargando}
        vacio="Sin cierres."
        anchoMinimo={760}
        porPagina={50}
        exportar={`Liquidaciones ${mes}`}
      />
    </main>
  )
}
