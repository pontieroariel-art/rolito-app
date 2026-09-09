import type { Cobranza, Liquidacion, VentaVentanilla } from '@/types'
import { chequesDe, efectivoDe, retencionesDe, sumaImportes, transferenciaDe } from './medios'

// Cálculo PURO del cierre de caja de un usuario de ventanilla, por persona y
// día (decisión de Ariel 2026-09-09). Ventanilla es la caja que además recibe
// las liquidaciones de los repartidores (y las rendiciones de supervisores
// cuando existan), así que el efectivo que tiene que rendir es:
//   ventas contado en efectivo (contado + promo) + cobranzas de mostrador en
//   efectivo + efectivo recibido en las liquidaciones que cerró.
// La cuenta corriente, las transferencias, los cheques y las retenciones no
// son efectivo: se informan (los valores en papel se entregan aparte).

export interface VentasMostrador {
  cantidad: number
  contadoEfectivo: number
  contadoTransferencia: number
  cuentaCorriente: number
  promoEfectivo: number
  promoTransferencia: number
  promoCuentaCorriente: number
  total: number
}

export interface CobranzasMostrador {
  cantidad: number
  efectivo: number
  transferencia: number
  cheques: { cantidad: number; total: number }
  retenciones: { cantidad: number; total: number }
  total: number
}

export interface LiquidacionRecibida {
  id: string
  choferId: string
  choferNombre: string
  efectivoARendir: number
  efectivoRecibido: number
  diferenciaEfectivo: number
}

export interface BultoMostrador { productoId: string; nombre: string; cantidad: number }

export interface MostradorCalculado {
  ventas: VentasMostrador
  cobranzas: CobranzasMostrador
  recibido: { liquidaciones: LiquidacionRecibida[]; efectivo: number }
  bultos: BultoMostrador[]
  efectivoARendir: number
}

export function calcularMostrador(
  ventas: VentaVentanilla[],
  cobranzas: Cobranza[],
  liquidacionesRecibidas: Liquidacion[] = [],
): MostradorCalculado {
  const suma = (filtro: (v: VentaVentanilla) => boolean) => ventas.filter(filtro).reduce((s, v) => s + v.total, 0)
  const contado = (v: VentaVentanilla) => v.canal !== 'promo'
  const promo = (v: VentaVentanilla) => v.canal === 'promo'
  const vm: VentasMostrador = {
    cantidad: ventas.length,
    contadoEfectivo:      suma((v) => contado(v) && v.formaPago === 'contado_efectivo'),
    contadoTransferencia: suma((v) => contado(v) && v.formaPago === 'contado_transferencia'),
    cuentaCorriente:      suma((v) => contado(v) && v.formaPago === 'cuenta_corriente'),
    promoEfectivo:        suma((v) => promo(v) && v.formaPago === 'contado_efectivo'),
    promoTransferencia:   suma((v) => promo(v) && v.formaPago === 'contado_transferencia'),
    promoCuentaCorriente: suma((v) => promo(v) && v.formaPago === 'cuenta_corriente'),
    total: 0,
  }
  vm.total = vm.contadoEfectivo + vm.contadoTransferencia + vm.cuentaCorriente + vm.promoEfectivo + vm.promoTransferencia + vm.promoCuentaCorriente

  const cheques = cobranzas.flatMap(chequesDe)
  const retenciones = cobranzas.flatMap(retencionesDe)
  const cm: CobranzasMostrador = {
    cantidad: cobranzas.length,
    efectivo:      cobranzas.reduce((s, c) => s + efectivoDe(c), 0),
    transferencia: cobranzas.reduce((s, c) => s + transferenciaDe(c), 0),
    cheques:     { cantidad: cheques.length, total: sumaImportes(cheques) },
    retenciones: { cantidad: retenciones.length, total: sumaImportes(retenciones) },
    total: 0,
  }
  cm.total = cm.efectivo + cm.transferencia + cm.cheques.total + cm.retenciones.total

  const liquidaciones: LiquidacionRecibida[] = liquidacionesRecibidas.map((l) => ({
    id: l.id, choferId: l.choferId, choferNombre: l.choferNombre,
    efectivoARendir: l.efectivoARendir, efectivoRecibido: l.efectivoRecibido, diferenciaEfectivo: l.diferenciaEfectivo,
  }))
  const recibidoEfectivo = liquidaciones.reduce((s, l) => s + l.efectivoRecibido, 0)

  // Bultos que salieron del depósito de la planta por esta persona, por producto.
  const porProducto = new Map<string, BultoMostrador>()
  for (const v of ventas) for (const i of v.items) {
    const b = porProducto.get(i.productoId) ?? { productoId: i.productoId, nombre: i.nombre, cantidad: 0 }
    b.cantidad += i.cantidad
    porProducto.set(i.productoId, b)
  }

  return {
    ventas: vm,
    cobranzas: cm,
    recibido: { liquidaciones, efectivo: recibidoEfectivo },
    bultos: [...porProducto.values()].sort((a, b) => b.cantidad - a.cantidad),
    efectivoARendir: vm.contadoEfectivo + vm.promoEfectivo + cm.efectivo + recibidoEfectivo,
  }
}

export interface ChequeEnPapel { cobranzaId: string; numeroRecibo?: string; clienteNombre: string; numero: string; bancoNombre: string; fechaAcreditacion: string; importe: number; esEcheq?: boolean }
export interface RetencionEnPapel { cobranzaId: string; numeroRecibo?: string; clienteNombre: string; tipo: string; nroCertificado: string; importe: number }

/** Cheques y certificados de retención que el cajero tiene que entregar en papel. */
export function valoresEnPapel(cobranzas: Cobranza[]): { cheques: ChequeEnPapel[]; retenciones: RetencionEnPapel[] } {
  const cheques: ChequeEnPapel[] = []
  const retenciones: RetencionEnPapel[] = []
  for (const c of cobranzas) {
    for (const ch of chequesDe(c)) cheques.push({ cobranzaId: c.id, numeroRecibo: c.numeroRecibo, clienteNombre: c.clienteNombre, numero: ch.numero, bancoNombre: ch.bancoNombre, fechaAcreditacion: ch.fechaAcreditacion, importe: ch.importe, ...(ch.esEcheq ? { esEcheq: true } : {}) })
    for (const r of retencionesDe(c)) retenciones.push({ cobranzaId: c.id, numeroRecibo: c.numeroRecibo, clienteNombre: c.clienteNombre, tipo: r.tipo, nroCertificado: r.nroCertificado, importe: r.importe })
  }
  return { cheques, retenciones }
}

/**
 * Qué documentos quedan fuera de un cierre ya hecho: los posteriores a `hasta`
 * (se venden después de cerrar la caja). Se rinden al día siguiente.
 */
export function fueraDelCierre<T extends { fecha: { toMillis(): number } }>(docs: T[], hastaMillis: number | null): T[] {
  if (hastaMillis === null) return []
  return docs.filter((d) => d.fecha.toMillis() > hastaMillis)
}
