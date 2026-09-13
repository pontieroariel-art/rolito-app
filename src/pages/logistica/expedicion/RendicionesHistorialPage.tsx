import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, History, ShieldCheck } from 'lucide-react'
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

const dif = (n: number) => (
  <span className={`tabular-nums font-semibold ${n === 0 ? 'text-gray-500' : n < 0 ? 'text-red-600' : 'text-amber-700'}`}>{formatoARS(n)}</span>
)
const plata = (n: number) => <span className="tabular-nums">{formatoARS(n)}</span>
const sinPrefijo = (p: Rendicion['plantaId']) => PLANTAS[p].label.replace('Planta ', '')

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
    { titulo: 'Cajero', csv: (c) => c.nombre, celda: (c) => (
      <button type="button" onClick={() => setFiltro(filtro === c.id ? '' : c.id)} className="text-left hover:text-accent">{c.nombre}</button>
    ) },
    { titulo: 'Planta',  csv: (c) => c.planta,  celda: (c) => c.planta },
    { titulo: 'Cierres', alinear: 'der', csv: (c) => c.cierres, celda: (c) => <span className="tabular-nums">{c.cierres}</span> },
    { titulo: 'A rendir', alinear: 'der', csv: (c) => c.aRendir, celda: (c) => plata(c.aRendir) },
    { titulo: 'Contado',  alinear: 'der', csv: (c) => c.contado, celda: (c) => plata(c.contado) },
    { titulo: 'Diferencia', alinear: 'der', csv: (c) => c.diferencia, celda: (c) => dif(c.diferencia) },
    { titulo: 'Con diferencia', alinear: 'der', csv: (c) => c.conDiferencia, celda: (c) => (
      <span className="tabular-nums">{c.conDiferencia ? <span className="text-red-600 font-semibold">{c.conDiferencia}</span> : '0'}</span>
    ) },
    { titulo: 'Sin validar', alinear: 'der', csv: (c) => c.sinValidar, celda: (c) => (
      <span className="tabular-nums">{c.sinValidar ? <span className="text-amber-700 font-semibold">{c.sinValidar}</span> : '0'}</span>
    ) },
  ]

  const columnasCierres: ColumnaHistorial<Rendicion>[] = [
    { titulo: 'Fecha',  csv: (r) => r.fecha,  celda: (r) => r.fecha },
    { titulo: 'Código', csv: (r) => r.codigo, celda: (r) => r.codigo },
    { titulo: 'Cajero', csv: (r) => `${r.sujetoNombre} · ${sinPrefijo(r.plantaId)}`, celda: (r) => (
      <>{r.sujetoNombre} <span className="text-gray-400">· {sinPrefijo(r.plantaId)}</span></>
    ) },
    { titulo: 'Ventas',    alinear: 'der', csv: (r) => r.cantidadVentas,    celda: (r) => <span className="tabular-nums">{r.cantidadVentas}</span> },
    { titulo: 'Cobranzas', alinear: 'der', csv: (r) => r.cantidadCobranzas, celda: (r) => <span className="tabular-nums">{r.cantidadCobranzas}</span> },
    { titulo: 'A rendir',  alinear: 'der', csv: (r) => r.efectivoARendir,   celda: (r) => plata(r.efectivoARendir) },
    { titulo: 'Contado',   alinear: 'der', csv: (r) => r.efectivoContado,   celda: (r) => plata(r.efectivoContado) },
    { titulo: 'Diferencia', alinear: 'der', csv: (r) => r.diferenciaEfectivo, celda: (r) => dif(r.diferenciaEfectivo) },
    { titulo: 'Motivo', csv: (r) => (r.diferencia ? `${MOTIVOS_DIFERENCIA_LIQUIDACION[r.diferencia.motivo]}${r.diferencia.nota ? ` · ${r.diferencia.nota}` : ''}` : ''), celda: (r) => (
      <span className="text-gray-600">
        {r.diferencia ? `${MOTIVOS_DIFERENCIA_LIQUIDACION[r.diferencia.motivo]}${r.diferencia.nota ? ` · ${r.diferencia.nota}` : ''}` : ''}
        {r.anulacionesPosteriores?.length ? <span className="block"><AnuladasDespuesDeCerrar anulaciones={r.anulacionesPosteriores} compacto /></span> : null}
      </span>
    ) },
    { titulo: 'Validada', csv: (r) => (r.validacion ? r.validacion.nombre : 'Pendiente'), celda: (r) => (
      r.validacion
        ? <span className="inline-flex items-center gap-1 text-xs text-[#0F6B4E]"><ShieldCheck size={13} /> {r.validacion.nombre}</span>
        : <span className="text-xs text-amber-700">Pendiente</span>
    ) },
    { titulo: 'Entrega', csv: (r) => (r.entregaId ? codigoDeEntregaId(r.entregaId) : 'en caja'), celda: (r) => (
      <span className="text-xs">{r.entregaId
        ? <span className="text-[#0F6B4E]">{codigoDeEntregaId(r.entregaId)}</span>
        : <span className="text-amber-700">en caja</span>}</span>
    ) },
  ]

  const alcance = enTesoreria || !user?.planta ? 'Las dos plantas' : PLANTAS[user.planta].label

  return (
    <main className="max-w-5xl mx-auto p-4 space-y-4 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to={enTesoreria ? '/tesoreria/rendiciones' : '/caja/rendiciones'} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-accent mb-1"><ArrowLeft size={14} /> {enTesoreria ? 'Rendiciones del día' : 'Mi caja'}</Link>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><History size={22} className="text-accent" /> Historial de cierres de caja</h1>
          <p className="text-gray-500 text-sm">{alcance} · todos los cierres del mes, con su diferencia y su validación</p>
        </div>
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
      </div>

      <HistorialTable
        titulo="Por cajero"
        resumen={<span className="text-sm text-gray-600">{visibles.length} cierres · diferencia del mes {dif(totalDiferencia)}</span>}
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
        porPagina={50}
        exportar={`Cierres de caja ${mes}`}
      />
    </main>
  )
}
