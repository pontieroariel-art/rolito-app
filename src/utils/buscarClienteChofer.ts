import type { ClienteIndex, DeliveryAddress, UserProfile } from '@/types'
import { normalizarBusqueda } from './busqueda'

// Buscar cliente del chofer (2026-09-26, pedido de los choferes: "búsqueda del
// cliente donde figure principalmente la ubicación"). Lógica pura: qué domicilios
// se muestran y a dónde lleva cada botón. La pantalla es
// pages/logistica/chofer/BuscarClienteChofer.tsx.

export interface DomicilioChofer {
  id:        string
  nombre:    string
  direccion: string
  lat:       number | null
  lng:       number | null
  horario:   string
  contacto:  string
  telefono:  string
  principal: boolean
  /** Texto normalizado para filtrar las sucursales de una cuenta grande (Coto, 37). */
  buscar:    string
}

const coord = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null)

/** Domicilio con coordenadas usables (el 0,0 de un geocode fallido no cuenta). */
export const tieneUbicacion = (d: Pick<DomicilioChofer, 'lat' | 'lng'>): boolean =>
  d.lat !== null && d.lng !== null && !(d.lat === 0 && d.lng === 0)

function armar(p: Omit<DomicilioChofer, 'buscar'>): DomicilioChofer {
  return { ...p, buscar: normalizarBusqueda([p.nombre, p.direccion, p.id].join(' ')) }
}

/**
 * Domicilios del cliente. Lo del índice (que ya está en el teléfono) se muestra
 * al instante; cuando llega la ficha completa se usa la ficha, que suma horario
 * y contacto. El principal va primero.
 */
export function domiciliosDelCliente(
  indice: Pick<ClienteIndex, 'direccion' | 'domicilios' | 'telefono'> | null | undefined,
  ficha?: Partial<Pick<UserProfile, 'addresses' | 'address' | 'lat' | 'lng' | 'telefono' | 'phone'>> | null,
): DomicilioChofer[] {
  const telCliente = (ficha?.telefono || ficha?.phone || indice?.telefono || '').trim()
  let lista: DomicilioChofer[] = []
  if (ficha?.addresses?.length) {
    lista = ficha.addresses.map((a: DeliveryAddress, i) => armar({
      id: a.id || `sin-codigo-${i}`,
      nombre: a.nombre || a.nombreComercialTango || '',
      direccion: a.address || a.domicilioTango || '',
      lat: coord(a.lat), lng: coord(a.lng),
      horario: a.horarioApertura || a.horarioCierre ? `${a.horarioApertura || '?'} a ${a.horarioCierre || '?'}` : '',
      contacto: (a.contactoNombre || '').trim(),
      telefono: (a.contactoTelefono || '').trim() || telCliente,
      principal: !!a.esPrincipal,
    }))
  } else if (ficha?.address) {
    lista = [armar({ id: 'legacy', nombre: '', direccion: ficha.address, lat: coord(ficha.lat), lng: coord(ficha.lng), horario: '', contacto: '', telefono: telCliente, principal: true })]
  } else if (indice?.domicilios?.length) {
    lista = indice.domicilios.map((d, i) => armar({
      id: d.id || `sin-codigo-${i}`, nombre: d.nombre || '', direccion: d.direccion || '',
      lat: coord(d.lat), lng: coord(d.lng), horario: '', contacto: '', telefono: telCliente, principal: i === 0,
    }))
  } else if (indice?.direccion) {
    lista = [armar({ id: 'legacy', nombre: '', direccion: indice.direccion, lat: null, lng: null, horario: '', contacto: '', telefono: telCliente, principal: true })]
  }
  if (lista.length === 1) lista[0] = { ...lista[0]!, principal: true }
  return [...lista].sort((a, b) => Number(b.principal) - Number(a.principal))
}

/** Filtra las sucursales por nombre, calle o código. */
export function filtrarDomicilios(lista: DomicilioChofer[], texto: string): DomicilioChofer[] {
  const q = normalizarBusqueda(texto)
  return q ? lista.filter((d) => d.buscar.includes(q)) : lista
}

/** Navegación con Google Maps: por coordenadas si las hay, si no por la dirección escrita. */
export function urlComoLlegar(d: Pick<DomicilioChofer, 'lat' | 'lng' | 'direccion'>): string | null {
  if (tieneUbicacion(d)) return `https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}`
  const t = d.direccion.trim()
  return t ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(t)}` : null
}

/** Navegación con Waze. */
export function urlWaze(d: Pick<DomicilioChofer, 'lat' | 'lng' | 'direccion'>): string | null {
  if (tieneUbicacion(d)) return `https://waze.com/ul?ll=${d.lat},${d.lng}&navigate=yes`
  const t = d.direccion.trim()
  return t ? `https://waze.com/ul?q=${encodeURIComponent(t)}&navigate=yes` : null
}

/**
 * Mapa chico embebido: un iframe de Google Maps, no el SDK de mapas. Así no
 * suma nada al peso de la app ni ocupa el hilo de la pantalla del chofer.
 */
export function urlMapaEmbebido(d: Pick<DomicilioChofer, 'lat' | 'lng'>): string | null {
  return tieneUbicacion(d) ? `https://maps.google.com/maps?q=${d.lat},${d.lng}&z=16&output=embed` : null
}

/** Teléfono para `tel:` (solo dígitos y +). */
export const telDe = (t: string): string => t.replace(/[^\d+]/g, '')

/**
 * Link a Vender con el cliente y la sucursal ya elegidos. El id del domicilio es
 * el código de Tango de la sucursal (addresses[].id); Vender lo marca solo si
 * existe y está habilitado en la empresa del canal, si no el chofer la elige.
 */
export function urlVender(uid: string, d?: Pick<DomicilioChofer, 'id'> | null): string {
  const q = new URLSearchParams({ cliente: uid })
  if (d && d.id && d.id !== 'legacy' && !d.id.startsWith('sin-codigo-')) q.set('sucursal', d.id)
  return `/chofer/venta?${q.toString()}`
}
