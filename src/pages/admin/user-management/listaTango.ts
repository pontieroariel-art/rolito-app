import type { UserProfile } from '../../../types'

// "Redonhielo: 301 · HABITUALES / Rolito: 1 · ESTACION DE SERVICIO" — la lista
// que Tango le asignó al cliente en cada empresa (la sync deja nro y nombre en
// la ficha). Se edita en Tango, acá solo se muestra.
export function listaTangoResumen(user: Pick<UserProfile, 'codigoTango' | 'listaTango' | 'listaTangoNombre'>): string {
  if (!user.codigoTango) return 'Sin vínculo con Tango'
  const parte = (empresa: 'redonhielo' | 'rolito', label: string) => {
    const nro = user.listaTango?.[empresa]
    if (nro == null) return `${label}: sin lista`
    const nombre = user.listaTangoNombre?.[empresa]
    return `${label}: ${nro}${nombre ? ` · ${nombre}` : ''}`
  }
  return `${parte('redonhielo', 'Redonhielo')} / ${parte('rolito', 'Rolito')}`
}
