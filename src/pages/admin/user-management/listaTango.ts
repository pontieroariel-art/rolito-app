import type { UserProfile } from '../../../types'
import { estaVinculadoATango, tangoIdsDe } from '@/utils/tangoEmpresas'

// "Redonhielo: 301 · HABITUALES / Rolito: 1 · ESTACION DE SERVICIO" — la lista
// que Tango le asignó al cliente en cada empresa (la sync deja nro y nombre en
// la ficha). Se edita en Tango, acá solo se muestra.
export function listaTangoResumen(user: Pick<UserProfile, 'codigoTango' | 'idGva14Tango' | 'tangoIds' | 'listaTango' | 'listaTangoNombre'>): string {
  if (!estaVinculadoATango(user)) return 'Sin vínculo con Tango'
  const parte = (empresa: 'redonhielo' | 'rolito', label: string) => {
    const nro = user.listaTango?.[empresa]
    if (nro == null) return `${label}: sin lista`
    const nombre = user.listaTangoNombre?.[empresa]
    return `${label}: ${nro}${nombre ? ` · ${nombre}` : ''}`
  }
  return `${parte('redonhielo', 'Redonhielo')} / ${parte('rolito', 'Rolito')}`
}

// "FC.280 (Redonhielo y Rolito)" / "FC.280 (Redonhielo) · FC.281 (Rolito)" /
// "FC.280 +2 (Redonhielo)" — el código de cliente en Tango, por empresa,
// abreviado cuando coincide.
export function codigosTangoResumen(user: Pick<UserProfile, 'codigoTango' | 'idGva14Tango' | 'tangoIds'>): string {
  const ids = tangoIdsDe(user)
  const rh = ids.redonhielo ?? []
  const ro = ids.rolito ?? []
  if (!rh.length && !ro.length) return ''
  const lista = (l: typeof rh) => l.length ? `${l[0].codigo}${l.length > 1 ? ` +${l.length - 1}` : ''}` : ''
  if (rh.length && ro.length && lista(rh) === lista(ro)) return `${lista(rh)} (Redonhielo y Rolito)`
  return [rh.length ? `${lista(rh)} (Redonhielo)` : '', ro.length ? `${lista(ro)} (Rolito)` : ''].filter(Boolean).join(' · ')
}
