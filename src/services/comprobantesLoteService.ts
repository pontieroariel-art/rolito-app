import { obtenerFacturaPdf, obtenerRemitoPdf } from './facturaAdeudadaService'
import { reportError } from './observability'
import type { ItemLote } from '@/utils/comprobantesLote'

// Genera los PDF de varios comprobantes elegidos (facturas y remitos de
// Tango) de a uno, avisando el avance, para mandarlos o bajarlos en bloque
// (2026-09-10, Comprobantes de clientes). Cada PDF sale de la misma cascada
// que usa la ficha del supervisor (venta de la app → detalle de Tango →
// archivo de administración); el que no se pueda armar queda en `fallidos`
// con el motivo, sin frenar al resto.

export interface PdfDeItem { item: ItemLote; blob: Blob; nombre: string }
export interface FallaDeItem { item: ItemLote; motivo: string }
export interface ResultadoLote { generados: PdfDeItem[]; fallidos: FallaDeItem[] }

export interface ProgresoLote { hecho: number; total: number; actual: ItemLote | null }

/** Nombre de archivo único dentro del lote (dos ventas distintas pueden tener el mismo nombre genérico). */
function nombreUnico(nombre: string, usados: Set<string>): string {
  let n = nombre
  for (let i = 2; usados.has(n); i++) n = nombre.replace(/\.pdf$/i, '') + `-${i}.pdf`
  usados.add(n)
  return n
}

export async function generarPdfsLote(
  items: ItemLote[],
  onProgreso?: (p: ProgresoLote) => void,
  cancelado?: () => boolean,
): Promise<ResultadoLote> {
  const usados = new Set<string>()
  // Hasta 3 en vuelo (2026-09-12): cada PDF son varias lecturas de Firestore y
  // en serie un lote de 20 tardaba lo que sumaban todas. Los resultados se
  // guardan por posición para que el orden del lote no dependa de cuál terminó antes.
  const CONCURRENCIA = 3
  const resultados: Array<{ ok: true; blob: Blob; nombre: string } | { ok: false; motivo: string } | null> = items.map(() => null)
  let hecho = 0, siguiente = 0
  const trabajador = async () => {
    while (siguiente < items.length) {
      if (cancelado?.()) return
      const i = siguiente++
      const item = items[i]
      onProgreso?.({ hecho, total: items.length, actual: item })
      try {
        const r = item.clase === 'factura'
          ? await obtenerFacturaPdf({ tipo: item.tipo, numero: item.numero }, item.empresa)
          : await obtenerRemitoPdf(item.numero, item.empresa)
        resultados[i] = r.ok ? { ok: true, blob: r.blob, nombre: r.nombre } : { ok: false, motivo: r.motivo }
      } catch (err) {
        reportError(err, { origen: 'generarPdfsLote', clave: item.clave })
        resultados[i] = { ok: false, motivo: 'No se pudo generar el PDF.' }
      }
      hecho++
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, items.length) }, trabajador))
  const generados: PdfDeItem[] = []
  const fallidos: FallaDeItem[] = []
  items.forEach((item, i) => {
    const r = resultados[i]
    if (!r) return   // cancelado antes de empezar
    if (r.ok) generados.push({ item, blob: r.blob, nombre: nombreUnico(r.nombre, usados) })
    else fallidos.push({ item, motivo: r.motivo })
  })
  onProgreso?.({ hecho: items.length, total: items.length, actual: null })
  return { generados, fallidos }
}
