// Arma el comprobante impreso a partir de una venta ya facturada.
//
// Junta las dos mitades: lo que declaró ARCA (que viaja en `venta.factura`) y
// los datos del cliente. Los importes NO se recalculan — se usan los que
// efectivamente se informaron, para que el papel coincida con lo declarado.

import { AnulacionEnVenta, CanalVenta, FacturaArcaVenta, UserProfile, VentaCamion, VentaCamionItem } from '@/types'
import { FacturaArcaData, RenglonArca } from './facturaArcaPdf'
import { clienteImpreso } from './clienteImpreso'

// Lo que el comprobante necesita de la venta. Lo cumplen tanto la venta del
// camión (VentaCamion, con choferNombre) como la del mostrador
// (VentaVentanilla, con cajaNombre y, si es ocasional, clienteOcasional).
export interface VentaFacturable {
  factura?:         FacturaArcaVenta
  fecha:            VentaCamion['fecha']
  items:            VentaCamionItem[]
  cambios?:         VentaCamionItem[]
  clienteNombre:    string
  /** Empresa de la venta y sucursal de Tango a la que fue (para imprimir SU domicilio, 2026-09-10). */
  canal:            CanalVenta
  clienteCodigoTango?: string
  total:            number
  choferNombre?:    string
  cajaNombre?:      string
  clienteOcasional?: { nombre: string; cuit?: string; dni?: string }
  /** Anulación con nota de crédito (ventanilla, 2026-09-09). */
  anulacion?:       AnulacionEnVenta
  /** Orden de compra del cliente (2026-09-11). */
  ordenCompra?:     string
}

/** 1 = Factura A, 6 = B, 11 = C; 3/8/13 = la nota de crédito de cada clase (anulación de ventanilla). */
const LETRA_POR_TIPO: Record<number, { letra: 'A' | 'B' | 'C'; codigo: string; titulo: 'FACTURA' | 'NOTA DE CRÉDITO' }> = {
  1:  { letra: 'A', codigo: '01', titulo: 'FACTURA' },
  6:  { letra: 'B', codigo: '06', titulo: 'FACTURA' },
  11: { letra: 'C', codigo: '11', titulo: 'FACTURA' },
  3:  { letra: 'A', codigo: '03', titulo: 'NOTA DE CRÉDITO' },
  8:  { letra: 'B', codigo: '08', titulo: 'NOTA DE CRÉDITO' },
  13: { letra: 'C', codigo: '13', titulo: 'NOTA DE CRÉDITO' },
}

const nroComp = (pv: number, n: number) => `${String(pv).padStart(5, '0')}-${String(n).padStart(8, '0')}`

/** 'AAAAMMDD' → Date local. */
function deFechaArca(s: string | null | undefined): Date | null {
  if (!s || !/^\d{8}$/.test(s)) return null
  return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)))
}

export type ArmadoFactura =
  | { ok: true; datos: FacturaArcaData }
  | { ok: false; motivo: string }

export function armarFacturaDeVenta(venta: VentaFacturable, cliente?: UserProfile): ArmadoFactura {
  const f: FacturaArcaVenta | undefined = venta.factura
  if (!f) return { ok: false, motivo: 'Esta venta todavía no tiene factura.' }
  return armarComprobante(venta, cliente, f)
}

/**
 * La nota de crédito que anuló la factura de la venta (ventanilla, 2026-09-09):
 * mismo papel que la factura, con el título de NC y el comprobante asociado.
 */
export function armarNotaCreditoDeVenta(venta: VentaFacturable, cliente?: UserProfile): ArmadoFactura {
  const nc = venta.anulacion?.notaCredito
  if (!nc) return { ok: false, motivo: 'Esta venta no tiene nota de crédito.' }
  const a = nc.cbtesAsoc?.[0]
  const asociado = a ? `${LETRA_POR_TIPO[a.Tipo]?.titulo ?? 'Comprobante'} ${LETRA_POR_TIPO[a.Tipo]?.letra ?? ''} ${nroComp(a.PtoVta, a.Nro)}`.replace(/\s+/g, ' ') : ''
  return armarComprobante(venta, cliente, nc, asociado)
}

function armarComprobante(venta: VentaFacturable, cliente: UserProfile | undefined, f: FacturaArcaVenta, comprobanteAsociado = ''): ArmadoFactura {
  if (f.estado !== 'emitida' || !f.cae) {
    return {
      ok: false,
      motivo: f.estado === 'incierta'
        ? 'La factura está en revisión: todavía no sabemos si ARCA la autorizó.'
        : 'ARCA rechazó esta factura, no hay comprobante para entregar.',
    }
  }

  const tipo = LETRA_POR_TIPO[f.cbteTipo]
  if (!tipo) return { ok: false, motivo: `Tipo de comprobante desconocido (${f.cbteTipo}).` }

  const fechaEmision = deFechaArca(f.importes?.fecha) ?? venta.fecha.toDate()
  const caeVto = deFechaArca(f.caeFchVto)
  if (!caeVto) return { ok: false, motivo: 'La factura no tiene vencimiento de CAE.' }

  // Solo lo vendido. Los cambios (bolsa rota repuesta sin cargo) NO van en la
  // factura: un renglón a $0 confunde al cliente (decisión de Ariel 2026-09-04).
  // Quedan en el remito de la app y en el movimiento de stock camión → merma.
  const renglones: RenglonArca[] = venta.items.map((i) => ({
    descripcion:    i.nombre,
    cantidad:       i.cantidad,
    unidad:         'UNI',
    precioUnitario: i.precioUnitario,
    total:          i.cantidad * i.precioUnitario,
  }))

  // Si por algún motivo no quedaron guardados los importes declarados, se usa
  // el total de la venta y no se inventa el desglose: mejor un comprobante con
  // el IVA en cero visible que uno con números plausibles pero distintos de los
  // que tiene ARCA.
  const imp = f.importes
  // Registrado: datos de su ficha (Tango), con la sucursal donde se entregó si
  // la cuenta tiene varias. Ocasional del mostrador: sin ficha, queda lo declarado.
  const ci = clienteImpreso(venta, cliente)

  return {
    ok: true,
    datos: {
      letra: tipo.letra,
      codigoTipo: tipo.codigo,
      ...(tipo.titulo !== 'FACTURA' ? { tituloDocumento: tipo.titulo } : {}),
      ...(comprobanteAsociado ? { comprobanteAsociado } : {}),
      puntoVenta: f.puntoVenta,
      numero: f.numero,
      fechaEmision,
      // Registrado: datos de su ficha (Tango). Ocasional del mostrador: es
      // consumidor final, identificado por CUIT o DNI si los dio, y si no, sin
      // identificar — el papel dice lo mismo que se declaró.
      cliente: {
        razonSocial:    ci.razonSocial,
        ...(ci.sucursal ? { sucursal: ci.sucursal } : {}),
        cuit:           cliente?.cuit
                          ?? venta.clienteOcasional?.cuit
                          ?? (venta.clienteOcasional?.dni ? `DNI ${venta.clienteOcasional.dni}` : ''),
        condicionIva:   cliente?.categoriaIvaTangoDesc ?? (venta.clienteOcasional ? 'Consumidor Final' : ''),
        domicilio:      ci.domicilio,
        condicionVenta: 'Contado',
        vendedor:       venta.choferNombre ?? venta.cajaNombre ?? '',
      },
      // La orden de compra del cliente va como nota bajo el primer renglón (el
      // encabezado no tiene lugar) y en el ticket como campo propio.
      ...(venta.ordenCompra ? { ordenCompra: venta.ordenCompra } : {}),
      renglones: venta.ordenCompra && renglones.length
        ? [{ ...renglones[0], notas: [...(renglones[0].notas ?? []), `Orden de compra: ${venta.ordenCompra}`] }, ...renglones.slice(1)]
        : renglones,
      totales: {
        subtotal:       imp?.neto ?? venta.total,
        bonificaciones: 0,
        iva:            imp?.iva ?? 0,
        percIibbCaba:   imp?.tributos ?? 0,
        total:          imp?.total ?? venta.total,
      },
      cae: f.cae,
      caeVto,
      descargar: false,
    },
  }
}
