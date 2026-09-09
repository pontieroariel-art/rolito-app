// ¿Se le puede vender en cuenta corriente a este cliente?
//
// La condición de venta vive en la ficha del cliente en Tango (GVA14.COND_VTA)
// y la sync diaria la copia a `users.condicionVenta` como texto ("CONTADO",
// "7 DIAS F.F.", "VALORES 30 DIAS F.F."…). Cuando la venta va a Tango en
// cuenta corriente, el Facturador usa esa condición: si el cliente es CONTADO
// rechaza la factura con cuota ("La condición de venta contado no debe incluir
// las cuotas", 2026-09-09, venta de ventanilla a un cliente sin CUIT). Acá se
// avisa ANTES de cobrar, en ventanilla y en el camión.
//
// Sin condición cargada (cliente todavía no sincronizado con Tango) no se
// bloquea: la autoridad sigue siendo Tango al registrar la venta.

export interface ResultadoCuentaCorriente { ok: boolean; motivo?: string }

export function esCondicionContado(condicionVenta: string | undefined | null): boolean {
  return String(condicionVenta ?? '').trim().toUpperCase() === 'CONTADO'
}

export function admiteCuentaCorriente(cliente: { condicionVenta?: string } | undefined): ResultadoCuentaCorriente {
  if (!cliente) return { ok: false, motivo: 'Cuenta corriente solo para clientes registrados.' }
  if (esCondicionContado(cliente.condicionVenta)) {
    return { ok: false, motivo: 'Este cliente está como CONTADO en Tango: no se le puede vender en cuenta corriente. Cobrale en efectivo o transferencia, o pedile a administración que le cambie la condición de venta.' }
  }
  return { ok: true }
}
