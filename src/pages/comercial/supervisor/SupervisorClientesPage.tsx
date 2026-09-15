import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Search, X } from 'lucide-react'
import SupervisorHeader from '@/components/supervisor/SupervisorHeader'
import { indexAComboItems, type ComboItem } from '@/components/common/ClienteCombobox'
import { useClientesConDeuda } from '@/hooks/useClientesConDeuda'
import { useClientesIndex } from '@/hooks/useClientesIndex'
import { usePrivacidad } from '@/hooks/usePrivacidad'
import { INPUT_BUSQUEDA_PROPS, normalizarBusqueda } from '@/utils/busqueda'
import { ordenarPorPrioridad, type FilaDeuda } from '@/utils/listaClientesDeuda'
import { formatoARS } from '@/utils/money'
import { ETIQUETA_MORA, type NivelMora } from '@/utils/mora'
import { haceCuanto } from '@/utils/tiempo'
import { NOMBRE_EMPRESA_CORTO } from '@/utils/tangoEmpresas'

/**
 * CLIENTES — la puerta de entrada del supervisor (2026-09-13; rehecha el
 * 2026-09-15 a pedido de Ariel: "el diseño me parece feo, el buscador no anda,
 * los filtros los sacaría, usaría solo el buscador").
 *
 * UN solo buscador, sobre TODOS los clientes (clientesIndex), y una sola lista:
 *  - sin escribir nada, la agenda: los que DEBEN, ordenados por urgencia (mora,
 *    días de atraso, importe), con los ya cobrados hoy al fondo;
 *  - escribiendo, los clientes que coinciden (deban o no), con su deuda al lado
 *    si la tienen. Borrar el texto vuelve a la agenda.
 *
 * Cada fila abre la FICHA: ahí se cobra, se llama o se manda WhatsApp con el
 * saldo completo a la vista. Nada más en la tarjeta.
 *
 * Lo que la hacía lenta antes: dos buscadores (el de arriba empujaba toda la
 * pantalla con sus resultados en vez de flotar; el de abajo re-dibujaba las 478
 * tarjetas en cada tecla), chips de estado y de zona, y una tarjeta con su
 * propio estado de privacidad por fila. Ahora: el texto va diferido
 * (`useDeferredValue`), la búsqueda usa el índice precalculado del combobox,
 * las filas son `memo`, la privacidad se lee una vez y la agenda se pinta de a
 * 40 a medida que se scrollea.
 */
const TOPE_RESULTADOS = 50
const PASO_AGENDA = 40

export default function SupervisorClientesPage() {
  const { filas, cargando, sinSaldos } = useClientesConDeuda()
  const { clientes } = useClientesIndex()
  const { privado } = usePrivacidad()
  const [texto, setTexto] = useState('')
  const diferido = useDeferredValue(texto)
  const q = normalizarBusqueda(diferido)
  const [limite, setLimite] = useState(PASO_AGENDA)
  const inputRef = useRef<HTMLInputElement>(null)

  const agenda = useMemo(() => ordenarPorPrioridad(filas), [filas])
  const deudaPorUid = useMemo(() => new Map(filas.map((f) => [f.uid, f])), [filas])
  // indexAComboItems cachea por identidad de la lista y precalcula `buscar`.
  const items = useMemo(() => indexAComboItems(clientes), [clientes])
  const resultados = useMemo(() => {
    if (!q) return null
    const out: ComboItem[] = []
    for (const i of items) {
      if ((i.buscar ?? '').includes(q)) { out.push(i); if (out.length === TOPE_RESULTADOS) break }
    }
    return out
  }, [items, q])

  const totalDeuda = useMemo(() => agenda.reduce((t, f) => t + f.saldoTotal, 0), [agenda])
  const actualizado = useMemo(() => {
    let max: { toDate(): Date } | undefined
    for (const f of filas) if (f.actualizadoEn && (!max || f.actualizadoEn.toDate() > max.toDate())) max = f.actualizadoEn
    return max ? haceCuanto(max) : ''
  }, [filas])

  // La agenda se pinta de a 40: el sentinela del pie pide 40 más al asomar.
  const sentinela = useRef<HTMLDivElement>(null)
  const hayMas = !q && limite < agenda.length
  useEffect(() => {
    const el = sentinela.current
    if (!el || !hayMas) return
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setLimite((l) => l + PASO_AGENDA) }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hayMas, limite])

  const limpiar = () => { setTexto(''); setLimite(PASO_AGENDA); inputRef.current?.focus() }

  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2]">
      <SupervisorHeader title="Clientes" back />
      <main className="max-w-md mx-auto p-4 space-y-3 pb-10">
        <div className="relative">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-secundario pointer-events-none" />
          <input
            ref={inputRef}
            type="search"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar cliente…"
            aria-label="Buscar cliente por nombre, código, CUIT, sucursal o dirección"
            enterKeyHint="search"
            {...INPUT_BUSQUEDA_PROPS}
            className="w-full h-12 bg-white border border-[#D3D1C7] rounded-xl pl-10 pr-11 text-base text-gray-900 placeholder:text-secundario focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent [&::-webkit-search-cancel-button]:hidden"
          />
          {texto && (
            <button type="button" onClick={limpiar} aria-label="Borrar la búsqueda"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg flex items-center justify-center text-secundario active:bg-[#F1F0EA]">
              <X size={18} />
            </button>
          )}
        </div>

        {resultados ? (
          <>
            <p className="text-xs text-secundario px-1">
              {resultados.length === 0 ? 'Ningún cliente coincide.' : resultados.length === TOPE_RESULTADOS ? `Primeros ${TOPE_RESULTADOS} resultados: afiná la búsqueda` : `${resultados.length} ${resultados.length === 1 ? 'cliente' : 'clientes'}`}
            </p>
            <div className="space-y-2">
              {resultados.map((i) => <FilaBusqueda key={i.uid} item={i} deuda={deudaPorUid.get(i.uid)} privado={privado} />)}
            </div>
          </>
        ) : cargando ? (
          <p className="text-sm text-secundario text-center pt-8">Cargando saldos…</p>
        ) : sinSaldos ? (
          <div className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-4 text-center">
            <p className="text-sm text-gray-600">No hay saldos de Tango cargados todavía.</p>
            <p className="text-xs text-secundario mt-1">Buscá al cliente arriba para abrir su ficha igual.</p>
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between px-1">
              <p className="text-xs text-secundario">
                <span className="font-semibold text-gray-900">{agenda.length}</span> {agenda.length === 1 ? 'cliente debe' : 'clientes deben'} · <span className="font-semibold text-gray-900 tabular-nums">{privado ? '$ •••••' : formatoARS(totalDeuda)}</span>
              </p>
              {actualizado && <p className="text-xs text-secundario">Tango · {actualizado}</p>}
            </div>
            <div className="space-y-2">
              {agenda.slice(0, limite).map((f) => <FilaAgenda key={f.uid} f={f} privado={privado} />)}
            </div>
            {hayMas && (
              <div ref={sentinela} className="pt-2">
                <button type="button" onClick={() => setLimite((l) => l + PASO_AGENDA)}
                  className="w-full h-11 rounded-xl border border-[#D3D1C7] bg-white text-sm font-medium text-gray-700">
                  Mostrar {Math.min(PASO_AGENDA, agenda.length - limite)} más · quedan {agenda.length - limite}
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

const BORDE: Record<NivelMora, string> = { ok: 'border-l-[#D3D1C7]', amarillo: 'border-l-amber-400', rojo: 'border-l-red-500' }
const ATRASO: Record<NivelMora, string> = { ok: 'text-secundario', amarillo: 'text-amber-700', rojo: 'text-red-600' }

const desglose = (f: FilaDeuda): string => {
  const partes = (['redonhielo', 'rolito'] as const)
    .map((e) => [e, f.porEmpresa?.[e]?.saldoTotal ?? 0] as const)
    .filter(([, t]) => t > 0)
  if (partes.length < 2) return ''
  return partes.map(([e, t]) => `${NOMBRE_EMPRESA_CORTO[e]} ${formatoARS(t)}`).join(' · ')
}

/** Lado derecho de la tarjeta: cuánto debe y hace cuánto. */
function Deuda({ f, privado }: { f: FilaDeuda; privado: boolean }) {
  const detalle = f.nivel !== 'ok'
    ? `${ETIQUETA_MORA[f.nivel]} · ${f.diasAtraso} d`
    : f.diasAtraso > 0 ? `${f.diasAtraso} d de atraso` : 'Al día'
  return (
    <div className="text-right shrink-0">
      <p className="text-base font-bold text-gray-900 tabular-nums leading-tight">{privado ? '$ •••••' : formatoARS(f.saldoTotal)}</p>
      <p className={`text-[11px] font-medium leading-tight ${ATRASO[f.nivel]}`}>{detalle}</p>
    </div>
  )
}

/** Tarjeta: toda ella abre la ficha. Borde izquierdo con el color de la mora. */
function Tarjeta({ uid, nivel, children }: { uid: string; nivel: NivelMora; children: React.ReactNode }) {
  return (
    <Link to={`/supervisor/cliente/${uid}`}
      className={`flex items-center gap-3 bg-white rounded-xl border border-[#D3D1C7] border-l-4 ${BORDE[nivel]} shadow-sm px-3.5 py-3 active:scale-[0.99] transition-transform`}>
      {children}
    </Link>
  )
}

const FilaAgenda = memo(function FilaAgenda({ f, privado }: { f: FilaDeuda; privado: boolean }) {
  const dos = desglose(f)
  return (
    <Tarjeta uid={f.uid} nivel={f.nivel}>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate" title={f.razonSocial}>{f.razonSocial}</p>
        <p className="text-xs text-secundario truncate">
          {[f.localidad, f.codigoTango].filter(Boolean).join(' · ')}
          {dos && !privado ? ` · ${dos}` : ''}
        </p>
        {f.cobradoHoy && (
          <p className="text-[11px] font-medium text-[#0F6E56] inline-flex items-center gap-1 mt-0.5"><CheckCircle2 size={12} /> Ya le cobraste hoy</p>
        )}
      </div>
      <Deuda f={f} privado={privado} />
    </Tarjeta>
  )
})

const FilaBusqueda = memo(function FilaBusqueda({ item, deuda, privado }: { item: ComboItem; deuda?: FilaDeuda; privado: boolean }) {
  return (
    <Tarjeta uid={item.uid} nivel={deuda?.nivel ?? 'ok'}>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate" title={item.label}>{item.label}</p>
        <p className="text-xs text-secundario truncate">
          {[item.localidad, item.codigo, item.sucursales && item.sucursales > 1 ? `${item.sucursales} sucursales` : ''].filter(Boolean).join(' · ')}
        </p>
        {deuda?.cobradoHoy && (
          <p className="text-[11px] font-medium text-[#0F6E56] inline-flex items-center gap-1 mt-0.5"><CheckCircle2 size={12} /> Ya le cobraste hoy</p>
        )}
      </div>
      {deuda ? <Deuda f={deuda} privado={privado} /> : <p className="text-xs text-secundario shrink-0">Sin deuda</p>}
    </Tarjeta>
  )
})
