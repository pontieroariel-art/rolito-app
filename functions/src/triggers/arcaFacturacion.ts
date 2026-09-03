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
import { verificarCertificadoCoincide } from '../services/arca/wsaa'
import { feCaeSolicitar, feCompConsultar, type ConfigWsfev1 } from '../services/arca/wsfev1'
import type { PuertoArca } from '../services/arca/emision'
import { resolverIncierto } from '../services/arca/emision'
import { facturarVenta, rutaFactura, type RegistroFactura } from '../services/arca/facturacionVenta'
import { documentoDeVenta } from '../services/arca/circuito'
import { leerPercepcionDePerfil } from '../services/arca/percepcionPerfil'
import type { ItemFacturable, DatosReceptor } from '../services/arca/comprobante'
import { validarVentanaEmision } from '../services/arca/comprobante'
import type { DbLike } from '../services/arca/numeracion'
import { sendEmail, APP_URL, resendApiKey } from '../email'
import { tplArcaFacturasConProblemas, type FacturaConProblema } from '../templates'

const TZ = 'America/Argentina/Buenos_Aires'

// Una venta de contado que lleva más de esto sin factura ya no es "ARCA
// tardó": es un dato del cliente que falta o una configuración caída. Se
// avisa a la oficina una sola vez (avisadoEn), para que lo arregle mientras
// la ventana de 5 días sigue abierta.
const HORAS_PENDIENTE_ANTES_DE_AVISAR = 3

/**
 * Las dos colecciones que la app factura: la venta del camión y la del
 * mostrador (ventanilla). Misma regla de negocio (docs/arca §11), distinto
 * origen. El registro en `facturasArca/{ventaId}` guarda de cuál vino para que
 * la reconciliación y el aviso lean la venta del lugar correcto; los registros
 * anteriores a esto no tienen el campo y son del camión.
 */
type ColeccionVenta = 'ventasCamion' | 'ventasVentanilla'
const coleccionDe = (f: Record<string, unknown> | undefined): ColeccionVenta =>
  f?.coleccion === 'ventasVentanilla' ? 'ventasVentanilla' : 'ventasCamion'

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
  // El certificado (secret) y el ambiente (config/arca) se cambian por
  // separado, y el de homologación está a nombre de otro CUIT. Cruzados, ARCA
  // devuelve un 601 que no dice cuál de las dos puntas está mal.
  verificarCertificadoCoincide(arcaCert.value(), config.cuit)

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
 * Solo `venta.items`. Los cambios viven en `venta.cambios` y valen $0: son
 * renglones del papel, no del comprobante fiscal. (WSFEv1 tampoco lleva
 * renglones —solo importes—, así que un cambio es invisible para ARCA por
 * construcción; esto es para que siga siéndolo si algún día eso cambia.)
 */
function itemsDe(venta: Record<string, unknown>): ItemFacturable[] {
  const items = (venta.items ?? []) as Array<Record<string, unknown>>
  return items.map((i) => ({
    descripcion: String(i.nombre ?? ''),
    cantidad: Number(i.cantidad),
    precioUnitario: Number(i.precioUnitario),
  }))
}

/** Guarda el estado de la factura y lo refleja en la venta. */
async function persistir(db: Firestore, registro: RegistroFactura, coleccion: ColeccionVenta): Promise<void> {
  const batch = db.batch()
  batch.set(
    db.doc(rutaFactura(registro.ventaId)),
    {
      ...registro,
      coleccion,
      actualizadoEn: FieldValue.serverTimestamp(),
      // Una rechazada entra en la cola de aviso a la oficina (ver
      // avisarFacturasConProblemas). El null explícito es lo que permite
      // consultarla con where('avisadoEn', '==', null).
      ...(registro.estado === 'rechazada' ? { avisadoEn: null } : {}),
    },
    { merge: true },
  )
  // Espejo en la venta, para que la pantalla del chofer y los listados no
  // tengan que hacer un join. Lleva todo lo que necesita el comprobante
  // impreso: el tipo (define si es A o B), la fecha y los importes TAL COMO se
  // le informaron a ARCA. Recalcularlos en el front arriesgaría que el papel
  // no coincida con lo declarado.
  batch.set(
    db.doc(`${coleccion}/${registro.ventaId}`),
    {
      factura: {
        estado: registro.estado,
        numero: registro.numero,
        puntoVenta: registro.puntoVenta,
        cbteTipo: registro.cbteTipo,
        cae: registro.cae ?? null,
        caeFchVto: registro.caeFchVto ?? null,
        ...(registro.importes ? { importes: registro.importes } : {}),
      },
    },
    { merge: true },
  )
  await batch.commit()
}

/**
 * Factura una venta ya conocida. Compartido por el trigger y la reconciliación.
 */
async function facturar(db: Firestore, ventaId: string, coleccion: ColeccionVenta): Promise<RegistroFactura | null> {
  const config = await leerConfigParaEmitir(comoDb(db))

  const ventaSnap = await db.doc(`${coleccion}/${ventaId}`).get()
  const venta = ventaSnap.data()
  if (!venta) return null

  const documento = documentoDeVenta(venta.canal, venta.formaPago, venta.total)
  if (documento !== 'factura_arca') {
    // Promo (Rolito) y cuenta corriente no las factura la app. La de cuenta
    // corriente sale por remito y la factura la oficina desde Tango: emitirla
    // acá también sería facturar dos veces la misma venta.
    if (documento === null) {
      console.warn(
        `[arca] la venta ${ventaId} no dice cómo se cobró ` +
        `(canal=${String(venta.canal)}, formaPago=${String(venta.formaPago)}, ` +
        `total=${String(venta.total)}); no se factura`,
      )
    }
    return null
  }

  // Receptor: el cliente registrado sale de su perfil (datos de Tango). El
  // ocasional del mostrador no tiene perfil: es consumidor final, con el CUIT
  // o DNI que haya cargado caja, o sin identificar hasta el tope (ver
  // validarReceptor). Al ocasional no se le percibe IIBB: no está en padrón.
  const clienteId = String(venta.clienteId ?? '')
  const perfil = clienteId ? (await db.doc(`users/${clienteId}`).get()).data() : undefined
  const ocasional = venta.clienteOcasional as { nombre?: string; cuit?: string; dni?: string } | undefined

  let receptor: DatosReceptor
  if (perfil) {
    receptor = {
      razonSocial: String(perfil.razonSocial ?? ''),
      cuit: String(perfil.cuit ?? ''),
      categoriaIvaTango: String(perfil.categoriaIvaTango ?? ''),
    }
  } else if (coleccion === 'ventasVentanilla' && ocasional) {
    receptor = {
      razonSocial: String(ocasional.nombre ?? ''),
      cuit: String(ocasional.cuit ?? ''),
      dni: String(ocasional.dni ?? ''),
      categoriaIvaTango: 'CF',
      mostrador: true,
    }
  } else {
    throw new Error(`La venta ${ventaId} no tiene un cliente resoluble`)
  }

  const arca = await puertoArca(db, config)

  return facturarVenta({
    db: comoDb(db),
    arca,
    config,
    ventaId,
    datos: {
      receptor,
      items: itemsDe(venta),
      fechaVenta: (venta.fecha as { toDate?: () => Date } | undefined)?.toDate?.() ?? new Date(),
    },
    percepcionIIBB: perfil ? leerPercepcionDePerfil(perfil, config.tributoIdPercepcionIIBB) : undefined,
    leer: async () => (await db.doc(rutaFactura(ventaId)).get()).data(),
    guardar: async (r) => { await persistir(db, r, coleccion) },
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
async function facturarVentaNueva(
  coleccion: ColeccionVenta,
  ventaId: string,
  venta: Record<string, unknown> | undefined,
): Promise<void> {
  // Filtro barato antes de tocar secrets y red; `facturar` vuelve a decidir
  // sobre la venta releída, que es la palabra final.
  if (!venta || documentoDeVenta(venta.canal, venta.formaPago, venta.total) !== 'factura_arca') return

  const db = getFirestore()
  try {
    await facturar(db, ventaId, coleccion)
  } catch (e) {
    const motivo = (e as Error).message
    console.error(`[arca] no se pudo facturar la venta ${ventaId} (${coleccion}): ${motivo}`)
    await db.doc(rutaFactura(ventaId)).set(
      { ventaId, coleccion, estado: 'pendiente', motivo, actualizadoEn: FieldValue.serverTimestamp() },
      { merge: true },
    )
  }
}

export const onVentaContadoFacturar = onDocumentCreated(
  { document: 'ventasCamion/{ventaId}', secrets: [arcaCert, arcaKey] },
  (event) => facturarVentaNueva('ventasCamion', event.params.ventaId, event.data?.data()),
)

/** Venta de contado en el mostrador → misma factura electrónica que el camión. */
export const onVentaVentanillaContadoFacturar = onDocumentCreated(
  { document: 'ventasVentanilla/{ventaId}', secrets: [arcaCert, arcaKey] },
  (event) => facturarVentaNueva('ventasVentanilla', event.params.ventaId, event.data?.data()),
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
  { schedule: '15 * * * *', timeZone: TZ, secrets: [arcaCert, arcaKey, resendApiKey] },
  async () => {
    const db = getFirestore()
    const ahora = new Date()

    // Dos consultas y no una con `in`: las inciertas son las urgentes (hay un
    // número reservado que ARCA pudo haber autorizado) y no pueden quedar
    // detrás de una cola de pendientes que fallan siempre por lo mismo.
    const [inciertas, pendientes] = await Promise.all([
      db.collection('facturasArca').where('estado', '==', 'incierta').limit(50).get(),
      db.collection('facturasArca').where('estado', '==', 'pendiente').limit(50).get(),
    ])

    // Las que van a la oficina en este ciclo (además de las rechazadas, que se
    // buscan aparte al final).
    const trabadas: FacturaConProblema[] = []

    if (!inciertas.empty || !pendientes.empty) {
      let config: ConfigArca | null = null
      let arca: PuertoArca | null = null
      try {
        config = await leerConfigParaEmitir(comoDb(db))
        arca = await puertoArca(db, config)
      } catch (e) {
        console.error(`[arca] reconciliación sin configuración utilizable: ${(e as Error).message}`)
      }

      if (config && arca) {
        for (const docSnap of inciertas.docs) {
          const f = docSnap.data()
          const ventaId = docSnap.id
          if (typeof f.numero !== 'number' || typeof f.cbteTipo !== 'number') continue
          try {
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
            }, coleccionDe(f))
          } catch (e) {
            // Un fallo acá no debe frenar al resto de la tanda.
            console.error(`[arca] reconciliación de ${ventaId} (incierta) falló: ${(e as Error).message}`)
          }
        }

        for (const docSnap of pendientes.docs) {
          const f = docSnap.data()
          const ventaId = docSnap.id
          const coleccion = coleccionDe(f)
          const venta = (await db.doc(`${coleccion}/${ventaId}`).get()).data()
          const fechaVenta = (venta?.fecha as { toDate?: () => Date } | undefined)?.toDate?.()

          try {
            // Pasada la ventana de ARCA ya no hay nada que reintentar: se
            // cierra como 'vencida' y se avisa. Sin esto quedaba 'pendiente'
            // para siempre, ocupando la tanda de cada hora y sin que nadie
            // en la oficina se enterara. (Solo si nunca se reservó número:
            // con número, la palabra la tiene facturarVenta.)
            if (venta && fechaVenta && typeof f.numero !== 'number') {
              const ventana = validarVentanaEmision(fechaVenta, ahora)
              if (!ventana.valida) {
                const motivo = `No se pudo facturar a tiempo: ${ventana.motivo}. Último error: ${String(f.motivo ?? 'sin detalle')}`
                await docSnap.ref.set(
                  { estado: 'vencida', motivo, avisadoEn: null, actualizadoEn: FieldValue.serverTimestamp() },
                  { merge: true },
                )
                continue
              }
            }

            if ((await facturar(db, ventaId, coleccion)) === null) {
              // La venta no la factura la app (promo, cuenta corriente) o ya no
              // existe. Sin este cierre el registro quedaría 'pendiente' para
              // siempre, reintentándose cada hora sin que nada cambie nunca.
              await docSnap.ref.set(
                {
                  estado: 'no_corresponde',
                  motivo: 'la app no factura esta venta: es promo, es de cuenta corriente (la factura la oficina desde el remito) o la venta ya no existe',
                  actualizadoEn: FieldValue.serverTimestamp(),
                },
                { merge: true },
              )
            }
          } catch (e) {
            const motivo = (e as Error).message
            console.error(`[arca] reconciliación de ${ventaId} falló: ${motivo}`)
            // Dejar el motivo actual en el doc: es lo que va a leer la oficina.
            await docSnap.ref.set({ motivo, actualizadoEn: FieldValue.serverTimestamp() }, { merge: true })
              .catch(() => { /* el log ya quedó */ })

            const horas = fechaVenta ? (ahora.getTime() - fechaVenta.getTime()) / 3_600_000 : 0
            if (venta && horas >= HORAS_PENDIENTE_ANTES_DE_AVISAR && !f.avisadoEn) {
              trabadas.push({
                ventaId,
                estado: 'pendiente',
                motivo,
                clienteNombre: String(venta.clienteNombre ?? ''),
                total: Number(venta.total ?? 0),
                fechaVenta: venta.fecha,
              })
            }
          }
        }
      }
    }

    await avisarFacturasConProblemas(db, trabadas)
  },
)

/**
 * Manda a la oficina, UNA vez por factura, las que no se van a resolver solas:
 * rechazadas y vencidas (se marcan con `avisadoEn: null` al escribirse) más
 * las pendientes trabadas que detectó la tanda. Sin este aviso la única
 * persona que se enteraba era el chofer, en su pantalla de ventas.
 */
async function avisarFacturasConProblemas(db: Firestore, trabadas: FacturaConProblema[]): Promise<void> {
  // Dos igualdades por consulta (estado + avisadoEn): no necesitan índice
  // compuesto, a diferencia de un `in` combinado con otro filtro.
  const [rechazadas, vencidas] = await Promise.all(
    (['rechazada', 'vencida'] as const).map((estado) =>
      db.collection('facturasArca')
        .where('estado', '==', estado)
        .where('avisadoEn', '==', null)
        .limit(50)
        .get(),
    ),
  )

  const problemas: FacturaConProblema[] = [...trabadas]
  for (const docSnap of [...rechazadas.docs, ...vencidas.docs]) {
    const f = docSnap.data()
    const venta = (await db.doc(`${coleccionDe(f)}/${docSnap.id}`).get()).data()
    problemas.push({
      ventaId: docSnap.id,
      estado: f.estado === 'vencida' ? 'vencida' : 'rechazada',
      motivo: String(f.motivo ?? 'sin detalle'),
      clienteNombre: String(venta?.clienteNombre ?? ''),
      total: Number(venta?.total ?? 0),
      fechaVenta: venta?.fecha,
    })
  }
  if (problemas.length === 0) return

  const emails = ((await db.doc('configuracion/notificaciones').get()).data()?.emails ?? []) as string[]
  if (emails.length === 0) {
    console.warn(`[arca] ${problemas.length} factura(s) con problemas y nadie configurado en configuracion/notificaciones.emails`)
    return
  }

  await sendEmail(
    emails,
    `ARCA: ${problemas.length} factura${problemas.length !== 1 ? 's' : ''} con problemas`,
    tplArcaFacturasConProblemas(problemas, APP_URL),
  )

  // Recién después de mandar el mail se marcan como avisadas: si Resend falla,
  // el próximo ciclo las vuelve a incluir en vez de perderlas.
  const batch = db.batch()
  for (const p of problemas) {
    batch.set(db.doc(rutaFactura(p.ventaId)), { avisadoEn: FieldValue.serverTimestamp() }, { merge: true })
  }
  await batch.commit()
}
