// Faltante de mercadería en la descarga contada (2026-09-13, control de fugas).
//
// El muelle cuenta A CIEGAS: nunca ve el teórico, ni antes ni después de
// registrar, porque mostrarlo destruye el control. El faltante lo calcula el
// SERVIDOR cuando la descarga se crea (muelle no puede leer `ventasCamion`:
// firestore.rules) y lo vuelve a calcular caja en vivo al liquidar el día.
//
// Acá vive la regla, pura, compartida por las tres puntas: la marca que escribe
// el trigger, el gate del cierre en caja y el panel de Ajustes generales.
//
// Sobre el teórico: `devolucionTeorica = carga − ventas − cambios` y
// `diferencia = descarga − devolucionTeorica` (utils/liquidacion.ts). Negativo
// es lo que falta.

export interface UmbralFaltantes {
  /** Con el control apagado nada se marca ni traba (arranque y días raros). */
  habilitado: boolean
  /** Bolsas faltantes desde las cuales el desvío es grave. */
  bolsas: number
}

export const UMBRAL_FALTANTES_DEFAULT: UmbralFaltantes = { habilitado: true, bolsas: 10 }

export interface DiferenciaProducto {
  productoId: string
  nombre:     string
  /** descarga − devolución teórica: negativo = falta, positivo = sobra. */
  diferencia: number
}

export interface FaltanteProducto {
  productoId: string
  nombre:     string
  faltan:     number
}

export interface FaltanteCalculado {
  /** Suma de lo que falta, sin compensar con lo que sobra. */
  bolsasFaltantes: number
  bolsasSobrantes: number
  /** Solo los productos con faltante, del más grande al más chico. */
  productos: FaltanteProducto[]
  /** Pasó el umbral: hay que revisarlo antes de cerrar la caja. */
  grave: boolean
  /**
   * Todavía no hay descarga contada (2026-09-14): el camión sigue en la calle o
   * muelle no contó. No hay faltante que informar, porque comparar la
   * devolución teórica contra un conteo que no existe daba "faltan 948 bolsas"
   * mientras el chofer repartía, y caja aprendía a ignorar el cartel rojo.
   */
  sinDescarga?: boolean
}

/**
 * Un sobrante NO compensa un faltante: si faltan 12 bolsas de 3 kg y sobran 12
 * de escamas, no es que "está" — son dos desvíos, y taparlos entre sí es
 * exactamente la fuga que este control busca. Por eso se suman los faltantes
 * aparte y el umbral se mide contra ese total.
 */
export function calcularFaltante(
  diferencias: DiferenciaProducto[],
  umbral: UmbralFaltantes = UMBRAL_FALTANTES_DEFAULT,
  opts: { hayDescarga?: boolean } = {},
): FaltanteCalculado {
  // Sin conteo del muelle no hay control que hacer todavía: cero faltante,
  // nada grave, y la marca para que la pantalla lo diga con esas palabras.
  if (opts.hayDescarga === false) {
    return { bolsasFaltantes: 0, bolsasSobrantes: 0, productos: [], grave: false, sinDescarga: true }
  }
  const productos = diferencias
    .filter((d) => d.diferencia < 0)
    .map((d) => ({ productoId: d.productoId, nombre: d.nombre, faltan: -d.diferencia }))
    .sort((a, b) => b.faltan - a.faltan || a.nombre.localeCompare(b.nombre))
  const bolsasFaltantes = productos.reduce((s, p) => s + p.faltan, 0)
  const bolsasSobrantes = diferencias.reduce((s, d) => s + Math.max(0, d.diferencia), 0)
  return {
    bolsasFaltantes,
    bolsasSobrantes,
    productos,
    grave: umbral.habilitado && umbral.bolsas > 0 && bolsasFaltantes >= umbral.bolsas,
  }
}

/** Sanea lo que viene de Firestore: el default si el dato no sirve. */
export function normalizarUmbralFaltantes(raw: Partial<UmbralFaltantes> | null | undefined): UmbralFaltantes {
  const bolsas = typeof raw?.bolsas === 'number' && Number.isFinite(raw.bolsas) && raw.bolsas > 0
    ? Math.round(raw.bolsas)
    : UMBRAL_FALTANTES_DEFAULT.bolsas
  return {
    habilitado: typeof raw?.habilitado === 'boolean' ? raw.habilitado : UMBRAL_FALTANTES_DEFAULT.habilitado,
    bolsas,
  }
}

/**
 * Un producto "en bolsa" por su nombre (Hielo bolsa 3kg, Hielo picado bolsa
 * 10kg, escamas). `bolsasFaltantes` suma TODO lo que falta, hielo o no, así
 * que la palabra "bolsas" solo vale cuando lo que falta es hielo (2026-09-23,
 * Ariel: "acá no faltan bolsas sino que son agua").
 */
export const esProductoEnBolsa = (nombre: string): boolean => /bolsa|hielo|escamas/i.test(nombre)

/**
 * Cantidad con su unidad: "20 bolsas" si todo lo que falta es hielo en bolsa,
 * "20 de Agua desmineralizada x 6 litros" si es un solo producto de otra cosa,
 * "35 unidades" si se mezclan. Los que llaman anteponen "faltan".
 */
export function textoFaltante(productos: Pick<FaltanteProducto, 'nombre' | 'faltan'>[], total?: number): string {
  const n = total ?? productos.reduce((s, p) => s + p.faltan, 0)
  if (productos.length > 0 && productos.every((p) => esProductoEnBolsa(p.nombre))) return `${n} bolsa${n === 1 ? '' : 's'}`
  if (productos.length === 1) return `${n} de ${productos[0]!.nombre}`
  return `${n} unidad${n === 1 ? '' : 'es'}`
}

/** Texto corto del desvío, para el chip de caja y la bandeja. */
export function describirFaltante(f: FaltanteCalculado): string {
  if (f.sinDescarga) return 'Sin descarga contada todavía'
  if (f.bolsasFaltantes === 0) return 'Sin faltantes'
  const detalle = f.productos.map((p) => `${p.faltan} ${p.nombre}`).join(', ')
  return `Faltan ${textoFaltante(f.productos, f.bolsasFaltantes)} (${detalle})`
}
