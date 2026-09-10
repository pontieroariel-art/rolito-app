// Armado PURO del comprobante para el Facturador de Tango
// (`POST /Api/FacturadorVenta/registrar`, body = array). Port a TypeScript de
// scripts/tango/tango-factura.mjs para el worker en Cloud Functions.
//
// Regla de oro: los IMPORTES son los que la app ya le informó a ARCA
// (`payload.factura.importes`) — no se recalculan. Los ítems se reconstruyen
// desde la venta y se ajustan por redondeo para que sumen exacto. El CAE viaja
// tal cual (`cAE`, `fechaVtoCAE`): Tango registra el comprobante YA autorizado
// (ejemplo 05 del readme oficial, INTEGRACION.md §12 y §15).

import { referenciaPedido, fechaDe, fechaISO, numeroComprobanteInterno, quienVende, type PayloadVenta, type ItemOutbox } from './pedido'

export const LETRA_POR_CBTE_TIPO: Record<number, string> = { 1: 'A', 6: 'B', 11: 'C' }
/** Notas de crédito de ARCA (3 = NC A, 8 = NC B, 13 = NC C). */
export const LETRA_NC_POR_CBTE_TIPO: Record<number, string> = { 3: 'A', 8: 'B', 13: 'C' }
/** Motivo de NC de Tango por defecto: 4 = "Anulación de fact. electrónica" (tabla Motivos NC del Facturador). */
export const CODIGO_MOTIVO_NC_DEFAULT = 4
const IVA_21 = 21

export const redondear2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const recortar = (s: unknown, n: number) => (s == null ? '' : String(s)).slice(0, n)

export interface ConfigFacturadorEmpresa {
  talonarios?: Record<string, number | string>
  /**
   * Talonarios de NOTA DE CRÉDITO por letra (A/B), para anular una factura de
   * ventanilla (2026-09-09). En Tango el talonario es por tipo de comprobante,
   * así que la NC no puede usar el de la factura.
   */
  talonariosNC?: Record<string, number | string>
  /** Motivo de NC de Tango (tabla Motivos NC). Ausente = 4 "Anulación de fact. electrónica". */
  codigoMotivoNC?: number | string
  /**
   * Código de tipo de comprobante de la nota de crédito en el Facturador.
   * Ausente = 'N/C' (lo que Tango guarda en GVA12.T_COMP para las notas de
   * crédito). El ejemplo del readme oficial usa 'CDE', pero en la instalación
   * de Redonhielo el Facturador lo rechazó: "(78038) El código de tipo de
   * comprobante CDE no existe" (primera NC real, 2026-09-10).
   */
  codigoTipoNC?: string
  /** Un código, o { contado, cuenta_corriente } (la promo en cta. cte. factura con cuota). */
  condicionVenta?: number | string | Record<string, number | string>
  listaPrecio?: number | string | Record<string, number | string>
  contracuenta?: number | string
  vendedor?: number | string
  codigoTasaIva21?: number | string
  /**
   * Empresa que factura SIN IVA (Rolito / promo, decisión Ariel 2026-09-03): el
   * precio de la app es el importe final, IVA 0, alícuota "tasa cero"
   * (`codigoTasaIvaCero`, default 10). Redonhielo sigue con 21%.
   */
  sinIva?: boolean
  codigoTasaIvaCero?: number | string
  cuentas?: Record<string, number | string>
  tipoPago?: Record<string, string>
  codigoAlicuotaPercepcionIIBB?: number | string
  codigoPercepcionIIBB?: string
  preciosIncluyenIva?: boolean
  fechaCierreTesoreria?: string
  depositoVentanilla?: string
  /**
   * false = la factura NO descarga stock en esta empresa (Rolito, decisión de
   * Ariel 2026-09-05: todo el stock vive en Redonhielo; la mercadería de la
   * promo sale por un egreso VPR en Redonhielo, ver sql/movimientoStock.ts).
   * Ausente = true (Redonhielo).
   */
  descargaStock?: boolean
}

export interface MapeosFactura {
  codigoArticulo: (productoId: string) => string | null
  codigoDeposito?: string | null
  etiquetaCamion?: string
  /**
   * Letra con la que Tango registra la factura X de promo (Tango no tiene
   * letra X para facturas): 'A' si el cliente es Responsable Inscripto, 'B'
   * si no — decisión de Ariel 2026-09-03 (opción "factura manual en Rolito").
   * El papel del cliente sigue siendo la factura X de la app.
   */
  letraNoFiscal?: 'A' | 'B'
}

/** 'AAAAMMDD' (formato ARCA) → 'yyyy-mm-dd'. Acepta también yyyy-mm-dd o Date. */
export function fechaArcaAIso(v: unknown): string | null {
  if (!v) return null
  if (v instanceof Date) return fechaISO(v)
  const s = String(v)
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return null
}

/** Letra + punto de venta (5) + número (8): 'A' + '01104' + '00000001'. */
export function numeroComprobanteTango(letra: string, puntoVenta: number | undefined, numero: number): string {
  return `${letra}${String(puntoVenta ?? 0).padStart(5, '0')}${String(numero).padStart(8, '0')}`
}

export interface DocumentoVenta {
  letra: string
  puntoVenta: number | undefined
  numero: number
  cae: string | null
  caeFchVto: string | null
  importes: { fecha?: string; neto: number; iva: number; tributos?: number; total: number } | null
  fiscal: boolean
}

/**
 * Qué documento representa la venta: FAC A/B/C con CAE de ARCA, o la factura X
 * interna de promo (sin CAE). Devuelve null si no hay nada facturable.
 */
export function documentoDeVenta(payload: PayloadVenta): DocumentoVenta | { error: string } | null {
  const f = payload.factura
  if (f && f.estado === 'emitida' && typeof f.numero === 'number') {
    const letra = LETRA_POR_CBTE_TIPO[f.cbteTipo ?? -1]
    if (!letra) return { error: `cbteTipo ${f.cbteTipo} sin letra conocida (1=A, 6=B, 11=C)` }
    if (!f.importes) return { error: 'La factura no tiene importes guardados (factura.importes)' }
    return { letra, puntoVenta: f.puntoVenta, numero: f.numero, cae: f.cae ?? null, caeFchVto: f.caeFchVto ?? null, importes: f.importes, fiscal: true }
  }
  const ci = payload.comprobanteInterno
  if (ci && ci.tipo === 'facturaX' && typeof ci.numero === 'number') {
    return { letra: 'X', puntoVenta: ci.puntoVenta, numero: ci.numero, cae: null, caeFchVto: null, importes: null, fiscal: false }
  }
  return null
}

export interface ItemFacturador {
  codigo: string
  descripcion: string
  cantidad: number
  codigoDeposito?: string
  codigoTasaIva: number | string
  precio: number
  importe: number
  importeSinImpuestos: number
  importeIva: number
  descargaStock: boolean
  percepciones?: Percepcion[]
  /** Neto del ítem, para repartir percepciones; se quita antes de mandar. */
  _base: number
}

export interface Percepcion {
  codigoAlicuota: number | string
  codigoPercepcion: string
  porcentaje: number
  base: number
  importe: number
}

interface OpcionesItems {
  codigoArticulo: (productoId: string) => string | null
  preciosIncluyenIva?: boolean
  codigoTasaIva: number | string
  codigoDeposito?: string | null
  totales?: { neto: number; iva: number } | null
  /** Sin IVA: el precio de la app es el importe final (base = importe, IVA 0). */
  sinIva?: boolean
  /**
   * false = los ítems no descargan stock. El depósito se manda igual: el Facturador
   * lo exige aunque no descargue (rechaza con exceptionMessage "*" si falta —
   * probado en Rolito el 2026-09-06, factura A 01104-00000062).
   */
  descargaStock?: boolean
  /**
   * Incluir los cambios como renglones a $0 (artículos CAMBIO*, que en Tango no
   * mueven stock). Solo para la factura en $0 de Rolito: una promo de solo
   * cambios no tiene otro renglón que mostrar (decisión de Ariel 2026-09-05).
   */
  incluirCambios?: boolean
}

/**
 * Ítems del comprobante con importes que cierran contra los totales de ARCA.
 * Los precios de la app son NETOS salvo preciosIncluyenIva. Los cambios NO van
 * (salvo `incluirCambios`): un renglón a $0 confunde al cliente y el artículo
 * CAMBIO* movía stock ficticio (decisión de Ariel 2026-09-04,
 * docs/tango/STOCK_REPARTO.md). El cambio sale del stock por otro comprobante.
 */
export function itemsDeVenta(payload: PayloadVenta, opciones: OpcionesItems): { items: ItemFacturador[]; faltantes: string[]; error?: string } {
  const { codigoArticulo, preciosIncluyenIva = false, codigoTasaIva, codigoDeposito, totales, sinIva = false, incluirCambios = false } = opciones
  const descargaStock = opciones.descargaStock !== false
  const items: (ItemFacturador & { esCambio: boolean })[] = []
  const faltantes: string[] = []
  // Sin IVA (Rolito): el precio es final, no hay factor.
  const factor = sinIva ? 1 : 1 + IVA_21 / 100
  const tasa = sinIva ? 0 : IVA_21

  const agregar = (it: { productoId: string; nombre?: string; cantidad: number; precioUnitario?: number }, esCambio: boolean) => {
    const cantidad = Number(it.cantidad)
    if (!(cantidad > 0)) return
    const productoId = it.productoId
    let codigo = codigoArticulo(productoId)
    if (!codigo && esCambio && productoId.startsWith('cambio_')) codigo = codigoArticulo(productoId.slice('cambio_'.length))
    if (!codigo) { faltantes.push(it.productoId); return }
    const unitario = esCambio ? 0 : Number(it.precioUnitario ?? 0)
    const bruto = cantidad * unitario
    const base  = redondear2(preciosIncluyenIva ? bruto / factor : bruto)
    const iva   = redondear2(base * (tasa / 100))
    items.push({
      codigo,
      descripcion: recortar(it.nombre ?? it.productoId, 30),
      cantidad,
      ...(codigoDeposito ? { codigoDeposito } : {}),
      codigoTasaIva,
      precio: redondear2(preciosIncluyenIva ? unitario : unitario * factor),
      importe: redondear2(base + iva),
      importeSinImpuestos: base,
      importeIva: iva,
      // Un renglón de cambio nunca descarga: el artículo CAMBIO* es informativo.
      descargaStock: descargaStock && !esCambio,
      _base: base,
      esCambio,
    })
  }
  for (const it of payload.items ?? []) agregar(it, false)
  if (incluirCambios) for (const it of payload.cambios ?? []) agregar(it, true)

  // Ajuste por redondeo: la suma de bases/IVAs tiene que dar EXACTO el neto/IVA
  // informado a ARCA. La diferencia (centavos) se carga al último ítem con importe.
  if (totales && items.length) {
    const conImporte = items.filter((i) => !i.esCambio && i._base > 0)
    const ultimo = conImporte[conImporte.length - 1] ?? items[items.length - 1]
    const dBase = redondear2(totales.neto - items.reduce((s, i) => s + i._base, 0))
    const dIva  = redondear2(totales.iva  - items.reduce((s, i) => s + i.importeIva, 0))
    if (Math.abs(dBase) > 1 || Math.abs(dIva) > 1) {
      return { items: [], faltantes, error: `Los ítems no cierran contra los importes de ARCA (neto ${totales.neto} vs ${redondear2(totales.neto - dBase)}, iva ${totales.iva} vs ${redondear2(totales.iva - dIva)})` }
    }
    ultimo._base = redondear2(ultimo._base + dBase)
    ultimo.importeSinImpuestos = ultimo._base
    ultimo.importeIva = redondear2(ultimo.importeIva + dIva)
    ultimo.importe = redondear2(ultimo._base + ultimo.importeIva)
  }

  return {
    faltantes: [...new Set(faltantes)],
    items: items.map(({ esCambio: _e, ...i }) => i),
  }
}

/**
 * Percepción de IIBB (tributos de ARCA) repartida por ítem proporcional al
 * neto, ajustada para que sume exacto `tributos`. La alícuota se reconstruye
 * (tributos / neto) porque la venta solo guarda el importe total.
 */
export function percepcionesPorItem(items: { _base: number }[], tributos: number | undefined, cfg: ConfigFacturadorEmpresa): Percepcion[][] {
  const total = redondear2(tributos ?? 0)
  if (!(total > 0)) return items.map(() => [])
  const neto = items.reduce((s, i) => s + i._base, 0)
  if (!(neto > 0)) return items.map(() => [])
  const alicuota = Math.round((total / neto) * 100 * 100) / 100
  const repartos = items.map((i) => (i._base > 0 ? redondear2(i._base * (alicuota / 100)) : 0))
  const dif = redondear2(total - repartos.reduce((s, x) => s + x, 0))
  const idx = repartos.map((x, k) => [x, k] as const).filter(([x]) => x > 0).pop()?.[1] ?? 0
  repartos[idx] = redondear2(repartos[idx] + dif)
  return items.map((i, k) => (repartos[k] > 0 ? [{
    codigoAlicuota: cfg.codigoAlicuotaPercepcionIIBB as number | string,
    codigoPercepcion: cfg.codigoPercepcionIIBB ?? '',
    porcentaje: alicuota,
    base: i._base,
    importe: repartos[k],
  }] : []))
}

export type ArmadoFactura =
  | { comprobante: Record<string, unknown>; fiscal: boolean; referencia: string; error?: undefined }
  | { error: string; faltantes?: string[] }

/** Arma el comprobante completo para el Facturador. */
export function armarComprobanteFacturador(payload: PayloadVenta, item: ItemOutbox, cfg: ConfigFacturadorEmpresa, mapeos: MapeosFactura): ArmadoFactura {
  const docu0 = documentoDeVenta(payload)
  if (!docu0) return { error: 'La venta no tiene factura de ARCA emitida ni factura X interna: nada que registrar' }
  if ('error' in docu0) return { error: docu0.error }
  // La factura X de la app entra en Tango con letra A/B (no existe X para facturas).
  if (!docu0.fiscal && !mapeos.letraNoFiscal) return { error: 'Falta la letra (A/B) con la que Tango registra la factura X de promo (categoría de IVA del cliente)' }
  const docu = docu0.fiscal ? docu0 : { ...docu0, letra: mapeos.letraNoFiscal as string }

  const empresa = item.empresa ?? '?'
  const talonario = cfg.talonarios?.[docu.letra]
  if (!talonario) return { error: `Falta config/tango.facturador.${empresa}.talonarios.${docu.letra} (código de talonario para la letra ${docu.letra})` }
  const codigoCliente = payload.clienteCodigoTango
  if (!codigoCliente) return { error: `La venta no trae clienteCodigoTango (cliente ${payload.clienteId} sin vincular a Tango)` }
  const formaPago = payload.formaPago ?? ''
  const cuenta = cfg.cuentas?.[formaPago]
  if (!cuenta && formaPago !== 'cuenta_corriente') return { error: `Falta config/tango.facturador.${empresa}.cuentas.${formaPago} (cuenta de tesorería)` }
  const sinIva = cfg.sinIva === true
  const codigoTasaIva = sinIva ? (cfg.codigoTasaIvaCero ?? 10) : cfg.codigoTasaIva21
  for (const k of ['condicionVenta', 'contracuenta', 'vendedor', ...(sinIva ? [] : ['codigoTasaIva21' as const])] as const) {
    if (cfg[k] === undefined || cfg[k] === null || cfg[k] === '') return { error: `Falta config/tango.facturador.${empresa}.${k}` }
  }
  const listaPrecio = typeof cfg.listaPrecio === 'object' && cfg.listaPrecio !== null
    ? (cfg.listaPrecio as Record<string, number | string>)[payload.canal ?? '']
    : cfg.listaPrecio
  if (listaPrecio === undefined || listaPrecio === null) return { error: `Falta config/tango.facturador.${empresa}.listaPrecio (o .listaPrecio.${payload.canal})` }
  // Condición de venta: un código para todo, o uno por forma de pago
  // ({ contado, cuenta_corriente }) — la promo en cta. cte. va como factura
  // con cuota y Tango necesita la condición de cuenta corriente.
  const condicionVenta = typeof cfg.condicionVenta === 'object' && cfg.condicionVenta !== null
    ? (cfg.condicionVenta as Record<string, number | string>)[formaPago === 'cuenta_corriente' ? 'cuenta_corriente' : 'contado']
    : cfg.condicionVenta
  if (condicionVenta === undefined || condicionVenta === null) return { error: `Falta config/tango.facturador.${empresa}.condicionVenta.${formaPago === 'cuenta_corriente' ? 'cuenta_corriente' : 'contado'}` }

  let totales = docu.importes
    ? { neto: Number(docu.importes.neto), iva: Number(docu.importes.iva), tributos: Number(docu.importes.tributos ?? 0), total: Number(docu.importes.total) }
    : null
  const descargaStock = cfg.descargaStock !== false
  // Factura X de promo sin nada vendido (solo cambios): en Rolito queda una
  // factura en $0 con los renglones de cambio, que es el papel del cambio.
  const soloCambios = !docu.fiscal && !(payload.items ?? []).some((i) => Number(i.cantidad) > 0) && (payload.cambios ?? []).some((i) => Number(i.cantidad) > 0)
  const r = itemsDeVenta(payload, {
    codigoArticulo: mapeos.codigoArticulo, preciosIncluyenIva: cfg.preciosIncluyenIva === true,
    codigoTasaIva: codigoTasaIva as number | string, codigoDeposito: mapeos.codigoDeposito, totales, sinIva,
    descargaStock, incluirCambios: soloCambios,
  })
  if (r.error) return { error: r.error }
  if (r.faltantes.length) return { error: `Falta el código de artículo Tango en config/tango.articulos para: ${r.faltantes.join(', ')}`, faltantes: r.faltantes }
  if (r.items.length === 0) return { error: 'La venta no tiene ítems con cantidad > 0' }
  if (!totales) {
    const neto = redondear2(r.items.reduce((s, i) => s + i._base, 0))
    const iva  = redondear2(r.items.reduce((s, i) => s + i.importeIva, 0))
    totales = { neto, iva, tributos: 0, total: redondear2(neto + iva) }
  }
  if (totales.tributos > 0 && !cfg.codigoAlicuotaPercepcionIIBB) {
    return { error: `La factura lleva percepción de IIBB (${totales.tributos}) y falta config/tango.facturador.${empresa}.codigoAlicuotaPercepcionIIBB` }
  }
  const percepciones = percepcionesPorItem(r.items, totales.tributos, cfg)

  const ref = referenciaPedido(item.origenColeccion, item.origenId)
  const fecha = fechaArcaAIso(docu.importes?.fecha) ?? fechaISO(fechaDe(payload.fecha))
  const numeroInterno = numeroComprobanteInterno(payload.comprobanteInterno)
  // Quién vendió (cajero o chofer) va en la leyenda 3 y en las observaciones;
  // el vendedor del comprobante (codigoVendedor) es el supervisor del cliente.
  const vende = quienVende(payload, mapeos.etiquetaCamion ?? payload.camionId ?? '')

  const comprobante: Record<string, unknown> = {
    codigoTipoComprobante: 'FAC',
    numeroComprobante: numeroComprobanteTango(docu.letra, docu.puntoVenta, docu.numero),
    codigoTalonario: talonario,
    ...(docu.cae ? { cAE: docu.cae, fechaVtoCAE: fechaArcaAIso(docu.caeFchVto) ?? undefined } : {}),
    codigoCliente,
    codigoCondicionDeVenta: condicionVenta,
    fechaComprobante: fecha,
    ...(cfg.fechaCierreTesoreria ? { fechaCierreTesoreria: cfg.fechaCierreTesoreria } : {}),
    codigoListaPrecio: listaPrecio,
    codigoContracuenta: cfg.contracuenta,
    ...(mapeos.codigoDeposito ? { codigoDeposito: mapeos.codigoDeposito } : {}),   // obligatorio para el Facturador aunque no descargue
    codigoVendedor: String(cfg.vendedor),
    leyenda1: recortar(ref, 60),
    leyenda2: recortar(`Venta ${payload.canal === 'promo' ? 'Promo' : 'Contado'} app${numeroInterno ? ` ${numeroInterno}` : ''} - ${formaPago}`, 60),
    leyenda3: recortar(vende.leyenda, 60),
    leyenda4: recortar(payload.firmanteNombre ? `Firmo: ${payload.firmanteNombre}` : '', 60),
    leyenda5: '',
    total: totales.total,
    totalSinImpuestos: totales.neto,
    totalExento: 0,
    totalIva: totales.iva,
    subtotal: totales.total,
    subtotalSinImpuestos: totales.neto,
    observaciones: recortar(`${ref}. Venta desde ${vende.lugar} por ${vende.nombre}; firmo ${payload.firmanteNombre ?? 'el cliente'}.`, 280),
    items: r.items.map((i, k) => {
      const { _base, ...it } = i
      return percepciones[k].length ? { ...it, percepciones: percepciones[k] } : it
    }),
  }
  if (totales.total <= 0) {
    // Factura en $0 (solo cambios): no hay nada que cobrar ni que imputar. Si el
    // Facturador exige un pago o una cuota igual, se ajusta con la prueba en TestingRH.
  } else if (formaPago === 'cuenta_corriente') {
    comprobante.cuotasCuentaCorriente = [{ fechaVencimiento: fecha, importe: totales.total }]
  } else {
    comprobante.pagos = [{ tipo: cfg.tipoPago?.[formaPago] ?? 'Efectivo', codigoDeCuenta: cuenta, monto: totales.total }]
  }
  return { comprobante, fiscal: docu.fiscal, referencia: ref }
}

/** Interpreta la respuesta del Facturador: { Message, Comprobantes[], Succeeded }. */
export function interpretarRespuestaFacturador(data: unknown, numeroEsperado: string): { ok: boolean; yaExistia: boolean; mensaje: string; numeroComprobante: string | null } {
  const d = (data ?? {}) as Record<string, unknown>
  const lista = ((d.Comprobantes ?? d.comprobantes ?? []) as Record<string, unknown>[])
  const c = lista.find((x) => String(x.numeroComprobante ?? '').replace(/\s+/g, '').endsWith(numeroEsperado)) ?? lista[0]
  const succeeded = (d.Succeeded ?? d.succeeded) === true
  const ok = succeeded && (!c || /^ok$/i.test(String(c.estado ?? 'Ok')))
  const mensaje = [c?.mensaje, c?.exceptionMessage, d.Message ?? d.message].filter(Boolean).join(' | ')
  const yaExistia = /\(51016\)|ya existe el n(ú|u)mero de comprobante/i.test(mensaje)
  return { ok: ok || yaExistia, yaExistia, mensaje, numeroComprobante: (c?.numeroComprobante as string | undefined) ?? null }
}

// ── Nota de crédito (anulación de una factura de ventanilla, 2026-09-09) ─────

/**
 * Arma la NOTA DE CRÉDITO que anula la factura de la venta, para el Facturador
 * (ejemplo 06 del readme oficial: `codigoTipoComprobante: 'CDE'` con
 * `codigoTipoComprobanteDeReferencia`/`numeroDeComprobanteDeReferencia` y
 * `comprobanteCanceladoCompletamente: true`).
 *
 * Se apoya en `armarComprobanteFacturador`: la NC es la factura entera
 * (mismos ítems, importes, percepciones y pago, así el efectivo y el stock
 * vuelven por donde salieron) con su propio número, talonario, CAE y fecha,
 * más la referencia a la factura. Los importes de la NC son los que ARCA
 * autorizó (`payload.notaCredito.importes`); si no coinciden con los de la
 * factura, no se registra.
 */
export function armarNotaCreditoFacturador(payload: PayloadVenta, item: ItemOutbox, cfg: ConfigFacturadorEmpresa, mapeos: MapeosFactura): ArmadoFactura {
  const nc = payload.notaCredito
  if (!nc || nc.estado !== 'emitida' || typeof nc.numero !== 'number' || !nc.cae) {
    return { error: 'La anulación no tiene una nota de crédito emitida por ARCA (notaCredito.estado/numero/cae)' }
  }
  const letra = LETRA_NC_POR_CBTE_TIPO[nc.cbteTipo ?? -1]
  if (!letra) return { error: `cbteTipo ${nc.cbteTipo} no es una nota de crédito conocida (3=A, 8=B, 13=C)` }
  const asociado = nc.cbtesAsoc?.[0]
  if (!asociado) return { error: 'La nota de crédito no trae el comprobante asociado (cbtesAsoc)' }
  const letraFactura = LETRA_POR_CBTE_TIPO[asociado.Tipo]
  if (!letraFactura) return { error: `El comprobante asociado tiene tipo ${asociado.Tipo}, que no es una factura` }
  const empresa = item.empresa ?? '?'
  const talonario = cfg.talonariosNC?.[letra]
  if (!talonario) return { error: `Falta config/tango.facturador.${empresa}.talonariosNC.${letra} (talonario de nota de crédito ${letra})` }

  const base = armarComprobanteFacturador(payload, item, cfg, mapeos)
  if (base.error !== undefined) return base
  if (!base.fiscal) return { error: 'Solo se anulan por nota de crédito las facturas con CAE de ARCA' }
  const totalFactura = Number(base.comprobante.total)
  const totalNc = Number(nc.importes?.total ?? totalFactura)
  if (Math.abs(totalFactura - totalNc) > 0.011) {
    return { error: `El total de la nota de crédito (${totalNc}) no coincide con el de la factura (${totalFactura}); no se registra` }
  }

  const ref = `ROLITO:NC:${item.origenId}`
  const numeroFactura = numeroComprobanteTango(letraFactura, asociado.PtoVta, asociado.Nro)
  const anulacion = payload.anulacion ?? {}
  const motivo = anulacion.motivo ? `${anulacion.motivo}${anulacion.nota ? ` - ${anulacion.nota}` : ''}` : (anulacion.nota ?? '')
  const comprobante: Record<string, unknown> = {
    ...base.comprobante,
    codigoTipoComprobante: String(cfg.codigoTipoNC ?? 'N/C'),
    numeroComprobante: numeroComprobanteTango(letra, nc.puntoVenta, nc.numero),
    codigoTalonario: talonario,
    cAE: nc.cae,
    fechaVtoCAE: fechaArcaAIso(nc.caeFchVto) ?? undefined,
    fechaComprobante: fechaArcaAIso(nc.importes?.fecha) ?? String(base.comprobante.fechaComprobante),
    codigoTipoComprobanteDeReferencia: 'FAC',
    numeroDeComprobanteDeReferencia: numeroFactura,
    comprobanteCanceladoCompletamente: true,
    codigoMotivo: String(cfg.codigoMotivoNC ?? CODIGO_MOTIVO_NC_DEFAULT),
    leyenda1: recortar(ref, 60),
    leyenda2: recortar(`Anula ${letraFactura} ${String(asociado.PtoVta).padStart(5, '0')}-${String(asociado.Nro).padStart(8, '0')} app`, 60),
    leyenda3: recortar(motivo, 60),
    leyenda4: recortar(anulacion.resueltaPor ? `Autorizo: ${anulacion.resueltaPor}` : '', 60),
    leyenda5: recortar(anulacion.solicitadoPor ? `Pidio: ${anulacion.solicitadoPor}` : '', 60),
    observaciones: recortar(`${ref}. Nota de credito por anulacion de la factura ${numeroFactura} (${base.referencia}). ${motivo}. Pidio ${anulacion.solicitadoPor ?? 'caja'}, autorizo ${anulacion.resueltaPor ?? '?'}.`, 280),
  }
  return { comprobante, fiscal: true, referencia: ref }
}
