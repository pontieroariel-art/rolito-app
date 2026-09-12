import { aCentavos, sumaCentavos } from '@/utils/money'
import { Cobranza } from '@/types'

export interface ResumenMedios {
  efectivo: number
  transferencia: number
  cheques: number
  retenciones: number
  total: number
}

/** Totales por medio de pago de un conjunto de cobranzas (en pesos, calculado en centavos). */
export function resumenPorMedio(cobranzas: Cobranza[]): ResumenMedios {
  let efectivo = 0, transferencia = 0, cheques = 0, retenciones = 0
  for (const c of cobranzas) {
    if (c.medios) {
      efectivo += aCentavos(c.medios.efectivo)
      transferencia += aCentavos(c.medios.transferencia)
      cheques += sumaCentavos(c.medios.cheques.map((ch) => ch.importe))
      retenciones += sumaCentavos(c.medios.retenciones.map((r) => r.importe))
    } else if (c.formaPago === 'contado_efectivo') {
      // Por si esta persona registró alguna cobranza simple (caja / calle).
      efectivo += aCentavos(c.importe)
    } else {
      transferencia += aCentavos(c.importe)
    }
  }
  return {
    efectivo: efectivo / 100,
    transferencia: transferencia / 100,
    cheques: cheques / 100,
    retenciones: retenciones / 100,
    total: (efectivo + transferencia + cheques + retenciones) / 100,
  }
}

/** 'yyyy-MM-dd' local de una cobranza, para agrupar por día. */
export function diaDe(c: Cobranza): string {
  const d = c.fecha.toDate()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
