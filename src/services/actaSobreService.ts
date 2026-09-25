import { doc, getDoc } from 'firebase/firestore'
import type { Cobranza, Liquidacion, Sobre, VentaVentanilla } from '@/types'
import { db } from './firebase'
import { personasDelActa } from '@/utils/actaSobre'
import { compartirActaSobre, generateActaSobre, nombreArchivoSobre, type DetalleActaSobre } from '@/utils/sobrePdf'

// El acta del sobre lista, persona por persona, lo que el cajero recibió de
// cada chofer o cobrador (2026-09-14). El sobre guarda solo los ids de las
// liquidaciones (`sistema.origenIds.liquidacionesIds`), así que para
// imprimirla —recién cerrada, desde el historial o desde tesorería— se
// traen esas liquidaciones y las cobranzas que cada una referencia.

const leer = async <T>(coleccion: string, ids: string[]): Promise<T[]> => {
  const snaps = await Promise.all(ids.map((id) => getDoc(doc(db, coleccion, id))))
  return snaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() }) as T)
}

export async function detalleDelActa(sobre: Sobre): Promise<DetalleActaSobre> {
  const o = sobre.sistema.origenIds
  const ids = o.liquidacionesIds
  // Los anticipos del turno (2026-09-23) restan en el acta igual que en la pantalla.
  const anticipos = sobre.tipo === 'ventanilla' && o.anticiposIds?.length ? await leer<Sobre>('rendiciones', o.anticiposIds) : []
  // El acta igual a la pantalla (2026-09-24): ventas y cobranzas del turno una por una.
  const [ventas, cobranzasMostrador, liquidaciones] = await Promise.all([
    sobre.tipo === 'ventanilla' ? leer<VentaVentanilla>('ventasVentanilla', o.ventasIds) : Promise.resolve([] as VentaVentanilla[]),
    sobre.tipo === 'ventanilla' ? leer<Cobranza>('cobranzas', o.cobranzasIds) : Promise.resolve([] as Cobranza[]),
    ids.length ? leer<Liquidacion>('liquidaciones', ids) : Promise.resolve([] as Liquidacion[]),
  ])
  if (!ids.length) return { personas: [], anticipos, ventas, cobranzas: cobranzasMostrador, liquidaciones }
  const cobranzas = await leer<Cobranza>('cobranzas', [...new Set(liquidaciones.flatMap((l) => l.cobranzasIds ?? []))])
  return { personas: personasDelActa(liquidaciones, cobranzas), anticipos, ventas, cobranzas: cobranzasMostrador, liquidaciones }
}

/** Comparte el acta con el detalle por persona. Si el detalle no se puede leer, sale igual con la cifra total. */
export async function compartirActaSobreCompleta(sobre: Sobre) {
  const detalle = await detalleDelActa(sobre).catch((): DetalleActaSobre => ({ sinDetalle: true }))
  return compartirActaSobre(sobre, detalle)
}

/** El acta como archivo en memoria, para el visor (2026-09-15): no baja nada sola. */
export async function actaSobreBlob(sobre: Sobre): Promise<{ blob: Blob; nombre: string }> {
  const detalle = await detalleDelActa(sobre).catch((): DetalleActaSobre => ({ sinDetalle: true }))
  const blob = await generateActaSobre(sobre, detalle)
  return { blob, nombre: nombreArchivoSobre(sobre) }
}
