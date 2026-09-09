// Clientes, saldos y consultas de saldo: Tango → app por Tango Connect, sin
// pasar por la VM (2026-09-03, reemplaza a scripts/tango/bridge-sync-clientes.mjs,
// bridge-sync-saldos.mjs y la parte de tango-consultas de bridge-listener.mjs).
//
// Misma lógica de negocio que antes: la lectura de Tango se hace acá con
// TangoClient y las filas se le pasan a las mismas funciones que ya usaban
// las Functions HTTP del bridge (procesarLoteClientesTango, procesarLoteSaldos),
// así el matching de clientes, los descuentos de cobranzas pendientes y el
// vaciado del cache de saldos no cambian. Ver docs/tango/INTEGRACION.md §18.

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { defineSecret } from 'firebase-functions/params'
import { logger } from 'firebase-functions/v2'
import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore'
import { TangoClient, PROCESOS } from '../services/tango/client'
import { prop } from '../services/tango/pedido'
import type { ConfigTango } from '../services/tango/writers'
import { indiceUsuariosClientes, procesarLoteClientesTango, type TangoClienteRow, type ResultadoSync } from './tangoSync'
import { descuentosPendientes, indiceClientesTango, procesarLoteSaldos, type TangoSaldoRow, type ComprobanteSaldoRow } from './tangoSaldos'
import { EMPRESAS, tangoIdsDe, type Empresa } from '../services/tango/empresas'
import {
  PROCESO_DETALLE_COMPROBANTES_DEFAULT, completarEmision, ddMMyyyy as ddMMyyyyEmision, fechasDeFilasDetalle, iso as isoEmision,
  podarMapa, rangoAPedir, rutaEmisiones, type MapaEmisiones,
} from '../services/tango/emisiones'
import { candidatosAlta, corridaConfiable, decidirBaja, type EstadoVinculo, type MotivoSinAlta } from '../services/tango/clientes'
import { getAuth } from 'firebase-admin/auth'
import { assertRateLimit } from '../rateLimit'

const tangoApiToken = defineSecret('TANGO_API_TOKEN')
const CONNECT_BASE_URL_DEFAULT = 'https://001174-003.connect.axoft.com'
const TZ = 'America/Argentina/Buenos_Aires'
const ROLES_QUE_SINCRONIZAN = new Set(['super_admin', 'gerente_general', 'gerente_comercial', 'comercial', 'facturacion'])
const ROLES_SALDOS = new Set([...ROLES_QUE_SINCRONIZAN, 'supervisor'])

// Consultas Live de composición de saldos. Mismos procesos que usaba el
// bridge; se pueden pisar desde config/tango.saldos (y por empresa en
// config/tango.saldos.porEmpresa.<empresa>).
const PROCESO_DEUDAS_VENCIDAS_DEFAULT = 17953
const PROCESO_DEUDAS_A_VENCER_DEFAULT = 17955
const FROM_DATE_DEFAULT = '01/01/2015'

type ConfigSync = ConfigTango & {
  enabled?: boolean
  connectBaseUrl?: string
  saldos?: {
    procesoDeudasVencidas?: number; procesoDeudasAVencer?: number; fromDate?: string
    /** Live "Detalle de comprobantes" (default 17943): de ahí sale la fecha de emisión. */
    procesoDetalleComprobantes?: number
    porEmpresa?: Partial<Record<Empresa, { procesoDeudasVencidas?: number; procesoDeudasAVencer?: number; fromDate?: string; procesoDetalleComprobantes?: number }>>
  }
  // Llaves de apagado por si hay que volver al bridge de la VM: default encendido.
  syncCloud?: { clientes?: boolean; saldos?: boolean; consultas?: boolean }
  // Padrón maestro (2026-09-06): altas.enabled encola candidatos, altas.crear los crea
  // (tangoAltas.ts); bajas.enabled desactiva cuentas que ya no están en Tango.
  altas?: { enabled?: boolean; crear?: boolean }
  bajas?: { enabled?: boolean; maxPorCorrida?: number }
  clientesSync?: { resumen?: ResumenClientes }
}

async function contexto(): Promise<{ db: Firestore; cfg: ConfigSync; tango: TangoClient }> {
  const db = getFirestore()
  const cfg = ((await db.doc('config/tango').get()).data() ?? {}) as ConfigSync
  if (cfg.enabled !== true) throw new HttpsError('failed-precondition', 'config/tango.enabled está apagado')
  const tango = new TangoClient({ baseUrl: cfg.connectBaseUrl ?? CONNECT_BASE_URL_DEFAULT, token: tangoApiToken.value(), timeoutMs: 60_000 })
  return { db, cfg, tango }
}

function companyDe(cfg: ConfigSync, empresa: Empresa): number {
  const c = cfg.companies?.[empresa]
  if (!Number.isInteger(c)) throw new HttpsError('failed-precondition', `config/tango.companies.${empresa} no está configurado`)
  return c as number
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const str = (v: unknown): string | undefined => (v == null || v === '' ? undefined : String(v))

// ── Clientes ─────────────────────────────────────────────────────────────────

// Mismo recorte que hacía bridge-sync-clientes.mjs sobre la fila de process 2117.
export function recortarCliente(c: Record<string, unknown>): TangoClienteRow {
  return {
    idGva14:            Number(prop(c, 'ID_GVA14')),
    codGva14:           String(prop(c, 'COD_GVA14') ?? '').trim(),
    cuit:               String(prop(c, 'CUIT') ?? ''),
    razonSocial:        str(prop(c, 'RAZON_SOCI')),
    email:              str(prop(c, 'E_MAIL')),
    telefono1:          str(prop(c, 'TELEFONO_1')),
    telefono2:          str(prop(c, 'TELEFONO_2')),
    telefonoMovil:      str(prop(c, 'TELEFONO_MOVIL')),
    condicionVentaDesc: str(prop(c, 'GVA01_DESC_COND')),
    categoriaIvaCodigo: str(prop(c, 'COD_CATEGORIA_IVA')),
    categoriaIvaDesc:   str(prop(c, 'DESC_CATEGORIA_IVA')),
    vendedorCodigo:     str(prop(c, 'GVA23_CODIGO')),
    domicilio:          str(prop(c, 'DOMICILIO')) ?? str(prop(c, 'DIR_COM')),
    localidad:          str(prop(c, 'LOCALIDAD')),
    provinciaDesc:      str(prop(c, 'GVA18_DESCRIPCION')),
    codigoPostal:       str(prop(c, 'C_POSTAL')),
    fechaAlta:          str(prop(c, 'FECHA_ALTA')),
    ...(typeof prop(c, 'HABILITADO') === 'boolean' ? { habilitado: prop(c, 'HABILITADO') as boolean } : {}),
  }
}

export interface ResumenClientesEmpresa {
  company?: number
  recibidos: number
  lotes: number
  actualizados: number
  matchedByIdGva14: number
  matchedByCuit: number
  matchedByCodigo: number
  newlyLinkedCodigoTango: number
  codigosSecundarios: number
  skippedNoMatch: number
  skippedAmbiguousCuit: number
  emailsActualizados: number
  emailsConError: number
  errores: unknown[]
}

export interface ResumenAltasEncoladas {
  candidatos: number
  encolados: number
  yaEncolados: number
  descartados: number
  porMotivo: Record<string, number>
  ejemplosDescartados: MotivoSinAlta[]
}

export interface ResumenBajas {
  enabled: boolean
  evaluadas: number
  bajas: number
  reactivadas: number
  corridaConfiable: Partial<Record<Empresa, boolean>>
  topeAlcanzado: boolean
  ejemplos: Array<{ uid: string; razonSocial: string; accion: string; motivo?: string }>
}

export interface ResumenClientes extends ResumenClientesEmpresa {
  empresas: Partial<Record<Empresa, ResumenClientesEmpresa>>
  altas?: ResumenAltasEncoladas
  bajas?: ResumenBajas
}

function resumenClientesVacio(): ResumenClientesEmpresa {
  return {
    recibidos: 0, lotes: 0, actualizados: 0, matchedByIdGva14: 0, matchedByCuit: 0, matchedByCodigo: 0,
    newlyLinkedCodigoTango: 0, codigosSecundarios: 0, skippedNoMatch: 0, skippedAmbiguousCuit: 0, emailsActualizados: 0, emailsConError: 0, errores: [],
  }
}

function sumarResumenClientes(into: ResumenClientesEmpresa, r: ResultadoSync) {
  into.lotes++
  into.actualizados           += r.actualizados ?? 0
  into.matchedByIdGva14       += r.matchedByIdGva14 ?? 0
  into.matchedByCuit          += r.matchedByCuit ?? 0
  into.matchedByCodigo        += r.matchedByCodigo ?? 0
  into.newlyLinkedCodigoTango += r.newlyLinkedCodigoTango ?? 0
  into.codigosSecundarios     += r.codigosSecundarios ?? 0
  into.skippedNoMatch         += r.skippedNoMatch ?? 0
  into.skippedAmbiguousCuit   += r.skippedAmbiguousCuit ?? 0
  into.emailsActualizados     += r.emailsActualizados ?? 0
  into.emailsConError         += r.emailsConError ?? 0
  if (r.errores?.length && into.errores.length < 50) into.errores.push(...r.errores.slice(0, 50 - into.errores.length))
}

/** Filas de clientes de una empresa, ya recortadas. */
export async function filasClientes(tango: TangoClient, company: number): Promise<TangoClienteRow[]> {
  const filas = await tango.getAll(company, PROCESOS.clientes, 200)
  return filas.map(recortarCliente).filter((r) => Number.isInteger(r.idGva14) && r.codGva14)
}

/**
 * Padrón de las DOS empresas (2026-09-06). Redonhielo primero (manda la ficha),
 * Rolito después (solo vincula identidad). Si una empresa falla, la otra sigue
 * y el error queda en el resumen, como en la sync de precios.
 */
export async function sincronizarClientes(db: Firestore, tango: TangoClient, cfg: ConfigSync): Promise<ResumenClientes> {
  const indice = await indiceUsuariosClientes(db)
  const resumen: ResumenClientes = { ...resumenClientesVacio(), empresas: {} }
  const sinCuenta: Array<{ empresa: Empresa; fila: TangoClienteRow }> = []
  // Por empresa: uid → apareció habilitada (true) o solo inhabilitada (false).
  const vistos: Record<Empresa, Map<string, boolean>> = { redonhielo: new Map(), rolito: new Map() }
  const corridaOk: Partial<Record<Empresa, boolean>> = {}
  for (const empresa of EMPRESAS) {
    const re = resumenClientesVacio()
    resumen.empresas[empresa] = re
    try {
      const company = companyDe(cfg, empresa)
      re.company = company
      const rows = await filasClientes(tango, company)
      re.recibidos = rows.length
      for (const lote of chunk(rows, 300)) {
        const r: ResultadoSync = await procesarLoteClientesTango(db, lote, { dryRun: false, empresa, indice })
        sumarResumenClientes(re, r)
        for (const f of r.sinCuenta ?? []) sinCuenta.push({ empresa, fila: f })
        for (const v of r.vistos ?? []) vistos[empresa].set(v.uid, (vistos[empresa].get(v.uid) ?? false) || v.habilitado)
      }
      corridaOk[empresa] = corridaConfiable(rows.length, cfg.clientesSync?.resumen?.empresas?.[empresa]?.recibidos)
    } catch (e) {
      corridaOk[empresa] = false
      re.errores.push({ empresa, motivo: (e as Error).message })
      logger.error(`[tango] sync de clientes de ${empresa} falló: ${(e as Error).message}`)
    }
    // Totales (compatibilidad con el panel viejo): suma de las dos empresas.
    for (const k of Object.keys(re) as (keyof ResumenClientesEmpresa)[]) {
      if (k === 'errores') resumen.errores.push(...re.errores)
      else if (k !== 'company') (resumen[k] as number) += re[k] as number
    }
  }
  // Altas y bajas no pueden tirar abajo la corrida: si fallan, queda el
  // error en el resumen y el resto (fichas ya actualizadas) se registra igual.
  try {
    if (cfg.altas?.enabled === true) resumen.altas = await encolarAltas(db, sinCuenta)
  } catch (e) {
    resumen.errores.push({ paso: 'altas', motivo: (e as Error).message })
    logger.error(`[tango] encolar altas falló: ${(e as Error).message}`)
  }
  try {
    resumen.bajas = await aplicarBajas(db, cfg, indice.perfilPorUid, vistos, corridaOk)
  } catch (e) {
    resumen.errores.push({ paso: 'bajas', motivo: (e as Error).message })
    logger.error(`[tango] bajas falló: ${(e as Error).message}`)
  }
  return resumen
}

// ── Altas: encolar candidatos (los crea tangoAltas.ts) ──────────────────────
async function encolarAltas(db: Firestore, sinCuenta: Array<{ empresa: Empresa; fila: TangoClienteRow }>): Promise<ResumenAltasEncoladas> {
  const { candidatos, descartados } = candidatosAlta(sinCuenta)
  const porMotivo: Record<string, number> = {}
  for (const d of descartados) porMotivo[d.motivo] = (porMotivo[d.motivo] ?? 0) + 1
  const out: ResumenAltasEncoladas = { candidatos: candidatos.length, encolados: 0, yaEncolados: 0, descartados: descartados.length, porMotivo, ejemplosDescartados: descartados.filter((d) => d.motivo === 'cuit_invalido').slice(0, 30) }
  // Una sola lectura de la cola (son miles de CUIT: leerlos de a uno superaba
  // el tope de 9 min de la function). Los que ya están en un estado final
  // (creada / existia / error) no se re-encolan solos.
  const enCola = new Map<string, string>()
  for (const d of (await db.collection('tango-altas').select('estado').get()).docs) enCola.set(d.id, String(d.data().estado ?? ''))
  let batch = db.batch(), ops = 0
  for (const c of candidatos) {
    const estadoActual = enCola.get(c.clave)
    if (estadoActual && estadoActual !== 'pendiente') { out.yaEncolados++; continue }
    if (estadoActual) out.yaEncolados++
    else out.encolados++
    // JSON round-trip: las filas recortadas traen campos undefined (str() de
    // recortarCliente) y Firestore los rechaza.
    batch.set(db.doc(`tango-altas/${c.clave}`), { cuit: c.cuit, clave: c.clave, ...(c.sinCuit ? { sinCuit: true } : {}), filas: JSON.parse(JSON.stringify(c.filas)), estado: 'pendiente', razonSocial: c.filas[0].fila.razonSocial ?? '', actualizadoEn: FieldValue.serverTimestamp(), ...(estadoActual ? {} : { creadoEn: FieldValue.serverTimestamp() }) }, { merge: true })
    if (++ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0 }
  }
  if (ops) await batch.commit()
  return out
}

// ── Bajas / reactivaciones ──────────────────────────────────────────────────
// Solo cuentas con identidad Tango. Baja = estado 'inactivo' + Auth
// deshabilitado (la sesión muere); nunca se borra nada. Con circuit breaker
// por empresa (corridaOk) y tope por corrida.
async function aplicarBajas(
  db: Firestore, cfg: ConfigSync,
  perfilPorUid: Map<string, FirebaseFirestore.DocumentData>,
  vistos: Record<Empresa, Map<string, boolean>>,
  corridaOk: Partial<Record<Empresa, boolean>>,
): Promise<ResumenBajas> {
  const out: ResumenBajas = { enabled: cfg.bajas?.enabled === true, evaluadas: 0, bajas: 0, reactivadas: 0, corridaConfiable: corridaOk, topeAlcanzado: false, ejemplos: [] }
  const tope = cfg.bajas?.maxPorCorrida ?? 500
  const auth = getAuth()
  for (const [uid, perfil] of perfilPorUid) {
    const ids = tangoIdsDe(perfil)
    const estado: EstadoVinculo = { vinculada: {}, habilitada: {}, corridaOk }
    for (const e of EMPRESAS) {
      if (!ids[e]?.length) continue
      estado.vinculada[e] = true
      if (vistos[e].has(uid)) estado.habilitada[e] = vistos[e].get(uid)
    }
    if (!Object.keys(estado.vinculada).length) continue
    out.evaluadas++
    const decision = decidirBaja(estado, perfil)
    if (decision.accion === 'nada') continue
    if (out.ejemplos.length < 30) out.ejemplos.push({ uid, razonSocial: String(perfil.razonSocial ?? perfil.nombre ?? ''), accion: decision.accion, ...(decision.accion === 'baja' ? { motivo: decision.motivo } : {}) })
    if (!out.enabled) { if (decision.accion === 'baja') out.bajas++; else out.reactivadas++; continue }   // dry-run: solo contar
    if (decision.accion === 'baja') {
      if (out.bajas >= tope) { out.topeAlcanzado = true; continue }
      await db.doc(`users/${uid}`).update({ estado: 'inactivo', bajaTango: { fecha: FieldValue.serverTimestamp(), motivo: decision.motivo } })
      await auth.updateUser(uid, { disabled: true }).catch((e) => logger.warn(`[tango] baja ${uid}: no se pudo deshabilitar en Auth (${(e as Error).message})`))
      await auth.revokeRefreshTokens(uid).catch(() => undefined)
      out.bajas++
    } else {
      await db.doc(`users/${uid}`).update({ estado: 'activo', bajaTango: FieldValue.delete() })
      await auth.updateUser(uid, { disabled: false }).catch((e) => logger.warn(`[tango] reactivar ${uid}: no se pudo habilitar en Auth (${(e as Error).message})`))
      out.reactivadas++
    }
  }
  return out
}

async function correrClientes(origen: string, uid?: string) {
  const { db, cfg, tango } = await contexto()
  if (cfg.syncCloud?.clientes === false) throw new HttpsError('failed-precondition', 'config/tango.syncCloud.clientes está apagado')
  const inicio = Date.now()
  const resumen = await sincronizarClientes(db, tango, cfg)
  await db.doc('config/tango').set({
    clientesSync: { ultimaCorrida: FieldValue.serverTimestamp(), origen, uid: uid ?? null, duracionMs: Date.now() - inicio, resumen },
  }, { merge: true })
  logger.info(`[tango] clientes sincronizados (${origen}) en ${Date.now() - inicio}ms: ${JSON.stringify({ ...resumen, empresas: undefined, errores: resumen.errores.length, altas: resumen.altas && { ...resumen.altas, ejemplosDescartados: undefined }, bajas: resumen.bajas && { ...resumen.bajas, ejemplos: undefined } })}`)
  return resumen
}

// ── Saldos (composición de deuda por cliente) ────────────────────────────────

// dd/MM/yyyy — el único formato de fecha que acepta GetApiLiveQueryData.
function ddMMyyyy(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}
const soloFecha = (iso: unknown): string => (typeof iso === 'string' ? iso.slice(0, 10) : '')

// Mismo recorte que bridge-sync-saldos.mjs / bridge-listener.mjs.
export function recortarComprobante(f: Record<string, unknown>): ComprobanteSaldoRow {
  const idGva12 = prop(f, 'ID_GVA12')
  const dias = prop(f, 'DIAS_DE_ATRASO')
  const venc = prop(f, 'FECHA_DE_VENCIMIENTO')
  return {
    tipo:            String(prop(f, 'TIPO_COMPROBANTE') ?? ''),
    numero:          String(prop(f, 'NRO_COMPROBANTE') ?? ''),
    fechaEmision:    soloFecha(prop(f, 'FECHA_DE_EMISION')),
    ...(venc ? { fechaVencimiento: soloFecha(venc) } : {}),
    importeOriginal: Number(prop(f, 'IMPORTE_AL_VENCIMIENTO_CTE') ?? 0),
    saldoPendiente:  Number(prop(f, 'IMPORTE_PENDIENTE_CTE') ?? 0),
    ...(typeof idGva12 === 'number' ? { idComprobanteTango: idGva12 } : {}),
    ...(typeof dias === 'number' && dias > 0 ? { diasAtraso: dias } : {}),
  }
}

// "ACH082 - HANZA MARIA ELENA" → { codigo, nombre }
function parseCliente(campo: unknown): { codigo: string; nombre: string } {
  const s = String(campo ?? '')
  const idx = s.indexOf(' - ')
  return idx === -1 ? { codigo: '', nombre: s } : { codigo: s.slice(0, idx).trim(), nombre: s.slice(idx + 3).trim() }
}

/**
 * Id de cliente (ID_GVA14) de una fila de deuda.
 *
 * La Live de deudas VENCIDAS trae ID_GVA14; la de deudas A VENCER (17955) NO:
 * solo trae CLIENTE "PA.003 - ALGAR S.R.L.". Hasta el 2026-09-09 esas filas se
 * descartaban en silencio y ningún cliente veía en la app sus facturas todavía
 * no vencidas (visto con ALGAR: 3 facturas en Tango, 2 en la app). Se resuelve
 * por código con el índice de clientes vinculados.
 */
export function idGva14DeFila(f: Record<string, unknown>, porCodigo: Map<string, number>): number | null {
  const id = prop(f, 'ID_GVA14')
  if (typeof id === 'number' && Number.isInteger(id) && id > 0) return id
  const { codigo } = parseCliente(prop(f, 'CLIENTE'))
  const porCod = codigo ? porCodigo.get(codigo) : undefined
  return porCod ?? null
}

/** código de Tango → ID_GVA14, a partir del índice de una empresa. */
export function mapaPorCodigo(indiceEmpresa: Map<number, { codigo: string }>): Map<string, number> {
  const m = new Map<string, number>()
  for (const [idGva14, cli] of indiceEmpresa) if (cli.codigo) m.set(cli.codigo, idGva14)
  return m
}

/** Filas de deuda agrupadas por cliente; `sinCliente` = filas que no se pudieron atribuir. */
export function agruparDeudaPorCliente(filas: Record<string, unknown>[], empresa: Empresa, porCodigo: Map<string, number>): { porCliente: Map<number, TangoSaldoRow>; sinCliente: number } {
  const porCliente = new Map<number, TangoSaldoRow>()
  let sinCliente = 0
  for (const f of filas) {
    const idGva14 = idGva14DeFila(f, porCodigo)
    if (idGva14 === null) { sinCliente++; continue }
    if (!porCliente.has(idGva14)) {
      const { codigo, nombre } = parseCliente(prop(f, 'CLIENTE'))
      porCliente.set(idGva14, { idGva14, codGva14: codigo || undefined, razonSocial: nombre || undefined, empresa, comprobantes: [] })
    }
    porCliente.get(idGva14)!.comprobantes.push(recortarComprobante(f))
  }
  return { porCliente, sinCliente }
}

/**
 * Completa la fecha de emisión de los comprobantes en deuda de una empresa
 * (ver services/tango/emisiones.ts): lee el mapa guardado, pide a la Live de
 * detalle solo los días nuevos (o una ventana más ancha si quedó alguno sin
 * fecha), y guarda el mapa podado a lo que sigue en deuda. Nunca tira: si la
 * Live falla, los comprobantes salen sin fecha como hasta ahora.
 */
async function completarFechasEmision(
  db: Firestore, tango: TangoClient, cfg: ConfigSync, company: number, empresa: Empresa,
  comprobantes: ComprobanteSaldoRow[], hoy = new Date(),
): Promise<{ sinFecha: number; pedidas: number }> {
  const ref = db.doc(rutaEmisiones(empresa))
  let mapa: MapaEmisiones | undefined
  try { mapa = (await ref.get()).data() as MapaEmisiones | undefined } catch { mapa = undefined }
  const fechas: Record<string, string> = { ...(mapa?.fechas ?? {}) }
  let faltantes = completarEmision(comprobantes, fechas)
  let pedidas = 0
  const rango = rangoAPedir(mapa, hoy, faltantes)
  if (rango) {
    try {
      const proceso = cfg.saldos?.porEmpresa?.[empresa]?.procesoDetalleComprobantes ?? cfg.saldos?.procesoDetalleComprobantes ?? PROCESO_DETALLE_COMPROBANTES_DEFAULT
      const filas = await tango.live(company, proceso, ddMMyyyyEmision(rango.desde), ddMMyyyyEmision(rango.hasta))
      pedidas = filas.length
      Object.assign(fechas, fechasDeFilasDetalle(filas))
      faltantes = completarEmision(comprobantes, fechas)
    } catch (e) {
      logger.warn(`[tango] fechas de emisión de ${empresa}: no se pudo leer el detalle de comprobantes (${(e as Error).message})`)
      return { sinFecha: faltantes.length, pedidas }
    }
  }
  const podado = podarMapa(fechas, comprobantes.map((c) => c.idComprobanteTango))
  await ref.set({ fechas: podado, hastaFecha: isoEmision(hoy), actualizadoEn: FieldValue.serverTimestamp() }).catch(() => undefined)
  return { sinFecha: faltantes.length, pedidas }
}

/** Todas las filas de deuda (vencidas + a vencer) de una empresa. */
async function filasDeuda(tango: TangoClient, cfg: ConfigSync, company: number, empresa: Empresa = 'redonhielo'): Promise<Record<string, unknown>[]> {
  const porEmpresa = cfg.saldos?.porEmpresa?.[empresa] ?? {}
  const desde = porEmpresa.fromDate ?? cfg.saldos?.fromDate ?? FROM_DATE_DEFAULT
  const hastaDate = new Date()
  hastaDate.setFullYear(hastaDate.getFullYear() + 5)   // "a vencer" incluye vencimientos futuros
  const hasta = ddMMyyyy(hastaDate)
  const vencidas = porEmpresa.procesoDeudasVencidas ?? cfg.saldos?.procesoDeudasVencidas ?? PROCESO_DEUDAS_VENCIDAS_DEFAULT
  const aVencer  = porEmpresa.procesoDeudasAVencer ?? cfg.saldos?.procesoDeudasAVencer ?? PROCESO_DEUDAS_A_VENCER_DEFAULT
  const filas = await tango.live(company, vencidas, desde, hasta)
  filas.push(...await tango.live(company, aVencer, desde, hasta))
  return filas
}

export interface ResumenSaldosEmpresa {
  company?: number
  filas: number
  clientesConDeuda: number
  lotes: number
  actualizados: number
  skippedNoMatch: number
  vaciados: number
  /** Filas de deuda que no se pudieron atribuir a un cliente (sin ID_GVA14 y código no vinculado). */
  filasSinCliente?: number
  /** Comprobantes en deuda que quedaron sin fecha de emisión (no aparecieron en el detalle de comprobantes). */
  sinFechaEmision?: number
  error?: string
}

export interface ResumenSaldos extends ResumenSaldosEmpresa {
  empresas: Partial<Record<Empresa, ResumenSaldosEmpresa>>
}

/**
 * Deuda de las DOS empresas (2026-09-06): cada una se lee y se escribe por
 * separado en su rama de saldosTango/{uid}, con su propio runId de vaciado. Los
 * varios códigos de un mismo CUIT van juntos en el mismo lote (se agrupan por
 * cuenta antes de partir), así ningún lote pisa lo que escribió el anterior.
 */
export async function sincronizarSaldos(db: Firestore, tango: TangoClient, cfg: ConfigSync): Promise<ResumenSaldos> {
  const indice = await indiceClientesTango(db)
  const descuentos = await descuentosPendientes(db)
  const resumen: ResumenSaldos = { filas: 0, clientesConDeuda: 0, lotes: 0, actualizados: 0, skippedNoMatch: 0, vaciados: 0, empresas: {} }
  for (const empresa of EMPRESAS) {
    const re: ResumenSaldosEmpresa = { filas: 0, clientesConDeuda: 0, lotes: 0, actualizados: 0, skippedNoMatch: 0, vaciados: 0 }
    resumen.empresas[empresa] = re
    try {
      const company = companyDe(cfg, empresa)
      re.company = company
      const filas = await filasDeuda(tango, cfg, company, empresa)
      const { porCliente, sinCliente } = agruparDeudaPorCliente(filas, empresa, mapaPorCodigo(indice[empresa]))
      re.filasSinCliente = sinCliente
      if (sinCliente) logger.warn(`[tango] saldos de ${empresa}: ${sinCliente} fila(s) de deuda sin ID_GVA14 ni código conocido (cliente sin vincular en la app)`)
      // Fecha de emisión (las Live de deudas no la traen): del detalle de comprobantes, cacheada.
      const emis = await completarFechasEmision(db, tango, cfg, company, empresa, [...porCliente.values()].flatMap((r) => r.comprobantes))
      re.sinFechaEmision = emis.sinFecha
      if (emis.pedidas) logger.info(`[tango] fechas de emisión de ${empresa}: ${emis.pedidas} renglones leídos, ${emis.sinFecha} comprobante(s) siguen sin fecha`)
      // Agrupar por cuenta de la app para que los códigos de un mismo CUIT
      // caigan en el mismo lote; los no vinculados van al final (skippedNoMatch).
      const grupos = new Map<string, TangoSaldoRow[]>()
      for (const row of porCliente.values()) {
        const clave = indice[empresa].get(row.idGva14)?.uid ?? `?${row.idGva14}`
        if (!grupos.has(clave)) grupos.set(clave, [])
        grupos.get(clave)!.push(row)
      }
      const lotes = [...grupos.values()].reduce<TangoSaldoRow[][]>((acc, g) => {
        if (!acc.length || acc[acc.length - 1].length >= 100) acc.push([])
        acc[acc.length - 1].push(...g)
        return acc
      }, [])
      // runId identifica la corrida completa de ESTA empresa: al llegar el
      // último lote, toda rama de esta empresa que no fue tocada se vacía.
      const runId = `${empresa}:${new Date().toISOString()}`
      re.filas = filas.length
      re.clientesConDeuda = porCliente.size
      if (lotes.length === 0) lotes.push([])   // nadie debe nada: igual hay que vaciar el cache viejo
      for (const [i, lote] of lotes.entries()) {
        const r = await procesarLoteSaldos(db, lote, { dryRun: false, runId, esUltimoLote: i === lotes.length - 1, empresa, indice, descuentos })
        re.lotes++
        re.actualizados   += r.actualizados ?? 0
        re.skippedNoMatch += r.skippedNoMatch ?? 0
        re.vaciados       += r.vaciados ?? 0
      }
    } catch (e) {
      re.error = (e as Error).message
      logger.error(`[tango] sync de saldos de ${empresa} falló: ${re.error}`)
    }
    resumen.filas += re.filas; resumen.clientesConDeuda += re.clientesConDeuda; resumen.lotes += re.lotes
    resumen.actualizados += re.actualizados; resumen.skippedNoMatch += re.skippedNoMatch; resumen.vaciados += re.vaciados
  }
  return resumen
}

async function correrSaldos(origen: string, uid?: string) {
  const { db, cfg, tango } = await contexto()
  if (cfg.syncCloud?.saldos === false) throw new HttpsError('failed-precondition', 'config/tango.syncCloud.saldos está apagado')
  const inicio = Date.now()
  const resumen = await sincronizarSaldos(db, tango, cfg)
  await db.doc('config/tango').set({
    saldosSync: { ultimaCorrida: FieldValue.serverTimestamp(), origen, uid: uid ?? null, duracionMs: Date.now() - inicio, resumen },
  }, { merge: true })
  logger.info(`[tango] saldos sincronizados (${origen}) en ${Date.now() - inicio}ms: ${JSON.stringify(resumen)}`)
  return resumen
}

// ── Programadas y callables ──────────────────────────────────────────────────

// Clientes a las 5:00 (antes que precios a las 5:30, que necesita los
// codigoTango recién vinculados). Saldos cada hora en horario de operación.
export const syncClientesTangoConnect = onSchedule(
  { schedule: '0 5 * * *', timeZone: TZ, secrets: [tangoApiToken], timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    try { await correrClientes('programada') } catch (e) { logger.error(`[tango] sync de clientes falló: ${(e as Error).message}`) }
  },
)

export const syncSaldosTangoConnect = onSchedule(
  { schedule: '10 6-22 * * *', timeZone: TZ, secrets: [tangoApiToken], timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    try { await correrSaldos('programada') } catch (e) { logger.error(`[tango] sync de saldos falló: ${(e as Error).message}`) }
  },
)

async function rolDe(uid: string): Promise<string> {
  return String((await getFirestore().collection('users').doc(uid).get()).data()?.rol ?? '')
}

export const sincronizarClientesTangoAhora = onCall(
  { secrets: [tangoApiToken], timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado')
    if (!ROLES_QUE_SINCRONIZAN.has(await rolDe(request.auth.uid))) throw new HttpsError('permission-denied', 'No tenés permiso para sincronizar clientes')
    await assertRateLimit(request.auth.uid, 'sincronizarClientesTango', 3, 300)
    return correrClientes('manual', request.auth.uid)
  },
)

export const sincronizarSaldosTangoAhora = onCall(
  { secrets: [tangoApiToken], timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado')
    if (!ROLES_SALDOS.has(await rolDe(request.auth.uid))) throw new HttpsError('permission-denied', 'No tenés permiso para sincronizar saldos')
    await assertRateLimit(request.auth.uid, 'sincronizarSaldosTango', 6, 300)
    return correrSaldos('manual', request.auth.uid)
  },
)

// ── Consultas on-demand de saldo (tango-consultas) ───────────────────────────
// La pantalla de cobro crea un doc pidiendo el saldo fresco de UN cliente. Se
// leen las Live de deudas de la empresa, se filtra por ID_GVA14 y se escribe
// `resultado` en el mismo doc; onConsultaRespondida (tangoConsultas.ts) lo
// copia después al cache saldosTango, igual que cuando respondía el bridge.
export const onConsultaSaldoPendiente = onDocumentCreated(
  { document: 'tango-consultas/{consultaId}', secrets: [tangoApiToken], timeoutSeconds: 120, memory: '512MiB' },
  async (event) => {
    const snap = event.data
    if (!snap) return
    const data = snap.data()
    if (data.tipo !== 'saldoCliente' || data.estado !== 'pendiente') return
    const db = getFirestore()
    const marcarError = (msg: string) => snap.ref.update({ estado: 'error', ultimoError: msg, respondidoPor: 'cloud', actualizadoEn: FieldValue.serverTimestamp() })
    try {
      const cfg = ((await db.doc('config/tango').get()).data() ?? {}) as ConfigSync
      if (cfg.enabled !== true || cfg.syncCloud?.consultas === false) return   // la responde el bridge (o nadie)
      const tango = new TangoClient({ baseUrl: cfg.connectBaseUrl ?? CONNECT_BASE_URL_DEFAULT, token: tangoApiToken.value(), timeoutMs: 60_000 })
      const empresa: Empresa = data.empresa === 'rolito' ? 'rolito' : 'redonhielo'
      const idGva14 = Number(data.idGva14)
      if (!Number.isInteger(idGva14)) { await marcarError('idGva14 inválido'); return }
      // Varios códigos del mismo CUIT: la consulta puede traer más de un ID_GVA14.
      const ids = new Set<number>([idGva14, ...(Array.isArray(data.idsGva14) ? (data.idsGva14 as unknown[]).map(Number).filter(Number.isInteger) : [])])
      // Las filas "a vencer" no traen ID_GVA14: se atribuyen por el código del
      // cliente (sus códigos en esta empresa salen de su perfil).
      const porCodigo = new Map<string, number>()
      if (typeof data.clienteUid === 'string' && data.clienteUid) {
        const perfil = (await db.doc(`users/${data.clienteUid}`).get()).data()
        for (const id of tangoIdsDe(perfil)[empresa] ?? []) if (ids.has(id.idGva14)) porCodigo.set(id.codigo, id.idGva14)
      }
      const filas = (await filasDeuda(tango, cfg, companyDe(cfg, empresa), empresa)).filter((f) => { const id = idGva14DeFila(f, porCodigo); return id !== null && ids.has(id) })
      const comprobantes = filas.map((f) => ({ ...recortarComprobante(f), codigoTango: parseCliente(prop(f, 'CLIENTE')).codigo }))
      // Fecha de emisión desde el mapa cacheado (sin pedirle nada más a Tango: la sync horaria lo mantiene).
      try {
        const mapa = (await db.doc(rutaEmisiones(empresa)).get()).data() as MapaEmisiones | undefined
        if (mapa?.fechas) completarEmision(comprobantes, mapa.fechas)
      } catch { /* sin fecha, como antes */ }
      const saldoTotal = Math.round(comprobantes.reduce((s, c) => s + c.saldoPendiente, 0) * 100) / 100
      // Si mientras tanto la respondió otro (bridge todavía prendido), no pisar.
      await db.runTransaction(async (tx) => {
        const actual = (await tx.get(snap.ref)).data()
        if (!actual || actual.estado !== 'pendiente') return
        tx.update(snap.ref, { estado: 'respondida', resultado: { comprobantes, saldoTotal }, ultimoError: null, respondidoPor: 'cloud', actualizadoEn: FieldValue.serverTimestamp() })
      })
      logger.info(`[tango] consulta ${event.params.consultaId}: saldo de idGva14=${idGva14} (${empresa}) respondido, ${comprobantes.length} comprobantes`)
    } catch (e) {
      const msg = (e as Error).message
      logger.error(`[tango] consulta ${event.params.consultaId} falló: ${msg}`)
      await marcarError(msg).catch(() => undefined)
    }
  },
)
