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
import { procesarLoteClientesTango, type TangoClienteRow, type ResultadoSync } from './tangoSync'
import { procesarLoteSaldos, type TangoSaldoRow, type ComprobanteSaldoRow } from './tangoSaldos'
import { assertRateLimit } from '../rateLimit'

const tangoApiToken = defineSecret('TANGO_API_TOKEN')
const CONNECT_BASE_URL_DEFAULT = 'https://001174-003.connect.axoft.com'
const TZ = 'America/Argentina/Buenos_Aires'
const ROLES_QUE_SINCRONIZAN = new Set(['super_admin', 'gerente_general', 'gerente_comercial', 'comercial', 'facturacion'])
const ROLES_SALDOS = new Set([...ROLES_QUE_SINCRONIZAN, 'supervisor'])

// Consultas Live de composición de saldos (Redonhielo). Mismos procesos que
// usaba el bridge; se pueden pisar desde config/tango.saldos.
const PROCESO_DEUDAS_VENCIDAS_DEFAULT = 17953
const PROCESO_DEUDAS_A_VENCER_DEFAULT = 17955
const FROM_DATE_DEFAULT = '01/01/2015'

type ConfigSync = ConfigTango & {
  enabled?: boolean
  connectBaseUrl?: string
  saldos?: { procesoDeudasVencidas?: number; procesoDeudasAVencer?: number; fromDate?: string }
  // Llaves de apagado por si hay que volver al bridge de la VM: default encendido.
  syncCloud?: { clientes?: boolean; saldos?: boolean; consultas?: boolean }
}

async function contexto(): Promise<{ db: Firestore; cfg: ConfigSync; tango: TangoClient }> {
  const db = getFirestore()
  const cfg = ((await db.doc('config/tango').get()).data() ?? {}) as ConfigSync
  if (cfg.enabled !== true) throw new HttpsError('failed-precondition', 'config/tango.enabled está apagado')
  const tango = new TangoClient({ baseUrl: cfg.connectBaseUrl ?? CONNECT_BASE_URL_DEFAULT, token: tangoApiToken.value(), timeoutMs: 60_000 })
  return { db, cfg, tango }
}

function companyDe(cfg: ConfigSync, empresa: 'redonhielo' | 'rolito'): number {
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
  }
}

export interface ResumenClientes {
  recibidos: number
  lotes: number
  actualizados: number
  matchedByIdGva14: number
  matchedByCuit: number
  newlyLinkedCodigoTango: number
  skippedNoMatch: number
  skippedAmbiguousCuit: number
  emailsActualizados: number
  emailsConError: number
  errores: unknown[]
}

export async function sincronizarClientes(db: Firestore, tango: TangoClient, cfg: ConfigSync): Promise<ResumenClientes> {
  const company = companyDe(cfg, 'redonhielo')
  const filas = await tango.getAll(company, PROCESOS.clientes, 200)
  const rows = filas.map(recortarCliente).filter((r) => Number.isInteger(r.idGva14) && r.codGva14)
  const resumen: ResumenClientes = {
    recibidos: rows.length, lotes: 0, actualizados: 0, matchedByIdGva14: 0, matchedByCuit: 0,
    newlyLinkedCodigoTango: 0, skippedNoMatch: 0, skippedAmbiguousCuit: 0, emailsActualizados: 0, emailsConError: 0, errores: [],
  }
  for (const lote of chunk(rows, 300)) {
    const r: ResultadoSync = await procesarLoteClientesTango(db, lote, { dryRun: false })
    resumen.lotes++
    resumen.actualizados           += r.actualizados ?? 0
    resumen.matchedByIdGva14       += r.matchedByIdGva14 ?? 0
    resumen.matchedByCuit          += r.matchedByCuit ?? 0
    resumen.newlyLinkedCodigoTango += r.newlyLinkedCodigoTango ?? 0
    resumen.skippedNoMatch         += r.skippedNoMatch ?? 0
    resumen.skippedAmbiguousCuit   += r.skippedAmbiguousCuit ?? 0
    resumen.emailsActualizados     += r.emailsActualizados ?? 0
    resumen.emailsConError         += r.emailsConError ?? 0
    if (r.errores?.length && resumen.errores.length < 50) resumen.errores.push(...r.errores.slice(0, 50 - resumen.errores.length))
  }
  return resumen
}

async function correrClientes(origen: string, uid?: string) {
  const { db, cfg, tango } = await contexto()
  if (cfg.syncCloud?.clientes === false) throw new HttpsError('failed-precondition', 'config/tango.syncCloud.clientes está apagado')
  const inicio = Date.now()
  const resumen = await sincronizarClientes(db, tango, cfg)
  await db.doc('config/tango').set({
    clientesSync: { ultimaCorrida: FieldValue.serverTimestamp(), origen, uid: uid ?? null, duracionMs: Date.now() - inicio, resumen },
  }, { merge: true })
  logger.info(`[tango] clientes sincronizados (${origen}) en ${Date.now() - inicio}ms: ${JSON.stringify({ ...resumen, errores: resumen.errores.length })}`)
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

/** Todas las filas de deuda (vencidas + a vencer) de una empresa. */
async function filasDeuda(tango: TangoClient, cfg: ConfigSync, company: number): Promise<Record<string, unknown>[]> {
  const desde = cfg.saldos?.fromDate ?? FROM_DATE_DEFAULT
  const hastaDate = new Date()
  hastaDate.setFullYear(hastaDate.getFullYear() + 5)   // "a vencer" incluye vencimientos futuros
  const hasta = ddMMyyyy(hastaDate)
  const vencidas = cfg.saldos?.procesoDeudasVencidas ?? PROCESO_DEUDAS_VENCIDAS_DEFAULT
  const aVencer  = cfg.saldos?.procesoDeudasAVencer ?? PROCESO_DEUDAS_A_VENCER_DEFAULT
  const filas = await tango.live(company, vencidas, desde, hasta)
  filas.push(...await tango.live(company, aVencer, desde, hasta))
  return filas
}

export interface ResumenSaldos {
  filas: number
  clientesConDeuda: number
  lotes: number
  actualizados: number
  skippedNoMatch: number
  vaciados: number
}

export async function sincronizarSaldos(db: Firestore, tango: TangoClient, cfg: ConfigSync): Promise<ResumenSaldos> {
  const company = companyDe(cfg, 'redonhielo')
  const filas = await filasDeuda(tango, cfg, company)
  const porCliente = new Map<number, TangoSaldoRow>()
  for (const f of filas) {
    const idGva14 = prop(f, 'ID_GVA14')
    if (typeof idGva14 !== 'number') continue
    if (!porCliente.has(idGva14)) {
      const { codigo, nombre } = parseCliente(prop(f, 'CLIENTE'))
      porCliente.set(idGva14, { idGva14, codGva14: codigo || undefined, razonSocial: nombre || undefined, empresa: 'redonhielo', comprobantes: [] })
    }
    porCliente.get(idGva14)!.comprobantes.push(recortarComprobante(f))
  }
  const rows = [...porCliente.values()]
  // runId identifica la corrida completa: al llegar el último lote, todo doc
  // del cache que no fue tocado por este runId se vacía (cliente sin deuda).
  const runId = new Date().toISOString()
  const lotes = chunk(rows, 100)
  const resumen: ResumenSaldos = { filas: filas.length, clientesConDeuda: rows.length, lotes: 0, actualizados: 0, skippedNoMatch: 0, vaciados: 0 }
  if (lotes.length === 0) lotes.push([])   // nadie debe nada: igual hay que vaciar el cache viejo
  for (const [i, lote] of lotes.entries()) {
    const r = await procesarLoteSaldos(db, lote, { dryRun: false, runId, esUltimoLote: i === lotes.length - 1 })
    resumen.lotes++
    resumen.actualizados   += r.actualizados ?? 0
    resumen.skippedNoMatch += r.skippedNoMatch ?? 0
    resumen.vaciados       += r.vaciados ?? 0
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
      const empresa: 'redonhielo' | 'rolito' = data.empresa === 'rolito' ? 'rolito' : 'redonhielo'
      const idGva14 = Number(data.idGva14)
      if (!Number.isInteger(idGva14)) { await marcarError('idGva14 inválido'); return }
      const filas = (await filasDeuda(tango, cfg, companyDe(cfg, empresa))).filter((f) => prop(f, 'ID_GVA14') === idGva14)
      const comprobantes = filas.map(recortarComprobante)
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
