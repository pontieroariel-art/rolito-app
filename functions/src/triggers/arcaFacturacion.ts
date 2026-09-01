/**
 * Facturación electrónica de las ventas de contado del camión.
 *
 * Acá vive el pegamento: leer la venta y el cliente, resolver la percepción de
 * IIBB, armar el puerto hacia ARCA y delegar en `facturarVenta`, que es quien
 * garantiza que una venta produzca a lo sumo una factura.
 *
 * Toda la lógica con reglas propias (fiscal, numeración, idempotencia) vive en
 * `services/arca/` y está testeada sin red. Este archivo es deliberadamente
 * flaco: si crece, algo se está poniendo en el lugar equivocado.
 *
 * Ver docs/arca/FACTURACION_ELECTRONICA.md.
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { defineSecret } from 'firebase-functions/params'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'

import { leerConfigParaEmitir, type ConfigArca } from '../services/arca/configuracion'
import { obtenerTicketAcceso } from '../services/arca/ticketCache'
import { feCaeSolicitar, feCompConsultar, type ConfigWsfev1 } from '../services/arca/wsfev1'
import type { PuertoArca } from '../services/arca/emision'
import { resolverIncierto } from '../services/arca/emision'
import { facturarVenta, rutaFactura, type RegistroFactura } from '../services/arca/facturacionVenta'
import type { ItemFacturable, PercepcionIIBB } from '../services/arca/comprobante'
import type { DbLike } from '../services/arca/numeracion'

const TZ = 'America/Argentina/Buenos_Aires'

// El certificado y su clave viven en secrets, nunca en el repo ni en Firestore:
// con ellos se puede emitir comprobantes en nombre de la empresa.
const arcaCert = defineSecret('ARCA_CERT_PEM')
const arcaKey = defineSecret('ARCA_KEY_PEM')

/** Firestore real, con la forma mínima que esperan los servicios. */
function comoDb(db: Firestore): DbLike {
  return {
    doc: (path: string) => db.doc(path),
    runTransaction: (fn) => db.runTransaction(fn as never) as never,
  } as DbLike
}

/** Arma el puerto hacia ARCA: autentica (con cache) y expone las dos operaciones. */
async function puertoArca(db: Firestore, config: ConfigArca): Promise<PuertoArca> {
  const ta = await obtenerTicketAcceso({
    db: comoDb(db),
    cuit: config.cuit,
    ambiente: config.ambiente,
    certificadoPem: arcaCert.value(),
    clavePrivadaPem: arcaKey.value(),
  })

  const cfg: ConfigWsfev1 = {
    ambiente: config.ambiente,
    credenciales: { token: ta.token, sign: ta.sign, cuit: config.cuit },
  }

  return {
    solicitarCae: (ptoVta, cbteTipo, detalle) => feCaeSolicitar(cfg, ptoVta, cbteTipo, detalle),
    consultarComprobante: (ptoVta, cbteTipo, numero) => feCompConsultar(cfg, ptoVta, cbteTipo, numero),
  }
}

/**
 * Percepción de IIBB del cliente.
 *
 * Se espera en `users/{uid}.percepcionIIBB` con la alícuota del padrón de AGIP y
 * su período de vigencia. Devuelve undefined si el cliente no está en el padrón:
 * eso significa "no corresponde percibirle", no "faltan datos".
 *
 * OJO: quien complete este campo (el sync desde Tango) **tiene que escribir la
 * vigencia**. Sin vigencia no se puede distinguir una alícuota del mes en curso
 * de una del mes pasado, y usar la vieja factura mal sin que nada falle.
 */
function percepcionDe(perfil: Record<string, unknown>, config: ConfigArca): PercepcionIIBB | undefined {
  const p = perfil.percepcionIIBB as Record<string, unknown> | undefined
  if (!p) return undefined

  const alicuota = Number(p.alicuota)
  if (!Number.isFinite(alicuota) || alicuota <= 0) return undefined

  const desde = (p.vigenciaDesde as { toDate?: () => Date } | undefined)?.toDate?.()
  const hasta = (p.vigenciaHasta as { toDate?: () => Date } | undefined)?.toDate?.()
  if (!desde || !hasta) {
    throw new Error(
      'El cliente tiene alícuota de percepción de IIBB pero sin período de vigencia. ' +
      'No se puede saber si el padrón está al día, así que no se factura.',
    )
  }

  return {
    alicuota,
    tributoId: config.tributoIdPercepcionIIBB,
    descripcion: 'Percepción IIBB CABA',
    vigenciaDesde: desde,
    vigenciaHasta: hasta,
  }
}

function itemsDe(venta: Record<string, unknown>): ItemFacturable[] {
  const items = (venta.items ?? []) as Array<Record<string, unknown>>
  return items.map((i) => ({
    descripcion: String(i.nombre ?? ''),
    cantidad: Number(i.cantidad),
    precioUnitario: Number(i.precioUnitario),
  }))
}

/** Guarda el estado de la factura y lo refleja en la venta. */
async function persistir(db: Firestore, registro: RegistroFactura): Promise<void> {
  const batch = db.batch()
  batch.set(
    db.doc(rutaFactura(registro.ventaId)),
    { ...registro, actualizadoEn: FieldValue.serverTimestamp() },
    { merge: true },
  )
  // Espejo en la venta, para que la pantalla del chofer y los listados no
  // tengan que hacer un join.
  batch.set(
    db.doc(`ventasCamion/${registro.ventaId}`),
    {
      factura: {
        estado: registro.estado,
        numero: registro.numero,
        puntoVenta: registro.puntoVenta,
        cae: registro.cae ?? null,
        caeFchVto: registro.caeFchVto ?? null,
      },
    },
    { merge: true },
  )
  await batch.commit()
}

/**
 * Factura una venta ya conocida. Compartido por el trigger y la reconciliación.
 */
async function facturar(db: Firestore, ventaId: string): Promise<RegistroFactura | null> {
  const config = await leerConfigParaEmitir(comoDb(db))

  const ventaSnap = await db.doc(`ventasCamion/${ventaId}`).get()
  const venta = ventaSnap.data()
  if (!venta) return null
  if (venta.canal !== 'contado') return null   // Promo no se factura

  const clienteId = String(venta.clienteId ?? '')
  const perfil = clienteId ? (await db.doc(`users/${clienteId}`).get()).data() : undefined
  if (!perfil) throw new Error(`La venta ${ventaId} no tiene un cliente resoluble`)

  const arca = await puertoArca(db, config)

  return facturarVenta({
    db: comoDb(db),
    arca,
    config,
    ventaId,
    datos: {
      receptor: {
        razonSocial: String(perfil.razonSocial ?? ''),
        cuit: String(perfil.cuit ?? ''),
        categoriaIvaTango: String(perfil.categoriaIvaTango ?? ''),
      },
      items: itemsDe(venta),
      fechaVenta: (venta.fecha as { toDate?: () => Date } | undefined)?.toDate?.() ?? new Date(),
    },
    percepcionIIBB: percepcionDe(perfil, config),
    leer: async () => (await db.doc(rutaFactura(ventaId)).get()).data(),
    guardar: async (r) => { await persistir(db, r) },
  })
}

/**
 * Venta de contado nueva → factura electrónica.
 *
 * Los errores se registran pero NO se relanzan: si se relanzaran, Cloud
 * Functions reintentaría el trigger, y cada reintento pasaría otra vez por
 * `facturarVenta`. Eso es seguro (está diseñado para ser idempotente) pero
 * inútil si la causa es permanente — un cliente sin CUIT no se arregla
 * reintentando. Lo que sí reintenta es la reconciliación, que corre con
 * criterio.
 */
export const onVentaContadoFacturar = onDocumentCreated(
  { document: 'ventasCamion/{ventaId}', secrets: [arcaCert, arcaKey] },
  async (event) => {
    const venta = event.data?.data()
    if (!venta || venta.canal !== 'contado') return

    const db = getFirestore()
    const ventaId = event.params.ventaId

    try {
      await facturar(db, ventaId)
    } catch (e) {
      const motivo = (e as Error).message
      console.error(`[arca] no se pudo facturar la venta ${ventaId}: ${motivo}`)
      await db.doc(rutaFactura(ventaId)).set(
        { ventaId, estado: 'pendiente', motivo, actualizadoEn: FieldValue.serverTimestamp() },
        { merge: true },
      )
    }
  },
)

/**
 * Reconciliación: resuelve lo que quedó a medias.
 *
 * Dos casos distintos:
 *
 *   `incierta`  → se pidió el CAE y no sabemos si salió. Solo se puede
 *                 preguntar (`resolverIncierto`); nunca reintentar la emisión.
 *   `pendiente` → ni siquiera se llegó a intentar (faltaba configuración, el
 *                 cliente no era facturable, ARCA estaba caído). Acá sí se
 *                 reintenta de cero.
 *
 * Corre seguido porque una factura sin resolver bloquea la ventana de 5 días de
 * ARCA: pasada esa ventana la venta ya no se puede facturar con su fecha real.
 */
export const reconciliarFacturasArca = onSchedule(
  { schedule: '15 * * * *', timeZone: TZ, secrets: [arcaCert, arcaKey] },
  async () => {
    const db = getFirestore()

    const pendientes = await db
      .collection('facturasArca')
      .where('estado', 'in', ['incierta', 'pendiente'])
      .limit(50)
      .get()

    if (pendientes.empty) return

    let config: ConfigArca
    try {
      config = await leerConfigParaEmitir(comoDb(db))
    } catch (e) {
      console.error(`[arca] reconciliación sin configuración utilizable: ${(e as Error).message}`)
      return
    }

    const arca = await puertoArca(db, config)

    for (const docSnap of pendientes.docs) {
      const f = docSnap.data()
      const ventaId = docSnap.id

      try {
        if (f.estado === 'incierta' && typeof f.numero === 'number' && typeof f.cbteTipo === 'number') {
          const r = await resolverIncierto(comoDb(db), arca, config.puntoVenta, f.cbteTipo, f.numero)
          await persistir(db, {
            ventaId,
            estado: r.estado === 'emitido' ? 'emitida' : 'rechazada',
            puntoVenta: config.puntoVenta,
            cbteTipo: r.cbteTipo,
            numero: r.numero,
            cae: r.estado === 'emitido' ? r.cae : null,
            caeFchVto: r.estado === 'emitido' ? r.caeFchVto : null,
            motivo: r.estado === 'rechazado' ? r.motivo : null,
          })
        } else {
          await facturar(db, ventaId)
        }
      } catch (e) {
        // Un fallo acá no debe frenar al resto de la tanda.
        console.error(`[arca] reconciliación de ${ventaId} falló: ${(e as Error).message}`)
      }
    }
  },
)
