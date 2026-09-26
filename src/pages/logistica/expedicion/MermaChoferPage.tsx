import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Download, PackageX, Truck, Wallet } from 'lucide-react'
import PageHeader from '@/components/common/PageHeader'
import AvisoErrorCarga from '@/components/common/AvisoErrorCarga'
import { TH as th, TD as td, NUMERO } from '@/components/common/tabla'
import { useAuth } from '@/context/AuthContext'
import { useDiaActual } from '@/hooks/useDiaActual'
import { usePreciosTango } from '@/hooks/usePreciosTango'
import { useCotConfig } from '@/hooks/useCotConfig'
import { getViajesParaMerma, MAX_DIAS_MERMA } from '@/services/mermaChoferService'
import { reportError } from '@/services/observability'
import { addDaysStr } from '@/utils/helpers'
import { descargarCSV } from '@/utils/csv'
import { formatoARS } from '@/utils/money'
import { resumirMerma, type ChoferMerma, type ViajeParaMerma } from '@/utils/mermaChofer'
import { PLANTAS, type PlantaId } from '@/types'

// Merma y faltantes por chofer (2026-09-26, pedido de Ariel: "son bolsas, es
// dinero al fin y al cabo"; "un buen dashboard limpio y bien visible").
// Reporte de GESTIÓN: super_admin, logística y gerencia. No lo ven los medidos
// (chofer, muelle, caja). Cuentas en utils/mermaChofer.ts.

const COLOR_ROTAS = '#D9822B'   // merma: se rompieron en el camión (no se cobra)
const COLOR_FALTAN = '#B3261E'  // faltante: diferencia del chofer (98)

const pesos = (n: number) => formatoARS(n).replace(/,00$/, '')
const bolsas = (n: number) => `${n.toLocaleString('es-AR')} ${n === 1 ? 'bolsa' : 'bolsas'}`
const fechaCorta = (d: Date) => `${d.toLocaleDateString('es-AR', { weekday: 'short' }).replace('.', '')} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
const pct = (n: number) => `${n.toLocaleString('es-AR', { maximumFractionDigits: 1 })} %`

export default function MermaChoferPage() {
  const { user } = useAuth()
  const hoy = useDiaActual()
  const [planta, setPlanta] = useState<PlantaId | 'todas'>(user?.planta ?? 'todas')
  const [desde, setDesde] = useState(() => addDaysStr(hoy, -6))
  const [hasta, setHasta] = useState(hoy)
  const [viajes, setViajes] = useState<ViajeParaMerma[] | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [reintento, setReintento] = useState(0)
  const [elegido, setElegido] = useState<string | null>(null)

  const { cfg } = useCotConfig()
  const { precios: preciosTango } = usePreciosTango('redonhielo')
  const lista = preciosTango?.listas?.[cfg.listaPrecios]?.precios ?? null

  const dias = Math.round((new Date(`${hasta}T00:00:00`).getTime() - new Date(`${desde}T00:00:00`).getTime()) / 86_400_000) + 1
  const rangoValido = dias >= 1 && dias <= MAX_DIAS_MERMA

  useEffect(() => {
    if (!rangoValido) return
    let vivo = true
    setCargando(true)
    setError('')
    getViajesParaMerma(planta, desde, hasta)
      .then((v) => { if (vivo) setViajes(v) })
      .catch((err) => {
        reportError(err, { origen: 'MermaChoferPage', accion: 'traer viajes' })
        if (vivo) setError('No se pudieron traer los viajes. Probá con un rango más corto.')
      })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [planta, desde, hasta, rangoValido, reintento])

  const r = useMemo(() => (viajes ? resumirMerma(viajes, lista) : null), [viajes, lista])
  const maxTotal = Math.max(1, ...(r?.choferes.map((c) => c.importeTotal) ?? [0]))
  const chofer = r?.choferes.find((c) => (c.choferId || c.choferNombre) === elegido) ?? null

  const atajo = (d: number) => { setDesde(addDaysStr(hoy, -(d - 1))); setHasta(hoy) }
  const esteMes = () => { setDesde(`${hoy.slice(0, 8)}01`); setHasta(hoy) }

  const exportar = () => {
    if (!r) return
    descargarCSV(`merma-choferes-${desde}_${hasta}`,
      ['Chofer', 'Viajes contados', 'Viajes sin contar', 'Bolsas cargadas', 'Rotas en el camión', '% rotas', '$ rotas', 'Faltantes', '$ faltantes', '$ total'],
      r.choferes.map((c) => [c.choferNombre, c.viajes, c.viajesSinContar, c.cargadas, c.rotasCamion, Number(c.pctRotas.toFixed(2)), c.importeRotas, c.faltan, c.importeFaltan, c.importeTotal]))
  }

  const inputClass = 'h-10 bg-white border border-[#D3D1C7] rounded-lg px-3 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'
  const chip = 'h-10 px-3 rounded-lg border border-[#D3D1C7] bg-white text-sm text-gray-700 hover:bg-[#F1EFE8]'

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-4">
      <PageHeader
        titulo="Merma y faltantes por chofer"
        contexto="Bolsas que se rompieron en el camión y bolsas que no volvieron, en plata"
        acciones={<button type="button" onClick={exportar} disabled={!r?.choferes.length} className="h-10 px-3 rounded-lg border border-[#D3D1C7] bg-white text-sm inline-flex items-center gap-2 disabled:opacity-50"><Download size={16} /> Excel</button>}
      />

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-2">
        {!user?.planta && (
          <label className="text-xs text-secundario">Planta
            <select value={planta} onChange={(e) => setPlanta(e.target.value as PlantaId | 'todas')} className={`${inputClass} block mt-1`}>
              <option value="todas">Todas</option>
              {(Object.keys(PLANTAS) as PlantaId[]).map((p) => <option key={p} value={p}>{PLANTAS[p].label.replace("Planta ", "")}</option>)}
            </select>
          </label>
        )}
        <label className="text-xs text-secundario">Desde<input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} className={`${inputClass} block mt-1`} /></label>
        <label className="text-xs text-secundario">Hasta<input type="date" value={hasta} min={desde} max={hoy} onChange={(e) => setHasta(e.target.value)} className={`${inputClass} block mt-1`} /></label>
        <button type="button" className={chip} onClick={() => atajo(1)}>Hoy</button>
        <button type="button" className={chip} onClick={() => atajo(7)}>7 días</button>
        <button type="button" className={chip} onClick={esteMes}>Este mes</button>
      </div>
      {!rangoValido && <p className="text-sm text-red-700">Elegí un rango de hasta {MAX_DIAS_MERMA} días.</p>}
      {error && <AvisoErrorCarga mensaje={error} onReintentar={() => setReintento((n) => n + 1)} />}

      {cargando && !r ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[0, 1, 2, 3].map((i) => <div key={i} className="h-28 rounded-2xl bg-white border border-[#D3D1C7] animate-pulse" />)}</div>
      ) : r && (
        <>
          {/* Números grandes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-2xl p-4 text-white shadow-sm" style={{ background: '#2B2A26' }}>
              <p className="text-sm opacity-80 flex items-center gap-1.5"><Wallet size={16} /> Plata perdida</p>
              <p className="text-3xl font-bold tabular-nums mt-1">{pesos(r.total.importeTotal)}</p>
              <p className="text-xs opacity-80 mt-1">{pesos(r.total.importeRotas)} en rotas · {pesos(r.total.importeFaltan)} en faltantes</p>
            </div>
            <Kpi icono={<PackageX size={16} />} color={COLOR_ROTAS} titulo="Rotas en el camión" valor={r.total.rotasCamion.toLocaleString('es-AR')} unidad={r.total.rotasCamion === 1 ? 'bolsa' : 'bolsas'}
              detalle={`${pct(r.total.pctRotas)} de lo cargado · ${pesos(r.total.importeRotas)}`} nota="Van a merma. No se cobran." />
            <Kpi icono={<AlertTriangle size={16} />} color={COLOR_FALTAN} titulo="Faltantes" valor={r.total.faltan.toLocaleString('es-AR')} unidad={r.total.faltan === 1 ? 'bolsa' : 'bolsas'}
              detalle={pesos(r.total.importeFaltan)} nota="No volvieron ni sanas ni rotas: diferencia del chofer." />
            <Kpi icono={<Truck size={16} />} color="#1D9E75" titulo="Viajes contados" valor={r.total.viajes.toLocaleString('es-AR')}
              detalle={`${bolsas(r.total.cargadas)} cargadas`} nota={r.total.viajesSinContar ? `${r.total.viajesSinContar} sin contar todavía (no suman)` : 'Todos con la descarga contada'} />
          </div>

          {r.sinPrecio.length > 0 && (
            <p className="text-sm text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">
              Sin precio en la lista {cfg.listaPrecios}: {r.sinPrecio.join(', ')}. Sus bolsas se cuentan pero no suman plata.
            </p>
          )}

          {r.choferes.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#D3D1C7] p-10 text-center text-secundario">No hay viajes en este rango.</div>
          ) : (
            <>
              {/* Ranking */}
              <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <h2 className="text-xs font-semibold text-secundario uppercase tracking-wide">¿Quién pierde más?</h2>
                  <div className="flex items-center gap-4 text-xs text-secundario">
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: COLOR_ROTAS }} /> Rotas en el camión</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: COLOR_FALTAN }} /> Faltantes</span>
                  </div>
                </div>
                <div className="space-y-2">
                  {r.choferes.map((c) => {
                    const clave = c.choferId || c.choferNombre
                    return (
                      <button key={clave} type="button" onClick={() => setElegido(elegido === clave ? null : clave)}
                        className={`w-full text-left rounded-xl px-3 py-2 transition-colors ${elegido === clave ? 'bg-[#F1EFE8]' : 'hover:bg-[#F8F7F2]'}`}>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="font-medium text-gray-900 truncate" title={c.choferNombre}>{c.choferNombre}</span>
                          <span className="tabular-nums font-semibold text-gray-900 shrink-0">{pesos(c.importeTotal)}</span>
                        </div>
                        <div className="mt-1 h-3 rounded-full bg-[#EFEDE6] overflow-hidden flex">
                          <div style={{ width: `${(c.importeRotas / maxTotal) * 100}%`, background: COLOR_ROTAS }} />
                          <div style={{ width: `${(c.importeFaltan / maxTotal) * 100}%`, background: COLOR_FALTAN }} />
                        </div>
                        <p className="mt-1 text-xs text-secundario tabular-nums">
                          {c.rotasCamion} rotas ({pct(c.pctRotas)}) · {c.faltan} {c.faltan === 1 ? 'faltante' : 'faltantes'} · {c.viajes} {c.viajes === 1 ? 'viaje' : 'viajes'}
                          {c.viajesSinContar ? ` · ${c.viajesSinContar} sin contar` : ''}
                        </p>
                      </button>
                    )
                  })}
                </div>
              </section>

              {chofer && <DetalleChofer c={chofer} onCerrar={() => setElegido(null)} />}

              {/* Tabla */}
              <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm overflow-hidden">
                <h2 className="px-4 py-3 text-xs font-semibold text-secundario uppercase tracking-wide">Por chofer</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className={th}>Chofer</th>
                        <th className={`${th} text-right whitespace-nowrap`}>Viajes</th>
                        <th className={`${th} text-right whitespace-nowrap`}>Cargó</th>
                        <th className={`${th} text-right whitespace-nowrap`}>Rotas camión</th>
                        <th className={`${th} text-right whitespace-nowrap`}>$ rotas</th>
                        <th className={`${th} text-right whitespace-nowrap`}>Faltantes</th>
                        <th className={`${th} text-right whitespace-nowrap`}>$ faltantes</th>
                        <th className={`${th} text-right whitespace-nowrap`}>$ total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.choferes.map((c) => {
                        const clave = c.choferId || c.choferNombre
                        return (
                          <tr key={clave} onClick={() => setElegido(elegido === clave ? null : clave)} className={`border-t border-[#E7E5DC] cursor-pointer ${elegido === clave ? 'bg-[#F1EFE8]' : 'hover:bg-[#F8F7F2]'}`}>
                            <td className={`${td} truncate max-w-[240px]`} title={c.choferNombre}>{c.choferNombre}</td>
                            <td className={`${td} ${NUMERO} whitespace-nowrap`}>{c.viajes}</td>
                            <td className={`${td} ${NUMERO} whitespace-nowrap`}>{c.cargadas.toLocaleString('es-AR')}</td>
                            <td className={`${td} ${NUMERO} whitespace-nowrap`}>{c.rotasCamion} <span className="text-secundario">· {pct(c.pctRotas)}</span></td>
                            <td className={`${td} ${NUMERO} whitespace-nowrap`}>{pesos(c.importeRotas)}</td>
                            <td className={`${td} ${NUMERO} ${c.faltan ? 'font-semibold text-red-700' : ''}`}>{c.faltan}</td>
                            <td className={`${td} ${NUMERO} whitespace-nowrap`}>{pesos(c.importeFaltan)}</td>
                            <td className={`${td} ${NUMERO} font-semibold whitespace-nowrap`}>{pesos(c.importeTotal)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          <p className="text-xs text-secundario max-w-3xl">
            <b>Rotas en el camión</b> = bolsas rotas que contó el muelle menos los cambios que registró el chofer (las de los cambios las rompió el cliente). Van a merma y no se le cobran.{' '}
            <b>Faltantes</b> = bolsas que no volvieron ni sanas ni rotas: van a la diferencia del chofer (depósito 98). Solo cuentan los viajes con la descarga contada.
            La plata se calcula a precio de la lista {cfg.listaPrecios} de Tango.
          </p>
        </>
      )}
    </div>
  )
}

function Kpi({ icono, color, titulo, valor, unidad, detalle, nota }: { icono: React.ReactNode; color: string; titulo: string; valor: string; unidad?: string; detalle: string; nota: string }) {
  return (
    <div className="rounded-2xl bg-white border border-[#D3D1C7] shadow-sm p-4 border-l-4" style={{ borderLeftColor: color }}>
      <p className="text-sm text-secundario flex items-center gap-1.5"><span style={{ color }}>{icono}</span> {titulo}</p>
      <p className="mt-1 whitespace-nowrap"><span className="text-3xl font-bold text-gray-900 tabular-nums">{valor}</span>{unidad && <span className="text-base text-secundario ml-1.5">{unidad}</span>}</p>
      <p className="text-sm text-gray-700 tabular-nums">{detalle}</p>
      <p className="text-xs text-secundario mt-1">{nota}</p>
    </div>
  )
}

function DetalleChofer({ c, onCerrar }: { c: ChoferMerma; onCerrar: () => void }) {
  const [abierto, setAbierto] = useState<string | null>(null)
  return (
    <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#E7E5DC]">
        <div>
          <h2 className="text-base font-semibold text-gray-900">{c.choferNombre}</h2>
          <p className="text-sm text-secundario">{c.viajes} {c.viajes === 1 ? 'viaje contado' : 'viajes contados'} · {pesos(c.importeTotal)} perdidos</p>
        </div>
        <button type="button" onClick={onCerrar} className="h-10 px-3 rounded-lg border border-[#D3D1C7] text-sm">Cerrar</button>
      </div>
      <ul className="divide-y divide-[#E7E5DC]">
        {c.detalle.map((v) => {
          const abre = abierto === v.remitoId
          const conAlgo = v.rotasCamion > 0 || v.faltan > 0
          return (
            <li key={v.remitoId}>
              <button type="button" onClick={() => setAbierto(abre ? null : v.remitoId)} className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-[#F8F7F2]">
                <span className="text-sm text-gray-900 w-28 shrink-0 tabular-nums">{fechaCorta(v.fecha)}</span>
                <span className="text-sm text-secundario w-32 shrink-0">{v.codigo}</span>
                <span className="flex-1 text-sm tabular-nums">
                  {!v.contado ? <span className="text-secundario">Sin contar todavía</span> : conAlgo
                    ? <>{v.rotasCamion > 0 && <span style={{ color: COLOR_ROTAS }} className="font-medium">{v.rotasCamion} rotas</span>}{v.rotasCamion > 0 && v.faltan > 0 && ' · '}{v.faltan > 0 && <span style={{ color: COLOR_FALTAN }} className="font-semibold">{v.faltan} {v.faltan === 1 ? 'faltante' : 'faltantes'}</span>}</>
                    : <span className="text-[#0F6B4E]">Todo en orden</span>}
                </span>
                <span className="text-sm tabular-nums font-semibold w-24 text-right">{v.contado ? pesos(v.importeRotas + v.importeFaltan) : '—'}</span>
                {v.contado && conAlgo ? (abre ? <ChevronUp size={16} className="text-secundario" /> : <ChevronDown size={16} className="text-secundario" />) : <span className="w-4" />}
              </button>
              {abre && (
                <ul className="px-4 pb-3 space-y-1 text-sm text-gray-700">
                  {v.productos.filter((p) => p.explicacion.length).map((p) => (
                    <li key={p.productoId}><span className="font-medium text-gray-900">{p.nombre}:</span> {p.explicacion.join(' ')}</li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
