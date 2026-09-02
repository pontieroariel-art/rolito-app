// Arma el comprobante impreso a partir de una venta ya facturada.
//
// Junta las dos mitades: lo que declaró ARCA (que viaja en `venta.factura`) y
// los datos del cliente. Los importes NO se recalculan — se usan los que
// efectivamente se informaron, para que el papel coincida con lo declarado.

import { FacturaArcaVenta, UserProfile, VentaCamion } from '@/types'
import { FacturaArcaData, RenglonArca } from './facturaArcaPdf'

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

export function armarFacturaDeVenta(venta: VentaCamion, cliente?: UserProfile): ArmadoFactura {
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

  // Los cambios van al final, después de lo vendido, y siempre en $0: no suman
  // al total ni a lo declarado a ARCA. Están en el papel para que el cliente vea
  // qué se le entregó y qué se retiró.
  const renglones: RenglonArca[] = [...venta.items, ...(venta.cambios ?? [])].map((i) => ({
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
      cliente: {
        razonSocial:    cliente?.razonSocial ?? venta.clienteNombre,
        cuit:           cliente?.cuit ?? '',
        condicionIva:   cliente?.categoriaIvaTangoDesc ?? '',
        domicilio:      cliente?.address ?? '',
        condicionVenta: 'Contado',
        vendedor:       venta.choferNombre,
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
