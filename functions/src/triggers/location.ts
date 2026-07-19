import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'

interface UbicacionData {
  lat?:            number
  lng?:            number
  nombreChofer?:   string
  telefonoChofer?: string
  timestamp?:      Timestamp
}

// Espeja la posición del chofer (colección `ubicaciones`, que el cliente ya NO
// puede leer por reglas) dentro de sus pedidos `en_camino`, en el campo
// `driverLocation`. El dueño del pedido —que sí puede leer su propio pedido— ve
// el camión en vivo por su onSnapshot, sin acceso a la ubicación de la flota.
//
// Solo se espejan pedidos `en_camino` (típicamente uno por chofer a la vez),
// así que el volumen de escrituras es bajo. Los dos filtros son de igualdad, de
// modo que Firestore resuelve la query sin índice compuesto.
export const mirrorDriverLocation = onDocumentWritten('ubicaciones/{driverEmail}', async (event) => {
  const after = event.data?.after
  if (!after?.exists) return

  const loc = after.data() as UbicacionData
  if (typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return

  const driverEmail = event.params.driverEmail
  const db = getFirestore()

  const snap = await db.collection('orders')
    .where('driverId', '==', driverEmail)
    .where('status', '==', 'en_camino')
    .get()
  if (snap.empty) return

  const driverLocation = {
    lat:            loc.lat,
    lng:            loc.lng,
    nombreChofer:   loc.nombreChofer   ?? '',
    telefonoChofer: loc.telefonoChofer ?? '',
    updatedAt:      loc.timestamp ?? FieldValue.serverTimestamp(),
  }

  const batch = db.batch()
  snap.docs.forEach((d) => batch.update(d.ref, { driverLocation }))
  await batch.commit()
})
