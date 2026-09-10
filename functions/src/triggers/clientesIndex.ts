import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { indiceDeCliente, mismoIndice, type ClienteIndex } from '../services/clientesIndex'

// Mantiene clientesIndex/{uid} (búsqueda liviana de clientes, 2026-09-10) a
// partir de users/{uid}. Corre en cada escritura de un usuario, incluida la
// sync diaria de precios (2.000 escrituras): por eso compara con el índice
// guardado y solo escribe si cambió algo de lo que se busca o se muestra.
// Si el usuario deja de ser cliente o se borra, saca el índice.

export const onClienteIndexado = onDocumentWritten('users/{uid}', async (event) => {
  const uid = event.params.uid
  const despues = event.data?.after?.exists ? event.data.after.data() : null
  const nuevo = indiceDeCliente(uid, despues as Parameters<typeof indiceDeCliente>[1])
  const db = getFirestore()
  const ref = db.doc(`clientesIndex/${uid}`)
  const actualSnap = await ref.get()
  const actual = actualSnap.exists ? (actualSnap.data() as ClienteIndex) : null
  if (!nuevo) {
    if (actualSnap.exists) await ref.delete()
    return
  }
  if (mismoIndice(actual, nuevo)) return
  await ref.set({ ...nuevo, actualizadoEn: FieldValue.serverTimestamp() })
})
