import type { DeliveryAddress, UserProfile } from '@/types'

// Links de contacto y navegación para el supervisor en la calle (2026-09-07):
// llamar, WhatsApp e "ir al cliente" en Google Maps. Puros, sin Firebase.

/** Dígitos del teléfono en formato internacional argentino (549 + área + número), o '' si no sirve. */
export function normalizarTelefonoAR(telefono: string | undefined | null): string {
  let d = String(telefono ?? '').replace(/\D/g, '')
  if (!d) return ''
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('549')) return d.length >= 12 ? d : ''
  if (d.startsWith('54')) d = d.slice(2)
  if (d.startsWith('0')) d = d.slice(1)
  // "15" después del código de área (011 15 1234 5678) no va en el formato internacional.
  d = d.replace(/^(\d{2,4})15(\d{6,8})$/, '$1$2')
  if (d.length < 10) return ''
  return `549${d}`
}

export const urlLlamar = (telefono: string | undefined | null): string | null => {
  const d = String(telefono ?? '').replace(/\D/g, '')
  return d.length >= 6 ? `tel:${d}` : null
}

export function urlWhatsApp(telefono: string | undefined | null, texto?: string): string | null {
  const n = normalizarTelefonoAR(telefono)
  if (!n) return null
  return `https://wa.me/${n}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`
}

/** Google Maps: con coordenadas verificadas va al punto exacto; si no, busca la dirección. */
export function urlMapa(destino: { lat?: number | null; lng?: number | null; address?: string | null }): string | null {
  if (typeof destino.lat === 'number' && typeof destino.lng === 'number') {
    return `https://www.google.com/maps/search/?api=1&query=${destino.lat},${destino.lng}`
  }
  const texto = (destino.address ?? '').trim()
  return texto ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(texto)}` : null
}

/** Domicilio principal del cliente: el marcado como principal, si no el primero, si no el legacy. */
export function direccionPrincipal(c: Partial<Pick<UserProfile, 'addresses' | 'address' | 'lat' | 'lng'>>): Pick<DeliveryAddress, 'address' | 'lat' | 'lng'> | null {
  const a = c.addresses?.find((x) => x.esPrincipal) ?? c.addresses?.[0]
  if (a) return a
  if (c.address) return { address: c.address, lat: c.lat ?? null, lng: c.lng ?? null }
  return null
}
