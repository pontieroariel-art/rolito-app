import type { CanalVenta, DeliveryAddress, UserProfile } from '@/types'
import { empresaDeCanal } from './precioTango'
import { sucursalesDe } from './sucursalesTango'

// Bloque "cliente" de los papeles de una venta (remito, factura X, factura
// ARCA, ticket): la razón social del CUIT y, cuando la venta fue a una
// sucursal, el nombre, domicilio, localidad y código de ESA sucursal (decisión
// de Ariel 2026-09-10: "el remito y la factura tienen que decir la dirección
// donde se bajó realmente la mercadería"). La sucursal se resuelve con
// `venta.clienteCodigoTango` contra `addresses[]` de la ficha (addresses[].id
// = código de Tango; los campos *Tango los escribe la sync de clientes).
//
// Sin código en la venta (ventas anteriores al 2026-09-08, cliente sin Tango)
// o sin esa dirección en la ficha, sale exactamente lo de siempre: la casa
// central. Puro, sin Firebase.

export interface ClienteImpreso {
  razonSocial:   string
  /** "YPF RUTA 8 KM 40 (YPF012)"; '' cuando no corresponde imprimir la línea. */
  sucursal:      string
  domicilio:     string
  /** "1667, TORTUGUITAS" (C.P. y localidad, como en el talonario). */
  localidadCp:   string
  /** El código de la sucursal vendida; sin él, el de Tango principal o el de la app. */
  codigoCliente: string
  cuit:          string
  condicionIva:  string
}

export interface VentaParaImprimir {
  canal:               CanalVenta
  clienteNombre:       string
  clienteCodigoTango?: string
}

const limpio = (s: string | undefined | null) => (s ?? '').trim()

/** "1611, DON TORCUATO" con lo que haya. */
const cpLocalidad = (cp: string | undefined, localidad: string | undefined) => [limpio(cp), limpio(localidad)].filter(Boolean).join(', ')

/** Nombre con que se imprime una sucursal: nombre comercial de Tango, si no la razón social del código, si no el nombre de la app. */
export function nombreImpresoSucursal(dir: Pick<DeliveryAddress, 'id' | 'nombre' | 'nombreComercialTango' | 'razonSocialTango'> | undefined, codigo: string): string {
  const nombre = limpio(dir?.nombreComercialTango) || limpio(dir?.razonSocialTango) || limpio(dir?.nombre)
  if (!nombre || nombre === codigo || nombre.toLowerCase() === 'principal') return codigo
  return `${nombre} (${codigo})`
}

export function clienteImpreso(venta: VentaParaImprimir, cliente: UserProfile | undefined): ClienteImpreso {
  // Lo de siempre: la ficha de la casa central.
  const base: ClienteImpreso = {
    razonSocial:   cliente?.razonSocial ?? venta.clienteNombre,
    sucursal:      '',
    domicilio:     cliente?.address ?? '',
    localidadCp:   cpLocalidad(cliente?.codigoPostalTango, cliente?.localidadTango),
    codigoCliente: cliente?.codigoTango ?? cliente?.codigoCliente ?? '',
    cuit:          cliente?.cuit ?? '',
    condicionIva:  cliente?.categoriaIvaTangoDesc ?? '',
  }
  const codigo = limpio(venta.clienteCodigoTango)
  if (!codigo) return base
  if (!cliente) return { ...base, codigoCliente: codigo }

  const empresa = empresaDeCanal(venta.canal)
  const lista = sucursalesDe(cliente, empresa)
  const dir = (cliente.addresses ?? []).find((a) => a.id === codigo)
  const esPrincipal = lista.length > 0 ? lista[0].codigo === codigo : true
  const tieneTango = !!(limpio(dir?.domicilioTango) || limpio(dir?.localidadTango) || limpio(dir?.codigoPostalTango))

  let domicilio = base.domicilio
  let localidadCp = base.localidadCp
  if (dir && tieneTango) {
    domicilio = limpio(dir.domicilioTango) || limpio(dir.address)
    localidadCp = cpLocalidad(dir.codigoPostalTango, dir.localidadTango)
  } else if (dir && !esPrincipal) {
    // Dato viejo de la sync (sin campos *Tango): `address` ya trae "domicilio,
    // localidad, provincia"; no hay C.P. de la sucursal para imprimir.
    domicilio = limpio(dir.address) || base.domicilio
    localidadCp = ''
  }

  // La línea Sucursal solo cuando hay algo que distinguir: la cuenta tiene más
  // de un código en esa empresa, o la venta fue a un código que no es el principal.
  const conSucursal = lista.length > 1 || (!!dir && !esPrincipal)
  return {
    ...base,
    sucursal:      conSucursal ? nombreImpresoSucursal(dir, codigo) : '',
    domicilio,
    localidadCp,
    codigoCliente: codigo,
  }
}
