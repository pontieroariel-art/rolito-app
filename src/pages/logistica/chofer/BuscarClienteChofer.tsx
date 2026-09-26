import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, Clock, MapPin, Navigation, Package, Phone, User } from 'lucide-react'
import ChoferHeader from '@/components/chofer/ChoferHeader'
import ClienteCombobox, { type ComboItem } from '@/components/common/ClienteCombobox'
import { useClientesIndex } from '@/hooks/useClientesIndex'
import { useClienteSeleccionado } from '@/hooks/useClienteSeleccionado'
import { normalizarBusqueda } from '@/utils/busqueda'
import {
  domiciliosDelCliente, filtrarDomicilios, telDe, tieneUbicacion,
  urlComoLlegar, urlMapaEmbebido, urlVender, urlWaze, type DomicilioChofer,
} from '@/utils/buscarClienteChofer'
import type { ClienteIndex } from '@/types'

// Buscar cliente del chofer (2026-09-26, pedido de los choferes: "búsqueda del
// cliente donde figure principalmente la ubicación"). Pedido de Ariel: la app
// del chofer no se puede tildar, tiene que ser súper fluida. Por eso:
// - busca en el índice liviano que ya está en el teléfono (sin señal anda igual);
// - muestra los domicilios del índice al instante y la ficha completa (horario,
//   contacto) llega después sin bloquear nada;
// - el mapa es un iframe de Google Maps, no el SDK: no suma peso a la app, y se
//   carga uno solo, el del domicilio abierto (Coto tiene 37 sucursales);
// - no muestra saldos, deuda ni precios (el chofer no ve importes de cta. cte.).

// Ítems del buscador con las calles y los nombres de TODAS las sucursales, para
// encontrar al cliente por la dirección ("monroe 100"). Caché por identidad de
// la lista, igual que el buscador común: se arma una vez, no en cada tecla.
const cacheItems = new WeakMap<object, ComboItem[]>()
function itemsConDomicilios(clientes: ClienteIndex[]): ComboItem[] {
  const c = cacheItems.get(clientes)
  if (c) return c
  const items = clientes.map((x) => {
    const extra = [...x.codigos, ...x.sucursales, x.direccion, ...(x.domicilios ?? []).flatMap((d) => [d.nombre, d.direccion])].filter(Boolean).join(' ')
    return {
      uid: x.uid, label: x.razonSocial, codigo: x.codigoCliente ?? x.codigos[0], cuit: x.cuit,
      localidad: x.localidad, contacto: x.nombreContacto, extra, sucursales: new Set(x.codigos).size,
      buscar: normalizarBusqueda([x.razonSocial, x.codigoCliente, x.cuit, x.localidad, x.nombreContacto, extra].filter(Boolean).join(' ')),
    }
  })
  cacheItems.set(clientes, items)
  return items
}

const BOTON = 'flex items-center justify-center gap-2 rounded-xl font-bold touch-manipulation select-none active:scale-[0.98] transition-transform'

const Domicilio = memo(function Domicilio({ d, abierto, onToggle, vender }: { d: DomicilioChofer; abierto: boolean; onToggle: (id: string) => void; vender?: string }) {
  const ir = urlComoLlegar(d)
  const waze = urlWaze(d)
  const mapa = abierto ? urlMapaEmbebido(d) : null
  // Al abrir un domicilio la pantalla se acomoda para que se vean los botones.
  const ref = useRef<HTMLLIElement>(null)
  const primera = useRef(true)
  useEffect(() => {
    if (primera.current) { primera.current = false; return }
    if (abierto) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [abierto])
  return (
    <li ref={ref} className="bg-white border border-[#D3D1C7] rounded-2xl overflow-hidden scroll-mt-20">
      <button type="button" onClick={() => onToggle(d.id)} aria-expanded={abierto}
        className="w-full flex items-start gap-3 px-4 py-3 text-left touch-manipulation">
        <MapPin size={20} className={`mt-0.5 shrink-0 ${tieneUbicacion(d) ? 'text-accent' : 'text-amber-600'}`} />
        <span className="flex-1 min-w-0">
          <span className="block text-base font-bold text-gray-900 truncate" title={d.nombre || d.direccion}>
            {d.nombre || 'Domicilio'}{d.principal && <span className="ml-2 text-xs font-semibold uppercase text-accent">principal</span>}
          </span>
          <span className="block text-sm text-gray-700 break-words">{d.direccion || 'Sin dirección cargada'}</span>
        </span>
        <ChevronDown size={20} className={`mt-1 shrink-0 text-secundario transition-transform ${abierto ? 'rotate-180' : ''}`} />
      </button>
      {abierto && (
        <div className="px-4 pb-4 flex flex-col gap-3">
          {mapa ? (
            <iframe title={`Mapa de ${d.nombre || d.direccion}`} src={mapa} loading="lazy" referrerPolicy="no-referrer-when-downgrade"
              className="w-full h-48 rounded-xl border border-[#E7E5DC] bg-[#F1EFE8]" />
          ) : (
            <p className="text-sm text-amber-700">Sin ubicación en el mapa: "Cómo llegar" busca por la dirección escrita.</p>
          )}
          {(d.horario || d.contacto) && (
            <div className="flex flex-col gap-1 text-sm text-gray-700">
              {d.horario && <p className="flex items-center gap-2"><Clock size={15} className="text-secundario shrink-0" /> Recibe de {d.horario}</p>}
              {d.contacto && <p className="flex items-center gap-2"><User size={15} className="text-secundario shrink-0" /> {d.contacto}</p>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {ir && (
              <a href={ir} target="_blank" rel="noopener noreferrer" className={`${BOTON} col-span-2 h-14 bg-accent text-white text-lg`}>
                <Navigation size={22} /> Cómo llegar
              </a>
            )}
            {waze && (
              <a href={waze} target="_blank" rel="noopener noreferrer" className={`${BOTON} h-12 bg-white border border-[#D3D1C7] text-gray-900`}>
                <Navigation size={18} className="text-[#33CCFF]" /> Waze
              </a>
            )}
            {d.telefono ? (
              <a href={`tel:${telDe(d.telefono)}`} className={`${BOTON} h-12 bg-white border border-[#D3D1C7] text-gray-900`}>
                <Phone size={18} className="text-accent" /> Llamar
              </a>
            ) : (
              <span className={`${BOTON} h-12 bg-[#F1EFE8] text-inerte`}><Phone size={18} /> Sin teléfono</span>
            )}
            {vender && (
              <Link to={vender} className={`${BOTON} col-span-2 h-14 bg-white border-2 border-accent text-accent text-base whitespace-nowrap`}>
                <Package size={22} /> Vender en esta sucursal
              </Link>
            )}
          </div>
        </div>
      )}
    </li>
  )
})

export default function BuscarClienteChofer() {
  const { clientes, loading } = useClientesIndex()
  const items = useMemo(() => itemsConDomicilios(clientes), [clientes])
  const [uid, setUid] = useState('')
  const [abiertoId, setAbiertoId] = useState<string | null>(null)
  const [filtro, setFiltro] = useState('')

  const indice = useMemo(() => (uid ? clientes.find((c) => c.uid === uid) ?? null : null), [clientes, uid])
  const { cliente: ficha, loading: cargandoFicha } = useClienteSeleccionado(uid || null)
  const domicilios = useMemo(() => domiciliosDelCliente(indice, ficha), [indice, ficha])
  const visibles = useMemo(() => filtrarDomicilios(domicilios, filtro), [domicilios, filtro])
  const varias = domicilios.length > 1
  // Con un solo domicilio se abre solo; con varios, el que toque el chofer.
  const abierto = abiertoId ?? (domicilios.length === 1 ? domicilios[0]!.id : null)

  const elegir = (id: string) => { setUid(id); setAbiertoId(null); setFiltro('') }
  const toggle = (id: string) => setAbiertoId((prev) => (prev === id || (prev === null && domicilios.length === 1) ? '' : id))

  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2] text-gray-900">
      <ChoferHeader title="Buscar cliente" back />
      <main className="max-w-2xl mx-auto px-4 py-4 flex flex-col gap-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
        <ClienteCombobox
          modo="busqueda"
          items={items}
          value={uid}
          onChange={(id) => elegir(id)}
          autoFocus={!uid}
          placeholder="Nombre, código, sucursal o calle…"
          sinResultados={loading && items.length === 0 ? 'Cargando clientes…' : undefined}
        />

        {!uid && (
          <p className="text-sm text-secundario text-center px-4">
            Escribí parte del nombre, el código de Tango, el nombre de la sucursal o la calle. Anda también sin señal.
          </p>
        )}

        {uid && (
          <>
            <section className="bg-white border border-[#D3D1C7] rounded-2xl px-4 py-3">
              <p className="text-lg font-black text-gray-900 leading-tight break-words">{indice?.razonSocial ?? ficha?.razonSocial ?? 'Cliente'}</p>
              <p className="text-sm text-secundario">
                {[indice?.codigoCliente ?? indice?.codigos[0], indice?.localidad].filter(Boolean).join(' · ')}
                {domicilios.length > 1 ? ` · ${domicilios.length} domicilios` : ''}
              </p>
            </section>

            {domicilios.length > 5 && (
              <input type="search" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Filtrar sucursal o calle…"
                className="h-12 px-4 rounded-xl border border-[#D3D1C7] bg-white text-base focus:outline-none focus:ring-2 focus:ring-accent" />
            )}

            {domicilios.length === 0 ? (
              <p className="text-sm text-secundario">{cargandoFicha ? 'Buscando los domicilios…' : 'Este cliente no tiene domicilios cargados. Avisale a logística.'}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {visibles.map((d) => <Domicilio key={d.id} d={d} abierto={abierto === d.id} onToggle={toggle} vender={varias ? urlVender(uid, d) : undefined} />)}
                {visibles.length === 0 && <li className="text-sm text-secundario">Ninguna sucursal coincide con "{filtro}".</li>}
              </ul>
            )}

            {/* Con varias sucursales se vende desde la tarjeta de cada una, así la
                venta sale al código de Tango de ESA sucursal y no a casa central. */}
            {!varias && (
              <Link to={urlVender(uid, domicilios[0])} className={`${BOTON} h-14 bg-white border-2 border-accent text-accent text-lg`}>
                <Package size={22} /> Vender a este cliente
              </Link>
            )}
          </>
        )}
      </main>
    </div>
  )
}
