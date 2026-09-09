/**
 * Pegamento entre los servicios puros de ARCA y Firebase: los secrets del
 * certificado, el adaptador de Firestore a `DbLike` y el puerto hacia ARCA
 * (autenticación con cache + las dos operaciones). Lo comparten los triggers
 * de facturación y los de anulación (nota de crédito).
 */

import { defineSecret } from 'firebase-functions/params'
import type { Firestore } from 'firebase-admin/firestore'

import type { ConfigArca } from './configuracion'
import { obtenerTicketAcceso } from './ticketCache'
import { verificarCertificadoCoincide } from './wsaa'
import { feCaeSolicitar, feCompConsultar, type ConfigWsfev1 } from './wsfev1'
import type { PuertoArca } from './emision'
import type { DbLike } from './numeracion'

// El certificado y su clave viven en secrets, nunca en el repo ni en Firestore:
// con ellos se puede emitir comprobantes en nombre de la empresa.
export const arcaCert = defineSecret('ARCA_CERT_PEM')
export const arcaKey = defineSecret('ARCA_KEY_PEM')

/** Firestore real, con la forma mínima que esperan los servicios. */
export function comoDb(db: Firestore): DbLike {
  return {
    doc: (path: string) => db.doc(path),
    runTransaction: (fn) => db.runTransaction(fn as never) as never,
  } as DbLike
}

/** Arma el puerto hacia ARCA: autentica (con cache) y expone las dos operaciones. */
export async function puertoArca(db: Firestore, config: ConfigArca): Promise<PuertoArca> {
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
