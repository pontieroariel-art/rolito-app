import { onRequest } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const tangoBridgeSecret = defineSecret('TANGO_BRIDGE_SECRET')

// Mismo criterio que syncClientesTango: el bridge manda lotes chicos, esto solo
// acota costo/DoS si el secret se filtrara.
const MAX_ROWS_POR_LOTE = 2000

// Fila tal como la arma scripts/tango/bridge-sync-saldos.mjs a partir de la
// composición de saldos de Tango (consulta Live / vista AXV_* — process a
// relevar, ver docs/tango/INTEGRACION.md). Un row = un cliente con sus
// comprobantes pendientes de cobro.
interface ComprobanteSaldoRow {
  tipo:               string
  numero:             string
  fechaEmision?:      string
  fechaVencimiento?:  string
  importeOriginal?:   number
  saldoPendiente:     number
  idComprobanteTango?: number
  diasAtraso?:        number
}

interface TangoSaldoRow {
  idGva14:      number
  codGva14?:    string
  razonSocial?: string
  empresa?:     'redonhielo' | 'rolito'
  comprobantes: ComprobanteSaldoRow[]
}

interface ResultadoSyncSaldos {
  succeeded: boolean
  dryRun: boolean
  reason?: string
  received?: number
  actualizados?: number
  skippedNoMatch?: number
  vaciados?: number
  wouldUpdate?: unknown[]
  // Solo en dryRun: quiénes son los deudores de Tango SIN cuenta en la app
  // (el sync de clientes no crea cuentas — estos quedan fuera del cache y los
  // supervisores no los ven; el listado sirve para decidir a quién dar de alta).
  sinMatch?: Array<{ idGva14: number; codigo: string; nombre: string; saldo: number }>
}

function redondear2(n: number): number {
  return Math.round(n * 100) / 100
}

function normalizarComprobante(c: ComprobanteSaldoRow) {
  return {
    tipo:               String(c.tipo ?? ''),
    numero:             String(c.numero ?? ''),
    fechaEmision:       c.fechaEmision ?? '',
    ...(c.fechaVencimiento ? { fechaVencimiento: c.fechaVencimiento } : {}),
    importeOriginal:    redondear2(Number(c.importeOriginal ?? c.saldoPendiente ?? 0)),
    saldoPendiente:     redondear2(Number(c.saldoPendiente ?? 0)),
    ...(typeof c.idComprobanteTango === 'number' ? { idComprobanteTango: c.idComprobanteTango } : {}),
    ...(typeof c.diasAtraso === 'number' && c.diasAtraso > 0 ? { diasAtraso: c.diasAtraso } : {}),
  }
}

// Cobranzas de supervisor que TODAVÍA no impactaron en Tango (tango.estado !=
// 'confirmado'): sus imputaciones se re-aplican como descuento sobre el
// snapshot que manda el bridge — si no, cada sync "resucitaría" deuda que ya
// se cobró en la calle pero que Tango aún no vio (writer stub / licencia
// pendiente). Cuando Tango confirme el recibo, su propia composición ya lo
// refleja y la cobranza confirmada deja de restarse. Acotado a 90 días: una
// cobranza que no llegó a Tango en 3 meses es un problema a resolver a mano,
// no a seguir descontando en silencio.
interface DescuentoCliente {
  porComprobante: Map<string, number>   // "tipo|numero" → Σ importeImputado (centavos)
  cobranzaIds:    string[]
}

async function descuentosPendientes(
  db: FirebaseFirestore.Firestore,
): Promise<Map<string, DescuentoCliente>> {
  const desde = new Date()
  desde.setDate(desde.getDate() - 90)
  const snap = await db.collection('cobranzas')
    .where('origen', '==', 'supervisor')
    .where('fecha', '>=', desde)
    .get()

  const porCliente = new Map<string, DescuentoCliente>()
  snap.forEach((docSnap) => {
    const c = docSnap.data()
    if (c.tango?.estado === 'confirmado') return
    if (!Array.isArray(c.imputaciones)) return
    if (!porCliente.has(c.clienteId)) {
      porCliente.set(c.clienteId, { porComprobante: new Map(), cobranzaIds: [] })
    }
    const d = porCliente.get(c.clienteId)!
    d.cobranzaIds.push(docSnap.id)
    for (const imp of c.imputaciones) {
      const clave = `${imp.comprobanteTipo}|${imp.comprobanteNumero}`
      const cent = Math.round(Number(imp.importeImputado ?? 0) * 100)
      d.porComprobante.set(clave, (d.porComprobante.get(clave) ?? 0) + cent)
    }
  })
  return porCliente
}

async function procesarLoteSaldos(
  db: FirebaseFirestore.Firestore,
  rows: TangoSaldoRow[],
  opts: { dryRun: boolean; runId: string | null; esUltimoLote: boolean },
): Promise<ResultadoSyncSaldos> {
  // Solo clientes ya vinculados a Tango (idGva14Tango lo puebla syncClientesTango).
  const usersSnap = await db.collection('users').where('rol', '==', 'cliente').get()
  const descuentos = await descuentosPendientes(db)
  const porIdGva14 = new Map<number, { uid: string; codigoTango?: string; razonSocial?: string; nombre?: string }>()
  usersSnap.forEach((docSnap) => {
    const data = docSnap.data()
    if (typeof data.idGva14Tango === 'number') {
      porIdGva14.set(data.idGva14Tango, {
        uid: docSnap.id,
        codigoTango: data.codigoTango,
        razonSocial: data.razonSocial,
        nombre: data.nombre,
      })
    }
  })

  let actualizados = 0
  let skippedNoMatch = 0
  let vaciados = 0
  const wouldUpdate: unknown[] = []
  const sinMatch: Array<{ idGva14: number; codigo: string; nombre: string; saldo: number }> = []

  let batch = db.batch()
  let enBatch = 0
  const flush = async () => {
    if (enBatch === 0) return
    if (!opts.dryRun) await batch.commit()
    batch = db.batch()
    enBatch = 0
  }

  for (const row of rows) {
    const user = porIdGva14.get(row.idGva14)
    if (!user) {
      // Cliente de Tango sin cuenta en la app — fuera de alcance del cache.
      skippedNoMatch++
      if (opts.dryRun && sinMatch.length < 300) {
        const saldo = redondear2((row.comprobantes ?? []).reduce((s, c) => s + Number(c.saldoPendiente ?? 0), 0))
        sinMatch.push({ idGva14: row.idGva14, codigo: row.codGva14 ?? '', nombre: row.razonSocial ?? '', saldo })
      }
      continue
    }

    let comprobantes = (row.comprobantes ?? []).map(normalizarComprobante)

    // Re-aplicar descuentos de cobranzas que Tango todavía no vio (ver
    // descuentosPendientes arriba).
    const descuento = descuentos.get(user.uid)
    if (descuento) {
      comprobantes = comprobantes
        .map((c) => {
          const cent = descuento.porComprobante.get(`${c.tipo}|${c.numero}`)
          if (!cent) return c
          const nuevoSaldo = Math.max(0, Math.round(c.saldoPendiente * 100) - cent) / 100
          return { ...c, saldoPendiente: nuevoSaldo }
        })
        .filter((c) => c.saldoPendiente > 0)
    }

    const saldoTotal = redondear2(comprobantes.reduce((s, c) => s + c.saldoPendiente, 0))
    const docData = {
      idGva14:       row.idGva14,
      codigoTango:   row.codGva14 ?? user.codigoTango ?? '',
      empresa:       row.empresa ?? 'redonhielo',
      razonSocial:   row.razonSocial ?? user.razonSocial ?? user.nombre ?? '',
      comprobantes,
      saldoTotal,
      // Deja constancia de qué cobranzas ya están descontadas en este cache —
      // onCobranzaCreada lo usa para no descontar dos veces.
      cobranzasAplicadas: descuento ? descuento.cobranzaIds : [],
      actualizadoEn: FieldValue.serverTimestamp(),
      origen:        'sync',
      ...(opts.runId ? { runId: opts.runId } : {}),
    }

    if (opts.dryRun) {
      if (wouldUpdate.length < 20) wouldUpdate.push({ uid: user.uid, saldoTotal, comprobantes: comprobantes.length })
      actualizados++
      continue
    }

    batch.set(db.collection('saldosTango').doc(user.uid), docData)
    actualizados++
    enBatch++
    if (enBatch >= 400) await flush()
  }

  await flush()

  // Cierre de corrida: el bridge manda el snapshot COMPLETO de la deuda en
  // lotes con el mismo runId; al llegar el último lote, todo doc del cache que
  // no fue tocado en esta corrida es un cliente que ya no debe nada → se vacía
  // (no se borra: conserva identidad y "actualizado hace X" en la UI).
  if (opts.esUltimoLote && opts.runId && !opts.dryRun) {
    const viejos = await db.collection('saldosTango').where('runId', '!=', opts.runId).get()
    let batchLimpieza = db.batch()
    let enLimpieza = 0
    for (const docSnap of viejos.docs) {
      batchLimpieza.update(docSnap.ref, {
        comprobantes:  [],
        saldoTotal:    0,
        actualizadoEn: FieldValue.serverTimestamp(),
        origen:        'sync',
        runId:         opts.runId,
      })
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
// (scripts/tango/bridge-sync-saldos.mjs) y actualiza el cache saldosTango/{uid}.
// Mismo patrón de autorización que syncClientesTango: bearer secret angosto.
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
      const resultado = await procesarLoteSaldos(db, rows, { dryRun, runId, esUltimoLote })
      res.status(200).json(resultado)
    } catch (err) {
      console.error('[syncSaldosTango] error procesando lote:', err)
      res.status(500).json({ succeeded: false, reason: err instanceof Error ? err.message : String(err) })
    }
  },
)
