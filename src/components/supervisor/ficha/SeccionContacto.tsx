import { Mail, MessageCircle, Phone } from 'lucide-react'
import { Plegable } from '@/components/ui/Plegable'
import { urlLlamar, urlWhatsApp } from '@/utils/contacto'
import type { UserProfile } from '@/types'

const btn = 'flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium active:scale-[0.98] transition-transform'
const btnOn = `${btn} border-accent text-accent bg-white`
const btnOff = `${btn} border-[#D3D1C7] text-gray-300 bg-gray-50 pointer-events-none`

export function BotonesTelefono({ telefono, textoWhatsApp }: { telefono: string | undefined; textoWhatsApp?: string }) {
  const llamar = urlLlamar(telefono)
  const wa = urlWhatsApp(telefono, textoWhatsApp)
  return (
    <div className="flex gap-2">
      <a href={llamar ?? undefined} className={llamar ? btnOn : btnOff} aria-disabled={!llamar}>
        <Phone size={15} /> Llamar
      </a>
      <a href={wa ?? undefined} target="_blank" rel="noopener noreferrer" className={wa ? btnOn : btnOff} aria-disabled={!wa}>
        <MessageCircle size={15} /> WhatsApp
      </a>
    </div>
  )
}

// Teléfonos y mail del cliente, con Llamar / WhatsApp de un toque. Los
// teléfonos de cada sucursal (contactoTelefono) se listan aparte.
export default function SeccionContacto({ c }: { c: UserProfile }) {
  const principal = c.telefono || c.phone
  const saludo = `Hola, soy de Rolito. Le escribo por su cuenta de ${c.razonSocial}.`
  const sucursales = (c.addresses ?? []).filter((a) => a.contactoTelefono && a.contactoTelefono !== principal)
  const vacio = !principal && !c.email && sucursales.length === 0
  return (
    <Plegable titulo="Contacto" abiertoInicial>
      {vacio && <p className="text-sm text-gray-500">Sin teléfono ni mail cargados.</p>}
      {principal && (
        <div className="space-y-2">
          <p className="text-sm text-gray-900">{principal}{c.nombreContacto ? <span className="text-gray-500"> · {c.nombreContacto}</span> : null}</p>
          <BotonesTelefono telefono={principal} textoWhatsApp={saludo} />
        </div>
      )}
      {sucursales.map((a) => (
        <div key={a.id} className="mt-3 pt-3 border-t border-gray-100 space-y-2">
          <p className="text-sm text-gray-900">{a.contactoTelefono}<span className="text-gray-500"> · {a.contactoNombre || a.nombre || 'sucursal'}</span></p>
          <BotonesTelefono telefono={a.contactoTelefono} textoWhatsApp={saludo} />
        </div>
      ))}
      {c.email && !c.email.endsWith('@rolito.local') && (
        <a href={`mailto:${c.email}`} className="mt-3 flex items-center gap-2 text-sm text-accent">
          <Mail size={15} /> {c.email}
        </a>
      )}
    </Plegable>
  )
}
