import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import { CatalogProducto } from '../types'
import { PRODUCTS } from '../utils/constants'

const catalogoRef = () => doc(db, 'config', 'catalogo')

const SEED: CatalogProducto[] = PRODUCTS.map((p) => ({
  id:     p.id,
  nombre: p.name,
  unidad: p.unit,
}))

export const getCatalogo = async (): Promise<CatalogProducto[]> => {
  try {
    const snap = await getDoc(catalogoRef())
    if (snap.exists()) return (snap.data().productos as CatalogProducto[]) ?? []
    await setDoc(catalogoRef(), { productos: SEED })
    return SEED
  } catch {
    return SEED
  }
}

export const saveCatalogo = (productos: CatalogProducto[]): Promise<void> =>
  setDoc(catalogoRef(), { productos })
