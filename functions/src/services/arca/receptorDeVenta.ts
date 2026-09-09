/**
 * El receptor fiscal de una venta: el cliente registrado sale de su perfil
 * (datos de Tango); el ocasional del mostrador no tiene perfil y es consumidor
 * final con el CUIT o DNI que haya cargado caja (o sin identificar hasta el
 * tope, ver validarReceptor). Compartido por la factura y la nota de crédito.
 */

import type { Firestore } from 'firebase-admin/firestore'
import type { DatosReceptor } from './comprobante'

export type ColeccionVenta = 'ventasCamion' | 'ventasVentanilla'

export async function receptorDeVenta(
  db: Firestore,
  ventaId: string,
  venta: Record<string, unknown>,
  coleccion: ColeccionVenta,
): Promise<{ receptor: DatosReceptor; perfil: Record<string, unknown> | undefined }> {
  const clienteId = String(venta.clienteId ?? '')
  const perfil = clienteId ? (await db.doc(`users/${clienteId}`).get()).data() : undefined
  const ocasional = venta.clienteOcasional as { nombre?: string; cuit?: string; dni?: string } | undefined

  if (perfil) {
    return {
      perfil,
      receptor: {
        razonSocial: String(perfil.razonSocial ?? ''),
        cuit: String(perfil.cuit ?? ''),
        categoriaIvaTango: String(perfil.categoriaIvaTango ?? ''),
      },
    }
  }
  if (coleccion === 'ventasVentanilla' && ocasional) {
    return {
      perfil: undefined,
      receptor: {
        razonSocial: String(ocasional.nombre ?? ''),
        cuit: String(ocasional.cuit ?? ''),
        dni: String(ocasional.dni ?? ''),
        categoriaIvaTango: 'CF',
        mostrador: true,
      },
    }
  }
  throw new Error(`La venta ${ventaId} no tiene un cliente resoluble`)
}
