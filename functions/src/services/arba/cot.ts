// COT de ARBA — Código de Operación de Traslado (2026-09-10). Lógica PURA del
// lado del server: arma el archivo TXT "Transporte de Bienes" con el diseño
// vigente desde el 05/08/2019 (registros 01 header / 02 remito / 03 productos
// / 04 footer, separados por '|', líneas CR+LF, ISO-8859-1) y parsea la
// respuesta XML del web service. La presentación (HTTP) está en cotHttp.ts y
// el trigger en triggers/cotArba.ts. Fuente: "Diseño de archivo TXT -
// Instructivo Transporte de Bienes" de ARBA. Ver docs/arba/COT.md.

export interface CotDomicilio {
  calle: string; numero: number; complemento?: string; piso?: string; dto?: string; barrio?: string
  cp: string; localidad: string; provincia: string
}
export interface CotRecorrido { tipo: string; localidad: string; calle?: string; ruta: string }
export interface CotPlantaConfig { codigoPlanta: string; puerta: string; domicilio: CotDomicilio; recorrido: CotRecorrido }
export interface CotProductoConfig { pesoKg: number; codigoArba: string; descripcion: string }
export interface CotConfig {
  habilitado: boolean
  ambiente: 'produccion' | 'prueba'
  cuit: string
  razonSocial: string
  respaldo: { codigoComprobante: string; prefijo: number }
  transportista: { cuit: string }
  plantas: Record<string, CotPlantaConfig>
  productos: Record<string, CotProductoConfig>
}
export type CotDestino =
  | { tipo: 'planta'; plantaId: string }
  | { tipo: 'cliente'; clienteUid: string; codigoTango?: string; razonSocial: string; cuit: string; consumidorFinal: boolean; domicilio: CotDomicilio }
export interface CotSolicitud {
  destino: CotDestino
  respaldo: { codigoComprobante: string; prefijo: number; numero: number; importe: number }
  patente: string
  recorrido: CotRecorrido
  fechaSalida: string   // yyyy-MM-dd
  horaSalida: string    // HH:MM
}
export interface RemitoParaCot {
  plantaId: string
  fechaEmision: Date
  items: { productoId: string; nombre: string; cantidad: number }[]
}

export const URL_COT = {
  produccion: 'https://cot.arba.gov.ar/TransporteBienes/SeguridadCliente/presentarRemitos.do',
  prueba:     'https://cot.test.arba.gov.ar/TransporteBienes/SeguridadCliente/presentarRemitos.do',
} as const

const digitos = (s: string) => (s ?? '').replace(/\D/g, '')
const aaaammdd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`

/** Texto para el TXT: sin '|', sin saltos de línea, sin acentos raros fuera de latin-1, mayúsculas, recortado. */
export function campo(v: unknown, max: number): string {
  // Sin acentos (ARBA valida ASCII/latin-1); la Ñ existe en ISO-8859-1 y se conserva.
  const sinAcentos = String(v ?? '').split('').map((ch) => (ch === 'ñ' || ch === 'Ñ' ? ch : ch.normalize('NFD').replace(/\p{M}/gu, ''))).join('')
  return sinAcentos
    .replace(/[|\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, max)
}

/** Número con 2 decimales implícitos, sin separador: 3680 kg → "368000". */
export const centesimos = (n: number): string => String(Math.round(n * 100))

/** CODIGO_UNICO del comprobante respaldatorio: código AFIP (3) + prefijo (5) + número (8). */
export const codigoUnicoComprobante = (codigoComprobante: string, prefijo: number, numero: number): string =>
  `${digitos(codigoComprobante).padStart(3, '0').slice(-3)}${String(prefijo).padStart(5, '0').slice(-5)}${String(numero).padStart(8, '0').slice(-8)}`

/** Nombre del archivo: TB_<cuit>_<planta><puerta>_<aaaammdd>_<secuencia>.txt */
export const nombreArchivoCot = (cuit: string, planta: CotPlantaConfig, fecha: Date, secuencia: number): string =>
  `TB_${digitos(cuit)}_${planta.codigoPlanta.padStart(3, '0')}${planta.puerta.padStart(3, '0')}_${aaaammdd(fecha)}_${String(secuencia).padStart(6, '0')}.txt`

function domicilioCampos(d: CotDomicilio): string[] {
  const numero = d.numero > 0 ? String(d.numero) : '0'
  const comple = d.numero > 0 ? campo(d.complemento ?? '', 5) : 'S/N'
  return [campo(d.calle, 40), numero, comple, campo(d.piso, 3), campo(d.dto, 4), campo(d.barrio, 30), campo(d.cp, 8), campo(d.localidad, 50), campo(d.provincia, 1) || 'B']
}

export interface ArchivoCot { nombre: string; contenido: string; lineas: string[]; kg: number; productos: number }

/**
 * Arma el TXT de UN remito de carga. El destinatario es el cliente elegido por
 * caja (reparto) o la otra planta (traslado entre depósitos propios: mismo
 * CUIT en origen y destino, importe 0 permitido).
 */
export function armarArchivoCot(remito: RemitoParaCot, sol: CotSolicitud, cfg: CotConfig, secuencia: number): ArchivoCot {
  const planta = cfg.plantas[remito.plantaId]
  if (!planta) throw new Error(`Falta config/cot.plantas.${remito.plantaId}`)
  const cuit = digitos(cfg.cuit)
  if (cuit.length !== 11) throw new Error('config/cot.cuit tiene que tener 11 dígitos')

  // Productos: cantidad en kilos, agrupada por código de ARBA + descripción propia.
  const productos: string[] = []
  let kgTotal = 0
  for (const it of remito.items) {
    if (!(it.cantidad > 0)) continue
    const p = cfg.productos[it.productoId]
    if (!p || !(p.pesoKg > 0)) throw new Error(`Falta el peso por unidad en config/cot.productos para "${it.nombre}" (${it.productoId})`)
    if (!/^\d{6}$/.test(p.codigoArba)) throw new Error(`Código de ARBA inválido para "${it.nombre}": ${p.codigoArba}`)
    const kg = it.cantidad * p.pesoKg
    kgTotal += kg
    productos.push(['03', p.codigoArba, '1', centesimos(kg), campo(it.productoId, 25), campo(p.descripcion || it.nombre, 40), 'KILOGRAMOS', centesimos(kg)].join('|'))
  }
  if (!productos.length) throw new Error('El remito de carga no tiene productos con cantidad')

  const d = sol.destino
  const destinoCuit = d.tipo === 'planta' ? cuit : digitos(d.cuit)
  const consumidorFinal = d.tipo === 'cliente' && d.consumidorFinal
  const destinoDomicilio = d.tipo === 'planta'
    ? (cfg.plantas[d.plantaId]?.domicilio ?? (() => { throw new Error(`Falta config/cot.plantas.${d.plantaId}`) })())
    : d.domicilio
  const importe = d.tipo === 'planta' ? 0 : sol.respaldo.importe
  const fechaSalida = digitos(sol.fechaSalida)
  const horaSalida = digitos(sol.horaSalida).padStart(4, '0').slice(0, 4)
  const patente = sol.patente.toUpperCase().replace(/[^A-Z0-9]/g, '')

  const remitoLinea = [
    '02',
    aaaammdd(remito.fechaEmision),                                              // FECHA_EMISION
    codigoUnicoComprobante(sol.respaldo.codigoComprobante, sol.respaldo.prefijo, sol.respaldo.numero),   // CODIGO_UNICO
    fechaSalida,                                                                 // FECHA_SALIDA_TRANSPORTE
    horaSalida,                                                                  // HORA_SALIDA_TRANSPORTE
    'E',                                                                         // SUJETO_GENERADOR (emisor RG 1415)
    consumidorFinal ? '1' : '0',                                                 // DESTINATARIO_CONSUMIDOR_FINAL
    '',                                                                          // DESTINATARIO_TIPO_DOCUMENTO
    '',                                                                          // DESTINATARIO_DOCUMENTO
    destinoCuit,                                                                 // DESTINATARIO_CUIT
    campo(d.tipo === 'planta' ? cfg.razonSocial : d.razonSocial, 50),          // DESTINATARIO_RAZON_SOCIAL
    '0',                                                                         // DESTINATARIO_TENEDOR
    ...domicilioCampos(destinoDomicilio),                                        // DESTINO_DOMICILIO_*
    '',                                                                          // PROPIO_DESTINO_DOMICILIO_CODIGO
    'NO',                                                                        // ENTREGA_DOMICILIO_ORIGEN
    cuit,                                                                        // ORIGEN_CUIT
    campo(cfg.razonSocial, 50),                                                  // ORIGEN_RAZON_SOCIAL
    '0',                                                                         // EMISOR_TENEDOR
    ...domicilioCampos(planta.domicilio),                                        // ORIGEN_DOMICILIO_*
    digitos(cfg.transportista.cuit) || cuit,                                     // TRANSPORTISTA_CUIT
    campo(sol.recorrido.tipo, 1),                                                // TIPO_RECORRIDO
    campo(sol.recorrido.localidad, 50),                                          // RECORRIDO_LOCALIDAD
    campo(sol.recorrido.calle, 40),                                              // RECORRIDO_CALLE
    campo(sol.recorrido.ruta, 40),                                               // RECORRIDO_RUTA
    patente,                                                                     // PATENTE_VEHICULO
    '',                                                                          // PATENTE_ACOPLADO
    '0',                                                                         // PRODUCTO_NO_TERM_DEV
    importe > 0 ? centesimos(importe) : '0',                                     // IMPORTE (12+2)
  ].join('|')

  const lineas = [`01|${cuit}`, remitoLinea, ...productos, '04|1']
  return {
    nombre: nombreArchivoCot(cuit, planta, remito.fechaEmision, secuencia),
    contenido: lineas.join('\r\n') + '\r\n',
    lineas,
    kg: Math.round(kgTotal * 100) / 100,
    productos: productos.length,
  }
}

// ── Respuesta ────────────────────────────────────────────────────────────────

export interface RespuestaCot {
  ok: boolean
  cot?: string
  numeroUnico?: string
  procesado?: string
  codigoIntegridad?: string
  /** Error global (TBError: credenciales, formato) o del remito. */
  error?: string
  detalle?: { codigo: string; mensaje: string }[]
}

const tag = (xml: string, nombre: string): string | undefined => {
  const m = new RegExp(`<${nombre}>([^<]*)</${nombre}>`, 'i').exec(xml)
  return m ? m[1].trim() : undefined
}

/** Parsea el XML de presentarRemitos.do (TBError o validacionesRemitos). */
export function parsearRespuestaCot(xml: string): RespuestaCot {
  const texto = String(xml ?? '')
  if (/<TBError>/i.test(texto)) {
    const codigo = tag(texto, 'codigoError') ?? ''
    const mensaje = tag(texto, 'mensajeError') ?? 'Error de ARBA'
    return { ok: false, error: `ARBA (${tag(texto, 'tipoError') ?? 'error'} ${codigo}): ${mensaje}`, detalle: [{ codigo, mensaje }] }
  }
  const remito = /<remito>([\s\S]*?)<\/remito>/i.exec(texto)?.[1] ?? texto
  const errores: { codigo: string; mensaje: string }[] = []
  for (const m of remito.matchAll(/<error>([\s\S]*?)<\/error>/gi)) {
    errores.push({ codigo: tag(m[1], 'codigo') ?? '', mensaje: tag(m[1], 'descripcion') ?? tag(m[1], 'mensaje') ?? m[1].replace(/<[^>]+>/g, ' ').trim() })
  }
  const cot = tag(remito, 'cot')
  const procesado = tag(remito, 'procesado')
  const base = { cot, numeroUnico: tag(remito, 'numeroUnico'), procesado, codigoIntegridad: tag(texto, 'codigoIntegridad') }
  if (cot && (procesado ?? 'SI').toUpperCase() === 'SI') return { ok: true, ...base, ...(errores.length ? { detalle: errores } : {}) }
  const error = errores.length
    ? errores.map((e) => `${e.codigo ? `(${e.codigo}) ` : ''}${e.mensaje}`).join(' | ')
    : `ARBA no devolvió COT (procesado: ${procesado ?? '?'})`
  return { ok: false, ...base, error, ...(errores.length ? { detalle: errores } : {}) }
}

/** Validez del COT según distancia (< 500 km: 1 día): la fecha de salida + 1. */
export function fechaValidez(fechaSalida: string): string {
  const [y, m, d] = fechaSalida.split('-').map(Number)
  const f = new Date(y, (m ?? 1) - 1, (d ?? 1) + 1)
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`
}
