// Ventas reales por producto de producción, por planta y por día (2026-09-25).
//
// Para el panel del encargado de producción: "cuántos pallets se produjeron y
// cuántos se vendieron", la pauta de si se vende más de lo que se produce y
// se puede levantar stock (pedido de Ariel). El encargado NO puede leer las
// ventas sueltas (reglas), así que el servidor las resume en
// rollupsVentasProducto/{YYYY-MM-DD}.
//
// "Vendido" = ventas reales (decisión de Ariel): lo que se llevó el cliente en
// la calle (ventasCamion) y en la ventanilla (ventasVentanilla), sin las
// anuladas y sin los cambios (bolsas repuestas sin cargo).
//
// Los productos de la venta (catálogo: bolsa_10kg…) y los de producción
// (tablet: bolsas_10kg_rolito…) se cruzan por el ARTÍCULO DE TANGO, que es la
// identidad real: config/tango.articulos y config/tango.sql.stock.tipos.
// produccion_<planta>.articulos. Así no hay un mapa más que mantener.
//
// Módulo puro: se testea con vitest.

export interface ItemVentaMinimo { productoId?: string; cantidad?: number }
export interface VentaMinima {
  items?: ItemVentaMinimo[]
  anulacion?: { estado?: string } | null
  /** Solo ventanilla: la planta de la venta. */
  plantaId?: string
  /** Solo camión: el viaje, para saber de qué planta salió. */
  remitoId?: string | null
}

/** Unidades vendidas por producto de producción, por planta ('sin_planta' si no se sabe). */
export type VendidoPorPlanta = Record<string, Record<string, number>>

/**
 * Mapa producto de venta → producto de producción, cruzando por artículo de
 * Tango. `articulosVenta`: catálogo → código. `articulosProduccion`: los mapas
 * de cada planta (producción → código).
 */
export function mapaVentaAProduccion(
  articulosVenta: Record<string, string>,
  articulosProduccion: Record<string, string>[],
): Record<string, string> {
  const porCodigo = new Map<string, string>()
  for (const mapa of articulosProduccion) {
    for (const [prodId, codigo] of Object.entries(mapa)) if (codigo) porCodigo.set(codigo, prodId)
  }
  const out: Record<string, string> = {}
  for (const [ventaId, codigo] of Object.entries(articulosVenta)) {
    const prodId = porCodigo.get(codigo)
    if (prodId) out[ventaId] = prodId
  }
  return out
}

/**
 * Suma las unidades vendidas por planta y producto de producción. `plantaDe`
 * resuelve la planta de cada venta (ventanilla: su plantaId; camión: la del
 * remito de carga del viaje). Los productos sin cruce (agua, cambios…) no
 * cuentan: no son producción de hielo.
 */
export function sumarVendido(
  ventas: VentaMinima[],
  ventaAProduccion: Record<string, string>,
  plantaDe: (v: VentaMinima) => string | null,
): VendidoPorPlanta {
  const out: VendidoPorPlanta = {}
  for (const v of ventas) {
    if (v.anulacion?.estado === 'anulada') continue
    const planta = plantaDe(v) ?? 'sin_planta'
    for (const it of v.items ?? []) {
      const prodId = it.productoId ? ventaAProduccion[it.productoId] : undefined
      const cantidad = Number(it.cantidad)
      if (!prodId || !(cantidad > 0)) continue
      const p = (out[planta] ??= {})
      p[prodId] = (p[prodId] ?? 0) + cantidad
    }
  }
  return out
}
