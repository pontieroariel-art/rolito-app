// Comprobantes de la venta del camión que NO autoriza ARCA (docs/arca §11 y §13):
//
//   - Contado + cuenta corriente, o contado en $0 (solo cambios) → REMITO de
//     Redonhielo. Es el remito OFICIAL: sale con letra R y el CAI del talonario
//     autorizado por ARCA cuando la oficina lo cargó en config/remitoOficial;
//     mientras no esté, sale con letra X y sin CAI (no se inventa uno).
//   - Promo (Rolito), cobrada, en cuenta corriente o en $0 (solo cambios) →
//     FACTURA X de Rolito: no oficial, con precios; los cambios van como
//     renglones sin cargo. En Rolito no hay remitos (decisión de Ariel
//     2026-09-05): la factura en $0 es el papel del cambio. El tipo
//     'remitoPromo' queda solo para leer/reimprimir las ventas anteriores.
//
// El remito no lleva precios: solo cantidades, el bloque de entrega y el resumen
// de bultos. La firma del cliente va impresa en todos (decisión 2026-09-03).

import { UserProfile, VentaCamion, TipoComprobanteInterno } from '@/types'
import { documentoDeVenta } from './circuitoDocumento'
import { clienteImpreso } from './clienteImpreso'
import { codigoComprobanteInterno } from './numeracionInterna'
import { EMISOR_REDONHIELO, EMISOR_ROLITO, Emisor } from './emisores'

const CONDICION_VENTA: Record<VentaCamion['formaPago'], string> = {
  contado_efectivo:      'Contado',
  contado_transferencia: 'Transferencia',
  cuenta_corriente:      'Cuenta corriente',
}

/**
 * Qué comprobante interno le corresponde a la venta, o null si va por ARCA.
 * Si la venta ya salió con un comprobante numerado, ese tipo manda (una promo
 * en $0 anterior al 2026-09-05 salió como remito de Rolito y se reimprime así).
 */
export function tipoComprobanteInterno(
  venta: Pick<VentaCamion, 'canal' | 'formaPago' | 'total'> & { comprobanteInterno?: VentaCamion['comprobanteInterno'] },
): TipoComprobanteInterno | null {
  if (venta.comprobanteInterno?.tipo) return venta.comprobanteInterno.tipo
  const documento = documentoDeVenta(venta.canal, venta.formaPago, venta.total)
  if (documento === 'remito') return 'remito'
  // Promo: siempre factura X — cobrada, en cuenta corriente (2026-09-03) o en
  // $0 con solo cambios (2026-09-05). Espejo de destinoTango en functions.
  if (documento === 'no_oficial') return 'facturaX'
  return null
}

export const ETIQUETA_COMPROBANTE: Record<TipoComprobanteInterno, string> = {
  remito:      'Remito',
  remitoPromo: 'Remito',
  facturaX:    'Factura X',
}

// ── Remito ───────────────────────────────────────────────────────────────────

/** CAI del talonario de remitos de Redonhielo (config/remitoOficial). */
export interface CaiRemito {
  cai:         string
  vencimiento: Date
}

export interface RenglonRemito {
  descripcion: string
  cantidad:    number
  /** Bolsa rota repuesta sin cargo: se marca aparte en el papel. */
  esCambio:    boolean
}

export interface RemitoData {
  empresa:      'redonhielo' | 'rolito'
  emisor:       Emisor
  /** R = oficial con CAI; X = sin autorización fiscal. */
  letra:        'R' | 'X'
  /** "00002-00000015", o null si la venta salió sin numerar. */
  numero:       string | null
  fechaEmision: Date
  cliente: {
    razonSocial:    string
    /** "YPF RUTA 8 KM 40 (YPF012)": la sucursal donde se entregó, si la cuenta tiene varias (2026-09-10). */
    sucursal?:      string
    cuit:           string
    domicilio:      string
    /** "1611, DON TORCUATO" — C.P. y localidad, como en el talonario. */
    localidadCp:    string
    condicionIva:   string
    /** Código de cliente que se imprime (el de la sucursal vendida; si no, el de Tango o el de la app). */
    codigoCliente:  string
    vendedor:       string
    condicionVenta: string
  }
  entrega: {
    chofer:  string
    camion?: string
  }
  /** Orden de compra del cliente, impresa en el recuadro "Remitos - O/C" (2026-09-11). */
  ordenCompra?: string
  renglones:    RenglonRemito[]
  bultos: {
    entregados: number
    cambios:    number
  }
  firma?:       { dataUrl: string; aclaracion: string }
  /** Sello grande translúcido sobre el detalle ("PARA REPARTO" en el remito de carga). */
  marcaAgua?:   string
  /** Líneas extra al pie, debajo del CAI (ej. el COT de ARBA). */
  pieExtra?:    string[]
  /** Sin firma digital: línea para firmar en el papel con este rótulo. */
  firmaEnPapel?: string
  /** Lo que va donde la factura lleva el CAE. */
  control:
    | { tipo: 'cai'; cai: string; vencimiento: Date }
    | { tipo: 'interno'; codigo: string }
  leyenda:      string
  archivo:      string
}

export type ArmadoRemito =
  | { ok: true; datos: RemitoData }
  | { ok: false; motivo: string }

/**
 * Arma el remito. `cai` es el del talonario de Redonhielo: con él el remito
 * oficial sale con letra R; sin él (o vencido) sale X. Para Rolito se ignora.
 */
export function armarRemito(venta: VentaCamion, cliente?: UserProfile, cai?: CaiRemito | null): ArmadoRemito {
  const tipo = tipoComprobanteInterno(venta)
  if (tipo !== 'remito' && tipo !== 'remitoPromo') {
    return { ok: false, motivo: 'Esta venta no sale por remito.' }
  }
  const promo = tipo === 'remitoPromo'
  const numero = venta.comprobanteInterno ? codigoComprobanteInterno(venta.comprobanteInterno) : null
  const fechaEmision = venta.fecha.toDate()

  const items = venta.items.map((i) => ({ descripcion: i.nombre, cantidad: i.cantidad, esCambio: false }))
  const cambios = (venta.cambios ?? []).map((i) => ({ descripcion: i.nombre, cantidad: i.cantidad, esCambio: true }))

  // El CAI solo vale para Redonhielo, cargado y vigente a la fecha de la venta.
  const caiVigente = !promo && cai && cai.vencimiento.getTime() >= startOfDay(fechaEmision).getTime() ? cai : null

  const control: RemitoData['control'] = caiVigente
    ? { tipo: 'cai', cai: caiVigente.cai, vencimiento: caiVigente.vencimiento }
    : { tipo: 'interno', codigo: numero ?? venta.id.slice(0, 8).toUpperCase() }

  const letra: RemitoData['letra'] = caiVigente ? 'R' : 'X'
  const ci = clienteImpreso(venta, cliente)
  const leyenda = caiVigente
    ? 'Remito de entrega. La factura la emite la oficina.'
    : promo
      ? 'DOCUMENTO NO VÁLIDO COMO FACTURA — Remito interno de Rolito (promo).'
      : 'DOCUMENTO NO VÁLIDO COMO FACTURA — Remito de entrega. La factura la emite la oficina.'

  return {
    ok: true,
    datos: {
      empresa: promo ? 'rolito' : 'redonhielo',
      emisor: promo ? EMISOR_ROLITO : EMISOR_REDONHIELO,
      letra,
      numero,
      fechaEmision,
      ...(venta.ordenCompra ? { ordenCompra: venta.ordenCompra } : {}),
      cliente: {
        razonSocial:    ci.razonSocial,
        ...(ci.sucursal ? { sucursal: ci.sucursal } : {}),
        cuit:           ci.cuit,
        domicilio:      ci.domicilio,
        localidadCp:    ci.localidadCp,
        condicionIva:   ci.condicionIva,
        codigoCliente:  ci.codigoCliente,
        vendedor:       venta.choferNombre,
        condicionVenta: CONDICION_VENTA[venta.formaPago] ?? '',
      },
      entrega: {
        chofer: venta.choferNombre,
        ...(venta.camionId ? { camion: venta.camionId } : {}),
      },
      renglones: [...items, ...cambios],
      bultos: {
        entregados: items.reduce((s, i) => s + i.cantidad, 0),
        cambios:    cambios.reduce((s, i) => s + i.cantidad, 0),
      },
      ...(venta.firmaCliente
        ? { firma: { dataUrl: venta.firmaCliente, aclaracion: venta.firmanteNombre ?? '' } }
        : {}),
      control,
      leyenda,
      archivo: `remito-${numero ?? venta.id.slice(0, 8)}.pdf`,
    },
  }
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

// ── Factura X (promo cobrada) ────────────────────────────────────────────────

export interface RenglonInterno {
  descripcion:    string
  cantidad:       number
  precioUnitario: number
  total:          number
  /** Bolsa rota repuesta sin cargo (precio 0). */
  esCambio:       boolean
}

export interface ComprobanteInternoData {
  /** Orden de compra del cliente, impresa en el recuadro "Remitos - O/C" (2026-09-11). */
  ordenCompra?: string
  /** El talonario de promo decía "PROMOCIÓN", no "FACTURA". La NC X (2026-09-11) dice "NOTA DE CRÉDITO". */
  titulo:        'PROMOCIÓN' | 'NOTA DE CRÉDITO'
  /** NC X: la promo que anula ("Anula Promoción X 01104-00000640"). */
  comprobanteAsociado?: string
  letra:         'X'
  empresa:       'rolito'
  emisor:        Emisor
  numero:        string | null
  fechaEmision:  Date
  cliente: {
    razonSocial:    string
    sucursal?:      string
    cuit:           string
    condicionIva:   string
    domicilio:      string
    localidadCp:    string
    codigoCliente:  string
    condicionVenta: string
    vendedor:       string
  }
  renglones:     RenglonInterno[]
  total:         number
  firma?:        { dataUrl: string; aclaracion: string }
  leyenda:       string
  archivo:       string
}

export type ArmadoInterno =
  | { ok: true; datos: ComprobanteInternoData }
  | { ok: false; motivo: string }

export function armarFacturaX(venta: VentaCamion, cliente?: UserProfile): ArmadoInterno {
  if (tipoComprobanteInterno(venta) !== 'facturaX') {
    return { ok: false, motivo: 'Esta venta no sale por factura X.' }
  }
  const numero = venta.comprobanteInterno ? codigoComprobanteInterno(venta.comprobanteInterno) : null
  const ci = clienteImpreso(venta, cliente)

  const renglon = (i:VentaCamion['items'][number], esCambio: boolean): RenglonInterno => ({
    descripcion:    i.nombre,
    cantidad:       i.cantidad,
    precioUnitario: esCambio ? 0 : i.precioUnitario,
    total:          esCambio ? 0 : i.cantidad * i.precioUnitario,
    esCambio,
  })
  const renglones: RenglonInterno[] = [
    ...venta.items.map((i) => renglon(i, false)),
    ...(venta.cambios ?? []).map((i) => renglon(i, true)),
  ]

  return {
    ok: true,
    datos: {
      titulo: 'PROMOCIÓN',
      letra: 'X',
      empresa: 'rolito',
      emisor: EMISOR_ROLITO,
      numero,
      fechaEmision: venta.fecha.toDate(),
      ...(venta.ordenCompra ? { ordenCompra: venta.ordenCompra } : {}),
      cliente: {
        razonSocial:    ci.razonSocial,
        ...(ci.sucursal ? { sucursal: ci.sucursal } : {}),
        cuit:           ci.cuit,
        condicionIva:   ci.condicionIva,
        domicilio:      ci.domicilio,
        localidadCp:    ci.localidadCp,
        codigoCliente:  ci.codigoCliente,
        condicionVenta: CONDICION_VENTA[venta.formaPago] ?? '',
        vendedor:       venta.choferNombre,
      },
      renglones,
      total: venta.total,
      ...(venta.firmaCliente
        ? { firma: { dataUrl: venta.firmaCliente, aclaracion: venta.firmanteNombre ?? '' } }
        : {}),
      leyenda: 'DOCUMENTO NO VÁLIDO COMO FACTURA — Comprobante interno de Rolito (promo). No autorizado por ARCA.',
      archivo: `factura-x-${numero ?? venta.id.slice(0, 8)}.pdf`,
    },
  }
}

/**
 * Nota de crédito X de una promo anulada (2026-09-11): el mismo papel que la
 * factura X, al revés, con el número interno que asignó el server
 * (`anulacion.notaCreditoInterna`) y la promo que anula. Sin ARCA.
 */
export function armarNotaCreditoX(venta: VentaCamion, cliente?: UserProfile): ArmadoInterno {
  const nc = venta.anulacion?.notaCreditoInterna
  if (!nc) return { ok: false, motivo: 'Esta venta no tiene una nota de crédito X emitida.' }
  const base = armarFacturaX({ ...venta, canal: 'promo' }, cliente)
  if (!base.ok) return base
  const numero = codigoComprobanteInterno({ puntoVenta: nc.puntoVenta, numero: nc.numero })
  const promo = base.datos.numero ?? 'sin número'
  return {
    ok: true,
    datos: {
      ...base.datos,
      titulo: 'NOTA DE CRÉDITO',
      numero,
      fechaEmision: new Date(`${nc.fecha}T12:00:00`),
      comprobanteAsociado: `Anula Promoción X ${promo}`,
      firma: undefined,
      leyenda: `DOCUMENTO NO VÁLIDO COMO FACTURA — Nota de crédito interna de Rolito (promo) que anula la Promoción X ${promo}. No autorizada por ARCA.`,
      archivo: `nota-credito-x-${numero}.pdf`,
    },
  }
}
