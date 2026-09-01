/**
 * Cliente del WSFEv1 de ARCA (facturación electrónica).
 *
 * Se habla SOAP a mano en vez de usar una librería de WSDL: son cinco métodos,
 * el contrato no cambia, y traer un stack de SOAP a Cloud Functions por esto
 * sería desproporcionado. El armado de XML está acotado a este archivo.
 *
 * La autenticación (Token/Sign) la provee wsaa.ts; la lógica fiscal (qué
 * comprobante, cuánto IVA) vive en comprobante.ts. Acá solo se transporta.
 *
 * Ver docs/arca/FACTURACION_ELECTRONICA.md.
 */

import type { AmbienteArca } from './wsaa'
import { extraerTag } from './wsaa'
import type { FECAEDetRequest } from './comprobante'
import { fetchArca, type FetchArca } from './httpArca'

export const WSFEV1_URL: Record<AmbienteArca, string> = {
  homologacion: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  produccion:   'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
}

const NS = 'http://ar.gov.afip.dif.FEV1/'

export interface CredencialesArca {
  token: string
  sign: string
  /** CUIT del emisor, sin guiones. */
  cuit: string
}

export interface ConfigWsfev1 {
  ambiente: AmbienteArca
  credenciales: CredencialesArca
  /** Inyectable para testear sin red. */
  /** Transporte. Por defecto el de httpArca, que tolera el TLS de ARCA. */
  fetchImpl?: FetchArca
}

export interface ErrorArca { code: number; msg: string }

/** Un comprobante puede aprobarse CON observaciones: hay que registrarlas igual. */
export interface ObservacionArca { code: number; msg: string }

export class ArcaError extends Error {
  constructor(message: string, readonly errores: ErrorArca[] = []) {
    super(message)
    this.name = 'ArcaError'
  }
}

// ── Armado de SOAP ────────────────────────────────────────────────────────────

function escaparXml(v: string | number): string {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function tagsAuth(c: CredencialesArca): string {
  return [
    '<ar:Auth>',
    `<ar:Token>${escaparXml(c.token)}</ar:Token>`,
    `<ar:Sign>${escaparXml(c.sign)}</ar:Sign>`,
    `<ar:Cuit>${escaparXml(c.cuit)}</ar:Cuit>`,
    '</ar:Auth>',
  ].join('')
}

function envolver(operacion: string, cuerpoInterno: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"',
    `                  xmlns:ar="${NS}">`,
    '<soapenv:Header/>',
    '<soapenv:Body>',
    `<ar:${operacion}>`,
    cuerpoInterno,
    `</ar:${operacion}>`,
    '</soapenv:Body>',
    '</soapenv:Envelope>',
  ].join('')
}

// ── Parseo de respuestas ──────────────────────────────────────────────────────

/** Devuelve el contenido de cada ocurrencia de un tag. */
export function extraerTodos(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) out.push(m[1])
  return out
}

export function parsearErrores(xml: string): ErrorArca[] {
  const bloque = extraerTag(xml, 'Errors')
  if (!bloque) return []
  return extraerTodos(bloque, 'Err').map((e) => ({
    code: Number(extraerTag(e, 'Code') ?? 0),
    msg: extraerTag(e, 'Msg') ?? '',
  }))
}

export function parsearObservaciones(xml: string): ObservacionArca[] {
  const bloque = extraerTag(xml, 'Observaciones')
  if (!bloque) return []
  // <Observaciones> contiene uno o más <Obs>; algunos entornos devuelven los
  // campos sueltos si hay una sola. Se contemplan las dos formas.
  const obs = extraerTodos(bloque, 'Obs')
  const fuentes = obs.length > 0 ? obs : [bloque]
  return fuentes.map((o) => ({
    code: Number(extraerTag(o, 'Code') ?? 0),
    msg: extraerTag(o, 'Msg') ?? '',
  }))
}

/** Lanza si la respuesta trae un SOAP Fault o errores de ARCA. */
function verificarRespuesta(xml: string, operacion: string): void {
  const falla = extraerTag(xml, 'faultstring')
  if (falla) throw new ArcaError(`${operacion}: ${falla}`)

  const errores = parsearErrores(xml)
  if (errores.length > 0) {
    const detalle = errores.map((e) => `[${e.code}] ${e.msg}`).join(' | ')
    throw new ArcaError(`${operacion} rechazado por ARCA: ${detalle}`, errores)
  }
}

async function llamar(cfg: ConfigWsfev1, operacion: string, cuerpo: string): Promise<string> {
  const doFetch = cfg.fetchImpl ?? fetchArca
  const resp = await doFetch(WSFEV1_URL[cfg.ambiente], {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: `${NS}${operacion}`,
    },
    body: envolver(operacion, cuerpo),
  })

  const texto = await resp.text()

  // ARCA usa 500 para los SOAP Fault; el cuerpo explica mejor que el status.
  if (!resp.ok && !texto.includes('faultstring')) {
    throw new ArcaError(`${operacion}: HTTP ${resp.status}`)
  }
  verificarRespuesta(texto, operacion)
  return texto
}

// ── Métodos ───────────────────────────────────────────────────────────────────

/**
 * Health check de la infraestructura de ARCA. No necesita autenticación.
 * Útil para distinguir "ARCA está caído" de "nuestro token está mal".
 */
export async function feDummy(cfg: ConfigWsfev1): Promise<{ appServer: string; dbServer: string; authServer: string }> {
  const xml = await llamar(cfg, 'FEDummy', '')
  return {
    appServer: extraerTag(xml, 'AppServer') ?? '',
    dbServer: extraerTag(xml, 'DbServer') ?? '',
    authServer: extraerTag(xml, 'AuthServer') ?? '',
  }
}

/**
 * Último número de comprobante autorizado para un punto de venta y tipo.
 *
 * Es la fuente de verdad de la correlatividad: el número lo lleva el emisor,
 * ARCA solo valida que no haya saltos ni repeticiones. El próximo a emitir es
 * este + 1.
 */
export async function feCompUltimoAutorizado(
  cfg: ConfigWsfev1,
  ptoVta: number,
  cbteTipo: number,
): Promise<number> {
  const cuerpo = [
    tagsAuth(cfg.credenciales),
    `<ar:PtoVta>${ptoVta}</ar:PtoVta>`,
    `<ar:CbteTipo>${cbteTipo}</ar:CbteTipo>`,
  ].join('')
  const xml = await llamar(cfg, 'FECompUltimoAutorizado', cuerpo)
  return Number(extraerTag(xml, 'CbteNro') ?? 0)
}

export interface ComprobanteConsultado {
  existe: boolean
  cae?: string
  caeFchVto?: string
  cbteFch?: string
  impTotal?: number
}

/**
 * Consulta un comprobante ya emitido.
 *
 * Es la pieza central de la idempotencia: si se cortó la red después de pedir
 * un CAE, el comprobante puede haber quedado autorizado igual. Antes de
 * reintentar hay que preguntar por ese número — reintentar a ciegas puede
 * generar un duplicado, que es un problema fiscal, no un bug.
 */
export async function feCompConsultar(
  cfg: ConfigWsfev1,
  ptoVta: number,
  cbteTipo: number,
  cbteNro: number,
): Promise<ComprobanteConsultado> {
  const cuerpo = [
    tagsAuth(cfg.credenciales),
    '<ar:FeCompConsReq>',
    `<ar:CbteTipo>${cbteTipo}</ar:CbteTipo>`,
    `<ar:CbteNro>${cbteNro}</ar:CbteNro>`,
    `<ar:PtoVta>${ptoVta}</ar:PtoVta>`,
    '</ar:FeCompConsReq>',
  ].join('')

  try {
    const xml = await llamar(cfg, 'FECompConsultar', cuerpo)
    const cae = extraerTag(xml, 'CodAutorizacion') ?? extraerTag(xml, 'CAE')
    if (!cae) return { existe: false }
    return {
      existe: true,
      cae,
      caeFchVto: extraerTag(xml, 'FchVto') ?? extraerTag(xml, 'CAEFchVto') ?? undefined,
      cbteFch: extraerTag(xml, 'CbteFch') ?? undefined,
      impTotal: Number(extraerTag(xml, 'ImpTotal') ?? 0) || undefined,
    }
  } catch (e) {
    // 602 = "No existen datos en nuestros registros": el comprobante no está
    // emitido. Es una respuesta válida a esta pregunta, no una falla.
    if (e instanceof ArcaError && e.errores.some((x) => x.code === 602)) {
      return { existe: false }
    }
    throw e
  }
}

// ── Tablas de referencia (FEParamGet*) ────────────────────────────────────────

export interface ItemParametrico { id: string; desc: string }

/**
 * Consulta una tabla de referencia de ARCA.
 *
 * Estas listas (tipos de tributo, alícuotas de IVA, tipos de comprobante…) son
 * la fuente autoritativa: el manual no las fija, justamente para que puedan
 * cambiar. Conviene consultarlas en vez de hardcodear códigos — un `Id` de
 * tributo equivocado es un comprobante mal informado.
 */
export async function feParamGet(
  cfg: ConfigWsfev1,
  operacion: string,
  tagItem: string,
): Promise<ItemParametrico[]> {
  const xml = await llamar(cfg, operacion, tagsAuth(cfg.credenciales))
  return extraerTodos(xml, tagItem).map((item) => ({
    id: extraerTag(item, 'Id') ?? '',
    desc: extraerTag(item, 'Desc') ?? '',
  }))
}

export const feParamGetTiposTributos = (cfg: ConfigWsfev1) =>
  feParamGet(cfg, 'FEParamGetTiposTributos', 'TributoTipo')

export const feParamGetTiposIva = (cfg: ConfigWsfev1) =>
  feParamGet(cfg, 'FEParamGetTiposIva', 'IvaTipo')

export const feParamGetTiposCbte = (cfg: ConfigWsfev1) =>
  feParamGet(cfg, 'FEParamGetTiposCbte', 'CbteTipo')

export const feParamGetCondicionIvaReceptor = (cfg: ConfigWsfev1) =>
  feParamGet(cfg, 'FEParamGetCondicionIvaReceptor', 'CondicionIvaReceptor')

export interface PuntoVenta {
  nro: string
  emisionTipo: string
  bloqueado: string
  fechaBaja: string
}

/** Puntos de venta habilitados para facturación electrónica por web service. */
export async function feParamGetPtosVenta(cfg: ConfigWsfev1): Promise<PuntoVenta[]> {
  const xml = await llamar(cfg, 'FEParamGetPtosVenta', tagsAuth(cfg.credenciales))
  return extraerTodos(xml, 'PtoVenta').map((p) => ({
    nro: extraerTag(p, 'Nro') ?? '',
    emisionTipo: extraerTag(p, 'EmisionTipo') ?? '',
    bloqueado: extraerTag(p, 'Bloqueado') ?? '',
    fechaBaja: extraerTag(p, 'FchBaja') ?? '',
  }))
}

export interface ResultadoCae {
  resultado: 'A' | 'R' | 'P'
  cae: string | null
  caeFchVto: string | null
  cbteDesde: number
  observaciones: ObservacionArca[]
}

function tagsDetalle(d: FECAEDetRequest): string {
  const iva = d.Iva.map((i) =>
    ['<ar:AlicIva>',
     `<ar:Id>${i.Id}</ar:Id>`,
     `<ar:BaseImp>${i.BaseImp}</ar:BaseImp>`,
     `<ar:Importe>${i.Importe}</ar:Importe>`,
     '</ar:AlicIva>'].join(''),
  ).join('')

  // Percepciones y demás tributos. ARCA valida que la suma de los importes
  // coincida con ImpTrib (validación 10029).
  const tributos = (d.Tributos ?? []).map((t) =>
    ['<ar:Tributo>',
     `<ar:Id>${t.Id}</ar:Id>`,
     t.Desc ? `<ar:Desc>${escaparXml(t.Desc)}</ar:Desc>` : '',
     `<ar:BaseImp>${t.BaseImp}</ar:BaseImp>`,
     `<ar:Alic>${t.Alic}</ar:Alic>`,
     `<ar:Importe>${t.Importe}</ar:Importe>`,
     '</ar:Tributo>'].join(''),
  ).join('')

  return [
    '<ar:FECAEDetRequest>',
    `<ar:Concepto>${d.Concepto}</ar:Concepto>`,
    `<ar:DocTipo>${d.DocTipo}</ar:DocTipo>`,
    `<ar:DocNro>${d.DocNro}</ar:DocNro>`,
    `<ar:CbteDesde>${d.CbteDesde}</ar:CbteDesde>`,
    `<ar:CbteHasta>${d.CbteHasta}</ar:CbteHasta>`,
    `<ar:CbteFch>${d.CbteFch}</ar:CbteFch>`,
    `<ar:ImpTotal>${d.ImpTotal}</ar:ImpTotal>`,
    `<ar:ImpTotConc>${d.ImpTotConc}</ar:ImpTotConc>`,
    `<ar:ImpNeto>${d.ImpNeto}</ar:ImpNeto>`,
    `<ar:ImpOpEx>${d.ImpOpEx}</ar:ImpOpEx>`,
    `<ar:ImpTrib>${d.ImpTrib}</ar:ImpTrib>`,
    `<ar:ImpIVA>${d.ImpIVA}</ar:ImpIVA>`,
    `<ar:MonId>${d.MonId}</ar:MonId>`,
    `<ar:MonCotiz>${d.MonCotiz}</ar:MonCotiz>`,
    `<ar:CondicionIVAReceptorId>${d.CondicionIVAReceptorId}</ar:CondicionIVAReceptorId>`,
    tributos ? `<ar:Tributos>${tributos}</ar:Tributos>` : '',
    iva ? `<ar:Iva>${iva}</ar:Iva>` : '',
    '</ar:FECAEDetRequest>',
  ].join('')
}

/**
 * Pide el CAE de un comprobante.
 *
 * Se manda de a UN comprobante por request a propósito, aunque el servicio
 * acepte lotes: cada venta se resuelve por su cuenta, y un rechazo no arrastra
 * a las demás. El volumen de la venta en calle no justifica el lote.
 */
export async function feCaeSolicitar(
  cfg: ConfigWsfev1,
  ptoVta: number,
  cbteTipo: number,
  detalle: FECAEDetRequest,
): Promise<ResultadoCae> {
  const cuerpo = [
    tagsAuth(cfg.credenciales),
    '<ar:FeCAEReq>',
    '<ar:FeCabReq>',
    '<ar:CantReg>1</ar:CantReg>',
    `<ar:PtoVta>${ptoVta}</ar:PtoVta>`,
    `<ar:CbteTipo>${cbteTipo}</ar:CbteTipo>`,
    '</ar:FeCabReq>',
    `<ar:FeDetReq>${tagsDetalle(detalle)}</ar:FeDetReq>`,
    '</ar:FeCAEReq>',
  ].join('')

  const xml = await llamar(cfg, 'FECAESolicitar', cuerpo)

  const det = extraerTag(xml, 'FECAEDetResponse') ?? xml
  const resultado = (extraerTag(det, 'Resultado') ?? extraerTag(xml, 'Resultado') ?? 'R') as 'A' | 'R' | 'P'
  const cae = extraerTag(det, 'CAE')
  const observaciones = parsearObservaciones(det)

  if (resultado === 'R' || !cae) {
    const detalleObs = observaciones.map((o) => `[${o.code}] ${o.msg}`).join(' | ')
    throw new ArcaError(
      `ARCA rechazó el comprobante${detalleObs ? `: ${detalleObs}` : ''}`,
      observaciones,
    )
  }

  return {
    resultado,
    cae,
    caeFchVto: extraerTag(det, 'CAEFchVto'),
    cbteDesde: Number(extraerTag(det, 'CbteDesde') ?? detalle.CbteDesde),
    observaciones,
  }
}
