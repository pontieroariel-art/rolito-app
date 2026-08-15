import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import { MotivoIngreso } from '../types'

const motivosIngresoRef = () => doc(db, 'config', 'motivosIngreso')

// Motivos por defecto pedidos por el negocio — se siembran la primera vez
// que se lee el catálogo (documento todavía no existe).
const DEFAULTS: MotivoIngreso[] = [
  { id: 'retiro_heladera', nombre: 'Retiro de heladera',                     tipoOperacion: 'RETIRO', activo: true },
  { id: 'cambio_heladera', nombre: 'Cambio de heladera',                     tipoOperacion: 'CAMBIO', activo: true },
  { id: 'cambio_motor',    nombre: 'Cambio por motor',                       tipoOperacion: 'CAMBIO', activo: true },
  { id: 'cambio_gas',      nombre: 'Cambio por pérdida de gas refrigerante', tipoOperacion: 'CAMBIO', activo: true },
  { id: 'cambio_estetica', nombre: 'Cambio por estética',                    tipoOperacion: 'CAMBIO', activo: true },
]

export const getMotivosIngreso = async (): Promise<MotivoIngreso[]> => {
  try {
    const snap = await getDoc(motivosIngresoRef())
    if (snap.exists()) return (snap.data().items as MotivoIngreso[]) ?? []
    await setDoc(motivosIngresoRef(), { items: DEFAULTS })
    return DEFAULTS
  } catch {
    return []
  }
}

export const saveMotivosIngreso = (items: MotivoIngreso[]): Promise<void> =>
  setDoc(motivosIngresoRef(), { items })
