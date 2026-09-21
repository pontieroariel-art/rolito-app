import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { assertNoImpersonado } from '../authz'
import { assertRateLimit } from '../rateLimit'
import { confirmarRemitosAnulados, confirmarRecibosAnulados } from '../services/anuladosEnTango'

/**
 * "Preguntar a Tango ahora" (2026-09-20).
 *
 * Los remitos y recibos que la app anula salen de la lista de pendientes
 * cuando el lector ve el comprobante anulado en Tango, y eso corría una vez
 * por hora. Desde Comprobantes de clientes la oficina puede pedir la misma
 * pasada en el momento, después de que el bridge refresque los comprobantes
 * del cliente: así el que acaba de anularlo en Tango ve irse la fila en vez de
 * quedarse con la duda de si lo tomó.
 *
 * NO marca nada: corre exactamente la misma cuenta que el barrido horario. El
 * único que da por hecha una anulación sigue siendo Tango.
 */
export const verificarAnuladosEnTango = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado')
  assertNoImpersonado(request)

  const db = getFirestore()
  const quien = (await db.collection('users').doc(request.auth.uid).get()).data()
  const roles = [String(quien?.rol ?? ''), ...(Array.isArray(quien?.rolesExtra) ? quien!.rolesExtra.map(String) : [])]
  if (quien?.estado !== 'activo' || !roles.some((r) => ['facturacion', 'super_admin', 'tesoreria'].includes(r))) {
    throw new HttpsError('permission-denied', 'No podés verificar anulaciones en Tango')
  }
  // Son dos queries y unos pocos getAll: barato, pero no para apretarlo sin fin.
  await assertRateLimit(request.auth.uid, 'verificarAnuladosEnTango', 60, 3600)

  const [remitos, recibos] = await Promise.all([
    confirmarRemitosAnulados(db),
    confirmarRecibosAnulados(db),
  ])
  return { remitos, recibos }
})
