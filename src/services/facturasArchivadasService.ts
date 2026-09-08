import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { getBlob, ref, uploadBytes } from 'firebase/storage'
import { db, storage } from './firebase'
import { claveFactura } from '@/utils/facturaClave'
import type { FacturaPdfData } from '@/utils/facturaPdf'
import type { EmpresaTango, FacturaArchivada } from '@/types'

// Facturas de Tango archivadas por administración (Recupero de facturas →
// "Guardar en la app"): el PDF regenerado con CAE va a Storage y un doc
// liviano en facturasArchivadas lo indexa por empresa + clave. El supervisor
// lo baja desde la ficha del cliente para compartirlo por WhatsApp.

const COLECCION = 'facturasArchivadas'

export const idFacturaArchivada = (empresa: EmpresaTango, clave: string) => `${empresa}-${clave}`
export const rutaPdfFactura = (empresa: EmpresaTango, clave: string) => `facturas/${empresa}/${clave}.pdf`

export const getFacturaArchivada = async (empresa: EmpresaTango, clave: string): Promise<FacturaArchivada | null> => {
  const snap = await getDoc(doc(db, COLECCION, idFacturaArchivada(empresa, clave)))
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as FacturaArchivada) : null
}

/** Sube el PDF y escribe (o pisa) el índice. Devuelve la clave. */
export async function archivarFactura(
  empresa: EmpresaTango,
  f: FacturaPdfData,
  pdf: Blob,
  actor: { uid: string; nombre: string },
): Promise<string> {
  const clave = claveFactura(f.letra, f.puntoVenta, f.numero)
  const storagePath = rutaPdfFactura(empresa, clave)
  await uploadBytes(ref(storage, storagePath), pdf, { contentType: 'application/pdf' })
  const fecha = f.fechaEmision
  const ymd = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`
  const datos: Omit<FacturaArchivada, 'id' | 'subidoEn'> = {
    clave, empresa,
    letra:       f.letra,
    puntoVenta:  f.puntoVenta,
    numero:      f.numero,
    fecha:       ymd,
    total:       f.totales.total,
    cuitCliente: f.cliente.cuit,
    razonSocial: f.cliente.razonSocial,
    storagePath,
    subidoPor:   actor,
  }
  await setDoc(doc(db, COLECCION, idFacturaArchivada(empresa, clave)), { ...datos, subidoEn: serverTimestamp() })
  return clave
}

/** Baja el PDF archivado (requiere CORS GET en el bucket para el origen de la app). */
export const blobFacturaArchivada = (f: Pick<FacturaArchivada, 'storagePath'>): Promise<Blob> =>
  getBlob(ref(storage, f.storagePath))
