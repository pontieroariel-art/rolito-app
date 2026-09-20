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
 * **Cuando Tango anula un comprobante le borra el cliente** (y el usuario, y
 * los renglones): el comprobante se muda al cajón `{empresa}_000000` y lo que
 * queda en la ficha del cliente es la entrada vieja, con el estado de antes.
 * Verificado sobre producción el 2026-09-20: los 254 recibos y los 3.778
 * remitos de ese cajón están TODOS en A / ANU, ni uno vivo.
 *
 * Por eso preguntarle a la ficha del cliente "¿está anulado?" no podía dar que
 * sí nunca, y ninguna de las dos listas de pendientes se iba a vaciar jamás.
 * La respuesta la tiene el doc POR comprobante que también escribe el lector,
 * cuya clave es el NÚMERO — y el número no depende de a qué cuenta fue a
 * parar. El índice del cliente queda como atajo barato que solo puede
 * confirmar; desmentir, no.
 */
async function estadoSuelto(db: Db, empresa: string, tipo: 'REM' | 'REC', numero: string): Promise<string> {
  const snap = await db.doc(`tangoComprobanteDetalle/${empresa}_${tipo}_${numero.trim().toUpperCase()}`).get()
  return snap.exists ? String(snap.data()?.estado ?? '').trim().toUpperCase() : ''
}

/** Remitos de cta. cte. anulados en la app: confirma los que Tango ya muestra con estado A. */
export async function confirmarRemitosAnulados(db: Db = getFirestore()): Promise<{ pendientes: number; confirmados: number }> {
  // También los `encolado` (2026-09-20): si el bridge no los procesó —estaba
  // caído, la VM apagada— la venta no aparece en la lista de la oficina y se
  // volvería invisible. Acá se confirma igual apenas Tango los muestre
  // anulados, venga de donde venga la anulación.
  const pendientes = await db.collection('ventasCamion')
    .where('anulacion.tipo', '==', 'remito')
    .where('anulacion.tango.estado', 'in', ['pendiente_oficina', 'encolado'])
    .limit(200).get()

  // Un solo getAll: un cliente puede tener varios remitos pendientes.
  const codigos = [...new Set(pendientes.docs.map((d) => String(d.data().clienteCodigoTango ?? '').trim()).filter(Boolean))]
  const idx = await indices(db, codigos.map((c) => `redonhielo_${c}`))

  let confirmados = 0
  for (const d of pendientes.docs) {
    const v = d.data()
    const codigo = String(v.clienteCodigoTango ?? '').trim()
    const numero = String((v.tango as { remitoNumero?: string } | undefined)?.remitoNumero ?? '').trim()
    // Sin número no hay nada que buscar; sin código todavía queda el
    // comprobante suelto, que no depende de a qué cuenta fue el remito.
    if (!numero) continue
    const enIndice = String(codigo
      ? (idx.get(`redonhielo_${codigo}`)?.remitos as Record<string, { estado?: string }> | undefined)?.[numero]?.estado ?? ''
      : '').trim().toUpperCase()
    // El índice del cliente solo puede CONFIRMAR, nunca desmentir: cuando
    // Tango anula un remito le borra el cliente, así que el remito se muda al
    // cajón `000000` y la entrada vieja queda en la ficha del cliente con su
    // estado desactualizado ('P' o 'F') para siempre. Mirando solo ahí, un
    // remito anulado no se confirma NUNCA. Por eso el comprobante suelto
    // —cuya clave es el número— decide igual aunque el índice diga otra cosa.
    const anulado = enIndice === 'A' || await estadoSuelto(db, 'redonhielo', 'REM', numero) === 'A'
    if (anulado) {
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
    // Igual que los remitos: el índice solo confirma, el comprobante suelto
    // decide (caso FERRANTE, anulado en Tango pero bajo el código 000000).
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
