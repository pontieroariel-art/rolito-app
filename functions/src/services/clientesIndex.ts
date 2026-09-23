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
  // ── Ampliación 2026-09-22 (auditoría): lo que las pantallas de oficina
  // sacaban de la ficha completa (getAllUsers, 2.000+ docs con precios) y que
  // alcanza con el índice: contacto, marca de visita, listas y los domicilios
  // con coordenadas para los mapas.
  telefono?:  string
  email?:     string
  esVisita?:  boolean
  /** Lista de precios de Tango por empresa (users.listaTango). */
  listas?:    { redonhielo?: number; rolito?: number }
  /** Todos los domicilios (sucursales) con sus coordenadas, para los mapas. */
  domicilios?: { id: string; nombre: string; direccion: string; lat: number | null; lng: number | null }[]
  // ── Segunda vuelta (2026-09-22): lo que el tablero comercial y el mapa de
  // clientes necesitaban para descartar las cuentas del padrón de Tango que
  // nunca pidieron y para pintar por vendedor. Los Timestamps se copian tal
  // cual (el índice se lee desde la caché con el mismo tipo que la ficha).
  /** Quién aprobó la cuenta ('tango' = la dio de alta la sync del padrón). */
  aprobadoPor?:    string
  fechaCreacion?:  Marca
  ultimoPedidoAt?: Marca
  codVendedor?:    string
}

/** Un Timestamp de Firestore (admin o cliente), sin importar la librería: este módulo es puro. */
export interface Marca { seconds: number; nanoseconds: number }
const marca = (v: unknown): Marca | undefined => {
  const m = v as { seconds?: unknown; nanoseconds?: unknown; _seconds?: unknown; _nanoseconds?: unknown } | null | undefined
  if (!m || typeof m !== 'object') return undefined
  // Un Timestamp de verdad se devuelve TAL CUAL (el Admin SDK lo escribe como
  // Timestamp; una copia {seconds, nanoseconds} saldría como mapa y la app no
  // podría hacer toDate()). La forma serializada {_seconds} solo aparece en tests.
  if (typeof m.seconds === 'number') return m as Marca
  if (typeof m._seconds === 'number') return { seconds: m._seconds, nanoseconds: typeof m._nanoseconds === 'number' ? m._nanoseconds : 0 }
  return undefined
}
const mismaMarca = (a?: Marca, b?: Marca) => (a?.seconds ?? null) === (b?.seconds ?? null) && (a?.nanoseconds ?? null) === (b?.nanoseconds ?? null)

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
  addresses?:      { id?: string; nombre?: string; address?: string; esPrincipal?: boolean; lat?: number | null; lng?: number | null }[]
  address?:        string
  localidadTango?: string
  habilitadoTango?: { redonhielo?: boolean; rolito?: boolean }
  telefono?:       string
  phone?:          string
  esVisita?:       boolean
  listaTango?:     { redonhielo?: number; rolito?: number }
  aprobadoPor?:    string | null
  fechaCreacion?:  unknown
  ultimoPedidoAt?: unknown
  codVendedor?:    string
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

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
    ...(txt(p.telefono) || txt(p.phone) ? { telefono: txt(p.telefono) || txt(p.phone) } : {}),
    ...(txt(p.email) ? { email: txt(p.email) } : {}),
    ...(p.esVisita ? { esVisita: true } : {}),
    ...(typeof p.listaTango?.redonhielo === 'number' || typeof p.listaTango?.rolito === 'number'
      ? { listas: { ...(typeof p.listaTango?.redonhielo === 'number' ? { redonhielo: p.listaTango.redonhielo } : {}), ...(typeof p.listaTango?.rolito === 'number' ? { rolito: p.listaTango.rolito } : {}) } }
      : {}),
    ...(p.addresses?.length
      ? { domicilios: p.addresses.map((a) => ({ id: txt(a?.id), nombre: txt(a?.nombre), direccion: txt(a?.address), lat: num(a?.lat), lng: num(a?.lng) })) }
      : {}),
    ...(txt(p.aprobadoPor) ? { aprobadoPor: txt(p.aprobadoPor) } : {}),
    ...(marca(p.fechaCreacion) ? { fechaCreacion: marca(p.fechaCreacion) } : {}),
    ...(marca(p.ultimoPedidoAt) ? { ultimoPedidoAt: marca(p.ultimoPedidoAt) } : {}),
    ...(txt(p.codVendedor) ? { codVendedor: txt(p.codVendedor) } : {}),
  }
}

/** ¿Cambió algo del índice? (para no reescribirlo cuando solo cambiaron precios u otros campos). */
export function mismoIndice(a: ClienteIndex | null | undefined, b: ClienteIndex | null | undefined): boolean {
  if (!a || !b) return a === b
  const claves: (keyof ClienteIndex)[] = ['uid', 'razonSocial', 'nombreContacto', 'cuit', 'sinCuit', 'codigoCliente', 'direccion', 'localidad', 'estado', 'vinculadoTango', 'telefono', 'email', 'esVisita', 'aprobadoPor', 'codVendedor']
  for (const k of claves) if ((a[k] ?? null) !== (b[k] ?? null)) return false
  return a.codigos.join('|') === b.codigos.join('|') && a.sucursales.join('|') === b.sucursales.join('|')
    && (a.inhabilitadoEn ?? []).join('|') === (b.inhabilitadoEn ?? []).join('|')
    && JSON.stringify(a.listas ?? null) === JSON.stringify(b.listas ?? null)
    && JSON.stringify(a.domicilios ?? null) === JSON.stringify(b.domicilios ?? null)
    && mismaMarca(a.fechaCreacion, b.fechaCreacion) && mismaMarca(a.ultimoPedidoAt, b.ultimoPedidoAt)
}
