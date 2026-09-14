import type { Cobranza, Liquidacion } from '@/types'
import { chequesDe, efectivoDe, retencionesDe, sumaImportes, transferenciaDe } from './medios'

// Detalle del acta del sobre de ventanilla (2026-09-14, pedido de Ariel al
// ver la primera rendición de Nicolás): el "recibido de choferes" del sobre
// es una sola cifra, y cuando la caja no cuadra nadie sabe de quién era esa
// plata. El acta lista, por cada chofer o cobrador que le rindió al cajero,
// qué cobró (recibo por recibo, con el cliente y el medio) y cuánto efectivo
// le entregó. Puro: quien imprime trae las liquidaciones y sus cobranzas.

export interface ReciboDelActa {
  numeroRecibo:  string
  clienteNombre: string
  efectivo:      number
  transferencia: number
  cheques:       { numero: string; bancoNombre: string; importe: number }[]
  retenciones:   { tipo: string; nroCertificado: string; importe: number }[]
}

export interface PersonaDelActa {
  liquidacionId:     string
  codigo?:           string
  nombre:            string
  /** Ventas de contado en efectivo del reparto (0 en un cobrador). */
  ventasEfectivo:    number
  cobranzasEfectivo: number
  efectivoARendir:   number
  efectivoRecibido:  number
  diferencia:        number
  motivo?:           { motivo: string; nota: string }
  recibos:           ReciboDelActa[]
  /** Cobranzas de la liquidación que no se pudieron leer (ids sin doc): se avisa en el acta. */
  recibosSinDetalle: number
  valores:           { cheques: number; chequesTotal: number; retenciones: number; retencionesTotal: number }
}

export function reciboDelActa(c: Cobranza): ReciboDelActa {
  return {
    numeroRecibo:  c.numeroRecibo ?? c.id,
    clienteNombre: c.clienteNombre,
    efectivo:      efectivoDe(c),
    transferencia: transferenciaDe(c),
    cheques:       chequesDe(c).map((ch) => ({ numero: ch.numero, bancoNombre: ch.bancoNombre, importe: ch.importe })),
    retenciones:   retencionesDe(c).map((r) => ({ tipo: r.tipo, nroCertificado: r.nroCertificado, importe: r.importe })),
  }
}

/** Una fila por persona que rindió al cajero, en el orden de las liquidaciones. */
export function personasDelActa(liquidaciones: Liquidacion[], cobranzas: Cobranza[]): PersonaDelActa[] {
  const porId = new Map(cobranzas.map((c) => [c.id, c]))
  return liquidaciones.map((l) => {
    const ids = l.cobranzasIds ?? []
    const propias = ids.map((id) => porId.get(id)).filter((c): c is Cobranza => !!c)
    const recibos = propias
      .slice()
      .sort((a, b) => (a.fecha?.toMillis?.() ?? 0) - (b.fecha?.toMillis?.() ?? 0))
      .map(reciboDelActa)
    const cheques = l.cheques ?? []
    const retenciones = l.retenciones ?? []
    const cobranzasEfectivo = l.cobranzasCalle?.efectivo ?? recibos.reduce((s, r) => s + r.efectivo, 0)
    return {
      liquidacionId:     l.id,
      codigo:            l.codigo,
      nombre:            l.choferNombre,
      ventasEfectivo:    l.importes?.contadoEfectivo ?? 0,
      cobranzasEfectivo,
      efectivoARendir:   l.efectivoARendir,
      efectivoRecibido:  l.efectivoRecibido,
      diferencia:        l.diferenciaEfectivo,
      motivo:            l.diferencia,
      recibos,
      recibosSinDetalle: ids.length - propias.length,
      valores: { cheques: cheques.length, chequesTotal: sumaImportes(cheques), retenciones: retenciones.length, retencionesTotal: sumaImportes(retenciones) },
    }
  })
}
