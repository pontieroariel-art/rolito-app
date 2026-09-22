/**
 * Control del recibo del lado servidor (auditoría 2026-09-22).
 *
 * La triple igualdad del recibo (valores recibidos = importe; imputado ≤
 * recibido; a cuenta = recibido − imputado) se validaba SOLO en el navegador
 * del que cobra (cobranzaService.crearCobranzaCompleta) y las reglas no
 * pueden sumar arrays. Un recibo armado a mano con la consola viajaba a Tango
 * igual. Acá se recalcula con la misma cuenta, en centavos; si no cuadra, la
 * cobranza se marca (`control.descuadre`), NO se encola a Tango ni descuenta
 * el saldo, y se avisa a la oficina. No se corrige el doc: es la prueba de lo
 * que se declaró.
 */

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const cent = (v: unknown): number => Math.round(n(v) * 100)
const suma = (xs: unknown, campo: string): number =>
  Array.isArray(xs) ? xs.reduce((s: number, x) => s + cent((x as Record<string, unknown>)?.[campo]), 0) : 0

export interface ReciboParaControl {
  importe?: unknown
  aCuenta?: unknown
  imputaciones?: unknown
  medios?: {
    efectivo?: unknown
    transferencia?: unknown
    cheques?: unknown
    retenciones?: unknown
    aCuentaAplicado?: unknown
  } | null
}

export interface DescuadreRecibo {
  motivos:       string[]
  importe:       number
  totalMedios:   number
  totalImputado: number
  aCuenta:       number
}

/** `null` si el recibo cuadra (tolerancia de $1 por redondeos); si no, los motivos. */
export function controlarRecibo(c: ReciboParaControl, tolerancia = 100): DescuadreRecibo | null {
  const m = c.medios ?? {}
  const aplicado = suma(m.aCuentaAplicado, 'importe')
  const totalMedios = cent(m.efectivo) + cent(m.transferencia) + suma(m.cheques, 'importe') + suma(m.retenciones, 'importe') + aplicado
  const totalImputado = suma(c.imputaciones, 'importeImputado')
  const importe = cent(c.importe)
  const aCuenta = cent(c.aCuenta)
  const motivos: string[] = []

  if (totalMedios <= 0) motivos.push('No hay valores recibidos.')
  if (Math.abs(importe - totalMedios) > tolerancia) motivos.push('El importe del recibo no es la suma de los valores recibidos.')
  if (totalImputado > totalMedios + tolerancia) motivos.push('Lo imputado a facturas supera los valores recibidos.')
  const aCuentaEsperado = Math.max(0, totalMedios - totalImputado)
  if (Math.abs(aCuenta - aCuentaEsperado) > tolerancia) motivos.push('Lo que queda a cuenta no es recibido menos imputado.')
  if (aplicado > 0 && aCuenta > tolerancia) motivos.push('Aplica saldo a favor y deja plata a cuenta en el mismo recibo.')
  if (Array.isArray(c.imputaciones)) {
    for (const i of c.imputaciones as Array<Record<string, unknown>>) {
      const imp = cent(i?.importeImputado), saldo = cent(i?.saldoAlMomento)
      if (imp <= 0) { motivos.push('Hay una imputación en cero.'); break }
      if (saldo > 0 && imp > saldo + tolerancia) { motivos.push('Hay una imputación mayor al saldo de la factura.'); break }
    }
  }
  if (Array.isArray(m.aCuentaAplicado) && (m.aCuentaAplicado as Array<Record<string, unknown>>).some((a) => cent(a?.importe) <= 0 || !a?.reciboNumero)) {
    motivos.push('Hay un saldo a favor aplicado en cero o sin recibo.')
  }

  if (!motivos.length) return null
  return { motivos, importe: importe / 100, totalMedios: totalMedios / 100, totalImputado: totalImputado / 100, aCuenta: aCuenta / 100 }
}

const pesos = (x: number): string => '$' + x.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

export function avisoDescuadre(
  c: { numeroRecibo?: unknown; registradoPor?: { nombre?: unknown } | null; clienteNombre?: unknown },
  d: DescuadreRecibo,
): { titulo: string; cuerpo: string } {
  const quien = String(c.registradoPor?.nombre ?? '').trim()
  return {
    titulo: 'Recibo que no cuadra',
    cuerpo: `${c.numeroRecibo ? `Recibo ${String(c.numeroRecibo)}` : 'Recibo sin número'}${quien ? ` de ${quien}` : ''} a ${String(c.clienteNombre ?? '')}: importe ${pesos(d.importe)}, valores ${pesos(d.totalMedios)}, imputado ${pesos(d.totalImputado)}. ${d.motivos[0]} No se mandó a Tango.`,
  }
}
