// Arma el comprobante INTERNO de una venta del camión: el que sale cuando no
// hay factura de ARCA. Dos casos (docs/arca §11):
//
//   - Contado + cuenta corriente (Redonhielo) → REMITO. Lo factura la oficina
//     después desde Tango.
//   - Promo (Rolito) → FACTURA "X" si se cobró, REMITO si es cuenta corriente o
//     solo cambios ($0). No oficiales: numeración propia, sin QR de AFIP ni
//     código de barras, y con la leyenda que lo distingue.
//
// La firma del cliente va impresa en todos (decisión 2026-09-03). Los importes
// son los de la venta tal cual (no hay IVA discriminado: no es un comprobante
// fiscal).

import { UserProfile, VentaCamion } from '@/types'
import { documentoDeVenta } from './circuitoDocumento'
import { codigoComprobanteInterno } from '@/services/numeracionInternaService'
import { EMISOR_REDONHIELO, EMISOR_ROLITO, Emisor } from './emisores'

export interface RenglonInterno {
  descripcion:    string
  cantidad:       number
  precioUnitario: number
  total:          number
}

export interface ComprobanteInternoData {
  titulo:        'REMITO' | 'FACTURA'
  /** Siempre X: documento no válido como factura. */
  letra:         'X'
  empresa:       'redonhielo' | 'rolito'
  emisor:        Emisor
  /** "00002-00000015", o null si la venta salió sin numerar. */
  numero:        string | null
  fechaEmision:  Date
  cliente: {
    razonSocial:    string
    cuit:           string
    condicionIva:   string
    domicilio:      string
    condicionVenta: string
    vendedor:       string
  }
  renglones:     RenglonInterno[]
  total:         number
  firma?:        { dataUrl: string; aclaracion: string }
  leyenda:       string
  /** Nombre sugerido del archivo. */
  archivo:       string
}

export type ArmadoInterno =
  | { ok: true; datos: ComprobanteInternoData }
  | { ok: false; motivo: string }

const CONDICION_VENTA: Record<VentaCamion['formaPago'], string> = {
  contado_efectivo:      'Contado',
  contado_transferencia: 'Transferencia',
  cuenta_corriente:      'Cuenta corriente',
}

/** Qué comprobante interno le corresponde a la venta, o null si va por ARCA. */
export function tipoComprobanteInterno(
  venta: Pick<VentaCamion, 'canal' | 'formaPago' | 'total'>,
): 'remito' | 'facturaX' | null {
  const documento = documentoDeVenta(venta.canal, venta.formaPago, venta.total)
  if (documento === 'remito') return 'remito'
  if (documento === 'no_oficial') {
    return venta.formaPago === 'cuenta_corriente' || venta.total <= 0 ? 'remito' : 'facturaX'
  }
  return null
}

export function armarComprobanteInterno(venta: VentaCamion, cliente?: UserProfile): ArmadoInterno {
  const tipo = tipoComprobanteInterno(venta)
  if (!tipo) return { ok: false, motivo: 'Esta venta se factura por ARCA: no lleva comprobante interno.' }

  const promo = venta.canal === 'promo'
  const numero = venta.comprobanteInterno ? codigoComprobanteInterno(venta.comprobanteInterno) : null

  const renglones: RenglonInterno[] = [...venta.items, ...(venta.cambios ?? [])].map((i) => ({
    descripcion:    i.nombre,
    cantidad:       i.cantidad,
    precioUnitario: i.precioUnitario,
    total:          i.cantidad * i.precioUnitario,
  }))

  const titulo = tipo === 'remito' ? 'REMITO' : 'FACTURA'
  const leyenda = promo
    ? 'DOCUMENTO NO VÁLIDO COMO FACTURA — Comprobante interno de Rolito (promo). No autorizado por ARCA.'
    : 'DOCUMENTO NO VÁLIDO COMO FACTURA — Remito de entrega. La factura la emite la oficina.'

  return {
    ok: true,
    datos: {
      titulo,
      letra: 'X',
      empresa: promo ? 'rolito' : 'redonhielo',
      emisor: promo ? EMISOR_ROLITO : EMISOR_REDONHIELO,
      numero,
      fechaEmision: venta.fecha.toDate(),
      cliente: {
        razonSocial:    cliente?.razonSocial ?? venta.clienteNombre,
        cuit:           cliente?.cuit ?? '',
        condicionIva:   cliente?.categoriaIvaTangoDesc ?? '',
        domicilio:      cliente?.address ?? '',
        condicionVenta: CONDICION_VENTA[venta.formaPago] ?? '',
        vendedor:       venta.choferNombre,
      },
      renglones,
      total: venta.total,
      ...(venta.firmaCliente
        ? { firma: { dataUrl: venta.firmaCliente, aclaracion: venta.firmanteNombre ?? '' } }
        : {}),
      leyenda,
      archivo: `${tipo === 'remito' ? 'remito' : 'factura-x'}-${numero ?? venta.id.slice(0, 8)}.pdf`,
    },
  }
}
