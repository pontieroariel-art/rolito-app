import type { UserProfile } from '@/types'
import { direccionPrincipal } from './contacto'

/**
 * Mensajes prearmados que el supervisor le manda al cliente por WhatsApp
 * (2026-09-13). Viven acá y no en la pantalla porque son lo que LEE EL CLIENTE,
 * con el nombre del supervisor y el de la empresa: si hay que cambiar una
 * palabra, se cambia en un solo lugar y se ve en un test.
 *
 * "Escribir yo" (texto vacío) abre el chat sin nada: no toda conversación entra
 * en una plantilla.
 */

export interface PlantillaWhatsApp {
  id:     string
  label:  string
  /** Vacío = abrir el chat sin texto. */
  texto:  string
}

const nombreDePila = (nombre: string | undefined): string => (nombre ?? '').trim().split(/\s+/)[0] ?? ''

export function plantillasWhatsApp(
  cliente: Pick<UserProfile, 'addresses' | 'address' | 'lat' | 'lng'>,
  supervisor: { nombre?: string } | null,
): PlantillaWhatsApp[] {
  const quien = nombreDePila(supervisor?.nombre)
  // Sin nombre del supervisor se habla en plural de punta a punta: 'te escribimos…
  // Estoy pasando' quedaba cojo.
  const soy = quien ? `Hola, soy ${quien} de Rolito.` : 'Hola, te escribimos de Rolito.'
  const paso = quien ? 'Estoy pasando' : 'Estamos pasando'
  const donde = direccionPrincipal(cliente)?.address?.trim()
  return [
    {
      id: 'visita',
      label: 'Aviso de visita',
      texto: `${soy} ${paso} hoy${donde ? ` por ${donde}` : ''} para cobrar. ¿Les queda cómodo?`,
    },
    {
      id: 'retencion',
      label: 'Pedir comprobante de retención',
      texto: `${soy} Nos falta el comprobante de la retención del último pago. ¿Nos lo pueden enviar por acá?`,
    },
    { id: 'libre', label: 'Escribir yo', texto: '' },
  ]
}
