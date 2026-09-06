import { onRequest } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { EMPRESAS, esEmpresa, tangoIdsDe, type Empresa } from '../services/tango/empresas'
import {
  aplicarDescuentos, descuentosDeCobranzas, fusionarRamaEmpresa, normalizarComprobante, redondear2, vaciarRamaEmpresa,
  type ComprobanteSaldo, type DescuentoCliente, type SaldoDoc,
} from '../services/tango/saldos'

const tangoBridgeSecret = defineSecret('TANGO_BRIDGE_SECRET')

// Mismo criterio que syncClientesTango: el bridge manda lotes chicos, esto solo
// acota costo/DoS si el secret se filtrara.
const MAX_ROWS_POR_LOTE = 2000

// Un row = un cliente (ID_GVA14 de UNA empresa) con sus comprobantes pendientes
// de cobro, tal como salen de las consultas Live de deudas (tangoConnectSync.ts).
export interface ComprobanteSaldoRow {
  tipo:               string
  numero:             string
  fechaEmision?:      string
  fechaVencimiento?:  string
  importeOriginal?:   number
  saldoPendiente:     number
  idComprobanteTango?: number
  diasAtraso?:        number
}

export interface TangoSaldoRow {
  idGva14:      number
  codGva14?:    string
  razonSocial?: string
  empresa?:     Empresa
  comprobantes: ComprobanteSaldoRow[]
}

export interface ResultadoSyncSaldos {
  succeeded: boolean
  dryRun: boolean
  reason?: string
  received?: number
  actualizados?: number
  skippedNoMatch?: number
  vaciados?: number
  wouldUpdate?: unknown[]
  // Solo en dryRun: quiénes son los deudores de Tango SIN cuenta en la app
  // (quedan fuera del cache y los supervisores no los ven).
  sinMatch?: Array<{ idGva14: number; codigo: string; nombre: string; saldo: number }>
}

// ── Índice de clientes vinculados, por empresa ───────────────────────────────
// idGva14 (de esa empresa) → cuenta de la app. Un uid puede aparecer varias
// veces (varios códigos de Tango con el mismo CUIT). Se arma UNA vez por
// corrida y se comparte entre lotes.
export interface ClienteIndexado {
  uid:          string
  codigo:       string
  codigoTango?: string     // principal (legacy, Redonhielo)
  idGva14Tango?: number    // principal (legacy, Redonhielo)
  razonSocial?: string
  nombre?:      string
}
export type IndiceClientesTango = Record<Empresa, Map<number, ClienteIndexado>>

export async function indiceClientesTango(db: FirebaseFirestore.Firestore): Promise<IndiceClientesTango> {
  const usersSnap = await db.collection('users').where('rol', '==', 'cliente').get()
  const indice = { redonhielo: new Map<number, ClienteIndexado>(), rolito: new Map<number, ClienteIndexado>() }
  usersSnap.forEach((docSnap) => {
    const data = docSnap.data()
    const ids = tangoIdsDe(data)
    for (const empresa of EMPRESAS) {
      for (const id of ids[empresa] ?? []) {
        indice[empresa].set(id.idGva14, {
          uid: docSnap.id, codigo: id.codigo, razonSocial: data.razonSocial, nombre: data.nombre,
          codigoTango: ids.redonhielo?.[0]?.codigo ?? data.codigoTango, idGva14Tango: ids.redonhielo?.[0]?.idGva14 ?? data.idGva14Tango,
        })
      }
    }
  })
  return indice
}

// Cobranzas completas de los últimos 90 días que Tango todavía no confirmó
// (ver descuentosDeCobranzas): se restan del snapshot para no resucitar deuda
// ya cobrada. Una cobranza que no llegó a Tango en 3 meses es un problema a
// resolver a mano, no a seguir descontando en silencio.
export async function descuentosPendientes(db: FirebaseFirestore.Firestore): Promise<Map<string, DescuentoCliente>> {
  const desde = new Date()
  desde.setDate(desde.getDate() - 90)
  const snap = await db.collection('cobranzas').where('fecha', '>=', desde).get()
  return descuentosDeCobranzas(snap.docs.map((d) => ({ id: d.id, ...(d.data() as { clienteId: string; empresa?: unknown; imputaciones?: unknown; tango?: { estado?: unknown } | null }) })))
}

/**
 * Escribe en el cache los comprobantes de `opts.empresa` de los clientes de
 * `rows` (el resto del doc — la otra empresa — queda como está). Con
 * `esUltimoLote` vacía la rama de esa empresa en los docs que no tocó esta
 * corrida (runId): son clientes que ya no deben nada ahí.
 */
export async function procesarLoteSaldos(
  db: FirebaseFirestore.Firestore,
  rows: TangoSaldoRow[],
  opts: { dryRun: boolean; runId: string | null; esUltimoLote: boolean; empresa?: Empresa; indice?: IndiceClientesTango; descuentos?: Map<string, DescuentoCliente> },
): Promise<ResultadoSyncSaldos> {
  const empresa: Empresa = opts.empresa ?? (esEmpresa(rows[0]?.empresa) ? rows[0].empresa as Empresa : 'redonhielo')
  const indice = (opts.indice ?? await indiceClientesTango(db))[empresa]
  const descuentos = opts.descuentos ?? await descuentosPendientes(db)

  let actualizados = 0
  let skippedNoMatch = 0
  let vaciados = 0
  const wouldUpdate: unknown[] = []
  const sinMatch: Array<{ idGva14: number; codigo: string; nombre: string; saldo: number }> = []

  // Varios ID_GVA14 (códigos) pueden ser la misma cuenta: se juntan por uid.
  const porUid = new Map<string, { cliente: ClienteIndexado; comprobantes: ComprobanteSaldo[] }>()
  for (const row of rows) {
    const cliente = indice.get(row.idGva14)
    if (!cliente) {
      skippedNoMatch++
      if (opts.dryRun && sinMatch.length < 300) {
        const saldo = redondear2((row.comprobantes ?? []).reduce((s, c) => s + Number(c.saldoPendiente ?? 0), 0))
        sinMatch.push({ idGva14: row.idGva14, codigo: row.codGva14 ?? '', nombre: row.razonSocial ?? '', saldo })
      }
      continue
    }
    const codigo = row.codGva14 || cliente.codigo
    const comprobantes = (row.comprobantes ?? []).map((c) => normalizarComprobante(c, empresa, codigo))
    if (!porUid.has(cliente.uid)) porUid.set(cliente.uid, { cliente, comprobantes: [] })
    porUid.get(cliente.uid)!.comprobantes.push(...comprobantes)
  }

  const uids = [...porUid.keys()]
  const refs = uids.map((uid) => db.collection('saldosTango').doc(uid))
  const actuales = new Map<string, Partial<SaldoDoc> | undefined>()
  if (refs.length && !opts.dryRun) {
    for (let i = 0; i < refs.length; i += 300) {
      const snaps = await db.getAll(...refs.slice(i, i + 300))
      for (const s of snaps) actuales.set(s.id, s.exists ? (s.data() as Partial<SaldoDoc>) : undefined)
    }
  }

  let batch = db.batch()
  let enBatch = 0
  const flush = async () => {
    if (enBatch === 0) return
    if (!opts.dryRun) await batch.commit()
    batch = db.batch()
    enBatch = 0
  }

  for (const [uid, { cliente, comprobantes: crudos }] of porUid) {
    const descuento = descuentos.get(uid)
    const comprobantes = aplicarDescuentos(crudos, descuento)
    const actual = actuales.get(uid)
    const nuevo = fusionarRamaEmpresa(
      actual, empresa, comprobantes,
      { runId: opts.runId, origen: 'sync', ahora: FieldValue.serverTimestamp() },
      {
        // Identidad "principal" del doc (legacy): la de Redonhielo si la hay.
        idGva14:     cliente.idGva14Tango ?? actual?.idGva14 ?? 0,
        codigoTango: cliente.codigoTango ?? actual?.codigoTango ?? cliente.codigo,
        razonSocial: actual?.razonSocial || cliente.razonSocial || cliente.nombre || '',
      },
      descuento ? descuento.cobranzaIds : [],
    )

    if (opts.dryRun) {
      if (wouldUpdate.length < 20) wouldUpdate.push({ uid, empresa, saldoEmpresa: nuevo.porEmpresa[empresa]?.saldoTotal, comprobantes: comprobantes.length })
      actualizados++
      continue
    }
    batch.set(refs[uids.indexOf(uid)], { ...nuevo, actualizadoEn: FieldValue.serverTimestamp() })
    actualizados++
    enBatch++
    if (enBatch >= 400) await flush()
  }
  await flush()

  // Cierre de corrida: todo doc cuya rama de ESTA empresa no fue tocada por
  // este runId es un cliente que ya no debe nada ahí → se vacía solo esa rama
  // (no se borra: conserva la otra empresa, la identidad y el "actualizado hace X").
  if (opts.esUltimoLote && opts.runId && !opts.dryRun) {
    const runId = opts.runId
    const viejos = await db.collection('saldosTango').where(`porEmpresa.${empresa}.runId`, '!=', runId).get()
    const aVaciar = new Map(viejos.docs.map((d) => [d.id, d]))
    if (empresa === 'redonhielo') {
      // Docs anteriores al formato por empresa (sin porEmpresa): eran solo de Redonhielo.
      const legacy = await db.collection('saldosTango').where('runId', '!=', runId).get()
      for (const d of legacy.docs) if (!d.data().porEmpresa) aVaciar.set(d.id, d)
    }
    let batchLimpieza = db.batch()
    let enLimpieza = 0
    for (const docSnap of aVaciar.values()) {
      const vacio = vaciarRamaEmpresa(docSnap.data() as Partial<SaldoDoc>, empresa, runId, FieldValue.serverTimestamp())
      batchLimpieza.set(docSnap.ref, { ...vacio, actualizadoEn: FieldValue.serverTimestamp() })
      vaciados++
      enLimpieza++
      if (enLimpieza >= 400) {
        await batchLimpieza.commit()
        batchLimpieza = db.batch()
        enLimpieza = 0
      }
    }
    if (enLimpieza > 0) await batchLimpieza.commit()
  }

  return {
    succeeded: true,
    dryRun: opts.dryRun,
    received: rows.length,
    actualizados,
    skippedNoMatch,
    vaciados,
    ...(opts.dryRun ? { wouldUpdate, sinMatch } : {}),
  }
}

// Recibe la composición de saldos de los clientes desde el script del bridge
// (scripts/tango/bridge-sync-saldos.mjs — reemplazado por syncSaldosTangoConnect
// el 2026-09-03; queda por compatibilidad). Bearer secret angosto.
export const syncSaldosTango = onRequest(
  { secrets: [tangoBridgeSecret], invoker: 'public' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ succeeded: false, reason: 'method not allowed' })
      return
    }

    const authHeader = req.headers.authorization ?? ''
    if (authHeader !== `Bearer ${tangoBridgeSecret.value()}`) {
      res.status(401).json({ succeeded: false, reason: 'unauthorized' })
      return
    }

    const db = getFirestore()
    const dryRun = req.body?.dryRun === true

    if (!dryRun) {
      const cfgSnap = await db.doc('config/tango').get()
      const cfg = cfgSnap.data()
      if (cfg?.enabled !== true || cfg?.saldosEnabled !== true) {
        res.status(200).json({ succeeded: false, dryRun, reason: 'sync de saldos deshabilitado via config/tango (enabled + saldosEnabled)' })
        return
      }
    }

    const rows = req.body?.rows as TangoSaldoRow[] | undefined
    if (!Array.isArray(rows)) {
      res.status(400).json({ succeeded: false, reason: 'rows[] requerido' })
      return
    }
    if (rows.length > MAX_ROWS_POR_LOTE) {
      res.status(413).json({ succeeded: false, reason: `demasiadas filas (${rows.length} > ${MAX_ROWS_POR_LOTE}); enviá lotes más chicos` })
      return
    }

    const runId = typeof req.body?.runId === 'string' ? req.body.runId : null
    const esUltimoLote = req.body?.esUltimoLote === true

    try {
      const resultado = await procesarLoteSaldos(db, rows, { dryRun, runId, esUltimoLote, empresa: 'redonhielo' })
      res.status(200).json(resultado)
    } catch (err) {
      console.error('[syncSaldosTango] error procesando lote:', err)
      res.status(500).json({ succeeded: false, reason: err instanceof Error ? err.message : String(err) })
    }
  },
)
