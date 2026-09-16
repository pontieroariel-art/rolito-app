import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { History } from 'lucide-react'
import PageHeader from '@/components/common/PageHeader'
import Badge from '@/components/common/Badge'
import { useAuth } from '@/context/AuthContext'
import { subscribeLiquidacionesEnRango } from '@/services/liquidacionService'
import { formatoARS } from '@/utils/money'
import { coincideBusqueda } from '@/utils/busqueda'
import { codigoDeEntregaId } from '@/utils/entregaTesoreria'
import { useDiaActual } from '@/hooks/useDiaActual'
import { Liquidacion, MOTIVOS_DESVIO_DESCARGA, MOTIVOS_DIFERENCIA_LIQUIDACION, PLANTAS } from '@/types'
import AnuladasDespuesDeCerrar from '@/components/expedicion/AnuladasDespuesDeCerrar'
import HistorialTable, { BarraHistorial, type ColumnaHistorial } from '@/components/common/HistorialTable'

// Historial de liquidaciones (2026-09-06): mes × repartidor, con la diferencia
// de efectivo de cada cierre y los totales por repartidor, para ver quién
// viene con faltantes repetidos. Cada fila abre el cierre en modo lectura.
// La tabla, el vacío, el paginador y el CSV salen de HistorialTable (fase 3.2).

interface PorRepartidor {
  id: string; nombre: string; deposito?: string; cierres: number
  aRendir: number; recibido: number; diferencia: number; conDiferencia: number; valoresFaltantes: number
  // Cierres con faltante de MERCADERÍA observado (2026-09-13) y bolsas en total:
  // es el número que muestra a quién se le repite el desvío.
  conDesvio: number; bolsasFaltantes: number
}

// Una diferencia en cero no es noticia: pierde el color y queda en el gris
// secundario, que igual se lee. `tabular-nums` lo pone la columna (alinear 'der').
const dif = (n: number) => (
  <span className={`font-semibold ${n === 0 ? 'text-secundario' : n < 0 ? 'text-red-600' : 'text-amber-700'}`}>{formatoARS(n)}</span>
)
const plata = (n: number) => <span>{formatoARS(n)}</span>
/** '2026-09-12' → '12/09'. El mes ya lo eligió el filtro. */
const diaMes = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`
const cerroDe = (l: Liquidacion) =>
  `${l.cerradaPor.nombre}${l.firmanteRepartidor ? ' · firmó' : ''}${l.firmaRecibe ? ' · recibió' : ''}`
const motivoDe = (l: Liquidacion) =>
  (l.diferencia ? `${MOTIVOS_DIFERENCIA_LIQUIDACION[l.diferencia.motivo]}${l.diferencia.nota ? ` · ${l.diferencia.nota}` : ''}` : '')

export default function LiquidacionesHistorialPage({ base }: { base: '/caja' | '/tesoreria' | '/supervisor' }) {
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
      if (!r) { r = { id: l.choferId, nombre: l.choferNombre, deposito: l.depositoTango, cierres: 0, aRendir: 0, recibido: 0, diferencia: 0, conDiferencia: 0, valoresFaltantes: 0, conDesvio: 0, bolsasFaltantes: 0 }; m.set(l.choferId, r) }
      r.cierres++
      r.aRendir += l.efectivoARendir
      r.recibido += l.efectivoRecibido
      r.diferencia += l.diferenciaEfectivo
      r.valoresFaltantes += l.valoresFaltantes?.cantidad ?? 0
      if (l.desvio) { r.conDesvio += 1; r.bolsasFaltantes += l.desvio.bolsasFaltantes }
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
    { titulo: 'Repartidor', truncar: true, anchoMax: 260, csv: (r) => `${r.deposito ? `${r.deposito} · ` : ''}${r.nombre}`, celda: (r) => (
      <button type="button" onClick={() => setFiltroChofer(filtroChofer === r.id ? '' : r.id)} className="block max-w-full truncate text-left hover:text-accent">
        {r.deposito ? <span className="text-secundario mr-1.5">{r.deposito}</span> : null}{r.nombre}
      </button>
    ) },
    { titulo: 'Cierres',   alinear: 'der', csv: (r) => r.cierres,   celda: (r) => r.cierres },
    { titulo: 'A rendir',  alinear: 'der', csv: (r) => r.aRendir,   celda: (r) => plata(r.aRendir) },
    { titulo: 'Recibido',  alinear: 'der', csv: (r) => r.recibido,  celda: (r) => plata(r.recibido) },
    { titulo: 'Diferencia', alinear: 'der', csv: (r) => r.diferencia, celda: (r) => dif(r.diferencia) },
    { titulo: 'Con diferencia', alinear: 'der', csv: (r) => r.conDiferencia, celda: (r) => (
      r.conDiferencia ? <span className="text-red-600 font-semibold">{r.conDiferencia}</span> : <span className="text-secundario">0</span>
    ) },
    { titulo: 'Valores faltantes', alinear: 'der', csv: (r) => r.valoresFaltantes, celda: (r) => (
      r.valoresFaltantes ? <span className="text-red-600 font-semibold">{r.valoresFaltantes}</span> : <span className="text-secundario">0</span>
    ) },
    { titulo: 'Bolsas faltantes', alinear: 'der', csv: (r) => r.bolsasFaltantes, celda: (r) => (
      r.bolsasFaltantes
        ? <span className="text-red-600 font-semibold" title={`${r.conDesvio} cierre(s) con desvío observado`}>{r.bolsasFaltantes}</span>
        : <span className="text-secundario">0</span>
    ) },
  ]

  const columnasCierres: ColumnaHistorial<Liquidacion>[] = [
    { titulo: 'Fecha', csv: (l) => l.fecha, celda: (l) => (
      <Link to={`${base}/liquidaciones?fecha=${l.fecha}&repartidor=${encodeURIComponent(l.choferId)}`} className="text-accent underline underline-offset-2 whitespace-nowrap tabular-nums">{diaMes(l.fecha)}</Link>
    ) },
    { titulo: 'Código', csv: (l) => `${l.codigo ?? ''}${l.cierreArranque ? ' (cierre de arranque)' : ''}`, celda: (l) => (
      <span className="whitespace-nowrap">
        <span className="text-secundario tabular-nums">{l.codigo ?? '—'}</span>
        {/* Cerrada por script al arrancar el circuito (2026-09-16): sin firmas ni conteo real. */}
        {l.cierreArranque && <span className="ml-1.5 text-[11px] font-semibold text-amber-700" title={l.cierreArranque.motivo}>arranque</span>}
      </span>
    ) },
    { titulo: 'Repartidor', truncar: true, anchoMax: 155, csv: (l) => `${l.depositoTango ? `${l.depositoTango} · ` : ''}${l.choferNombre}`, celda: (l) => (
      <>{l.depositoTango ? <span className="text-secundario mr-1.5">{l.depositoTango}</span> : null}{l.choferNombre}</>
    ) },
    { titulo: 'Ventas',    alinear: 'der', csv: (l) => l.cantidadVentas ?? '', celda: (l) => l.cantidadVentas ?? <span className="text-secundario">—</span> },
    { titulo: 'Cobros', alinear: 'der', csv: (l) => l.cantidadCobranzas ?? l.cobranzasCalle?.cantidad ?? '', celda: (l) => (
      l.cantidadCobranzas ?? l.cobranzasCalle?.cantidad ?? <span className="text-secundario">—</span>
    ) },
    { titulo: 'A rendir',  alinear: 'der', csv: (l) => l.efectivoARendir,  celda: (l) => plata(l.efectivoARendir) },
    { titulo: 'Recibido',  alinear: 'der', csv: (l) => l.efectivoRecibido, celda: (l) => plata(l.efectivoRecibido) },
    { titulo: 'Diferencia', alinear: 'der', csv: (l) => l.diferenciaEfectivo, celda: (l) => dif(l.diferenciaEfectivo) },
    { titulo: 'Valores falt.', alinear: 'der', csv: (l) => l.valoresFaltantes?.cantidad ?? '', celda: (l) => (
      l.valoresFaltantes?.cantidad
        ? <span className="text-red-600 font-semibold">{l.valoresFaltantes.cantidad} · {formatoARS(l.valoresFaltantes.total)}</span>
        : <span className="text-secundario">—</span>
    ) },
    // Desvío de mercadería observado al cerrar: mismo criterio visual que las
    // anuladas después de cerrar — el cierre no se reabre, queda anotado.
    { titulo: 'Mercadería', alinear: 'der',
      csv: (l) => l.desvio ? `faltan ${l.desvio.bolsasFaltantes} · ${MOTIVOS_DESVIO_DESCARGA[l.desvio.motivo]}${l.desvio.autorizadoPor ? ` · autorizó ${l.desvio.autorizadoPor.nombre}` : ' · SIN autorización'}${l.desvio.nota ? ` · ${l.desvio.nota}` : ''}` : '',
      celda: (l) => l.desvio
        ? <span className={`font-semibold whitespace-nowrap ${l.desvio.autorizadoPor ? 'text-amber-700' : 'text-red-600'}`}
            title={`${l.desvio.productos.map((p) => `${p.nombre} −${p.faltan}`).join(' · ')} · ${MOTIVOS_DESVIO_DESCARGA[l.desvio.motivo]}${l.desvio.nota ? ` · ${l.desvio.nota}` : ''} · cerró ${l.desvio.observadoPor.nombre}${l.desvio.autorizadoPor ? ` · autorizó ${l.desvio.autorizadoPor.nombre}` : ' · SIN autorización'}`}>
            −{l.desvio.bolsasFaltantes} bolsas{l.desvio.autorizadoPor ? '' : ' !'}
          </span>
        : <span className="text-secundario">—</span> },
    // Una nota larga partía la fila en varios renglones y dejaba un hueco en
    // la tabla. Ahora va en una línea, con el texto completo en el tooltip, y
    // la marca de anuladas después manda: no se achica.
    { titulo: 'Motivo', anchoMax: 185, csv: (l) => motivoDe(l), celda: (l) => (
      <div className="flex items-center gap-1.5 min-w-0">
        {motivoDe(l) && <span className="truncate text-secundario" title={motivoDe(l)}>{motivoDe(l)}</span>}
        {l.anulacionesPosteriores?.length
          ? <span className="shrink-0"><AnuladasDespuesDeCerrar anulaciones={l.anulacionesPosteriores} compacto /></span>
          : null}
      </div>
    ) },
    // Quién cerró y dónde quedó la plata son el mismo momento del cierre: van
    // juntos en una columna y se ahorra un ancho que hacía scrollear la tabla.
    { titulo: 'Cerró y entregó', anchoMax: 205,
      csv: (l) => `${cerroDe(l)} · ${l.entregaId ? codigoDeEntregaId(l.entregaId) : l.entregaId === null ? 'en caja' : ''}`,
      celda: (l) => (
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate text-secundario" title={cerroDe(l)}>{cerroDe(l)}</span>
          {l.entregaId
            ? <span className="shrink-0"><Badge tono="neutro" punto={false} title={`Entregada a tesorería en ${codigoDeEntregaId(l.entregaId)}`}>{codigoDeEntregaId(l.entregaId)}</Badge></span>
            : l.entregaId === null
              ? <span className="shrink-0"><Badge tono="aviso" punto={false} title="Todavía está en caja, sin entregar a tesorería">en caja</Badge></span>
              : null}
        </div>
      ) },
  ]

  const planta = user?.planta ? PLANTAS[user.planta].label : 'Todas las plantas'

  // Una pantalla que ES una tabla usa todo el ancho que le deja el shell:
  // 1024 px es una medida de lectura y con doce columnas obligaba a scrollear
  // al costado. Las pantallas de formulario siguen en max-w-5xl.
  return (
    <main className="max-w-[1600px] mx-auto p-4 space-y-4 pb-10">
      <PageHeader
        titulo="Historial de liquidaciones"
        icono={<History size={22} />}
        volver={{ to: `${base}/liquidaciones`, etiqueta: 'Liquidación del día' }}
        contexto={`${planta} · todos los cierres del mes, con su diferencia de efectivo`}
        acciones={
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
        }
      />

      <HistorialTable
        className="max-w-5xl"
        titulo="Por repartidor"
        resumen={<span className="text-sm text-secundario tabular-nums">{liquidaciones.length} cierres · diferencia del mes {dif(totalDiferencia)}</span>}
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
        compacta
        porPagina={50}
        exportar={`Liquidaciones ${mes}`}
      />
    </main>
  )
}
