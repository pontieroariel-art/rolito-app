import { collection, onSnapshot, query, where, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { onSnapshotError } from './observability'
import { CambioCamion, Cobranza, DescargaCamion, RemitoCarga, VentaCamion } from '../types'

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
}

export function subscribeRepartoEnVivo(dia: Date, callback: (f: FuentesRepartoEnVivo) => void): () => void {
  const desde = new Date(dia); desde.setHours(0, 0, 0, 0)
  const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 1)
  const d = Timestamp.fromDate(desde), h = Timestamp.fromDate(hasta)

  const f: FuentesRepartoEnVivo = { remitos: [], ventas: [], cambios: [], descargas: [], cobranzas: [] }
  const emitir = () => callback({ ...f })
  const mapear = <T>(snap: { docs: { id: string; data(): unknown }[] }) => snap.docs.map((x) => ({ id: x.id, ...(x.data() as object) }) as T)

  const unsubs = [
    onSnapshot(query(collection(db, 'remitosCarga'), where('fecha', '>=', d), where('fecha', '<', h)),
      (s) => { f.remitos = mapear<RemitoCarga>(s); emitir() }, onSnapshotError((x: RemitoCarga[]) => { f.remitos = x; emitir() }, 'repartoEnVivo.remitosCarga')),
    onSnapshot(query(collection(db, 'ventasCamion'), where('fecha', '>=', d), where('fecha', '<', h)),
      (s) => { f.ventas = mapear<VentaCamion>(s); emitir() }, onSnapshotError((x: VentaCamion[]) => { f.ventas = x; emitir() }, 'repartoEnVivo.ventasCamion')),
    onSnapshot(query(collection(db, 'cambiosCamion'), where('fecha', '>=', d), where('fecha', '<', h)),
      (s) => { f.cambios = mapear<CambioCamion>(s); emitir() }, onSnapshotError((x: CambioCamion[]) => { f.cambios = x; emitir() }, 'repartoEnVivo.cambiosCamion')),
    onSnapshot(query(collection(db, 'descargasCamion'), where('fecha', '>=', d), where('fecha', '<', h)),
      (s) => { f.descargas = mapear<DescargaCamion>(s); emitir() }, onSnapshotError((x: DescargaCamion[]) => { f.descargas = x; emitir() }, 'repartoEnVivo.descargasCamion')),
    // Índice compuesto (origen, fecha) ya existe (firestore.indexes.json).
    onSnapshot(query(collection(db, 'cobranzas'), where('origen', '==', 'cobrador'), where('fecha', '>=', d), where('fecha', '<', h)),
      (s) => { f.cobranzas = mapear<Cobranza>(s); emitir() }, onSnapshotError((x: Cobranza[]) => { f.cobranzas = x; emitir() }, 'repartoEnVivo.cobranzas')),
  ]
  return () => unsubs.forEach((u) => u())
}
