// Total con IVA de una venta que va a factura electrónica (2026-09-11).
//
// Los precios de lista de Tango son netos (config/arca.preciosIncluyenIva =
// false), así que el total que suma la pantalla de venta es SIN IVA y la
// factura que emite el servidor le agrega el 21 % (y la percepción de IIBB si
// el cliente está en el padrón). El chofer le decía al cliente un importe y la
// factura salía con otro. Este cálculo replica al del servidor
// (functions/src/services/arca/comprobante.ts → calcularImportes: redondeo
// half-even por ítem, percepción sobre el neto) para que la pantalla muestre
// exactamente lo que va a facturar. Es informativo: la autoridad es el server.

export interface ItemFacturable { cantidad: number; precioUnitario: number }
export interface OpcionesTotal {
  preciosIncluyenIva: boolean
  /** Alícuota de percepción de IIBB (%) si el cliente está en el padrón y vigente; 0 o ausente = no se percibe. */
  percepcionAlicuota?: number
}
export interface DesgloseFactura { neto: number; iva: number; percepcion: number; total: number }

export const ALICUOTA_IVA_VENTA = 21

/** Redondeo a centavos "half even", el criterio de ARCA (mismo que el server). */
export function redondear2(n: number): number {
  const escalado = n * 100
  const piso = Math.floor(escalado)
  const resto = escalado - piso
  let redondeado: number
  if (Math.abs(resto - 0.5) < 1e-9) redondeado = piso % 2 === 0 ? piso : piso + 1
  else redondeado = Math.round(escalado)
  return redondeado / 100 + 0
}

export function desgloseFactura(items: ItemFacturable[], opciones: OpcionesTotal): DesgloseFactura {
  const factor = 1 + ALICUOTA_IVA_VENTA / 100
  let neto = 0, iva = 0
  for (const i of items) {
    if (!(i.cantidad > 0)) continue
    const bruto = i.cantidad * i.precioUnitario
    const base = redondear2(opciones.preciosIncluyenIva ? bruto / factor : bruto)
    neto = redondear2(neto + base)
    iva  = redondear2(iva + redondear2(base * (ALICUOTA_IVA_VENTA / 100)))
  }
  const alic = opciones.percepcionAlicuota ?? 0
  const percepcion = alic > 0 ? redondear2(neto * (alic / 100)) : 0
  return { neto, iva, percepcion, total: redondear2(neto + iva + percepcion) }
}

// ── Percepción de IIBB del cliente (users.percepcionIIBB, la carga el padrón de AGIP) ──

type FechaLike = string | Date | { toDate?: () => Date } | null | undefined

function diaISO(v: FechaLike): string | null {
  if (!v) return null
  if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null
  const d = v instanceof Date ? v : typeof v.toDate === 'function' ? v.toDate() : null
  if (!d || Number.isNaN(d.getTime())) return null
  // Día calendario argentino, como diaCalendarioAr del server.
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
}

/**
 * Alícuota de percepción vigente hoy para el perfil, o 0. Sin vigencia
 * cargada devuelve 0: el server frena la factura en ese caso y avisa.
 */
export function percepcionVigenteDe(
  perfil: { percepcionIIBB?: { alicuota?: unknown; vigenciaDesde?: FechaLike; vigenciaHasta?: FechaLike } | null } | null | undefined,
  hoy: Date = new Date(),
): number {
  const p = perfil?.percepcionIIBB
  if (!p) return 0
  const alicuota = Number(p.alicuota)
  if (!Number.isFinite(alicuota) || alicuota <= 0) return 0
  const desde = diaISO(p.vigenciaDesde), hasta = diaISO(p.vigenciaHasta), dia = diaISO(hoy)
  if (!desde || !hasta || !dia) return 0
  return dia >= desde && dia <= hasta ? alicuota : 0
}
