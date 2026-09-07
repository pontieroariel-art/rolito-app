import { MapPin, Navigation } from 'lucide-react'
import { Plegable } from '@/components/ui/Plegable'
import { urlMapa } from '@/utils/contacto'
import type { DeliveryAddress, UserProfile } from '@/types'

function Domicilio({ a, principal }: { a: Pick<DeliveryAddress, 'nombre' | 'address' | 'lat' | 'lng' | 'horarioApertura' | 'horarioCierre' | 'contactoNombre' | 'contactoTelefono'>; principal: boolean }) {
  const mapa = urlMapa(a)
  const verificada = typeof a.lat === 'number' && typeof a.lng === 'number'
  const horario = a.horarioApertura || a.horarioCierre ? `${a.horarioApertura || '?'} a ${a.horarioCierre || '?'}` : ''
  return (
    <div className="py-3 border-b border-gray-100 last:border-0">
      <div className="flex items-start gap-2">
        <MapPin size={16} className="text-gray-400 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">
            {a.nombre || 'Domicilio'}{principal && <span className="ml-1.5 text-[10px] font-semibold uppercase text-accent">principal</span>}
          </p>
          <p className="text-sm text-gray-700 break-words">{a.address || 'Sin dirección'}</p>
          {horario && <p className="text-xs text-gray-500">Horario: {horario}</p>}
          {(a.contactoNombre || a.contactoTelefono) && (
            <p className="text-xs text-gray-500">{[a.contactoNombre, a.contactoTelefono].filter(Boolean).join(' · ')}</p>
          )}
          <p className={`text-[11px] ${verificada ? 'text-accent' : 'text-amber-600'}`}>
            {verificada ? 'Ubicación verificada' : 'Sin ubicación en el mapa: se busca por la dirección'}
          </p>
        </div>
        {mapa && (
          <a href={mapa} target="_blank" rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-accent text-white px-3 py-2 text-sm font-medium active:scale-[0.98] transition-transform">
            <Navigation size={15} /> Ir
          </a>
        )}
      </div>
    </div>
  )
}

// Sucursales / puntos de entrega con "Ir" (Google Maps, coordenadas si el
// domicilio está verificado, si no la dirección escrita).
export default function SeccionDomicilios({ c }: { c: UserProfile }) {
  const lista = c.addresses?.length
    ? c.addresses
    : c.address
      ? [{ id: 'legacy', nombre: 'Domicilio', address: c.address, lat: c.lat ?? null, lng: c.lng ?? null, horarioApertura: '', horarioCierre: '', contactoNombre: '', contactoTelefono: '', esPrincipal: true }]
      : []
  return (
    <Plegable titulo="Domicilios" abiertoInicial extra={lista.length > 1 ? <span className="text-xs text-gray-500">{lista.length}</span> : undefined}>
      {lista.length === 0 && <p className="text-sm text-gray-500">Sin domicilios cargados.</p>}
      {lista.map((a, i) => <Domicilio key={a.id || i} a={a} principal={a.esPrincipal || (lista.length === 1)} />)}
    </Plegable>
  )
}
