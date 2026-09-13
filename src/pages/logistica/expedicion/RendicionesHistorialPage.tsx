import { useEffect, useMemo, useState } from 'react'
import { History, ShieldCheck } from 'lucide-react'
import PageHeader from '@/components/common/PageHeader'
import Badge from '@/components/common/Badge'
import { useAuth } from '@/context/AuthContext'
import { subscribeRendicionesEnRango } from '@/services/rendicionService'
import { formatoARS } from '@/utils/money'
import { coincideBusqueda } from '@/utils/busqueda'
import { codigoDeEntregaId } from '@/utils/entregaTesoreria'
import { useDiaActual } from '@/hooks/useDiaActual'
import { MOTIVOS_DIFERENCIA_LIQUIDACION, PLANTAS, type Rendicion } from '@/types'
import AnuladasDespuesDeCerrar from '@/components/expedicion/AnuladasDespuesDeCerrar'
import HistorialTable, { BarraHistorial, type ColumnaHistorial } from '@/components/common/HistorialTable'

// Historial de cierres de caja (2026-09-09): mes × cajero, con la diferencia
// de cada cierre y los totales por persona, para ver quién viene con
// faltantes repetidos y qué quedó sin validar. Lo usan caja (/caja/…),
// tesorería y gerencia (/tesoreria/…): mismo componente, distinta ruta.
// La tabla, el vacío, el paginador y el CSV salen de HistorialTable (fase 3.2).

interface PorCajero {
  id: string; nombre: string; planta: string; cierres: number
  aRendir: number; contado: number; diferencia: number; conDiferencia: number; sinValidar: number
}

// Una diferencia en cero no es noticia: pierde el color y queda en el gris
// secundario, que igual se lee. `tabular-nums` lo pone la columna (alinear 'der').
const dif = (n: number) => (
  <span className={`font-semibold ${n === 0 ? 'text-secundario' : n < 0 ? 'text-red-600' : 'text-amber-700'}`}>{formatoARS(n)}</span>
)
const plata = (n: number) => <span>{formatoARS(n)}</span>
const sinPrefijo = (p: Rendicion['plantaId']) => PLANTAS[p].label.replace('Planta ', '')
/** '2026-09-12' → '12/09'. */
const diaMes = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`
const motivoDe = (r: Rendicion) =>
  (r.diferencia ? `${MOTIVOS_DIFERENCIA_LIQUIDACION[r.diferencia.motivo]}${r.diferencia.nota ? ` · ${r.diferencia.nota}` : ''}` : '')

export default function RendicionesHistorialPage({ enTesoreria }: { enTesoreria: boolean }) {
  const { user } = useAuth()
  const hoy = useDiaActual()
  const [mes, setMes] = useState(hoy.slice(0, 7))
  const [rendiciones, setRendiciones] = useState<Rendicion[]>([])
  const [cargando, setCargando] = useState(true)
  const [filtro, setFiltro] = useState('')
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    setCargando(true)
    const [y, m] = mes.split('-').map(Number)
    const sig = new Date(y, m, 1)
    const hasta = `${sig.getFullYear()}-${String(sig.getMonth() + 1).padStart(2, '0')}-01`
    return subscribeRendicionesEnRango(`${mes}-01`, hasta, (r) => { setRendiciones(r); setCargando(false) })
  }, [mes])

  // Caja ve su planta; tesorería y gerencia, todo.
  const visibles = useMemo(() => rendiciones.filter((r) => enTesoreria || !user?.planta || r.plantaId === user.planta), [rendiciones, enTesoreria, user?.planta])

  const porCajero = useMemo(() => {
    const m = new Map<string, PorCajero>()
    for (const r of visibles) {
      let x = m.get(r.sujetoId)
      if (!x) { x = { id: r.sujetoId, nombre: r.sujetoNombre, planta: sinPrefijo(r.plantaId), cierres: 0, aRendir: 0, contado: 0, diferencia: 0, conDiferencia: 0, sinValidar: 0 }; m.set(r.sujetoId, x) }
      x.cierres++; x.aRendir += r.efectivoARendir; x.contado += r.efectivoContado; x.diferencia += r.diferenciaEfectivo
      if (r.diferenciaEfectivo !== 0) x.conDiferencia++
      if (!r.validacion) x.sinValidar++
    }
    return [...m.values()].sort((a, b) => a.diferencia - b.diferencia || a.nombre.localeCompare(b.nombre, 'es'))
  }, [visibles])

  const filas = useMemo(
    () => visibles
      .filter((r) => !filtro || r.sujetoId === filtro)
      .filter((r) => !busqueda.trim() || coincideBusqueda(busqueda, r.sujetoNombre, r.codigo, r.fecha, sinPrefijo(r.plantaId)))
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || a.sujetoNombre.localeCompare(b.sujetoNombre, 'es')),
    [visibles, filtro, busqueda],
  )
  const totalDiferencia = visibles.reduce((s, r) => s + r.diferenciaEfectivo, 0)

  const columnasResumen: ColumnaHistorial<PorCajero>[] = [
    { titulo: 'Cajero', truncar: true, anchoMax: 180, csv: (c) => c.nombre, celda: (c) => (
      <button type="button" onClick={() => setFiltro(filtro === c.id ? '' : c.id)} className="block max-w-full truncate text-left hover:text-accent">{c.nombre}</button>
    ) },
    { titulo: 'Planta',  csv: (c) => c.planta,  celda: (c) => c.planta },
    { titulo: 'Cierres', alinear: 'der', csv: (c) => c.cierres, celda: (c) => c.cierres },
    { titulo: 'A rendir', alinear: 'der', csv: (c) => c.aRendir, celda: (c) => plata(c.aRendir) },
    { titulo: 'Contado',  alinear: 'der', csv: (c) => c.contado, celda: (c) => plata(c.contado) },
    { titulo: 'Diferencia', alinear: 'der', csv: (c) => c.diferencia, celda: (c) => dif(c.diferencia) },
    { titulo: 'Con diferencia', alinear: 'der', csv: (c) => c.conDiferencia, celda: (c) => (
      c.conDiferencia ? <span className="text-red-600 font-semibold">{c.conDiferencia}</span> : <span className="text-secundario">0</span>
    ) },
    { titulo: 'Sin validar', alinear: 'der', csv: (c) => c.sinValidar, celda: (c) => (
      c.sinValidar ? <span className="text-amber-700 font-semibold">{c.sinValidar}</span> : <span className="text-secundario">0</span>
    ) },
  ]

  const columnasCierres: ColumnaHistorial<Rendicion>[] = [
    // La fecha va corta: el mes ya lo eligió el filtro, repetir el año en
    // cada fila es ancho gastado. El CSV se lleva la fecha completa.
    { titulo: 'Fecha',  csv: (r) => r.fecha,  celda: (r) => <span className="tabular-nums whitespace-nowrap">{diaMes(r.fecha)}</span> },
    { titulo: 'Código', csv: (r) => r.codigo, celda: (r) => <span className="tabular-nums whitespace-nowrap">{r.codigo}</span> },
    // La planta ya está en el código del cierre (RD-DT-000007): repetirla acá
    // era ancho gastado. El CSV se la sigue llevando.
    { titulo: 'Cajero', truncar: true, anchoMax: 150, csv: (r) => `${r.sujetoNombre} · ${sinPrefijo(r.plantaId)}`, celda: (r) => r.sujetoNombre },
    { titulo: 'Ventas',    alinear: 'der', csv: (r) => r.cantidadVentas,    celda: (r) => (r.cantidadVentas ? r.cantidadVentas : <span className="text-secundario">0</span>) },
    { titulo: 'Cobros', alinear: 'der', csv: (r) => r.cantidadCobranzas, celda: (r) => (r.cantidadCobranzas ? r.cantidadCobranzas : <span className="text-secundario">0</span>) },
    { titulo: 'A rendir',  alinear: 'der', csv: (r) => r.efectivoARendir,   celda: (r) => plata(r.efectivoARendir) },
    { titulo: 'Contado',   alinear: 'der', csv: (r) => r.efectivoContado,   celda: (r) => plata(r.efectivoContado) },
    { titulo: 'Diferencia', alinear: 'der', csv: (r) => r.diferenciaEfectivo, celda: (r) => dif(r.diferenciaEfectivo) },
    // Una nota larga partía la fila en cuatro renglones y dejaba un hueco en
    // la tabla. Ahora va en una línea, con el texto completo en el tooltip, y
    // la marca de anuladas después manda: no se achica.
    { titulo: 'Motivo', anchoMax: 185, csv: (r) => motivoDe(r), celda: (r) => (
      <div className="flex items-center gap-1.5 min-w-0">
        {motivoDe(r) && <span className="truncate text-secundario" title={motivoDe(r)}>{motivoDe(r)}</span>}
        {r.anulacionesPosteriores?.length
          ? <span className="shrink-0"><AnuladasDespuesDeCerrar anulaciones={r.anulacionesPosteriores} compacto /></span>
          : null}
      </div>
    ) },
    // Validación y entrega a tesorería son los dos estados del mismo cierre:
    // en una sola columna con dos badges se leen juntos y se ahorra un ancho.
    { titulo: 'Estado', anchoMax: 205,
      csv: (r) => `${r.validacion ? `validada por ${r.validacion.nombre}` : 'sin validar'} · ${r.entregaId ? codigoDeEntregaId(r.entregaId) : 'en caja'}`,
      celda: (r) => (
        <div className="flex items-center gap-1 min-w-0">
          {r.validacion
            ? <Badge tono="entregado" icono={<ShieldCheck />} title={`Validada por ${r.validacion.nombre}`}>Validada</Badge>
            : <Badge tono="pendiente">Sin validar</Badge>}
          {r.entregaId
            ? <Badge tono="neutro" punto={false} title={`Entregada a tesorería en ${codigoDeEntregaId(r.entregaId)}`}>{codigoDeEntregaId(r.entregaId)}</Badge>
            : <Badge tono="aviso" punto={false} title="Todavía está en caja, sin entregar a tesorería">en caja</Badge>}
        </div>
      ) },
  ]

  const alcance = enTesoreria || !user?.planta ? 'Las dos plantas' : PLANTAS[user.planta].label

  // Una pantalla que ES una tabla usa todo el ancho que le deja el shell:
  // 1024 px es una medida de lectura y con once columnas obligaba a scrollear
  // al costado. Las pantallas de formulario siguen en max-w-5xl.
  return (
    <main className="max-w-[1600px] mx-auto p-4 space-y-4 pb-10">
      <PageHeader
        titulo="Historial de cierres de caja"
        icono={<History size={22} />}
        volver={{ to: enTesoreria ? '/tesoreria/rendiciones' : '/caja/rendiciones', etiqueta: enTesoreria ? 'Rendiciones del día' : 'Mi caja' }}
        contexto={`${alcance} · todos los cierres del mes, con su diferencia y su validación`}
        acciones={
          <BarraHistorial
            mes={{ valor: mes, max: hoy.slice(0, 7), onChange: (m) => { setMes(m); setFiltro('') } }}
            selects={[{
              valor: filtro,
              onChange: setFiltro,
              etiqueta: 'Cajero',
              opciones: [{ value: '', label: 'Todos los cajeros' }, ...porCajero.map((c) => ({ value: c.id, label: `${c.nombre} · ${c.planta}` }))],
            }]}
            buscador={{ valor: busqueda, onChange: setBusqueda, placeholder: 'Cajero, código, fecha…' }}
          />
        }
      />

      <HistorialTable
        className="max-w-5xl"
        titulo="Por cajero"
        resumen={<span className="text-sm text-secundario tabular-nums">{visibles.length} cierres · diferencia del mes {dif(totalDiferencia)}</span>}
        columnas={columnasResumen}
        filas={porCajero}
        claveDe={(c) => c.id}
        cargando={cargando}
        filaResaltada={(c) => filtro === c.id}
        vacio="Sin cierres de caja en este mes."
        anchoMinimo={720}
        exportar={`Cierres de caja por cajero ${mes}`}
      />

      <HistorialTable
        titulo="Cierres"
        columnas={columnasCierres}
        filas={filas}
        claveDe={(r) => r.id}
        cargando={cargando}
        vacio="Sin cierres."
        anchoMinimo={820}
        compacta
        porPagina={50}
        exportar={`Cierres de caja ${mes}`}
      />
    </main>
  )
}
