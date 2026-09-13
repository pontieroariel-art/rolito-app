/**
 * Faltante de la descarga contada (2026-09-13, control de fugas en expedición).
 *
 * Muelle cuenta A CIEGAS: la tablet no ve ni retiene lo que tendría que haber
 * vuelto, y las reglas no le dejan leer `ventasCamion`. Así que el faltante lo
 * calcula el servidor cuando la descarga se crea, y lo escribe en
 * `descargasCamion.revision`.
 *
 * ES UNA FOTO DEL MOMENTO DEL CONTEO. Si el chofer sube ventas más tarde (venía
 * sin señal), el faltante de esta marca queda inflado. Por eso lo que TRABA el
 * cierre de la liquidación es el recálculo en vivo que hace caja, con todas las
 * ventas del día a la vista; esto es la marca de auditoría y el disparador del
 * aviso. Misma regla que el front (src/utils/faltantes.ts): un sobrante NO
 * compensa un faltante.
 */

export interface ItemContado {
  productoId: string
  nombre:     string
  cantidad:   number
}

export interface RemitoParaRevision { items: ItemContado[] }
export interface VentaParaRevision {
  items:      ItemContado[]
  cambios?:   ItemContado[] | null
  anulacion?: { estado?: string } | null
}
export interface DescargaParaRevision { items: ItemContado[] }

export interface UmbralFaltantes { habilitado: boolean; bolsas: number }
export const UMBRAL_FALTANTES_DEFAULT: UmbralFaltantes = { habilitado: true, bolsas: 10 }

export interface RevisionCalculada {
  requiere:        boolean
  bolsasFaltantes: number
  bolsasSobrantes: number
  productos:       { productoId: string; nombre: string; faltan: number }[]
  umbral:          number
}

const PREFIJO_CAMBIO = 'cambio_'
/** Los renglones de cambio vienen con el id prefijado; se agrupan en el producto que son. */
const productoDelCambio = (id: string): string =>
  id.startsWith(PREFIJO_CAMBIO) ? id.slice(PREFIJO_CAMBIO.length) : id
const nombreDelCambio = (nombre: string): string =>
  nombre.startsWith('Cambio ') ? nombre.slice('Cambio '.length) : nombre

/** Igual que utils/liquidacion.ts: devolución teórica = carga − ventas − cambios. */
export function calcularRevision(
  remitos:   RemitoParaRevision[],
  ventas:    VentaParaRevision[],
  cambiosViejos: ItemContado[],
  descargas: DescargaParaRevision[],
  umbral:    UmbralFaltantes = UMBRAL_FALTANTES_DEFAULT,
): RevisionCalculada {
  const filas = new Map<string, { nombre: string; teorico: number; descarga: number }>()
  const fila = (productoId: string, nombre: string) => {
    let f = filas.get(productoId)
    if (!f) { f = { nombre, teorico: 0, descarga: 0 }; filas.set(productoId, f) }
    return f
  }

  remitos.forEach((r) => (r.items ?? []).forEach((i) => { fila(i.productoId, i.nombre).teorico += i.cantidad }))
  // Una venta anulada con nota de crédito no cuenta: la NC ya devolvió el stock.
  ventas
    .filter((v) => v.anulacion?.estado !== 'anulada')
    .forEach((v) => {
      (v.items ?? []).forEach((i) => { fila(i.productoId, i.nombre).teorico -= i.cantidad })
      ;(v.cambios ?? []).forEach((i) => {
        fila(productoDelCambio(i.productoId), nombreDelCambio(i.nombre)).teorico -= i.cantidad
      })
    })
  // Registro viejo de cambios (cuando el cambio era una pantalla aparte).
  cambiosViejos.forEach((c) => { fila(productoDelCambio(c.productoId), nombreDelCambio(c.nombre)).teorico -= c.cantidad })
  descargas.forEach((d) => (d.items ?? []).forEach((i) => { fila(i.productoId, i.nombre).descarga += i.cantidad }))

  const productos: RevisionCalculada['productos'] = []
  let bolsasFaltantes = 0
  let bolsasSobrantes = 0
  filas.forEach((f, productoId) => {
    const diferencia = f.descarga - f.teorico
    if (diferencia < 0) { productos.push({ productoId, nombre: f.nombre, faltan: -diferencia }); bolsasFaltantes += -diferencia }
    else bolsasSobrantes += diferencia
  })
  productos.sort((a, b) => b.faltan - a.faltan || a.nombre.localeCompare(b.nombre))

  return {
    requiere: umbral.habilitado && umbral.bolsas > 0 && bolsasFaltantes >= umbral.bolsas,
    bolsasFaltantes,
    bolsasSobrantes,
    productos,
    umbral: umbral.bolsas,
  }
}

/** Sanea config/liquidacion.faltantes (mismo criterio que el front). */
export function normalizarUmbralFaltantes(raw: unknown): UmbralFaltantes {
  const o = (raw ?? {}) as Partial<UmbralFaltantes>
  const bolsas = typeof o.bolsas === 'number' && Number.isFinite(o.bolsas) && o.bolsas > 0
    ? Math.round(o.bolsas)
    : UMBRAL_FALTANTES_DEFAULT.bolsas
  return {
    habilitado: typeof o.habilitado === 'boolean' ? o.habilitado : UMBRAL_FALTANTES_DEFAULT.habilitado,
    bolsas,
  }
}
