import { collection, doc, onSnapshot, query, setDoc, where, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { fireAndForget, onSnapshotError, esperarOEncolar } from './observability'
import { aCentavos, sumaCentavos } from '../utils/money'
import { Cobranza, EmpresaTango, ImputacionFactura, MediosPago, PlantaId } from '../types'

const COBRANZAS = 'cobranzas'

// Las cobranzas simples de mostrador y de calle (cliente + importe, sin factura)
// se dejaron de crear el 2026-09-05: no llegaban a Tango. Todos cobran con
// crearCobranzaCompleta. Las ya registradas se siguen leyendo y reimprimiendo.

export class CobranzaDescuadradaError extends Error {}

export type OrigenCobranzaCompleta = 'supervisor' | 'caja' | 'cobrador'

// Cobranza COMPLETA (imputación a facturas de Tango + medios + recibo numerado),
// la misma para supervisor, ventanilla (caja) y chofer (decisión de Ariel
// 2026-09-05). Solo cambia el origen y cómo se espera al servidor: caja está
// en la PC e imprime contra un doc confirmado (esperarOEncolar, hasta 4 s);
// supervisor y chofer cobran sin señal (fire-and-forget + numeración reservada).
export async function crearCobranzaCompleta(
  args: {
    clienteId:     string
    clienteNombre: string
    empresa:       EmpresaTango
    codigoTango?:  string   // código de cliente en esa empresa (varios códigos por CUIT)
    numeroRecibo?: string
    imputaciones:  ImputacionFactura[]
    medios:        MediosPago
  },
  actor: { uid: string; nombre: string; depositoTango?: string },
  destino: { origen: OrigenCobranzaCompleta; plantaId?: PlantaId },
): Promise<Cobranza> {
  const totalImputado = sumaCentavos(args.imputaciones.map((i) => i.importeImputado))
  const aplicado = sumaCentavos((args.medios.aCuentaAplicado ?? []).map((a) => a.importe))
  const totalMedios =
    aCentavos(args.medios.efectivo) +
    aCentavos(args.medios.transferencia) +
    sumaCentavos(args.medios.cheques.map((c) => c.importe)) +
    sumaCentavos(args.medios.retenciones.map((r) => r.importe)) +
    aplicado

  // Los valores pueden superar lo imputado: la diferencia queda A CUENTA del cliente
  // (saldo a favor en Tango; decisión de Ariel 2026-09-08: siempre, cualquier medio,
  // también choferes). Lo que no puede pasar es imputar más de lo que se recibió.
  if (totalMedios <= 0) throw new CobranzaDescuadradaError('No hay valores recibidos.')
  if (totalImputado > totalMedios) {
    throw new CobranzaDescuadradaError('Lo imputado a facturas supera los valores recibidos.')
  }
  const aCuenta = totalMedios - totalImputado
  if (aplicado > 0 && aCuenta > 0) throw new CobranzaDescuadradaError('No se puede usar saldo a favor y dejar plata a cuenta en el mismo recibo.')
  if ((args.medios.aCuentaAplicado ?? []).some((a) => aCentavos(a.importe) <= 0 || !a.reciboNumero)) {
    throw new CobranzaDescuadradaError('Hay un saldo a favor aplicado en cero o sin recibo.')
  }
  if (args.imputaciones.some((i) => aCentavos(i.importeImputado) <= 0 || aCentavos(i.importeImputado) > aCentavos(i.saldoAlMomento))) {
    throw new CobranzaDescuadradaError('Hay una imputación en cero o mayor al saldo de la factura.')
  }
  if (destino.origen === 'caja' && !destino.plantaId) throw new CobranzaDescuadradaError('La cobranza de mostrador necesita la planta.')

  const ref = doc(collection(db, COBRANZAS))
  const cobranza: Omit<Cobranza, 'id'> = {
    origen:        destino.origen,
    ...(destino.origen === 'caja' ? { plantaId: destino.plantaId } : {}),
    registradoPor: { uid: actor.uid, nombre: actor.nombre },
    ...(actor.depositoTango ? { depositoTango: actor.depositoTango } : {}),
    clienteId:     args.clienteId,
    clienteNombre: args.clienteNombre,
    importe:       totalMedios / 100,
    formaPago:     'mixto',
    fecha:         Timestamp.now(),
    ...(args.numeroRecibo ? { numeroRecibo: args.numeroRecibo } : {}),
    empresa:       args.empresa,
    ...(args.codigoTango ? { codigoTango: args.codigoTango } : {}),
    imputaciones:  args.imputaciones,
    medios:        args.medios,
    ...(aCuenta > 0 ? { aCuenta: aCuenta / 100 } : {}),
  }
  const ctx = { origen: `crearCobranzaCompleta:${destino.origen}`, cobranzaId: ref.id, uid: actor.uid }
  if (destino.origen === 'caja') await esperarOEncolar(setDoc(ref, cobranza), ctx)
  else fireAndForget(setDoc(ref, cobranza), ctx)
  return { id: ref.id, ...cobranza }
}

// Cobranzas de una persona en un rango (liquidación del día y su propio
// resumen). Un chofer/cobrador solo registra en la calle, así que no hace
// falta filtrar por origen.
export const subscribeCobranzasChoferEnRango = (
  choferId: string,
  desde: Date, hasta: Date,
  callback: (cobranzas: Cobranza[]) => void,
  // Cuántas siguen solo en el teléfono (offline, sin confirmar por el
  // servidor) — mismo criterio que subscribeVentasRecientesChofer.
  onPendientes?: (cantidad: number) => void,
): () => void =>
  onSnapshot(
    query(
      collection(db, COBRANZAS),
      where('registradoPor.uid', '==', choferId),
      where('fecha', '>=', Timestamp.fromDate(desde)),
      where('fecha', '<', Timestamp.fromDate(hasta)),
    ),
    { includeMetadataChanges: !!onPendientes },
    (snap) => {
      callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Cobranza)))
      onPendientes?.(snap.docs.filter((d) => d.metadata.hasPendingWrites).length)
    },
    onSnapshotError(callback, 'cobranzas'),
  )

// Alias: la misma consulta sirve para cualquier persona que cobre (cajero,
// supervisor), no solo choferes — el índice es (registradoPor.uid, fecha).
export const subscribeCobranzasDeUsuarioEnRango = subscribeCobranzasChoferEnRango

// Todas las cobranzas de un día, de todos los orígenes (tablero en vivo de
// tesorería, 2026-09-09). Rango sobre un solo campo: sin índice compuesto.
export const subscribeCobranzasDelDia = (
  dia: Date,
  callback: (cobranzas: Cobranza[]) => void,
): () => void => {
  const desde = new Date(dia); desde.setHours(0, 0, 0, 0)
  const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 1)
  return onSnapshot(
    query(collection(db, COBRANZAS), where('fecha', '>=', Timestamp.fromDate(desde)), where('fecha', '<', Timestamp.fromDate(hasta))),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Cobranza)).sort((a, b) => b.fecha.toMillis() - a.fecha.toMillis())),
    onSnapshotError(callback, 'cobranzas'),
  )
}

// Cobranzas de mostrador del día de una planta (pantalla de caja).
export const subscribeCobranzasCajaDelDia = (
  plantaId: PlantaId,
  dia: Date,
  callback: (cobranzas: Cobranza[]) => void,
): () => void => {
  const desde = new Date(dia); desde.setHours(0, 0, 0, 0)
  const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 1)
  return onSnapshot(
    query(
      collection(db, COBRANZAS),
      where('plantaId', '==', plantaId),
      where('fecha', '>=', Timestamp.fromDate(desde)),
      where('fecha', '<', Timestamp.fromDate(hasta)),
    ),
    (snap) => callback(
      snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Cobranza))
        .sort((a, b) => b.fecha.toMillis() - a.fecha.toMillis()),
    ),
    onSnapshotError(callback, 'cobranzas'),
  )
}
