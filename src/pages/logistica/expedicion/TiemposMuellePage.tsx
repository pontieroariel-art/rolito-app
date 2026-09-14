import { useEffect, useMemo, useState } from 'react'
import { Clock, PackageCheck, Timer, Truck } from 'lucide-react'
import PageHeader from '@/components/common/PageHeader'
import { TH as th, TD as td, NUMERO } from '@/components/common/tabla'
import { useAuth } from '@/context/AuthContext'
import { useDiaActual } from '@/hooks/useDiaActual'
import { getTiemposMuelle, MAX_DIAS_RANGO, type DatosTiemposMuelle } from '@/services/metricasMuelleService'
import { reportError } from '@/services/observability'
import { addDaysStr } from '@/utils/helpers'
import { descargarCSV } from '@/utils/csv'
import {
  atencionDeVentanilla, duracion, esperaDeDescarga, esperaDeVentanilla, ocupacionDeDarsena,
  porDarsena, porFranjaHoraria, porGrupo, resumir, type MuestraTiempo, type ResumenTiempos,
} from '@/utils/metricasMuelle'
import { PLANTAS, type PlantaId } from '@/types'

// Tiempos del muelle (2026-09-13): cuánto espera un camión para que le cuenten
// la descarga, cuánto ocupa la dársena, y cuánto espera y tarda un turno de
// ventanilla. Todo sale de timestamps que la operación ya escribe — nadie
// cronometra nada ni carga un dato de más.
//
// Se muestran mediana y p90 además del promedio a propósito: en tiempos de
// espera el promedio solo miente (un camión olvidado cuatro horas corre el
// promedio del día entero y esconde que los demás estuvieron bien).

type Vista = 'esperaDescarga' | 'ocupacionDarsena' | 'esperaVentanilla' | 'atencionVentanilla'

const VISTAS: Array<{ id: Vista; corto: string; ayuda: string; icono: typeof Truck }> = [
  {
    id: 'esperaDescarga', corto: 'Espera de descarga', icono: PackageCheck,
    ayuda: 'Desde que el camión marcó que volvió a planta hasta que el muelle terminó de contarle la mercadería.',
  },
  {
    id: 'ocupacionDarsena', corto: 'Dársena ocupada', icono: Truck,
    ayuda: 'Desde que se le asignó la boca hasta que salió por el portón. En las cargas anteriores al 13/09, que no guardaban esa hora, arranca en la entrega de la mercadería.',
  },
  {
    id: 'esperaVentanilla', corto: 'Espera de turno', icono: Clock,
    ayuda: 'Desde que el cliente sacó el turno hasta que lo llamaron a la dársena.',
  },
  {
    id: 'atencionVentanilla', corto: 'Atención de turno', icono: Timer,
    ayuda: 'Desde que lo llamaron hasta que se llevó la mercadería.',
  },
]

export default function TiemposMuellePage() {
  const { user } = useAuth()
  const hoy = useDiaActual()
  const [plantaSel, setPlantaSel] = useState<PlantaId>('torcuato')
  const plantaId = user?.planta ?? plantaSel
  const [desde, setDesde] = useState(hoy)
  const [hasta, setHasta] = useState(hoy)
  const [vista, setVista] = useState<Vista>('esperaDescarga')
  const [datos, setDatos] = useState<DatosTiemposMuelle | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let vivo = true
    setCargando(true)
    setError('')
    getTiemposMuelle(plantaId, desde, hasta)
      .then((d) => { if (vivo) setDatos(d) })
      .catch((err) => {
        reportError(err, { origen: 'TiemposMuellePage' })
        if (vivo) setError('No se pudieron traer los tiempos. Probá con un rango más corto.')
      })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [plantaId, desde, hasta])

  const muestrasPorVista = useMemo((): Record<Vista, MuestraTiempo[]> => {
    if (!datos) return { esperaDescarga: [], ocupacionDarsena: [], esperaVentanilla: [], atencionVentanilla: [] }
    return {
      esperaDescarga:     esperaDeDescarga(datos.remitos, datos.descargas),
      ocupacionDarsena:   ocupacionDeDarsena(datos.remitos),
      esperaVentanilla:   esperaDeVentanilla(datos.ventanillas),
      atencionVentanilla: atencionDeVentanilla(datos.ventanillas),
    }
  }, [datos])

  const muestras = muestrasPorVista[vista]
  const total    = useMemo(() => resumir(muestras), [muestras])
  const franjas  = useMemo(() => porFranjaHoraria(muestras), [muestras])
  const grupos   = useMemo(() => porGrupo(muestras), [muestras])
  const bocas    = useMemo(() => porDarsena(muestras), [muestras])
  const actual   = VISTAS.find((v) => v.id === vista)!
  const esVentanilla = vista === 'esperaVentanilla' || vista === 'atencionVentanilla'

  const dias = Math.round((new Date(`${hasta}T00:00:00`).getTime() - new Date(`${desde}T00:00:00`).getTime()) / 86_400_000) + 1

  const exportar = () => descargarCSV(
    `tiempos-muelle-${vista}-${desde}_${hasta}`,
    ['Cuándo', 'Qué', 'Quién', 'Dársena', 'Minutos'],
    [...muestras]
      .sort((a, b) => a.desde.getTime() - b.desde.getTime())
      .map((m) => [m.desde.toLocaleString('es-AR'), m.etiqueta, m.grupo, m.darsena ?? '', m.minutos]),
  )

  const inputClass = 'bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

  const Tile = ({ titulo, valor, ayuda }: { titulo: string; valor: string; ayuda?: string }) => (
    <div className="rounded-xl border border-[#D3D1C7] bg-white p-3">
      <p className="text-xs text-secundario">{titulo}</p>
      <p className="text-2xl font-bold text-gray-900 tabular-nums">{valor}</p>
      {ayuda && <p className="text-[11px] text-secundario mt-0.5">{ayuda}</p>}
    </div>
  )

  const Tabla = ({ titulo, primera, filas }: {
    titulo: string; primera: string; filas: Array<{ clave: string; resumen: ResumenTiempos }>
  }) => (
    <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm overflow-hidden">
      <h2 className="px-4 py-3 text-xs font-semibold text-secundario uppercase tracking-wide">{titulo}</h2>
      {filas.length === 0 ? (
        <p className="px-4 pb-3 text-sm text-secundario">Sin datos en este rango.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={th}>{primera}</th>
                <th className={`${th} text-right`}>Casos</th>
                <th className={`${th} text-right`}>Mediana</th>
                <th className={`${th} text-right`}>Promedio</th>
                <th className={`${th} text-right`}>P90</th>
                <th className={`${th} text-right`}>El peor</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.clave} className="border-t border-[#E7E5DC]">
                  <td className={`${td} truncate max-w-[260px]`} title={f.clave}>{f.clave}</td>
                  <td className={`${td} ${NUMERO}`}>{f.resumen.cantidad}</td>
                  <td className={`${td} ${NUMERO}`}>{duracion(f.resumen.mediana)}</td>
                  <td className={`${td} ${NUMERO}`}>{duracion(f.resumen.promedio)}</td>
                  <td className={`${td} ${NUMERO} font-semibold`}>{duracion(f.resumen.p90)}</td>
                  <td className={`${td} ${NUMERO}`}>{duracion(f.resumen.maximo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )

  return (
    <main className="max-w-[1600px] mx-auto p-4 space-y-4 pb-10">
      <PageHeader
        titulo="Tiempos del muelle"
        contexto={`${PLANTAS[plantaId].label} · ${desde === hasta ? desde : `${desde} a ${hasta}`}`}
        acciones={
          <button
            type="button"
            onClick={exportar}
            disabled={muestras.length === 0}
            className="h-10 px-3 rounded-lg border border-[#D3D1C7] bg-white text-sm font-medium text-gray-700 hover:border-accent hover:text-accent disabled:opacity-50"
          >
            Exportar CSV
          </button>
        }
      />

      <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-3 flex flex-wrap items-end gap-3">
        {!user?.planta && (
          <label className="block">
            <span className="text-xs text-secundario mb-1 block">Planta</span>
            <select value={plantaSel} onChange={(e) => setPlantaSel(e.target.value as PlantaId)} className={inputClass}>
              {(Object.keys(PLANTAS) as PlantaId[]).map((p) => <option key={p} value={p}>{PLANTAS[p].label}</option>)}
            </select>
          </label>
        )}
        <label className="block">
          <span className="text-xs text-secundario mb-1 block">Desde</span>
          <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className="text-xs text-secundario mb-1 block">Hasta</span>
          <input type="date" value={hasta} min={desde} max={hoy} onChange={(e) => setHasta(e.target.value)} className={inputClass} />
        </label>
        <div className="flex gap-1.5">
          {([['Hoy', hoy, hoy], ['7 días', addDaysStr(hoy, -6), hoy], ['30 días', addDaysStr(hoy, -29), hoy]] as const).map(([label, d, h]) => (
            <button
              key={label}
              type="button"
              onClick={() => { setDesde(d); setHasta(h) }}
              className={`h-10 px-3 rounded-lg border text-sm font-medium ${desde === d && hasta === h ? 'border-accent text-accent bg-accent/5' : 'border-[#D3D1C7] bg-white text-gray-700'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {dias > MAX_DIAS_RANGO && (
        <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
          El rango es de {dias} días: por arriba de {MAX_DIAS_RANGO} la consulta baja demasiados documentos y puede tardar bastante.
        </p>
      )}
      {error && <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {VISTAS.map((v) => {
          const Icono = v.icono
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => setVista(v.id)}
              className={`inline-flex items-center gap-1.5 h-10 px-3 rounded-lg border text-sm font-medium ${vista === v.id ? 'border-accent text-accent bg-accent/5' : 'border-[#D3D1C7] bg-white text-gray-700'}`}
            >
              <Icono size={15} /> {v.corto}
              <span className="text-xs text-secundario tabular-nums">({muestrasPorVista[v.id].length})</span>
            </button>
          )
        })}
      </div>

      <p className="text-sm text-secundario">{actual.ayuda}</p>

      {cargando ? (
        <p className="text-sm text-secundario">Cargando…</p>
      ) : muestras.length === 0 ? (
        <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-6 text-center text-sm text-secundario">
          No hay tiempos para medir en este rango. Se cuentan solo los casos con las dos puntas marcadas
          (por ejemplo: el camión marcó el regreso Y el muelle registró la descarga).
        </section>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Tile titulo="Casos medidos" valor={String(total.cantidad)} />
            <Tile titulo="Mediana" valor={duracion(total.mediana)} ayuda="el caso del medio" />
            <Tile titulo="Promedio" valor={duracion(total.promedio)} />
            <Tile titulo="P90" valor={duracion(total.p90)} ayuda="9 de cada 10 por debajo" />
            <Tile titulo="El peor" valor={duracion(total.maximo)} />
          </div>

          <Tabla
            titulo="Por franja horaria (cuándo se tapona)"
            primera="Hora"
            filas={franjas.map((f) => ({ clave: `${String(f.hora).padStart(2, '0')}:00`, resumen: f.resumen }))}
          />

          <Tabla
            titulo={esVentanilla ? 'Por cajero que tomó el turno' : 'Por chofer / fletero'}
            primera={esVentanilla ? 'Cajero' : 'Chofer / fletero'}
            filas={grupos.map((g) => ({ clave: g.grupo, resumen: g.resumen }))}
          />

          {bocas.length > 0 && (
            <Tabla
              titulo="Por dársena"
              primera="Dársena"
              filas={bocas.map((b) => ({ clave: `Dársena ${b.darsena}`, resumen: b.resumen }))}
            />
          )}
        </>
      )}
    </main>
  )
}
