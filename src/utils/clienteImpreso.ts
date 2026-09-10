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

/** Para comparar nombres: sin acentos, puntuación ni espacios, en minúsculas ("S.A.EN FORM" ≡ "S.A EN FORM"). */
const clave = (s: string | undefined | null) => limpio(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * Nombre con que se imprime una sucursal. En Tango cada código tiene nombre
 * comercial (NOM_COM) y razón social propia, pero cualquiera de los dos puede
 * ser la razón social de la cuenta repetida o truncada (visto en prod
 * 2026-09-10: NOM_COM "OPERADORA SAN JUAN S.A.EN FORM" y razón social del
 * código "… - (ONIGLIA)"). Se toma el primero que realmente distinga a la
 * sucursal: nombre comercial → razón social del código → nombre en la app,
 * descartando los que son iguales al nombre de la cuenta, al código o
 * "Principal". Si ninguno la distingue, solo el código (la distingue el domicilio).
 */
export function nombreImpresoSucursal(
  dir: Pick<DeliveryAddress, 'id' | 'nombre' | 'nombreComercialTango' | 'razonSocialTango'> | undefined,
  codigo: string,
  razonSocialCuenta = '',
): string {
  const descartar = new Set([clave(razonSocialCuenta), clave(codigo), 'principal', ''])
  const candidatos = [dir?.nombreComercialTango, dir?.razonSocialTango, dir?.nombre]
  const nombre = candidatos.map(limpio).find((n) => !descartar.has(clave(n)))
  return nombre ? `${nombre} (${codigo})` : codigo
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
    sucursal:      conSucursal ? nombreImpresoSucursal(dir, codigo, base.razonSocial) : '',
    domicilio,
    localidadCp,
    codigoCliente: codigo,
  }
}
