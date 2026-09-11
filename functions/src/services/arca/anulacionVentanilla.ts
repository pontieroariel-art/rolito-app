/**
 * Anulación de una factura de ventanilla con nota de crédito (2026-09-09).
 *
 * El circuito: el cajero crea `anulacionesVentanilla/{ventaId}` (pendiente),
 * un usuario con `autorizaAnulaciones` la aprueba o rechaza desde la app, y
 * acá el server emite la NC en ARCA y la refleja en tres lugares: el registro
 * `facturasArca/nc_{ventaId}` (idempotencia + reconciliación), la solicitud
 * (`estado`, `notaCredito`, `ultimoError`) y la venta (`anulacion`, que es lo
 * que miran "Mi día", el cierre de caja y tesorería para dejar de contarla).
 *
 * Lo puro (`transicionAnulacion`) está separado para testearlo sin Firestore.
 */

import { FieldValue } from 'firebase-admin/firestore'
import type { Firestore, Timestamp } from 'firebase-admin/firestore'

import { leerConfigParaEmitir } from './configuracion'
import { comoDb, puertoArca } from './puertoFirebase'
import { documentoDeVenta } from './circuito'
import type { CbteAsoc, FacturaOrigen, FECAEDetRequest } from './comprobante'
import type { ImportesInformados } from './emision'
import { rutaFactura, rutaNotaCredito, type RegistroFactura } from './facturacionVenta'
import { emitirNotaCreditoTotal } from './notaCredito'
import { receptorDeVenta } from './receptorDeVenta'

export type EstadoAnulacion = 'pendiente' | 'aprobada' | 'rechazada' | 'emitida' | 'error'

export interface NotaCreditoVenta {
  estado: 'emitida' | 'rechazada' | 'incierta'
  cbteTipo: number
  puntoVenta: number
  numero: number
  cae: string | null
  caeFchVto: string | null
  importes?: ImportesInformados
  cbtesAsoc: CbteAsoc[]
}

/**
 * Nota de crédito INTERNA (2026-09-11): anula una factura X de promo. No pasa
 * por ARCA (la promo no se factura); lleva número propio del contador
 * `config/numeracionInterna_notaCreditoX` y en Tango entra como NC de Rolito
 * por el Facturador, referenciando a la factura que Tango ya registró.
 */
export interface NotaCreditoInterna {
  tipo: 'notaCreditoX'
  puntoVenta: number
  numero: number
  /** yyyy-MM-dd (día argentino) de emisión. */
  fecha: string
}

export type ResultadoEmisionNc = RegistroFactura | { estado: 'emitida'; interna: true; puntoVenta: number; numero: number }

export interface AnulacionVentanilla {
  ventaId: string
  coleccion?: string
  /** Pedida por facturación sobre una venta de un día ya cerrado (2026-09-11). */
  origen?: 'facturacion'
  clienteId?: string
  notaCreditoInterna?: NotaCreditoInterna
  estado: EstadoAnulacion
  motivo: string
  nota?: string
  solicitadoPor: { uid: string; nombre: string }
  solicitadaEn?: Timestamp
  resueltaPor?: { uid: string; nombre: string } | null
  resueltaEn?: Timestamp
  notaResolucion?: string
  notaCredito?: NotaCreditoVenta
  ultimoError?: string | null
}

export const rutaAnulacion = (ventaId: string) => `anulacionesVentanilla/${ventaId}`

/**
 * Colección de la venta anulada (2026-09-11): la factura de ventanilla o la
 * del camión (pedida por caja desde la liquidación abierta). La solicitud lo
 * dice en `coleccion`; sin el campo (solicitudes viejas) es ventanilla.
 */
export type ColeccionAnulable = 'ventasVentanilla' | 'ventasCamion'
export const coleccionDeAnulacion = (a: { coleccion?: unknown } | undefined): ColeccionAnulable =>
  a?.coleccion === 'ventasCamion' ? 'ventasCamion' : 'ventasVentanilla'

export type TransicionAnulacion = 'emitir' | 'rechazar' | 'resolicitar' | null

/**
 * Qué hacer ante un cambio de la solicitud. Pura.
 *
 *   pendiente → aprobada   emitir la NC
 *   error     → aprobada   volver a intentar (re-aprobación después de un error)
 *   pendiente → rechazada  reflejar el rechazo y avisar al cajero
 *   rechazada → pendiente  el cajero volvió a pedir: avisar de nuevo
 *   todo lo demás (incluidas las escrituras del propio server) → nada
 */
export function transicionAnulacion(
  antes: { estado?: unknown } | undefined,
  despues: { estado?: unknown } | undefined,
): TransicionAnulacion {
  const a = antes?.estado
  const d = despues?.estado
  if (a === d) return null
  if (d === 'aprobada' && (a === 'pendiente' || a === 'error')) return 'emitir'
  if (d === 'rechazada' && a === 'pendiente') return 'rechazar'
  if (d === 'pendiente' && a === 'rechazada') return 'resolicitar'
  return null
}

/** Refleja el resultado de la NC en el registro, la solicitud y la venta (un solo batch). */
export async function persistirNotaCredito(db: Firestore, registro: RegistroFactura, coleccion: ColeccionAnulable = 'ventasVentanilla'): Promise<void> {
  const ventaId = registro.ventaId
  const nc: NotaCreditoVenta = {
    estado: registro.estado,
    cbteTipo: registro.cbteTipo,
    puntoVenta: registro.puntoVenta,
    numero: registro.numero,
    cae: registro.cae ?? null,
    caeFchVto: registro.caeFchVto ?? null,
    ...(registro.importes ? { importes: registro.importes } : {}),
    cbtesAsoc: registro.cbtesAsoc ?? [],
  }

  const batch = db.batch()
  batch.set(
    db.doc(rutaNotaCredito(ventaId)),
    {
      ...registro,
      tipo: 'nota_credito',
      coleccion,
      actualizadoEn: FieldValue.serverTimestamp(),
      ...(registro.estado === 'rechazada' ? { avisadoEn: null } : {}),
    },
    { merge: true },
  )

  if (registro.estado === 'emitida') {
    batch.set(db.doc(rutaAnulacion(ventaId)), {
      estado: 'emitida', notaCredito: nc, ultimoError: null, actualizadoEn: FieldValue.serverTimestamp(),
    }, { merge: true })
    batch.set(db.doc(`${coleccion}/${ventaId}`), {
      anulacion: { estado: 'anulada', solicitudId: ventaId, notaCredito: nc },
    }, { merge: true })
  } else if (registro.estado === 'incierta') {
    // Número reservado, ARCA no contestó: la solicitud sigue 'aprobada' hasta
    // que la reconciliación averigüe qué pasó. La venta no se anula todavía.
    batch.set(db.doc(rutaAnulacion(ventaId)), {
      notaCredito: nc, ultimoError: registro.motivo ?? null, actualizadoEn: FieldValue.serverTimestamp(),
    }, { merge: true })
    batch.set(db.doc(`${coleccion}/${ventaId}`), {
      anulacion: { estado: 'aprobada', solicitudId: ventaId },
    }, { merge: true })
  } else {
    batch.set(db.doc(rutaAnulacion(ventaId)), {
      estado: 'error', notaCredito: nc, ultimoError: registro.motivo ?? 'ARCA rechazó la nota de crédito',
      actualizadoEn: FieldValue.serverTimestamp(),
    }, { merge: true })
    batch.set(db.doc(`${coleccion}/${ventaId}`), {
      anulacion: { estado: 'error', solicitudId: ventaId },
    }, { merge: true })
  }
  await batch.commit()
}

/** La solicitud quedó en error antes de llegar a ARCA (sin número): que la reconciliación reintente. */
export async function registrarErrorPrevio(db: Firestore, ventaId: string, motivo: string, coleccion: ColeccionAnulable = 'ventasVentanilla'): Promise<void> {
  const batch = db.batch()
  batch.set(db.doc(rutaNotaCredito(ventaId)), {
    ventaId, anulacionId: ventaId, tipo: 'nota_credito', coleccion,
    estado: 'pendiente', motivo, actualizadoEn: FieldValue.serverTimestamp(),
  }, { merge: true })
  batch.set(db.doc(rutaAnulacion(ventaId)), { ultimoError: motivo, actualizadoEn: FieldValue.serverTimestamp() }, { merge: true })
  await batch.commit()
}

/** El autorizante rechazó: la venta vuelve a contar y el cajero puede volver a pedir. */
export async function reflejarRechazoEnVenta(db: Firestore, ventaId: string, coleccion: ColeccionAnulable = 'ventasVentanilla'): Promise<void> {
  await db.doc(`${coleccion}/${ventaId}`).set(
    { anulacion: { estado: 'rechazada', solicitudId: ventaId } },
    { merge: true },
  )
}

/**
 * Emite (o retoma) la nota de crédito de una anulación aprobada.
 *
 * Devuelve null si no corresponde (la solicitud no está aprobada, la venta no
 * la factura la app o ya no existe). Si la factura original no está emitida
 * (incierta/rechazada) deja la solicitud en `error` con el motivo y devuelve
 * null: primero hay que resolver la factura (la reconciliación lo hace) y
 * después volver a aprobar. Los errores previos a la reserva de número se
 * relanzan: el que llama decide si deja el registro 'pendiente'.
 */
export async function emitirNotaCreditoDeAnulacion(db: Firestore, ventaId: string): Promise<ResultadoEmisionNc | null> {
  const anulacion = (await db.doc(rutaAnulacion(ventaId)).get()).data() as AnulacionVentanilla | undefined
  if (!anulacion || anulacion.estado !== 'aprobada') return null

  const coleccion = coleccionDeAnulacion(anulacion)
  const venta = (await db.doc(`${coleccion}/${ventaId}`).get()).data()
  if (!venta) return null
  const documento = documentoDeVenta(venta.canal, venta.formaPago, venta.total)
  // Promo (factura X, sin ARCA): nota de crédito interna numerada por la app (2026-09-11).
  if (documento === 'no_oficial') return emitirNotaCreditoInterna(db, ventaId, coleccion, venta)
  if (documento !== 'factura_arca') return null

  const espejo = venta.factura as { estado?: string; cae?: string | null; cbteTipo?: number; puntoVenta?: number; numero?: number; importes?: ImportesInformados } | undefined
  if (!espejo || espejo.estado !== 'emitida' || !espejo.cae) {
    const motivo = `La factura original no está emitida (estado ${espejo?.estado ?? 'sin factura'}); resolvela antes de anular`
    await db.doc(rutaAnulacion(ventaId)).set(
      { estado: 'error', ultimoError: motivo, actualizadoEn: FieldValue.serverTimestamp() },
      { merge: true },
    )
    await db.doc(`${coleccion}/${ventaId}`).set({ anulacion: { estado: 'error', solicitudId: ventaId } }, { merge: true })
    return null
  }

  const registroFactura = (await db.doc(rutaFactura(ventaId)).get()).data()
  const importes = (registroFactura?.importes ?? espejo.importes) as ImportesInformados | undefined
  if (!importes) throw new Error(`La factura de la venta ${ventaId} no tiene importes guardados: no se puede armar la NC`)

  const factura: FacturaOrigen = {
    puntoVenta: Number(registroFactura?.puntoVenta ?? espejo.puntoVenta),
    cbteTipo: Number(registroFactura?.cbteTipo ?? espejo.cbteTipo),
    numero: Number(registroFactura?.numero ?? espejo.numero),
    importes,
    ...(registroFactura?.detalle ? { detalle: registroFactura.detalle as FECAEDetRequest } : {}),
  }

  const config = await leerConfigParaEmitir(comoDb(db))
  const { receptor } = await receptorDeVenta(db, ventaId, venta, coleccion)
  const arca = await puertoArca(db, config)

  return emitirNotaCreditoTotal({
    db: comoDb(db),
    arca,
    config,
    ventaId,
    anulacionId: ventaId,
    factura,
    receptor,
    leer: async () => (await db.doc(rutaNotaCredito(ventaId)).get()).data(),
    guardar: async (r) => { await persistirNotaCredito(db, r, coleccion) },
  })
}

/** yyyy-MM-dd del día calendario argentino. */
const diaArgentino = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

/**
 * Nota de crédito interna para una factura X de promo (2026-09-11): sin ARCA.
 * Exige que Tango ya tenga la factura (`venta.tango.facturaNumero`), porque la
 * NC de Rolito la referencia; toma el número del contador
 * `config/numeracionInterna_notaCreditoX` en una transacción y deja la
 * solicitud 'emitida' y la venta 'anulada'. Sin contador → 'error' con el
 * motivo (hay que crearlo con configurar-ventas-tango --numeracion notaCreditoX=PV).
 */
export async function emitirNotaCreditoInterna(
  db: Firestore, ventaId: string, coleccion: ColeccionAnulable, venta: Record<string, unknown>,
): Promise<ResultadoEmisionNc | null> {
  const tango = venta.tango as { estado?: string; facturaNumero?: string } | undefined
  const fallar = async (motivo: string) => {
    await db.doc(rutaAnulacion(ventaId)).set({ estado: 'error', ultimoError: motivo, actualizadoEn: FieldValue.serverTimestamp() }, { merge: true })
    await db.doc(`${coleccion}/${ventaId}`).set({ anulacion: { estado: 'error', solicitudId: ventaId } }, { merge: true })
    return null
  }
  if (tango?.estado !== 'confirmado' || !tango.facturaNumero) {
    return fallar(`La factura de promo todavía no está registrada en Tango (estado ${tango?.estado ?? 'sin enviar'}); cuando entre, volvé a aprobar la anulación`)
  }
  const counterRef = db.doc('config/numeracionInterna_notaCreditoX')
  let nc: NotaCreditoInterna
  try {
    nc = await db.runTransaction(async (tx) => {
      const c = (await tx.get(counterRef)).data()
      if (!c || !Number.isInteger(c.next) || !Number.isInteger(Number(c.puntoVenta))) throw new Error('falta config/numeracionInterna_notaCreditoX { next, puntoVenta }')
      if (c.ultimo != null && Number(c.next) > Number(c.ultimo)) throw new Error('el talonario de notas de crédito X se agotó')
      tx.update(counterRef, { next: Number(c.next) + 1 })
      return { tipo: 'notaCreditoX' as const, puntoVenta: Number(c.puntoVenta), numero: Number(c.next), fecha: diaArgentino(new Date()) }
    })
  } catch (e) {
    return fallar(`No se pudo numerar la nota de crédito X: ${(e as Error).message}`)
  }
  const batch = db.batch()
  batch.set(db.doc(rutaAnulacion(ventaId)), { estado: 'emitida', notaCreditoInterna: nc, ultimoError: null, actualizadoEn: FieldValue.serverTimestamp() }, { merge: true })
  batch.set(db.doc(`${coleccion}/${ventaId}`), { anulacion: { estado: 'anulada', solicitudId: ventaId, notaCreditoInterna: nc } }, { merge: true })
  await batch.commit()
  return { estado: 'emitida', interna: true, puntoVenta: nc.puntoVenta, numero: nc.numero }
}
