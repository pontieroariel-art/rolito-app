import { useState, useEffect, useRef, useMemo, useDeferredValue, useId, KeyboardEvent } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import type { ClienteIndex, EmpresaTango, UserProfile } from '@/types'
import { coincideBusqueda, normalizarBusqueda, INPUT_BUSQUEDA_PROPS } from '@/utils/busqueda'
import { empresasInhabilitado, etiquetaInhabilitado } from '@/utils/inhabilitadoTango'
import { useClientesIndex } from '@/hooks/useClientesIndex'

/**
 * BUSCADOR / SELECTOR DE CLIENTES canónico (fase 3.1 del reordenamiento,
 * 2026-09-12). Reemplazó a los cinco buscadores a mano (asignación de equipos,
 * toma de service, asignar equipo, comprobantes de clientes, mapa de
 * heladeras) y al combobox viejo de components/ui.
 *
 * Dos modos, misma búsqueda y mismo ítem:
 *  - `desplegable` (default): campo de formulario cerrado que al abrirse
 *    muestra el buscador y la lista (venta del camión, ventanilla, cobranzas,
 *    remitos de carga, visitas, pedidos, movimientos).
 *  - `busqueda`: el input está siempre a la vista y los resultados debajo,
 *    en línea (`listaFlotante` los superpone, para un mapa) y solo al escribir
 *    (`listaSiempre` los lista de entrada, para un panel lateral).
 *
 * Datos: por defecto el índice liviano `clientesIndex` (una suscripción
 * compartida, ver useClientesIndex) filtrado con `filtro`; o una lista propia
 * en `items` (cuentas de Tango de cobranzas, etc.). Devuelve el uid y el ítem;
 * la ficha completa se pide aparte (getUserDocument / useClienteSeleccionado).
 *
 * Accesible: patrón combobox + listbox de ARIA, flechas, Enter, Escape,
 * Inicio/Fin, foco visible; sin dependencias.
 */

export interface ComboItem {
  uid:     string
  label:   string
  codigo?: string
  cuit?:   string
  localidad?: string
  contacto?:  string
  /** Texto extra solo para buscar (códigos y nombres de sucursales), no se muestra. */
  extra?:  string
  /** Cantidad de códigos de Tango de la cuenta (chip "N suc." si hay más de uno). */
  sucursales?: number
  /** label + codigo + cuit + extra ya normalizados, calculados UNA vez: con 2.000
   *  clientes, normalizar cada campo en cada tecla congelaba el buscador. */
  buscar?: string
}

const sufijoInhabilitado = (empresas: EmpresaTango[] | undefined): string => {
  const e = etiquetaInhabilitado(empresas)
  return e ? ` · ${e.toLowerCase()}` : ''
}

const conBuscar = (i: ComboItem): ComboItem =>
  ({ ...i, buscar: normalizarBusqueda([i.label, i.codigo, i.cuit, i.localidad, i.contacto, i.extra].filter(Boolean).join(' ')) })

// Caché por identidad de la lista: las pantallas pasan `toComboItems(clientes)`
// inline y re-mapeaban los 2.000 clientes en cada render.
const cacheItems = new WeakMap<object, ComboItem[]>()

/** Ítems desde fichas completas (pantallas que todavía bajan users enteros). */
export function toComboItems(clientes: UserProfile[]): ComboItem[] {
  const cacheado = cacheItems.get(clientes)
  if (cacheado) return cacheado
  const items = clientes.map((c) => {
    // Cuentas con varias sucursales en Tango (Rappi, Coto…): se buscan también
    // por el código o el nombre de cualquier sucursal (RAP001, "MONROE").
    const codigos = [...(c.tangoIds?.redonhielo ?? []), ...(c.tangoIds?.rolito ?? [])].map((x) => x.codigo)
    return conBuscar({
      uid:    c.uid,
      // Sin CUIT: se avisa en el nombre, porque solo se le puede vender en promo.
      // Inhabilitado en Tango (en una empresa o las dos): también, para que no lo elijan.
      label:  (c.razonSocial || c.nombreContacto || c.nombre || c.email || '') + (c.sinCuit ? ' · sin CUIT (solo promo)' : '') + sufijoInhabilitado(empresasInhabilitado(c)),
      codigo: c.codigoCliente,
      cuit:   c.cuit,
      contacto: c.nombreContacto,
      extra:  [...codigos, ...(c.addresses ?? []).map((a) => a.nombre)].filter(Boolean).join(' '),
      sucursales: new Set(codigos).size,
    })
  })
  cacheItems.set(clientes, items)
  return items
}

/** Ítems desde el índice liviano (clientesIndex, 2026-09-10). */
export function indexAComboItems(clientes: ClienteIndex[]): ComboItem[] {
  const cacheado = cacheItems.get(clientes)
  if (cacheado) return cacheado
  const items = clientes.map((c) => conBuscar({
    uid:    c.uid,
    label:  c.razonSocial + (c.sinCuit ? ' · sin CUIT (solo promo)' : '') + sufijoInhabilitado(c.inhabilitadoEn),
    codigo: c.codigoCliente ?? c.codigos[0],
    cuit:   c.cuit,
    localidad: c.localidad,
    contacto:  c.nombreContacto,
    extra:  [...c.codigos, ...c.sucursales, c.direccion].filter(Boolean).join(' '),
    sucursales: new Set(c.codigos).size,
  }))
  cacheItems.set(clientes, items)
  return items
}

const MAX_RESULTADOS = 50
const VACIO: ComboItem[] = []

interface Props {
  /** uid elegido ('' o null = nada; 'todos' cuando hay `allLabel`). */
  value:       string | null
  onChange:    (uid: string, item: ComboItem | null) => void
  placeholder?: string
  disabled?:   boolean
  autoFocus?:  boolean
  /** Lista propia; si no viene, usa el índice de clientes activos. */
  items?:      ComboItem[]
  /** Filtro sobre el índice (p. ej. solo vinculados a Tango o de una localidad). */
  filtro?:     (c: ClienteIndex) => boolean
  modo?:       'desplegable' | 'busqueda'
  /** Solo desplegable: agrega la opción "todos" al inicio (value = 'todos'). */
  allLabel?:   string
  /** Solo búsqueda: la lista se superpone al contenido (mapa) en vez de fluir debajo. */
  listaFlotante?: boolean
  /** Solo búsqueda: lista los primeros clientes aunque no se haya escrito nada. */
  listaSiempre?: boolean
  /** Solo búsqueda: input más chico (barras de herramientas). */
  compacto?:   boolean
  className?:  string
  listaClassName?: string
  /** Contenido extra cuando no hay resultados (p. ej. un botón "Crear cliente"). */
  sinResultados?: React.ReactNode
}

export default function ClienteCombobox({
  value, onChange, placeholder, disabled = false, autoFocus = false,
  items: itemsProp, filtro, modo = 'desplegable', allLabel,
  listaFlotante = false, listaSiempre = false, compacto = false,
  className = '', listaClassName = '', sinResultados,
}: Props) {
  const id = useId()
  const usaIndice = !itemsProp
  const { clientes, loading } = useClientesIndex({ enabled: usaIndice })
  const filtrados = useMemo(() => (filtro ? clientes.filter(filtro) : clientes), [clientes, filtro])
  const items = itemsProp ?? (usaIndice ? indexAComboItems(filtrados) : VACIO)
  const cargando = usaIndice && loading && items.length === 0

  const [query, setQuery] = useState('')
  const [open,  setOpen]  = useState(false)
  const [activo, setActivo] = useState(0)
  const raiz = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listaRef = useRef<HTMLUListElement>(null)

  const seleccionado = value && value !== 'todos' ? items.find((i) => i.uid === value) ?? null : null

  // Se compara sin puntos, espacios, guiones ni acentos: el autocorrector del
  // iPad convierte "FC." en "F.C." y "fc280" tiene que encontrar a "FC.280".
  // Diferido: la tecla se pinta al instante y el filtrado corre después.
  const queryDiferida = useDeferredValue(query)
  const q = normalizarBusqueda(queryDiferida)
  const visibles = useMemo(() => {
    if (!q) return items.slice(0, MAX_RESULTADOS)
    const out: ComboItem[] = []
    for (const i of items) {
      if (i.buscar ? i.buscar.includes(q) : coincideBusqueda(q, i.label, i.codigo, i.cuit, i.extra)) { out.push(i); if (out.length === MAX_RESULTADOS) break }
    }
    return out
  }, [items, q])

  const esBusqueda = modo === 'busqueda'
  // En modo búsqueda la lista se ve al escribir (o siempre, si se pide); en
  // desplegable, al abrir.
  const listaVisible = esBusqueda ? (listaSiempre || (open && q.length > 0)) : open
  const conTodos = !esBusqueda && !!allLabel && !q
  const opciones = useMemo(() => (conTodos ? [{ uid: 'todos', label: allLabel! } as ComboItem, ...visibles] : visibles), [conTodos, allLabel, visibles])

  useEffect(() => { setActivo(0) }, [q, listaVisible])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => { if (raiz.current && !raiz.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!esBusqueda && open) inputRef.current?.focus()
  }, [esBusqueda, open])

  useEffect(() => {
    const el = listaRef.current?.querySelector<HTMLElement>(`[data-indice="${activo}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activo, listaVisible])

  const elegir = (item: ComboItem) => {
    onChange(item.uid, item.uid === 'todos' ? null : item)
    setQuery('')
    setOpen(false)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLButtonElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActivo((a) => Math.min(a + 1, opciones.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Home' && listaVisible) { e.preventDefault(); setActivo(0) }
    else if (e.key === 'End' && listaVisible) { e.preventDefault(); setActivo(opciones.length - 1) }
    else if (e.key === 'Enter') { if (listaVisible && opciones[activo]) { e.preventDefault(); elegir(opciones[activo]) } else if (!esBusqueda) { e.preventDefault(); setOpen(true) } }
    else if (e.key === 'Escape') { if (open || query) { e.preventDefault(); setOpen(false); setQuery('') } }
  }

  const idLista = `${id}-lista`
  const idOpcion = (i: number) => `${id}-opcion-${i}`
  const truncada = items.length > visibles.length && visibles.length === MAX_RESULTADOS

  const lista = listaVisible && (
    <div
      className={`bg-white border border-[#D3D1C7] rounded-lg shadow-lg overflow-hidden ${esBusqueda && !listaFlotante ? 'mt-1.5' : 'absolute z-50 top-full left-0 right-0 mt-1'} ${esBusqueda ? '' : ''}`}
    >
      {!esBusqueda && (
        <div className="p-2 border-b border-[#D3D1C7]">
          <input
            ref={inputRef}
            {...INPUT_BUSQUEDA_PROPS}
            role="combobox"
            aria-expanded="true"
            aria-controls={idLista}
            aria-activedescendant={opciones[activo] ? idOpcion(activo) : undefined}
            aria-autocomplete="list"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Buscar por nombre, código o CUIT…"
            className="w-full text-sm px-2 py-1.5 bg-[#F8F7F2] rounded border border-[#D3D1C7] focus:outline-none focus:ring-1 focus:ring-accent text-gray-900 placeholder-gray-400"
          />
        </div>
      )}
      <ul ref={listaRef} id={idLista} role="listbox" aria-label="Clientes" className={`overflow-y-auto ${listaClassName || 'max-h-72'}`}>
        {cargando ? (
          <li className="px-3 py-3 text-sm text-gray-400" role="presentation">Cargando clientes…</li>
        ) : opciones.length === 0 ? (
          <li className="px-3 py-3 text-sm text-gray-400" role="presentation">
            Ningún cliente coincide.
            {sinResultados}
          </li>
        ) : opciones.map((item, i) => {
          const esTodos = item.uid === 'todos'
          const elegido = item.uid === value
          // Contacto solo si aporta algo (en muchas fichas repite la razón social).
          const contacto = item.contacto && normalizarBusqueda(item.contacto) !== normalizarBusqueda(item.label) ? item.contacto : null
          const secundario = esTodos ? '' : [
            item.codigo ? `Código ${item.codigo}` : (item.sucursales ? undefined : 'Sin código de Tango'),
            item.cuit ? `CUIT ${item.cuit}` : null,
            item.localidad || null,
            contacto,
          ].filter(Boolean).join(' · ')
          return (
            <li
              key={item.uid}
              id={idOpcion(i)}
              data-indice={i}
              role="option"
              aria-selected={elegido}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActivo(i)}
              onClick={() => elegir(item)}
              className={`px-3 py-2 cursor-pointer ${i === activo ? 'bg-[#F0EEE7]' : ''} ${elegido ? 'bg-[#E8F5F0]' : ''}`}
            >
              <div className="flex items-center gap-2">
                <span className={`text-sm truncate ${elegido ? 'text-accent font-medium' : esTodos ? 'text-gray-500' : 'text-gray-900'}`}>{item.label}</span>
                {/* Cuentas con varias sucursales en Tango: chip fijo, que no se corte con el nombre largo. */}
                {item.sucursales && item.sucursales > 1 ? (
                  <span className="ml-auto shrink-0 text-[10px] font-semibold rounded-full px-1.5 py-0.5 bg-accent/10 text-accent border border-accent/30">{item.sucursales} suc.</span>
                ) : null}
              </div>
              {secundario && <p className="text-xs text-gray-500 truncate">{secundario}</p>}
            </li>
          )
        })}
      </ul>
      {!cargando && truncada && (
        <p className="px-3 py-1.5 text-xs text-gray-400 border-t border-[#D3D1C7]">
          {q ? `Primeros ${MAX_RESULTADOS}: afiná la búsqueda` : `Primeros ${MAX_RESULTADOS} de ${items.length}: escribí para filtrar`}
        </p>
      )}
    </div>
  )

  if (esBusqueda) {
    const alto = compacto ? 'py-1.5' : 'py-2'
    return (
      <div ref={raiz} className={`relative ${className}`}>
        <div className="relative">
          <Search size={compacto ? 14 : 15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            ref={inputRef}
            {...INPUT_BUSQUEDA_PROPS}
            role="combobox"
            aria-expanded={!!listaVisible}
            aria-controls={idLista}
            aria-activedescendant={listaVisible && opciones[activo] ? idOpcion(activo) : undefined}
            aria-autocomplete="list"
            aria-label={placeholder ?? 'Buscar cliente'}
            autoFocus={autoFocus}
            disabled={disabled}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={placeholder ?? 'Buscar por nombre, código o CUIT…'}
            className={`w-full bg-white border border-[#D3D1C7] rounded-lg pl-9 pr-8 ${alto} text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-gray-50 disabled:text-gray-400`}
          />
          {query && (
            <button type="button" onClick={() => { setQuery(''); inputRef.current?.focus() }} aria-label="Borrar búsqueda"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 p-0.5">
              <X size={14} />
            </button>
          )}
        </div>
        {lista}
      </div>
    )
  }

  const etiqueta = value === 'todos' && allLabel
    ? allLabel
    : seleccionado
      ? (seleccionado.codigo ? `[${seleccionado.codigo}] ${seleccionado.label}` : seleccionado.label)
      : null

  return (
    <div ref={raiz} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        autoFocus={autoFocus}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={idLista}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className={`w-full bg-white border rounded-lg px-3 py-2 text-sm flex items-center justify-between gap-2 text-left focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-gray-50 disabled:cursor-not-allowed ${
          open ? 'border-accent ring-1 ring-accent' : 'border-[#D3D1C7]'
        }`}
      >
        {etiqueta
          ? <span className="text-gray-900 truncate">{etiqueta}</span>
          : <span className="text-gray-400 truncate">{placeholder ?? '— Seleccioná un cliente —'}</span>}
        <ChevronDown size={16} className="text-gray-400 shrink-0" />
      </button>
      {lista}
    </div>
  )
}
