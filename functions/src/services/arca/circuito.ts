/**
 * Qué documento le corresponde a una venta.
 *
 * La regla no es fiscal sino del negocio, y es la que decide si la app le pide
 * un CAE a ARCA o no. Está acá, sola y testeada, porque equivocarse tiene dos
 * costos caros y opuestos: facturar de más (una venta de cuenta corriente que
 * la oficina va a volver a facturar desde Tango) o no facturar una venta que
 * ya se cobró.
 *
 *   canal 'contado' = empresa REDONHIELO = oficial = ARCA
 *   canal 'promo'   = empresa ROLITO     = no oficial (comprobante propio)
 *
 * Dentro de contado manda la forma de pago:
 *
 *   efectivo / transferencia  → la app emite la factura electrónica
 *   cuenta corriente          → la app emite un remito oficial que viaja a
 *                               Tango, y la oficina factura ESE remito. Si la
 *                               app además facturara, la operación saldría dos
 *                               veces.
 *
 * Ver docs/arca/FACTURACION_ELECTRONICA.md §11.
 */

export type CanalVenta = 'contado' | 'promo'
export type FormaPago = 'contado_efectivo' | 'contado_transferencia' | 'cuenta_corriente'

export type DocumentoDeVenta =
  /** La app le pide el CAE a ARCA. */
  | 'factura_arca'
  /** La app emite el remito; la factura la hace la oficina desde Tango. */
  | 'remito_a_facturar'
  /** Rolito: factura y remito propios, con numeración y CAE ficticios. */
  | 'no_oficial'

const FORMAS_QUE_FACTURAN: readonly string[] = ['contado_efectivo', 'contado_transferencia']

/**
 * Devuelve `null` cuando los datos de la venta no alcanzan para decidir (un
 * canal o una forma de pago que no conocemos). Quien llame tiene que tratar ese
 * caso como "no emitir todavía" y dejar rastro: emitir a ciegas es lo único
 * que no se puede deshacer.
 */
export function documentoDeVenta(canal: unknown, formaPago: unknown): DocumentoDeVenta | null {
  if (canal === 'promo') return 'no_oficial'
  if (canal !== 'contado') return null

  if (formaPago === 'cuenta_corriente') return 'remito_a_facturar'
  if (FORMAS_QUE_FACTURAN.includes(String(formaPago))) return 'factura_arca'
  return null
}

/** Atajo para el trigger: ¿esta venta la factura la app contra ARCA? */
export function facturaContraArca(canal: unknown, formaPago: unknown): boolean {
  return documentoDeVenta(canal, formaPago) === 'factura_arca'
}
