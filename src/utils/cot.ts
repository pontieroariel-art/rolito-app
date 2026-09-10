import type {
  CatalogProducto, CotConfig, CotDomicilio, CotProductoConfig, CotRecorrido, CotSolicitud, DeliveryAddress, PlantaId, RemitoCargaItem, UserProfile,
} from '@/types'

// COT de ARBA para el remito de carga (2026-09-10): lógica pura del lado de la
// app. Qué carga lo requiere (kilos / importe contra los umbrales de
// config/cot), cómo se arma el domicilio de destino a partir de la ficha del
// cliente, valores por defecto de la configuración y validación de lo que
// caja declara antes de emitir. El armado del archivo y la presentación a ARBA
// viven en functions/src/services/arba/cot.ts. Ver docs/arba/COT.md.

export const COT_DEFAULTS: CotConfig = {
  habilitado:    false,
  ambiente:      'produccion',
  cuit:          '30697668973',
  razonSocial:   'REDONHIELO S A',
  umbralKg:      4500,
  umbralImporte: 9_529_691,   // RN ARBA 27/23, vigente 2026
  importePorKg:  0,
  bloqueaSalida: false,
  respaldo:      { codigoComprobante: '091', prefijo: 25 },   // Remito R del talonario manual 00025
  transportista: { cuit: '30697668973' },
  plantas: {
    torcuato: {
      codigoPlanta: '001', puerta: '001',
      domicilio: { calle: 'RUTA PANAMERICANA KM 25.700', numero: 0, complemento: 'S/N', cp: '1611', localidad: 'DON TORCUATO', provincia: 'B' },
      recorrido: { tipo: 'M', localidad: 'DON TORCUATO', ruta: 'PANAMERICANA' },
    },
    merlo: {
      codigoPlanta: '002', puerta: '001',
      domicilio: { calle: 'PRESIDENTE PERON', numero: 26875, cp: '1722', localidad: 'MERLO', provincia: 'B' },
      recorrido: { tipo: 'M', localidad: 'MERLO', ruta: 'RUTA 205' },
    },
  },
  productos: {},
}

/** Código ARBA/NCM por defecto para el hielo; el agua de mesa va aparte. */
export const CODIGO_ARBA_HIELO = '220190'
export const CODIGO_ARBA_AGUA = '220110'

const num = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def)
const str = (v: unknown, def: string) => (typeof v === 'string' ? v : def)

function normalizarDomicilio(raw: Partial<CotDomicilio> | undefined, def: CotDomicilio): CotDomicilio {
  return {
    calle:       str(raw?.calle, def.calle),
    numero:      num(raw?.numero, def.numero),
    ...(str(raw?.complemento, def.complemento ?? '') ? { complemento: str(raw?.complemento, def.complemento ?? '') } : {}),
    ...(raw?.piso ? { piso: String(raw.piso) } : {}),
    ...(raw?.dto ? { dto: String(raw.dto) } : {}),
    ...(raw?.barrio ? { barrio: String(raw.barrio) } : {}),
    cp:          str(raw?.cp, def.cp),
    localidad:   str(raw?.localidad, def.localidad),
    provincia:   str(raw?.provincia, def.provincia),
  }
}

/** config/cot con los defaults completados (tolera docs viejos o vacíos). */
export function normalizarCotConfig(raw: Partial<CotConfig> | null | undefined): CotConfig {
  const d = COT_DEFAULTS
  const plantas = {} as Record<PlantaId, CotConfig['plantas'][PlantaId]>
  for (const id of Object.keys(d.plantas) as PlantaId[]) {
    const p = raw?.plantas?.[id]
    plantas[id] = {
      codigoPlanta: str(p?.codigoPlanta, d.plantas[id].codigoPlanta),
      puerta:       str(p?.puerta, d.plantas[id].puerta),
      domicilio:    normalizarDomicilio(p?.domicilio, d.plantas[id].domicilio),
      recorrido:    {
        tipo:      (['U', 'R', 'M', ''].includes(str(p?.recorrido?.tipo, 'M')) ? str(p?.recorrido?.tipo, 'M') : 'M') as CotRecorrido['tipo'],
        localidad: str(p?.recorrido?.localidad, d.plantas[id].recorrido.localidad),
        ...(p?.recorrido?.calle ? { calle: String(p.recorrido.calle) } : {}),
        ruta:      str(p?.recorrido?.ruta, d.plantas[id].recorrido.ruta),
      },
    }
  }
  const productos: Record<string, CotProductoConfig> = {}
  for (const [id, p] of Object.entries(raw?.productos ?? {})) {
    if (!p || typeof p !== 'object') continue
    productos[id] = { pesoKg: num(p.pesoKg, 0), codigoArba: str(p.codigoArba, CODIGO_ARBA_HIELO), descripcion: str(p.descripcion, '') }
  }
  return {
    habilitado:    raw?.habilitado === true,
    ambiente:      raw?.ambiente === 'prueba' ? 'prueba' : 'produccion',
    cuit:          str(raw?.cuit, d.cuit).replace(/\D/g, ''),
    razonSocial:   str(raw?.razonSocial, d.razonSocial),
    umbralKg:      num(raw?.umbralKg, d.umbralKg),
    umbralImporte: num(raw?.umbralImporte, d.umbralImporte),
    importePorKg:  num(raw?.importePorKg, d.importePorKg),
    bloqueaSalida: raw?.bloqueaSalida === true,
    respaldo:      { codigoComprobante: str(raw?.respaldo?.codigoComprobante, d.respaldo.codigoComprobante), prefijo: num(raw?.respaldo?.prefijo, d.respaldo.prefijo) },
    transportista: { cuit: str(raw?.transportista?.cuit, d.transportista.cuit).replace(/\D/g, '') },
    plantas,
    productos,
  }
}

/** Peso por unidad que sugiere el nombre del producto ("Hielo bolsa 10kg" → 10, "Agua de mesa x 6 litros" → 6). */
export function pesoSugerido(producto: Pick<CatalogProducto, 'nombre' | 'etiqueta'>): number {
  const m = /(\d+(?:[.,]\d+)?)\s*(kg|k|litros?|lts?|l)\b/i.exec(`${producto.nombre} ${producto.etiqueta ?? ''}`)
  return m ? Number(m[1].replace(',', '.')) : 0
}

/** Kilos totales de la carga y los productos a los que les falta el peso en la config. */
export function kgDeItems(items: Pick<RemitoCargaItem, 'productoId' | 'cantidad' | 'nombre'>[], productos: CotConfig['productos']): { kg: number; sinPeso: string[] } {
  let kg = 0
  const sinPeso: string[] = []
  for (const it of items) {
    const p = productos[it.productoId]
    if (!p || !(p.pesoKg > 0)) { if (it.cantidad > 0) sinPeso.push(it.nombre); continue }
    kg += it.cantidad * p.pesoKg
  }
  return { kg: Math.round(kg * 100) / 100, sinPeso }
}

/** Obligatorio si supera CUALQUIERA de los dos umbrales (RN ARBA 31/2019, medido en origen). */
export const requiereCot = (kg: number, importe: number, cfg: Pick<CotConfig, 'umbralKg' | 'umbralImporte'>): boolean =>
  kg >= cfg.umbralKg || importe >= cfg.umbralImporte

/** Patente vieja (AAA999) o Mercosur (AA999AA), sin espacios ni guiones. */
export const patenteValida = (p: string): boolean => /^([A-Z]{3}\d{3}|[A-Z]{2}\d{3}[A-Z]{2})$/.test(p.toUpperCase().replace(/[^A-Z0-9]/gi, ''))
export const patenteLimpia = (p: string): string => p.toUpperCase().replace(/[^A-Z0-9]/g, '')

/** "AMENABAR 2935" → calle + número; sin número al final → número 0 y 'S/N'. */
export function parsearCalleNumero(texto: string): { calle: string; numero: number; complemento?: string } {
  const t = texto.replace(/\s+/g, ' ').trim()
  const m = /^(.*?\S)\s+(\d{1,5})\s*(BIS|1\/2|1\/4)?\s*$/i.exec(t)
  if (m) return { calle: m[1], numero: Number(m[2]), ...(m[3] ? { complemento: m[3].toUpperCase() } : {}) }
  return { calle: t, numero: 0, complemento: 'S/N' }
}

/** Nombre de provincia (Tango, Google) → letra de la tabla de ARBA. Sin dato: Buenos Aires. */
export function letraProvincia(nombre: string | undefined | null): string {
  const n = (nombre ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  if (!n) return 'B'
  if (/capital|caba|ciudad aut|buenos aires ciudad/.test(n)) return 'C'
  const tabla: [RegExp, string][] = [
    [/salta/, 'A'], [/buenos aires|bs\.? ?as/, 'B'], [/san luis/, 'D'], [/entre r/, 'E'], [/la rioja/, 'F'], [/santiago/, 'G'], [/chaco/, 'H'],
    [/san juan/, 'J'], [/catamarca/, 'K'], [/la pampa/, 'L'], [/mendoza/, 'M'], [/misiones/, 'N'], [/formosa/, 'P'], [/neuqu/, 'Q'], [/rio negro/, 'R'],
    [/santa fe/, 'S'], [/tucum/, 'T'], [/chubut/, 'U'], [/tierra del fuego/, 'V'], [/corrientes/, 'W'], [/cordoba/, 'X'], [/jujuy/, 'Y'], [/santa cruz/, 'Z'],
  ]
  for (const [re, letra] of tabla) if (re.test(n)) return letra
  return 'B'
}

/**
 * Domicilio de destino de un cliente para el COT: la sucursal (addresses[] por
 * código de Tango) si se eligió una, si no la ficha principal. Prefiere los
 * campos de Tango (domicilio, localidad, C.P.) y cae a la dirección de la app.
 */
export function domicilioDeCliente(cliente: Pick<UserProfile, 'address' | 'addresses' | 'domicilioTango' | 'localidadTango' | 'codigoPostalTango' | 'provinciaTango'>, codigoTango?: string | null): CotDomicilio {
  const dir: DeliveryAddress | undefined = codigoTango ? (cliente.addresses ?? []).find((a) => a.id === codigoTango) : undefined
  const domicilio = (dir?.domicilioTango || dir?.address || cliente.domicilioTango || cliente.address || '').split(',')[0]
  const localidad = dir?.localidadTango || (dir ? '' : cliente.localidadTango) || ''
  const cp = dir?.codigoPostalTango || (dir ? '' : cliente.codigoPostalTango) || ''
  const provincia = letraProvincia(dir?.provinciaTango || (dir ? '' : cliente.provinciaTango))
  return { ...parsearCalleNumero(domicilio.toUpperCase()), cp: cp.replace(/\D/g, '').slice(0, 8), localidad: localidad.toUpperCase(), provincia }
}

const CUIT_RE = /^\d{11}$/
export const cuitLimpio = (c: string | undefined | null): string => (c ?? '').replace(/\D/g, '')

/** Errores de lo que caja declara antes de emitir; vacío = se puede presentar. */
export function validarSolicitudCot(s: CotSolicitud): string[] {
  const e: string[] = []
  if (!patenteValida(s.patente)) e.push('La patente del camión no tiene un formato válido (AAA999 o AA999AA).')
  if (!(s.respaldo.numero > 0)) e.push('Falta el número del remito R que respalda la carga.')
  if (!(s.respaldo.prefijo >= 0)) e.push('Falta el punto de venta del remito R.')
  if (s.destino.tipo === 'cliente') {
    if (!s.destino.razonSocial.trim()) e.push('Falta la razón social del destinatario.')
    if (!s.destino.consumidorFinal && !CUIT_RE.test(cuitLimpio(s.destino.cuit))) e.push('El destinatario no tiene un CUIT válido: marcalo como consumidor final o elegí otro.')
    if (s.destino.consumidorFinal && s.respaldo.importe >= 5000 && !CUIT_RE.test(cuitLimpio(s.destino.cuit))) e.push('Consumidor final con importe de $5.000 o más: hace falta CUIT o documento del destinatario.')
    const d = s.destino.domicilio
    if (!d.calle.trim()) e.push('Falta la calle del domicilio de destino.')
    if (!d.cp.trim()) e.push('Falta el código postal del destino.')
    if (!d.localidad.trim()) e.push('Falta la localidad del destino.')
    if (!(s.respaldo.importe > 0)) e.push('Falta el importe a declarar.')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.fechaSalida)) e.push('Fecha de salida inválida.')
  if (!/^\d{2}:\d{2}$/.test(s.horaSalida)) e.push('Hora de salida inválida.')
  return e
}

/** Fecha y hora de salida sugeridas: dentro de `minutos` a partir de `ahora`. */
export function salidaSugerida(ahora: Date = new Date(), minutos = 30): { fechaSalida: string; horaSalida: string } {
  const d = new Date(ahora.getTime() + minutos * 60_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return { fechaSalida: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, horaSalida: `${p(d.getHours())}:${p(d.getMinutes())}` }
}

/** La otra planta (traslado entre depósitos propios). */
export const otraPlanta = (plantaId: PlantaId): PlantaId => (plantaId === 'torcuato' ? 'merlo' : 'torcuato')

/** Número de remito R formateado "00025-00058680". */
export const formatoRespaldo = (r: { prefijo: number; numero: number }): string => `${String(r.prefijo).padStart(5, '0')}-${String(r.numero).padStart(8, '0')}`
