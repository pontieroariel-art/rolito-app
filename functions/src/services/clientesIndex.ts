// Índice liviano de clientes para buscar (2026-09-10). La búsqueda de cliente en
// la app (chofer al vender/cobrar, supervisor, ventanilla) bajaba la ficha
// completa de los 2.000+ clientes activos (precios de las dos empresas,
// direcciones, datos de Tango…): varios MB por 4G cada vez. Este índice tiene
// solo lo que hace falta para buscar y mostrar en la lista; la ficha completa
// se baja recién cuando se elige el cliente. Lo mantiene el trigger
// onClienteIndexado (users/{uid}) y lo carga el script backfill-clientes-index.
// Puro: sin Firebase.

export interface ClienteIndex {
  uid:           string
  razonSocial:   string
  nombreContacto: string
  cuit:          string
  sinCuit?:      boolean
  codigoCliente?: string
  /** Códigos de Tango de la cuenta, en las dos empresas, sin repetir. */
  codigos:       string[]
  /** Nombres de las sucursales (addresses[].nombre), para buscar por "MONROE". */
  sucursales:    string[]
  /** Dirección principal y localidad (Tango), para mostrar y buscar. */
  direccion:     string
  localidad:     string
  estado:        string
  /** true si tiene algún código de Tango (solo esos se pueden cobrar con imputación). */
  vinculadoTango: boolean
  /** Empresas donde Tango lo tiene inhabilitado (users.habilitadoTango, lo escribe la sync). Ausente = habilitado en todas. */
  inhabilitadoEn?: string[]
}

interface TangoId { idGva14?: number; codigo?: string }
interface Perfil {
  rol?:            string
  estado?:         string
  razonSocial?:    string
  nombreContacto?: string
  nombre?:         string
  email?:          string
  cuit?:           string
  sinCuit?:        boolean
  codigoCliente?:  string
  codigoTango?:    string
  idGva14Tango?:   number
  tangoIds?:       { redonhielo?: TangoId[]; rolito?: TangoId[] }
  addresses?:      { nombre?: string; address?: string; esPrincipal?: boolean }[]
  address?:        string
  localidadTango?: string
  habilitadoTango?: { redonhielo?: boolean; rolito?: boolean }
}

const txt = (v: unknown) => String(v ?? '').trim()

/** Índice de un perfil de cliente; null si no es un cliente (rol distinto). */
export function indiceDeCliente(uid: string, p: Perfil | undefined | null): ClienteIndex | null {
  if (!p || p.rol !== 'cliente') return null
  const codigos = new Set<string>()
  for (const x of [...(p.tangoIds?.redonhielo ?? []), ...(p.tangoIds?.rolito ?? [])]) if (x?.codigo) codigos.add(txt(x.codigo))
  if (p.codigoTango && typeof p.idGva14Tango === 'number' && p.idGva14Tango > 0) codigos.add(txt(p.codigoTango))
  const principal = p.addresses?.find((a) => a?.esPrincipal) ?? p.addresses?.[0]
  const sucursales = [...new Set((p.addresses ?? []).map((a) => txt(a?.nombre)).filter((n) => n && n !== 'Principal'))]
  const inhabilitadoEn = (['redonhielo', 'rolito'] as const).filter((e) => p.habilitadoTango?.[e] === false)
  return {
    uid,
    razonSocial:    txt(p.razonSocial) || txt(p.nombreContacto) || txt(p.nombre) || txt(p.email),
    nombreContacto: txt(p.nombreContacto),
    cuit:           txt(p.cuit),
    ...(p.sinCuit ? { sinCuit: true } : {}),
    ...(txt(p.codigoCliente) ? { codigoCliente: txt(p.codigoCliente) } : {}),
    codigos:        [...codigos],
    sucursales,
    direccion:      txt(principal?.address) || txt(p.address),
    localidad:      txt(p.localidadTango),
    estado:         txt(p.estado) || 'pendiente',
    vinculadoTango: codigos.size > 0,
    ...(inhabilitadoEn.length ? { inhabilitadoEn } : {}),
  }
}

/** ¿Cambió algo del índice? (para no reescribirlo cuando solo cambiaron precios u otros campos). */
export function mismoIndice(a: ClienteIndex | null | undefined, b: ClienteIndex | null | undefined): boolean {
  if (!a || !b) return a === b
  const claves: (keyof ClienteIndex)[] = ['uid', 'razonSocial', 'nombreContacto', 'cuit', 'sinCuit', 'codigoCliente', 'direccion', 'localidad', 'estado', 'vinculadoTango']
  for (const k of claves) if ((a[k] ?? null) !== (b[k] ?? null)) return false
  return a.codigos.join('|') === b.codigos.join('|') && a.sucursales.join('|') === b.sucursales.join('|')
    && (a.inhabilitadoEn ?? []).join('|') === (b.inhabilitadoEn ?? []).join('|')
}
