// Worker de tango-outbox en Cloud Functions: manda cada item a Tango por
// Tango Connect (HTTPS, internet) — reemplaza al bridge-listener de la VM
// para las entidades que ya tienen writer (remito → pedido, factura →
// Facturador). Ver docs/tango/INTEGRACION.md §16.
//
// Dos entradas, una sola máquina:
//   - onOutboxPendiente: dispara al escribirse un item en 'pendiente'
//     (creación o reposición a mano) y lo manda al toque.
//   - barridoOutboxTango: cada 5 min reintenta 'pendiente' (flag apagado
//     cuando se creó, o el trigger se perdió) y 'enviado' (fallaron — el
//     barrido ES el backoff, igual que en el bridge).
//
// Claim atómico: el item pasa pendiente/enviado → 'enviado' + intentos+1 en
// una transacción antes de tocar Tango, así el trigger y el barrido (o dos
// instancias) nunca lo mandan a la vez. Interruptores en config/tango:
//   workerCloud   (bool)  — sin esto la Function no toca nada (el bridge de la
//                           VM, si corre, sigue siendo el dueño de la cola)
//   remitosEnabled / facturasEnabled — por entidad, como siempre
//   companies { redonhielo, rolito } — número de empresa de la API
//   connectBaseUrl — opcional, default https://001174-003.connect.axoft.com

import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { defineSecret } from 'firebase-functions/params'
import { logger } from 'firebase-functions/v2'
import { getFirestore, FieldValue, type Firestore, type DocumentReference } from 'firebase-admin/firestore'
import { TangoClient } from '../services/tango/client'
import { enviarRemito, enviarFactura, type ConfigTango, type ResultadoWriter, type ContextoWriter } from '../services/tango/writers'
import type { PayloadVenta } from '../services/tango/pedido'

const tangoApiToken = defineSecret('TANGO_API_TOKEN')

const MAX_INTENTOS = 5
const CONNECT_BASE_URL_DEFAULT = 'https://001174-003.connect.axoft.com'
const TZ = 'America/Argentina/Buenos_Aires'

const HANDLERS: Record<string, { enviar: (p: PayloadVenta, ctx: ContextoWriter) => Promise<ResultadoWriter>; flag: string }> = {
  remito:  { enviar: enviarRemito,  flag: 'remitosEnabled' },
  factura: { enviar: enviarFactura, flag: 'facturasEnabled' },
}

interface ItemOutboxDoc {
  entidad: string
  empresa?: string
  origenColeccion: string
  origenId: string
  payload: PayloadVenta
  estado: string
  intentos?: number
  conCaePropio?: boolean
}

async function leerConfig(db: Firestore): Promise<ConfigTango> {
  return ((await db.doc('config/tango').get()).data() ?? {}) as ConfigTango
}

/**
 * Procesa un item. Devuelve qué pasó para el log. Nunca tira: todo error
 * queda escrito en el item (ultimoError) y se reintenta por el barrido.
 */
async function procesarItem(db: Firestore, ref: DocumentReference, cfg: ConfigTango, tango: TangoClient): Promise<string> {
  // 1. Claim atómico.
  const claim = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const d = snap.data() as ItemOutboxDoc | undefined
    if (!d) return { skip: 'no existe' }
    if (d.estado !== 'pendiente' && d.estado !== 'enviado') return { skip: `estado ${d.estado}` }
    const handler = HANDLERS[d.entidad]
    if (!handler) return { skip: `entidad ${d.entidad} sin writer en el worker (queda para el bridge)` }
    if ((cfg as Record<string, unknown>)[handler.flag] !== true) return { skip: `config/tango.${handler.flag} apagado` }
    const company = cfg.companies?.[d.empresa ?? '']
    if (!Number.isInteger(company)) {
      tx.update(ref, { ultimoError: `config/tango.companies no tiene un número para "${d.empresa}"`, actualizadoEn: FieldValue.serverTimestamp() })
      return { skip: `sin company para ${d.empresa}` }
    }
    const intentos = (d.intentos ?? 0) + 1
    tx.update(ref, { estado: 'enviado', intentos, worker: 'cloud', actualizadoEn: FieldValue.serverTimestamp() })
    return { d, handler, company: company as number, intentos }
  })
  if ('skip' in claim) return `${ref.id}: ${claim.skip}`

  const { d, handler, company, intentos } = claim
  const ctx: ContextoWriter = {
    tango, cfg, company,
    item: { origenColeccion: d.origenColeccion, origenId: d.origenId, empresa: d.empresa, conCaePropio: d.conCaePropio },
    log: (m) => logger.info(`[tango] ${m}`),
  }
  const resultado = await handler.enviar(d.payload, ctx)

  if (resultado.ok) {
    await ref.update({ estado: 'confirmado', ultimoError: null, resultado: resultado.resultado, actualizadoEn: FieldValue.serverTimestamp() })
    return `${ref.id}: confirmado en Tango`
  }
  const estadoFinal = intentos >= MAX_INTENTOS ? 'error' : 'enviado'
  await ref.update({ estado: estadoFinal, ultimoError: resultado.error, actualizadoEn: FieldValue.serverTimestamp() })
  return `${ref.id}: falló (intento ${intentos}/${MAX_INTENTOS}) — ${resultado.error}`
}

function clienteTango(cfg: ConfigTango): TangoClient {
  return new TangoClient({ baseUrl: (cfg.connectBaseUrl as string | undefined) ?? CONNECT_BASE_URL_DEFAULT, token: tangoApiToken.value() })
}

export const onOutboxPendiente = onDocumentWritten(
  { document: 'tango-outbox/{itemId}', secrets: [tangoApiToken], timeoutSeconds: 120 },
  async (event) => {
    const despues = event.data?.after
    if (!despues?.exists) return
    const d = despues.data() as ItemOutboxDoc
    if (d.estado !== 'pendiente') return
    if (!HANDLERS[d.entidad]) return
    const db = getFirestore()
    const cfg = await leerConfig(db)
    if (cfg.workerCloud !== true) return
    const msg = await procesarItem(db, despues.ref, cfg, clienteTango(cfg))
    logger.info(`[tango] ${msg}`)
  },
)

export const barridoOutboxTango = onSchedule(
  { schedule: 'every 5 minutes', timeZone: TZ, secrets: [tangoApiToken], timeoutSeconds: 300 },
  async () => {
    const db = getFirestore()
    const cfg = await leerConfig(db)
    if (cfg.workerCloud !== true) return
    const tango = clienteTango(cfg)
    const snap = await db.collection('tango-outbox')
      .where('estado', 'in', ['pendiente', 'enviado'])
      .where('entidad', 'in', Object.keys(HANDLERS))
      .limit(50)
      .get()
    if (snap.empty) return
    logger.info(`[tango] barrido: ${snap.size} item(s) a (re)intentar`)
    for (const doc of snap.docs) {
      try {
        logger.info(`[tango] ${await procesarItem(db, doc.ref, cfg, tango)}`)
      } catch (e) {
        logger.error(`[tango] ${doc.id}: error inesperado — ${(e as Error).message}`)
      }
    }
  },
)
