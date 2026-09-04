// Arma el comprobante impreso a partir de una venta ya facturada.
//
// Junta las dos mitades: lo que declaró ARCA (que viaja en `venta.factura`) y
// los datos del cliente. Los importes NO se recalculan — se usan los que
// efectivamente se informaron, para que el papel coincida con lo declarado.

import { FacturaArcaVenta, UserProfile, VentaCamion, VentaCamionItem } from '@/types'
import { FacturaArcaData, RenglonArca } from './facturaArcaPdf'

// Lo que el comprobante necesita de la venta. Lo cumplen tanto la venta del
// camión (VentaCamion, con choferNombre) como la del mostrador
// (VentaVentanilla, con cajaNombre y, si es ocasional, clienteOcasional).
export interface VentaFacturable {
  factura?:         FacturaArcaVenta
  fecha:            VentaCamion['fecha']
  items:            VentaCamionItem[]
  cambios?:         VentaCamionItem[]
  clienteNombre:    string
  total:            number
  choferNombre?:    string
  cajaNombre?:      string
  clienteOcasional?: { nombre: string; cuit?: string; dni?: string }
}

/** 1 = Factura A, 6 = B, 11 = C. Los demás no los emite la venta de calle. */
const LETRA_POR_TIPO: Record<number, { letra: 'A' | 'B' | 'C'; codigo: string }> = {
  1:  { letra: 'A', codigo: '01' },
  6:  { letra: 'B', codigo: '06' },
  11: { letra: 'C', codigo: '11' },
}

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

  return {
    ok: true,
    datos: {
      letra: tipo.letra,
      codigoTipo: tipo.codigo,
      puntoVenta: f.puntoVenta,
      numero: f.numero,
      fechaEmision,
      // Registrado: datos de su ficha (Tango). Ocasional del mostrador: es
      // consumidor final, identificado por CUIT o DNI si los dio, y si no, sin
      // identificar — el papel dice lo mismo que se declaró.
      cliente: {
        razonSocial:    cliente?.razonSocial ?? venta.clienteNombre,
        cuit:           cliente?.cuit
                          ?? venta.clienteOcasional?.cuit
                          ?? (venta.clienteOcasional?.dni ? `DNI ${venta.clienteOcasional.dni}` : ''),
        condicionIva:   cliente?.categoriaIvaTangoDesc ?? (venta.clienteOcasional ? 'Consumidor Final' : ''),
        domicilio:      cliente?.address ?? '',
        condicionVenta: 'Contado',
        vendedor:       venta.choferNombre ?? venta.cajaNombre ?? '',
      },
      renglones,
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
