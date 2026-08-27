import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

// Alta de un pallet de producción → un item en la cola tango-outbox, que el
// bridge en la VM de Tango escucha en tiempo real (ver
// scripts/tango/bridge-listener.mjs, docs/tango/INTEGRACION.md §7).
//
// produccionPallets es inmutable (firestore.rules: allow update, delete:
// if false), así que onCreate es el único evento que hace falta acá.
//
// ID determinístico (produccionPallets_{palletId}) + .create() en vez de
// .set(): si este trigger se reintenta (no es exactly-once), el segundo
// intento tira ALREADY_EXISTS y se ignora — evita mandar el mismo pallet dos
// veces a Tango.
export const onProduccionPalletCreado = onDocumentCreated(
  'produccionPallets/{palletId}',
  async (event) => {
    const pallet = event.data?.data()
    if (!pallet) return

    const db = getFirestore()
    const outboxId = `produccionPallets_${event.params.palletId}`

    try {
      await db.collection('tango-outbox').doc(outboxId).create({
        entidad: 'produccionPallet',
        origenColeccion: 'produccionPallets',
        origenId: event.params.palletId,
        payload: pallet,
        estado: 'pendiente',
        intentos: 0,
        ultimoError: null,
        creadoEn: FieldValue.serverTimestamp(),
        actualizadoEn: FieldValue.serverTimestamp(),
      })
    } catch (err) {
      // ALREADY_EXISTS (código 6) = reintento del trigger, no es un error real.
      const code = (err as { code?: number })?.code
      if (code !== 6) throw err
    }
  },
)
