import { claveDia } from '@/utils/diaReparto'
import { collection, onSnapshot, query, where, Timestamp } from 'firebase/firestore'
import { auth, db } from './firebase'
import { onSnapshotError } from './observability'
import { CambioCamion, Cobranza, DescargaCamion, EntregaFabrica, Order, RemitoCarga, VentaCamion } from '../types'

/** Las entregas con remito de fábrica de una lista de pedidos (solo los que la tienen). */
const entregasDe = (snap: { docs: { data(): unknown }[] }): EntregaFabrica[] =>
  snap.docs.map((d) => (d.data() as Order).entregaFabrica).filter((e): e is EntregaFabrica => !!e)

// Fuentes del "Reparto en vivo" del supervisor: todo lo del día, de todos los
// camiones y las dos plantas. Cinco suscripciones acotadas por fecha (rango de
// un día, sin índice compuesto); cada cambio en cualquiera dispara el callback
// con el conjunto completo. Permisos: rol supervisor lee estas colecciones
// (firestore.rules, 2026-09-05).

export interface FuentesRepartoEnVivo {
  remitos:   RemitoCarga[]
  ventas:    VentaCamion[]
  cambios:   CambioCamion[]
  descargas: DescargaCamion[]
  cobranzas: Cobranza[]      // solo origen 'cobrador' (cobradas en la calle por choferes)
  /** Entregas con remito de fábrica (Coto/Carrefour, 2026-09-23): bajan del camión sin venta de la app. */
  entregasFabrica: EntregaFabrica[]
}

export function subscribeRepartoEnVivo(dia: Date, callback: (f: FuentesRepartoEnVivo) => void): () => void {
  const desde = new Date(dia); desde.setHours(0, 0, 0, 0)
  const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 1)
  const d = Timestamp.fromDate(desde), h = Timestamp.fromDate(hasta)

  const f: FuentesRepartoEnVivo = { remitos: [], ventas: [], cambios: [], descargas: [], cobranzas: [], entregasFabrica: [] }
  const emitir = () => callback({ ...f })
  const mapear = <T>(snap: { docs: { id: string; data(): unknown }[] }) => snap.docs.map((x) => ({ id: x.id, ...(x.data() as object) }) as T)

  const unsubs = [
    // Dos igualdades, sin índice. Leen `orders` los roles de oficina, caja y tesorería.
    onSnapshot(query(collection(db, 'orders'), where('entregaFabrica.dia', '==', claveDia(desde))),
      (s) => { f.entregasFabrica = entregasDe(s); emitir() }, onSnapshotError((x: EntregaFabrica[]) => { f.entregasFabrica = x; emitir() }, 'repartoEnVivo.entregasFabrica')),
    onSnapshot(query(collection(db, 'remitosCarga'), where('fecha', '>=', d), where('fecha', '<', h)),
      (s) => { f.remitos = mapear<RemitoCarga>(s); emitir() }, onSnapshotError((x: RemitoCarga[]) => { f.remitos = x; emitir() }, 'repartoEnVivo.remitosCarga')),
    onSnapshot(query(collection(db, 'ventasCamion'), where('fecha', '>=', d), where('fecha', '<', h)),
      (s) => { f.ventas = mapear<VentaCamion>(s); emitir() }, onSnapshotError((x: VentaCamion[]) => { f.ventas = x; emitir() }, 'repartoEnVivo.ventasCamion')),
    onSnapshot(query(collection(db, 'cambiosCamion'), where('fecha', '>=', d), where('fecha', '<', h)),
      (s) => { f.cambios = mapear<CambioCamion>(s); emitir() }, onSnapshotError((x: CambioCamion[]) => { f.cambios = x; emitir() }, 'repartoEnVivo.cambiosCamion')),
    // Descargas por día de VIAJE (diaReparto, 2026-09-17), no por el día del conteo.
    onSnapshot(query(collection(db, 'descargasCamion'), where('diaReparto', '==', claveDia(desde))),
      (s) => { f.descargas = mapear<DescargaCamion>(s); emitir() }, onSnapshotError((x: DescargaCamion[]) => { f.descargas = x; emitir() }, 'repartoEnVivo.descargasCamion')),
    // Índice compuesto (origen, fecha) ya existe (firestore.indexes.json).
    onSnapshot(query(collection(db, 'cobranzas'), where('origen', '==', 'cobrador'), where('fecha', '>=', d), where('fecha', '<', h)),
      (s) => { f.cobranzas = mapear<Cobranza>(s); emitir() }, onSnapshotError((x: Cobranza[]) => { f.cobranzas = x; emitir() }, 'repartoEnVivo.cobranzas')),
  ]
  return () => unsubs.forEach((u) => u())
}

// "Mi camión hoy" del chofer (2026-09-10): las mismas cinco fuentes, pero solo
// las suyas (las reglas le dejan leer su propio remito de carga, ventas,
// cambios, descarga y cobranzas). Índices (choferId, fecha) y
// (registradoPor.uid, fecha) ya existen (firestore.indexes.json).
export function subscribeRepartoDelChofer(dia: Date, choferId: string, callback: (f: FuentesRepartoEnVivo) => void): () => void {
  const desde = new Date(dia); desde.setHours(0, 0, 0, 0)
  const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 1)
  const d = Timestamp.fromDate(desde), h = Timestamp.fromDate(hasta)

  const f: FuentesRepartoEnVivo = { remitos: [], ventas: [], cambios: [], descargas: [], cobranzas: [], entregasFabrica: [] }
  const emitir = () => callback({ ...f })
  const mapear = <T>(snap: { docs: { id: string; data(): unknown }[] }) => snap.docs.map((x) => ({ id: x.id, ...(x.data() as object) }) as T)

  // Las reglas le dejan al chofer leer los pedidos asignados a su email.
  const email = auth.currentUser?.email ?? ''
  const unsubs = [
    ...(email ? [onSnapshot(query(collection(db, 'orders'), where('driverId', '==', email), where('entregaFabrica.dia', '==', claveDia(desde))),
      (s) => { f.entregasFabrica = entregasDe(s).filter((e) => e.choferId === choferId); emitir() }, onSnapshotError((x: EntregaFabrica[]) => { f.entregasFabrica = x; emitir() }, 'miCamion.entregasFabrica'))] : []),
    onSnapshot(query(collection(db, 'remitosCarga'), where('choferId', '==', choferId), where('fecha', '>=', d), where('fecha', '<', h)),
      (s) => { f.remitos = mapear<RemitoCarga>(s); emitir() }, onSnapshotError((x: RemitoCarga[]) => { f.remitos = x; emitir() }, 'miCamion.remitosCarga')),
    onSnapshot(query(collection(db, 'ventasCamion'), where('choferId', '==', choferId), where('fecha', '>=', d), where('fecha', '<', h)),
      (s) => { f.ventas = mapear<VentaCamion>(s); emitir() }, onSnapshotError((x: VentaCamion[]) => { f.ventas = x; emitir() }, 'miCamion.ventasCamion')),
    onSnapshot(query(collection(db, 'cambiosCamion'), where('choferId', '==', choferId), where('fecha', '>=', d), where('fecha', '<', h)),
      (s) => { f.cambios = mapear<CambioCamion>(s); emitir() }, onSnapshotError((x: CambioCamion[]) => { f.cambios = x; emitir() }, 'miCamion.cambiosCamion')),
    onSnapshot(query(collection(db, 'descargasCamion'), where('choferId', '==', choferId), where('diaReparto', '==', claveDia(desde))),
      (s) => { f.descargas = mapear<DescargaCamion>(s); emitir() }, onSnapshotError((x: DescargaCamion[]) => { f.descargas = x; emitir() }, 'miCamion.descargasCamion')),
    onSnapshot(query(collection(db, 'cobranzas'), where('registradoPor.uid', '==', choferId), where('fecha', '>=', d), where('fecha', '<', h)),
      (s) => { f.cobranzas = mapear<Cobranza>(s).filter((c) => c.origen === 'cobrador'); emitir() }, onSnapshotError((x: Cobranza[]) => { f.cobranzas = x; emitir() }, 'miCamion.cobranzas')),
  ]
  return () => unsubs.forEach((u) => u())
}
