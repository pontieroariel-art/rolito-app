/**
 * tango-factura.mjs — armado PURO del comprobante para el Facturador de Tango
 * (`POST /FacturadorVenta/registrar`, body = array) a partir de una venta del
 * camión / ventanilla (payload del item `factura` de tango-outbox).
 *
 * Fuente: readme oficial de `TangoDeltaApi/src/CommonServices/ventas/
 * comprobantesregistracion` (resumen en docs/tango/INTEGRACION.md §12 y §15).
 *
 * Regla de oro: los IMPORTES son los que la app ya le informó a ARCA
 * (`payload.factura.importes`: neto, iva, tributos, total, fecha) — no se
 * recalculan. Los ítems se reconstruyen desde la venta y se ajustan por
 * redondeo para que sumen exactamente esos totales. El CAE viaja tal cual
 * (`cAE`, `fechaVtoCAE`): Tango registra el comprobante YA autorizado.
 *
 * Config por empresa (config/tango.facturador[empresa]):
 *   talonarios          { A: 20, B: 21, C: 22, X: 30 }  código de talonario por letra
 *   condicionVenta      1        (contado)
 *   listaPrecio         { contado: 2, promo: 3 }  o un número para ambos
 *   contracuenta        20
 *   vendedor            '3'
 *   codigoTasaIva21     1        (código de la tasa 21% en Tango)
 *   cuentas             { contado_efectivo: '1', contado_transferencia: '5' }  cuentas de tesorería
 *   tipoPago            { contado_efectivo: 'Efectivo', contado_transferencia: 'Efectivo' }  (opcional)
 *   codigoAlicuotaPercepcionIIBB   12   (código del impuesto "Percepción IIBB" en Tango)
 *   codigoPercepcionIIBB           ''   (opcional, 2 chars)
 *   preciosIncluyenIva  false    (mismo valor que config/arca.preciosIncluyenIva)
 *   fechaCierreTesoreria  'yyyy-mm-dd' (opcional)
 */
import { referenciaPedido, fechaDe, fechaISO, numeroComprobanteInterno } from './tango-pedido.mjs'

export const LETRA_POR_CBTE_TIPO = { 1: 'A', 6: 'B', 11: 'C' }
const IVA_21 = 21

export const redondear2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const recortar = (s, n) => (s == null ? '' : String(s)).slice(0, n)

/** 'AAAAMMDD' (formato ARCA) → 'yyyy-mm-dd'. Acepta también yyyy-mm-dd o Date. */
export function fechaArcaAIso(v) {
  if (!v) return null
  if (v instanceof Date) return fechaISO(v)
  const s = String(v)
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return null
}

/** Letra + punto de venta (5) + número (8): 'A1104' + '00000001' → 'A110400000001'. */
export function numeroComprobanteTango(letra, puntoVenta, numero) {
  return `${letra}${String(puntoVenta).padStart(5, '0')}${String(numero).padStart(8, '0')}`
}

/**
 * Qué documento representa la venta para el Facturador:
 *  - con factura de ARCA emitida → FAC letra A/B/C con CAE.
 *  - sin ARCA (promo cobrada, "factura X" interna) → FAC letra X sin CAE, con
 *    el número del comprobante interno de la app.
 * Devuelve null si no hay nada facturable.
 */
export function documentoDeVenta(payload) {
  const f = payload.factura
  if (f && f.estado === 'emitida' && typeof f.numero === 'number') {
    const letra = LETRA_POR_CBTE_TIPO[f.cbteTipo]
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

/**
 * Ítems del comprobante con importes que cierran contra los totales de ARCA.
 * Los precios de la app son NETOS salvo preciosIncluyenIva. `codigoArticulo`
 * como en tango-pedido. Los cambios van a precio 0 (descargan stock igual).
 */
export function itemsDeVenta(payload, opciones) {
  const { codigoArticulo, preciosIncluyenIva = false, codigoTasaIva, codigoDeposito, totales } = opciones
  const items = []
  const faltantes = []
  const factor = 1 + IVA_21 / 100

  const agregar = (it, esCambio) => {
    const cantidad = Number(it.cantidad)
    if (!(cantidad > 0)) return
    let productoId = it.productoId
    let codigo = codigoArticulo(productoId)
    if (!codigo && esCambio && productoId.startsWith('cambio_')) codigo = codigoArticulo(productoId.slice('cambio_'.length))
    if (!codigo) { faltantes.push(it.productoId); return }
    const unitario = esCambio ? 0 : Number(it.precioUnitario ?? 0)
    const bruto = cantidad * unitario
    const base  = redondear2(preciosIncluyenIva ? bruto / factor : bruto)
    const iva   = redondear2(base * (IVA_21 / 100))
    items.push({
      codigo,
      descripcion: recortar(it.nombre ?? it.productoId, 30),
      cantidad,
      base, iva, total: redondear2(base + iva),
      precioConIva: redondear2(preciosIncluyenIva ? unitario : unitario * factor),
      esCambio,
    })
  }
  for (const it of payload.items ?? []) agregar(it, false)
  for (const it of payload.cambios ?? []) agregar(it, true)

  // Ajuste por redondeo: la suma de bases/IVAs tiene que dar EXACTO el neto/IVA
  // informado a ARCA. La diferencia (centavos) se carga al último ítem con importe.
  if (totales && items.length) {
    const conImporte = items.filter((i) => !i.esCambio && i.base > 0)
    const ultimo = conImporte[conImporte.length - 1] ?? items[items.length - 1]
    const dBase = redondear2(totales.neto - items.reduce((s, i) => s + i.base, 0))
    const dIva  = redondear2(totales.iva  - items.reduce((s, i) => s + i.iva, 0))
    if (Math.abs(dBase) > 1 || Math.abs(dIva) > 1) {
      return { items: [], faltantes, error: `Los ítems no cierran contra los importes de ARCA (neto ${totales.neto} vs ${redondear2(totales.neto - dBase)}, iva ${totales.iva} vs ${redondear2(totales.iva - dIva)})` }
    }
    ultimo.base = redondear2(ultimo.base + dBase)
    ultimo.iva  = redondear2(ultimo.iva + dIva)
    ultimo.total = redondear2(ultimo.base + ultimo.iva)
  }

  return {
    faltantes: [...new Set(faltantes)],
    items: items.map((i) => ({
      codigo:              i.codigo,
      descripcion:         i.descripcion,
      cantidad:            i.cantidad,
      codigoDeposito:      codigoDeposito ?? undefined,
      codigoTasaIva:       codigoTasaIva,
      precio:              i.precioConIva,
      importe:             i.total,
      importeSinImpuestos: i.base,
      importeIva:          i.iva,
      descargaStock:       true,
      _base: i.base,
    })),
  }
}

/**
 * Percepción de IIBB (tributos de ARCA) repartida por ítem proporcional al
 * neto, ajustada para que sume exacto `tributos`. La alícuota se reconstruye
 * (tributos / neto) porque la venta solo guarda el importe total.
 */
export function percepcionesPorItem(items, tributos, cfg) {
  const total = redondear2(tributos ?? 0)
  if (!(total > 0)) return items.map(() => [])
  const neto = items.reduce((s, i) => s + i._base, 0)
  if (!(neto > 0)) return items.map(() => [])
  const alicuota = Math.round((total / neto) * 100 * 100) / 100
  const repartos = items.map((i) => (i._base > 0 ? redondear2(i._base * (alicuota / 100)) : 0))
  const dif = redondear2(total - repartos.reduce((s, x) => s + x, 0))
  const idx = repartos.map((x, k) => [x, k]).filter(([x]) => x > 0).pop()?.[1] ?? 0
  repartos[idx] = redondear2(repartos[idx] + dif)
  return items.map((i, k) => (repartos[k] > 0 ? [{
    codigoAlicuota: cfg.codigoAlicuotaPercepcionIIBB,
    codigoPercepcion: cfg.codigoPercepcionIIBB ?? '',
    porcentaje: alicuota,
    base: i._base,
    importe: repartos[k],
  }] : []))
}

/**
 * Arma el comprobante completo. `mapeos` = { codigoArticulo(productoId), codigoDeposito }.
 * Devuelve { comprobante, faltantes, error }.
 */
export function armarComprobanteFacturador(payload, item, cfg, mapeos) {
  const docu = documentoDeVenta(payload)
  if (!docu) return { error: 'La venta no tiene factura de ARCA emitida ni factura X interna: nada que registrar' }
  if (docu.error) return { error: docu.error }

  const talonario = cfg.talonarios?.[docu.letra]
  if (!talonario) return { error: `Falta config/tango.facturador.${item.empresa}.talonarios.${docu.letra} (código de talonario para la letra ${docu.letra})` }
  const codigoCliente = payload.clienteCodigoTango
  if (!codigoCliente) return { error: `La venta no trae clienteCodigoTango (cliente ${payload.clienteId} sin vincular a Tango)` }
  const cuenta = cfg.cuentas?.[payload.formaPago]
  if (!cuenta && payload.formaPago !== 'cuenta_corriente') return { error: `Falta config/tango.facturador.${item.empresa}.cuentas.${payload.formaPago} (cuenta de tesorería)` }
  for (const k of ['condicionVenta', 'contracuenta', 'vendedor', 'codigoTasaIva21']) {
    if (cfg[k] === undefined || cfg[k] === null || cfg[k] === '') return { error: `Falta config/tango.facturador.${item.empresa}.${k}` }
  }
  const listaPrecio = typeof cfg.listaPrecio === 'object' ? cfg.listaPrecio?.[payload.canal] : cfg.listaPrecio
  if (listaPrecio === undefined || listaPrecio === null) return { error: `Falta config/tango.facturador.${item.empresa}.listaPrecio (o .listaPrecio.${payload.canal})` }
  // Condición de venta: un código, o uno por forma de pago ({ contado, cuenta_corriente }).
  const claveCond = payload.formaPago === 'cuenta_corriente' ? 'cuenta_corriente' : 'contado'
  const condicionVenta = typeof cfg.condicionVenta === 'object' && cfg.condicionVenta !== null ? cfg.condicionVenta[claveCond] : cfg.condicionVenta
  if (condicionVenta === undefined || condicionVenta === null) return { error: `Falta config/tango.facturador.${item.empresa}.condicionVenta.${claveCond}` }

  // Totales: los de ARCA si es fiscal; si es factura X, se derivan de los ítems.
  let totales = docu.importes ? { neto: Number(docu.importes.neto), iva: Number(docu.importes.iva), tributos: Number(docu.importes.tributos ?? 0), total: Number(docu.importes.total) } : null
  const r = itemsDeVenta(payload, {
    codigoArticulo: mapeos.codigoArticulo, preciosIncluyenIva: cfg.preciosIncluyenIva === true,
    codigoTasaIva: cfg.codigoTasaIva21, codigoDeposito: mapeos.codigoDeposito, totales,
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
    return { error: `La factura lleva percepción de IIBB (${totales.tributos}) y falta config/tango.facturador.${item.empresa}.codigoAlicuotaPercepcionIIBB` }
  }
  const percepciones = percepcionesPorItem(r.items, totales.tributos, cfg)

  const ref = referenciaPedido(item.origenColeccion, item.origenId)
  const fecha = fechaArcaAIso(docu.importes?.fecha) ?? fechaISO(fechaDe(payload.fecha))
  const numeroInterno = numeroComprobanteInterno(payload.comprobanteInterno)

  const comprobante = {
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
    ...(mapeos.codigoDeposito ? { codigoDeposito: mapeos.codigoDeposito } : {}),
    codigoVendedor: String(cfg.vendedor),
    leyenda1: recortar(ref, 60),
    leyenda2: recortar(`Venta ${payload.canal === 'promo' ? 'Promo' : 'Contado'} app${numeroInterno ? ` ${numeroInterno}` : ''} - ${payload.formaPago ?? ''}`, 60),
    leyenda3: recortar(`Chofer ${payload.choferNombre ?? ''} - ${mapeos.etiquetaCamion ?? payload.camionId ?? ''}`, 60),
    leyenda4: recortar(payload.firmanteNombre ? `Firmo: ${payload.firmanteNombre}` : '', 60),
    leyenda5: '',
    total: totales.total,
    totalSinImpuestos: totales.neto,
    totalExento: 0,
    totalIva: totales.iva,
    subtotal: totales.total,
    subtotalSinImpuestos: totales.neto,
    observaciones: recortar(`${ref}. Venta desde la app por ${payload.choferNombre ?? ''}; firmo ${payload.firmanteNombre ?? 'el cliente'}.`, 280),
    items: r.items.map((i, k) => {
      const { _base, ...it } = i
      return percepciones[k].length ? { ...it, percepciones: percepciones[k] } : it
    }),
  }
  if (payload.formaPago === 'cuenta_corriente') {
    comprobante.cuotasCuentaCorriente = [{ fechaVencimiento: fecha, importe: totales.total }]
  } else {
    comprobante.pagos = [{ tipo: cfg.tipoPago?.[payload.formaPago] ?? 'Efectivo', codigoDeCuenta: cuenta, monto: totales.total }]
  }
  return { comprobante, fiscal: docu.fiscal, referencia: ref }
}

/** Interpreta la respuesta del Facturador: { Message, Comprobantes[], Succeeded }. */
export function interpretarRespuestaFacturador(data, numeroEsperado) {
  const lista = data?.Comprobantes ?? data?.comprobantes ?? []
  const c = lista.find((x) => (x.numeroComprobante ?? '').replace(/\s+/g, '').endsWith(numeroEsperado)) ?? lista[0]
  const ok = (data?.Succeeded ?? data?.succeeded) === true && (!c || /^ok$/i.test(c.estado ?? 'Ok'))
  const mensaje = [c?.mensaje, c?.exceptionMessage, data?.Message ?? data?.message].filter(Boolean).join(' | ')
  const yaExistia = /\(51016\)|ya existe el n(ú|u)mero de comprobante/i.test(mensaje)
  return { ok: ok || yaExistia, yaExistia, mensaje, numeroComprobante: c?.numeroComprobante ?? null }
}
