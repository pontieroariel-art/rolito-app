import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { HandCoins } from 'lucide-react'
import SupervisorHeader from '@/components/supervisor/SupervisorHeader'
import ChipMora, { BORDE_MORA } from '@/components/supervisor/ChipMora'
import ClienteCombobox from '@/components/common/ClienteCombobox'
import { useClientesConDeuda } from '@/hooks/useClientesConDeuda'
import { coincideBusqueda, normalizarBusqueda } from '@/utils/busqueda'
import {
  conteosDe, filtrarFilas, ordenarPorPrioridad, zonasDe, type FiltroDeuda, type FilaDeuda,
} from '@/utils/listaClientesDeuda'
import { formatoARS } from '@/utils/money'
import { esDatoViejo, haceCuanto } from '@/utils/tiempo'
import { NOMBRE_EMPRESA_CORTO } from '@/utils/tangoEmpresas'

/**
 * CLIENTES — la puerta de entrada del supervisor (2026-09-13). Fusiona las dos
 * pantallas que había ("Buscar cliente" y "Clientes con deuda"), que eran dos
 * buscadores distintos sobre dos universos distintos para la misma tarea mental
 * de encontrar a alguien.
 *
 * Los dos universos se separan por MECANISMO, no por un chip:
 *  - el buscador de arriba busca en TODOS los clientes (clientesIndex) — el que
 *    sabe a quién va a ver, escribe y entra;
 *  - la lista de abajo son los que DEBEN, ordenados por urgencia y filtrables
 *    por zona — la agenda del día del que sale a recorrer.
 *
 * La fila abre la FICHA (ahí se decide, con el saldo completo a la vista) y el
 * botón lateral va derecho a cobrar, para el que ya sabe a qué va.
 */
export default function SupervisorClientesPage() {
  const navigate = useNavigate()
  const { filas, cargando, sinSaldos } = useClientesConDeuda()
  const [estado, setEstado] = useState<FiltroDeuda>('deuda')
  const [zona, setZona] = useState('')
  const [busqueda, setBusqueda] = useState('')

  const conteos = useMemo(() => conteosDe(filas), [filas])
  const zonas = useMemo(() => zonasDe(filas), [filas])

  const lista = useMemo(() => {
    const q = normalizarBusqueda(busqueda)
    return ordenarPorPrioridad(filtrarFilas(filas, {
      estado, zona,
      coincide: q ? (f) => coincideBusqueda(q, f.razonSocial, f.codigoTango, f.localidad) : undefined,
    }))
  }, [filas, estado, zona, busqueda])

  const totalDeuda = useMemo(() => lista.reduce((t, f) => t + f.saldoTotal, 0), [lista])

  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2]">
      <SupervisorHeader title="Clientes" back />
      <main className="max-w-md mx-auto p-4 space-y-3 pb-10">
        {/* TODOS los clientes, deban o no. Sin autoFocus ni listaSiempre: el
            teclado no tiene que saltar tapando la agenda apenas se entra. */}
        <ClienteCombobox
          modo="busqueda"
          value=""
          onChange={(uid) => uid && navigate(`/supervisor/cliente/${uid}`)}
          placeholder="Nombre, código, CUIT o dirección…"
          listaClassName="max-h-[50vh]"
        />

        {cargando ? (
          <p className="text-sm text-secundario text-center pt-8">Cargando saldos…</p>
        ) : sinSaldos ? (
          <div className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-4 text-center">
            <p className="text-sm text-gray-600">No hay saldos de Tango cargados todavía.</p>
            <p className="text-xs text-secundario mt-1">El cache se actualiza solo desde el servidor de Tango. Buscá al cliente arriba para abrir su ficha igual.</p>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              {([['deuda', `Con deuda (${conteos.deuda})`], ['vencidos', `Vencidos (${conteos.vencidos})`],
                ['mora', `En mora (${conteos.mora})`]] as const).map(([id, label]) => (
                <button key={id} type="button" onClick={() => setEstado(id)}
                  className={`flex-1 h-11 rounded-lg border px-2 text-xs font-medium ${estado === id ? 'bg-accent text-white border-accent' : 'bg-white text-gray-700 border-[#D3D1C7]'}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* El recorrido de la calle es geográfico: sin esto, el orden por mora
                manda al supervisor de una punta del conurbano a la otra. */}
            {zonas.length > 1 && (
              <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1">
                {['', ...zonas].map((z) => (
                  <button key={z || 'todas'} type="button" onClick={() => setZona(z)}
                    className={`h-11 shrink-0 rounded-full border px-4 text-xs font-medium ${zona === z ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-[#D3D1C7]'}`}>
                    {z || 'Todas las zonas'}
                  </button>
                ))}
              </div>
            )}

            <div className="relative">
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Filtrar la lista por nombre, código o zona…"
                aria-label="Filtrar la lista de deudores"
                className="w-full bg-white border border-[#D3D1C7] rounded-lg px-3 h-11 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div className="flex items-center justify-between px-1">
              <p className="text-xs text-secundario">{lista.length} {lista.length === 1 ? 'cliente' : 'clientes'}</p>
              <p className="text-xs text-secundario">Deuda: <span className="font-semibold text-gray-900 tabular-nums">{formatoARS(totalDeuda)}</span></p>
            </div>

            {lista.length === 0 && <p className="text-sm text-secundario text-center py-6">Ningún cliente coincide.</p>}

            <div className="space-y-2">
              {lista.map((f) => <FilaCliente key={f.uid} f={f} />)}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

// "Redonhielo $745.288,75 · Rolito $163.200,00" cuando debe en las dos empresas.
const desglose = (f: FilaDeuda): string => {
  const partes = (['redonhielo', 'rolito'] as const)
    .map((e) => [e, f.porEmpresa?.[e]?.saldoTotal ?? 0] as const)
    .filter(([, t]) => t > 0)
  if (partes.length < 2) return ''
  return partes.map(([e, t]) => `${NOMBRE_EMPRESA_CORTO[e]} ${formatoARS(t)}`).join(' · ')
}

function FilaCliente({ f }: { f: FilaDeuda }) {
  const viejo = esDatoViejo(f.actualizadoEn)
  return (
    <div className={`flex bg-white rounded-xl border shadow-sm overflow-hidden ${BORDE_MORA[f.nivel]}`}>
      {/* El nombre se lleva la primera línea ENTERA: las razones sociales de Tango
          tienen 45 caracteres y, compartiendo línea con el importe, quedaban en
          "GASTRONOMIA E…". El importe va abajo, grande, con el chip al lado. */}
      <Link to={`/supervisor/cliente/${f.uid}`} className="block flex-1 min-w-0 p-3 active:bg-gray-50">
        <p className="text-sm font-medium text-gray-900 truncate" title={f.razonSocial}>{f.razonSocial}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className={`text-base font-bold tabular-nums ${f.cobradoHoy ? 'text-secundario' : 'text-gray-900'}`}>
            {formatoARS(f.saldoTotal)}
          </span>
          <ChipMora nivel={f.nivel} />
          {f.cobradoHoy && (
            <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 border text-accent bg-accent/10 border-accent/30">
              Ya le cobraste hoy
            </span>
          )}
        </div>
        {/* Orden por importancia: lo que se corta al truncar tiene que ser lo que
            menos importa (la cantidad de comprobantes), no los días de atraso. */}
        <p className="text-xs text-secundario truncate mt-0.5">
          {f.localidad && `${f.localidad} · `}
          {f.diasAtraso > 0 && <span className="text-red-600">{f.diasAtraso} {f.diasAtraso === 1 ? 'día' : 'días'} de atraso · </span>}
          cód. {f.codigoTango} · {f.comprobantes} {f.comprobantes === 1 ? 'comprobante' : 'comprobantes'}
        </p>
        {desglose(f) && <p className="text-xs text-secundario truncate">{desglose(f)}</p>}
        {/* Un saldo de hace días puede hacer que cobre de menos o reclame algo ya
            pagado: pasado un día deja de ser un gris más. */}
        <p className={`text-xs mt-0.5 ${viejo ? 'text-amber-700 font-medium' : 'text-secundario'}`}>
          Saldo de Tango {haceCuanto(f.actualizadoEn)}
        </p>
      </Link>
      <Link to={`/supervisor/cobrar?cliente=${f.uid}`} aria-label={`Cobrar a ${f.razonSocial}`}
        className="flex flex-col items-center justify-center gap-0.5 px-3 min-w-[56px] border-l border-[#D3D1C7] text-accent active:bg-accent/10">
        <HandCoins size={18} />
        <span className="text-[10px] font-medium">Cobrar</span>
      </Link>
    </div>
  )
}
