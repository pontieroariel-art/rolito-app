import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { reciboAnuladoEnIndice } from './anulacionCobranza'

/**
 * ¿La oficina ya anuló en Tango lo que la app dio por anulado? (2026-09-20)
 *
 * Los remitos y los recibos que la app anula los tiene que anular alguien a
 * mano en Tango (hasta que estén la traza y el writer SQL). La prueba de que
 * se hizo NO es que alguien lo tilde: es que el lector de comprobantes vea el
 * comprobante en estado A / ANU. Eso corría solo una vez por hora, así que
 * entre que lo hacían y que la fila se iba pasaba hasta una hora y nadie sabía
 * si ya estaba hecho o si nadie lo había agarrado.
 *
 * Por eso la pasada vive acá y no adentro del scheduler: la corren igual el
 * barrido horario y el botón "Ya lo anulé en Tango" de Comprobantes de
 * clientes, que antes pide al bridge refrescar los comprobantes de ese cliente
 * y después llama a esto. Misma cuenta, mismo resultado, sin estado inventado.
 */

type Db = FirebaseFirestore.Firestore
type Datos = FirebaseFirestore.DocumentData

async function indices(db: Db, claves: string[]): Promise<Map<string, Datos | undefined>> {
  const mapa = new Map<string, Datos | undefined>()
  if (!claves.length) return mapa
  const snaps = await db.getAll(...claves.map((k) => db.doc(`tangoComprobantes/${k}`)))
  snaps.forEach((s, i) => mapa.set(claves[i], s.data()))
  return mapa
}

const confirmado = () => ({ anulacion: { tango: { estado: 'confirmado', en: FieldValue.serverTimestamp() } } })

/**
 * El estado del comprobante SUELTO, por número (2026-09-20).
 *
 * El índice del cliente alcanza para casi todo y es una lectura por cliente,
 * pero no siempre lo tiene: el recibo de FERRANTE estaba anulado en Tango
 * desde hacía cuatro días y la fila no se iba, porque Tango lo registró con el
 * código de cliente `000000` y la ficha de FC.583 no lo mostraba nunca. El
 * lector escribe además un doc POR comprobante, cuya clave es el número — y el
 * número no depende de a qué cuenta haya ido a parar. Se usa como respaldo:
 * una lectura extra solo para los que el índice no resuelve.
 */
async function estadoSuelto(db: Db, empresa: string, tipo: 'REM' | 'REC', numero: string): Promise<string> {
  const snap = await db.doc(`tangoComprobanteDetalle/${empresa}_${tipo}_${numero.trim().toUpperCase()}`).get()
  return snap.exists ? String(snap.data()?.estado ?? '').trim().toUpperCase() : ''
}

/** Remitos de cta. cte. anulados en la app: confirma los que Tango ya muestra con estado A. */
export async function confirmarRemitosAnulados(db: Db = getFirestore()): Promise<{ pendientes: number; confirmados: number }> {
  const pendientes = await db.collection('ventasCamion')
    .where('anulacion.tipo', '==', 'remito')
    .where('anulacion.tango.estado', '==', 'pendiente_oficina')
    .limit(200).get()

  // Un solo getAll: un cliente puede tener varios remitos pendientes.
  const codigos = [...new Set(pendientes.docs.map((d) => String(d.data().clienteCodigoTango ?? '').trim()).filter(Boolean))]
  const idx = await indices(db, codigos.map((c) => `redonhielo_${c}`))

  let confirmados = 0
  for (const d of pendientes.docs) {
    const v = d.data()
    const codigo = String(v.clienteCodigoTango ?? '').trim()
    const numero = String((v.tango as { remitoNumero?: string } | undefined)?.remitoNumero ?? '').trim()
    // Sin número no hay nada que buscar; sin código todavía queda el respaldo
    // por comprobante, que no depende de a qué cuenta fue el remito.
    if (!numero) continue
    const enIndice = codigo
      ? (idx.get(`redonhielo_${codigo}`)?.remitos as Record<string, { estado?: string }> | undefined)?.[numero]?.estado
      : undefined
    const estado = String(enIndice ?? '').trim().toUpperCase() || await estadoSuelto(db, 'redonhielo', 'REM', numero)
    if (estado === 'A') {
      await d.ref.set(confirmado(), { merge: true })
      confirmados++
    }
  }
  return { pendientes: pendientes.size, confirmados }
}

/** Recibos de cobranza anulados en la app: confirma los que Tango ya muestra con estado ANU. */
export async function confirmarRecibosAnulados(db: Db = getFirestore()): Promise<{ pendientes: number; confirmados: number }> {
  const pendientes = await db.collection('cobranzas')
    .where('anulacion.tango.estado', '==', 'pendiente_oficina')
    .limit(200).get()

  const claveIdx = (c: Datos) => `${String(c.empresa ?? 'redonhielo')}_${String(c.codigoTango ?? '').trim()}`
  const claves = [...new Set(pendientes.docs.map((d) => claveIdx(d.data())).filter((k) => !k.endsWith('_')))]
  const idx = await indices(db, claves)

  let confirmados = 0
  for (const d of pendientes.docs) {
    const c = d.data()
    const recibo = String((c.tango as { reciboNumero?: string } | undefined)?.reciboNumero ?? '').trim()
    if (!recibo) continue
    const indice = idx.get(claveIdx(c)) as { facturas?: Record<string, { estado?: unknown }> } | undefined
    const empresa = String(c.empresa ?? 'redonhielo')
    // El índice del cliente primero; si no lo tiene, el comprobante suelto
    // (caso FERRANTE: anulado en Tango pero bajo el código 000000).
    const anulado = reciboAnuladoEnIndice(indice, recibo)
      || await estadoSuelto(db, empresa, 'REC', recibo) === 'ANU'
    if (anulado) {
      await d.ref.set(confirmado(), { merge: true })
      await db.doc(`anulacionesCobranza/${d.id}`).set({ tango: { estado: 'confirmado', en: FieldValue.serverTimestamp() } }, { merge: true })
      confirmados++
    }
  }
  return { pendientes: pendientes.size, confirmados }
}
