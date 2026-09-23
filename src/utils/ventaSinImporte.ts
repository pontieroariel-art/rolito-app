import type { FormaPago } from '@/types'

/**
 * El chofer no ve importes en la venta en cuenta corriente (2026-09-22,
 * decisión de Ariel): el remito de cuenta corriente sale sin precios y el
 * importe en pantalla prestaba a confusión con la plata que tiene que rendir.
 * Los precios siguen guardándose en la venta (la factura de Tango los usa);
 * solo no se muestran en el teléfono. Contado y promo siguen con importe.
 */
export const ventaSinImporte = (formaPago: FormaPago | null | undefined): boolean => formaPago === 'cuenta_corriente'

/** Texto que reemplaza al importe. */
export const SIN_IMPORTE = 'Cta. cte. · sin importe'
