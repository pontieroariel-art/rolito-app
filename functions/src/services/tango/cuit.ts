// CUIT/CUIL argentino: 11 dígitos con dígito verificador (módulo 11). Se usa
// para decidir si un CUIT de Tango identifica de verdad a un cliente (vínculo
// entre empresas, alta automática de cuentas, login por CUIT) o es un relleno
// tipo "00000000000" / "11111111111" / consumidor final.

export const soloDigitos = (v: unknown): string => (v == null ? '' : String(v).replace(/\D/g, ''))

const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]

export function cuitValido(v: unknown): boolean {
  const d = soloDigitos(v)
  if (d.length !== 11) return false
  if (/^(\d)\1{10}$/.test(d)) return false          // 00000000000, 11111111111, …
  const suma = PESOS.reduce((s, p, i) => s + p * Number(d[i]), 0)
  const resto = suma % 11
  const dv = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto
  return dv === Number(d[10])
}
