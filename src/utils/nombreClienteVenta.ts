// Nombre del cliente para los LISTADOS de ventas (2026-09-11). Una cuenta con
// varias sucursales en Tango tiene como `clienteNombre` la razón social de la
// cuenta ("GASTRONOMIA EMPRENDIMIENTOS S.A.S - (MAR DEL PLATA)"), y la venta
// pudo ser a otra sucursal (Centenera). Los papeles ya imprimen la sucursal
// (utils/clienteImpreso.ts); las pantallas muestran el nombre de la sucursal
// guardado en la venta, y si no lo hay, el de la cuenta.
export const nombreClienteVenta = (v: { clienteNombre: string; clienteSucursalNombre?: string | null }): string =>
  v.clienteSucursalNombre?.trim() || v.clienteNombre
