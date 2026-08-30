import {
  CambioCamion, Cobranza, DescargaCamion, Liquidacion, LiquidacionResumenProducto,
  RemitoCarga, VentaCamion,
} from '../types'

// Cálculo puro de la liquidación del repartidor — replica la hoja
// "Liquidación de repartidores" del sistema viejo: por producto, carga −
// ventas − cambios = devolución teórica, contra la descarga contada por
// muelle; más el cuadre de envases (pallets) y de plata. Ver el plan del
// módulo expedición y la foto de la hoja (2026-08-29).

export type LiquidacionCalculada = Omit<Liquidacion, 'id' | 'fecha' | 'plantaId' | 'choferId' | 'choferNombre' | 'efectivoRecibido' | 'diferenciaEfectivo' | 'cerradaPor' | 'createdAt'>

export function calcularLiquidacion(
  remitos:   RemitoCarga[],
  ventas:    VentaCamion[],
  cambios:   CambioCamion[],
  descargas: DescargaCamion[],
  // Cobranzas de cta. cte. hechas en la calle por esta persona (los
  // cobradores son choferes — "Detalle de cobranzas" de la hoja vieja).
  cobranzasCalle: Cobranza[] = [],
): LiquidacionCalculada {
  // ── Por producto ── acumular cada fuente sobre el mismo mapa, indexado por
  // productoId, para que ningún producto quede afuera aunque aparezca en una
  // sola fuente (ej. vendió algo que no figura en la carga → diferencia).
  const porProducto = new Map<string, LiquidacionResumenProducto>()
  const fila = (productoId: string, nombre: string): LiquidacionResumenProducto => {
    let f = porProducto.get(productoId)
    if (!f) {
      f = { productoId, nombre, carga: 0, ventaContado: 0, ventaPromo: 0, cambios: 0, devolucionTeorica: 0, descarga: 0, diferencia: 0 }
      porProducto.set(productoId, f)
    }
    return f
  }

  remitos.forEach((r) => r.items.forEach((i) => { fila(i.productoId, i.nombre).carga += i.cantidad }))
  ventas.forEach((v) => v.items.forEach((i) => {
    const f = fila(i.productoId, i.nombre)
    if (v.canal === 'contado') f.ventaContado += i.cantidad
    else f.ventaPromo += i.cantidad
  }))
  cambios.forEach((c) => { fila(c.productoId, c.nombre).cambios += c.cantidad })
  descargas.forEach((d) => d.items.forEach((i) => { fila(i.productoId, i.nombre).descarga += i.cantidad }))

  const productos = [...porProducto.values()].map((f) => {
    const devolucionTeorica = f.carga - f.ventaContado - f.ventaPromo - f.cambios
    return { ...f, devolucionTeorica, diferencia: f.descarga - devolucionTeorica }
  }).sort((a, b) => a.nombre.localeCompare(b.nombre))

  // ── Envases ── bases que salieron vs cómo volvieron.
  const salidos    = remitos.reduce((s, r) => s + r.palletsCarga, 0)
  const completos  = descargas.reduce((s, d) => s + d.palletsCompletos, 0)
  const parciales  = descargas.reduce((s, d) => s + d.palletsParciales, 0)
  const vacios     = descargas.reduce((s, d) => s + d.palletsVacios, 0)

  // ── Cambios vs bolsas rotas recibidas ──
  const registrados    = cambios.reduce((s, c) => s + c.cantidad, 0)
  const rotasRecibidas = descargas.reduce((s, d) => s + d.bolsasRotas.reduce((x, i) => x + i.cantidad, 0), 0)

  // ── Plata ──
  const porPago = (fp: VentaCamion['formaPago']) =>
    ventas.filter((v) => v.formaPago === fp).reduce((s, v) => s + v.total, 0)
  const contadoEfectivo      = porPago('contado_efectivo')
  const contadoTransferencia = porPago('contado_transferencia')
  const cuentaCorriente      = porPago('cuenta_corriente')

  // ── Cobranzas de calle ── el efectivo cobrado se rinde junto con el de
  // las ventas, en el mismo cierre (así rendían en el sistema viejo).
  const cobranzasEfectivo = cobranzasCalle
    .filter((c) => c.formaPago === 'contado_efectivo')
    .reduce((s, c) => s + c.importe, 0)
  const cobranzasTransferencia = cobranzasCalle
    .filter((c) => c.formaPago === 'contado_transferencia')
    .reduce((s, c) => s + c.importe, 0)

  return {
    productos,
    pallets: { salidos, completos, parciales, vacios, diferencia: (completos + parciales + vacios) - salidos },
    cambios: { registrados, rotasRecibidas },
    importes: {
      contadoEfectivo, contadoTransferencia, cuentaCorriente,
      total: contadoEfectivo + contadoTransferencia + cuentaCorriente,
    },
    cobranzasCalle: {
      cantidad:      cobranzasCalle.length,
      efectivo:      cobranzasEfectivo,
      transferencia: cobranzasTransferencia,
      total:         cobranzasEfectivo + cobranzasTransferencia,
    },
    efectivoARendir: contadoEfectivo + cobranzasEfectivo,
  }
}
