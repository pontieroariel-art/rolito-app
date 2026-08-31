import { doc, getDoc, setDoc } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from './firebase'
import { CatalogProducto } from '../types'
import { PRODUCTS } from '../utils/constants'
import { resizeImage } from '../utils/imagen'

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

// Sube la foto de un producto a Storage (catalogo/{productoId}), redimensionada
// en el cliente, y devuelve el downloadURL para guardar en el catálogo. No
// escribe el catálogo: el que llama arma el array y usa saveCatalogo.
export const subirFotoProducto = async (productoId: string, file: File): Promise<string> => {
  const blob    = await resizeImage(file)
  const fotoRef = ref(storage, `catalogo/${productoId}`)
  await uploadBytes(fotoRef, blob, { contentType: 'image/jpeg' })
  return getDownloadURL(fotoRef)
}
