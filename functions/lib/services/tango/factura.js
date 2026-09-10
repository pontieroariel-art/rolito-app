"use strict";
// Armado PURO del comprobante para el Facturador de Tango
// (`POST /Api/FacturadorVenta/registrar`, body = array). Port a TypeScript de
// scripts/tango/tango-factura.mjs para el worker en Cloud Functions.
//
// Regla de oro: los IMPORTES son los que la app ya le informó a ARCA
// (`payload.factura.importes`) — no se recalculan. Los ítems se reconstruyen
// desde la venta y se ajustan por redondeo para que sumen exacto. El CAE viaja
// tal cual (`cAE`, `fechaVtoCAE`): Tango registra el comprobante YA autorizado
// (ejemplo 05 del readme oficial, INTEGRACION.md §12 y §15).
Object.defineProperty(exports, "__esModule", { value: true });
exports.redondear2 = exports.CODIGO_MOTIVO_NC_DEFAULT = exports.LETRA_NC_POR_CBTE_TIPO = exports.LETRA_POR_CBTE_TIPO = void 0;
exports.fechaArcaAIso = fechaArcaAIso;
exports.numeroComprobanteTango = numeroComprobanteTango;
exports.documentoDeVenta = documentoDeVenta;
exports.itemsDeVenta = itemsDeVenta;
exports.percepcionesPorItem = percepcionesPorItem;
exports.armarComprobanteFacturador = armarComprobanteFacturador;
exports.interpretarRespuestaFacturador = interpretarRespuestaFacturador;
exports.armarNotaCreditoFacturador = armarNotaCreditoFacturador;
const pedido_1 = require("./pedido");
exports.LETRA_POR_CBTE_TIPO = { 1: 'A', 6: 'B', 11: 'C' };
/** Notas de crédito de ARCA (3 = NC A, 8 = NC B, 13 = NC C). */
exports.LETRA_NC_POR_CBTE_TIPO = { 3: 'A', 8: 'B', 13: 'C' };
/** Motivo de NC de Tango por defecto: 4 = "Anulación de fact. electrónica" (tabla Motivos NC del Facturador). */
exports.CODIGO_MOTIVO_NC_DEFAULT = 4;
const IVA_21 = 21;
const redondear2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
exports.redondear2 = redondear2;
const recortar = (s, n) => (s == null ? '' : String(s)).slice(0, n);
/** 'AAAAMMDD' (formato ARCA) → 'yyyy-mm-dd'. Acepta también yyyy-mm-dd o Date. */
function fechaArcaAIso(v) {
    if (!v)
        return null;
    if (v instanceof Date)
        return (0, pedido_1.fechaISO)(v);
    const s = String(v);
    if (/^\d{8}$/.test(s))
        return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    if (/^\d{4}-\d{2}-\d{2}/.test(s))
        return s.slice(0, 10);
    return null;
}
/** Letra + punto de venta (5) + número (8): 'A' + '01104' + '00000001'. */
function numeroComprobanteTango(letra, puntoVenta, numero) {
    return `${letra}${String(puntoVenta ?? 0).padStart(5, '0')}${String(numero).padStart(8, '0')}`;
}
/**
 * Qué documento representa la venta: FAC A/B/C con CAE de ARCA, o la factura X
 * interna de promo (sin CAE). Devuelve null si no hay nada facturable.
 */
function documentoDeVenta(payload) {
    const f = payload.factura;
    if (f && f.estado === 'emitida' && typeof f.numero === 'number') {
        const letra = exports.LETRA_POR_CBTE_TIPO[f.cbteTipo ?? -1];
        if (!letra)
            return { error: `cbteTipo ${f.cbteTipo} sin letra conocida (1=A, 6=B, 11=C)` };
        if (!f.importes)
            return { error: 'La factura no tiene importes guardados (factura.importes)' };
        return { letra, puntoVenta: f.puntoVenta, numero: f.numero, cae: f.cae ?? null, caeFchVto: f.caeFchVto ?? null, importes: f.importes, fiscal: true };
    }
    const ci = payload.comprobanteInterno;
    if (ci && ci.tipo === 'facturaX' && typeof ci.numero === 'number') {
        return { letra: 'X', puntoVenta: ci.puntoVenta, numero: ci.numero, cae: null, caeFchVto: null, importes: null, fiscal: false };
    }
    return null;
}
/**
 * Ítems del comprobante con importes que cierran contra los totales de ARCA.
 * Los precios de la app son NETOS salvo preciosIncluyenIva. Los cambios NO van
 * (salvo `incluirCambios`): un renglón a $0 confunde al cliente y el artículo
 * CAMBIO* movía stock ficticio (decisión de Ariel 2026-09-04,
 * docs/tango/STOCK_REPARTO.md). El cambio sale del stock por otro comprobante.
 */
function itemsDeVenta(payload, opciones) {
    const { codigoArticulo, preciosIncluyenIva = false, codigoTasaIva, codigoDeposito, totales, sinIva = false, incluirCambios = false } = opciones;
    const descargaStock = opciones.descargaStock !== false;
    const items = [];
    const faltantes = [];
    // Sin IVA (Rolito): el precio es final, no hay factor.
    const factor = sinIva ? 1 : 1 + IVA_21 / 100;
    const tasa = sinIva ? 0 : IVA_21;
    const agregar = (it, esCambio) => {
        const cantidad = Number(it.cantidad);
        if (!(cantidad > 0))
            return;
        const productoId = it.productoId;
        let codigo = codigoArticulo(productoId);
        if (!codigo && esCambio && productoId.startsWith('cambio_'))
            codigo = codigoArticulo(productoId.slice('cambio_'.length));
        if (!codigo) {
            faltantes.push(it.productoId);
            return;
        }
        const unitario = esCambio ? 0 : Number(it.precioUnitario ?? 0);
        const bruto = cantidad * unitario;
        const base = (0, exports.redondear2)(preciosIncluyenIva ? bruto / factor : bruto);
        const iva = (0, exports.redondear2)(base * (tasa / 100));
        items.push({
            codigo,
            descripcion: recortar(it.nombre ?? it.productoId, 30),
            cantidad,
            ...(codigoDeposito ? { codigoDeposito } : {}),
            codigoTasaIva,
            precio: (0, exports.redondear2)(preciosIncluyenIva ? unitario : unitario * factor),
            importe: (0, exports.redondear2)(base + iva),
            importeSinImpuestos: base,
            importeIva: iva,
            // Un renglón de cambio nunca descarga: el artículo CAMBIO* es informativo.
            descargaStock: descargaStock && !esCambio,
            _base: base,
            esCambio,
        });
    };
    for (const it of payload.items ?? [])
        agregar(it, false);
    if (incluirCambios)
        for (const it of payload.cambios ?? [])
            agregar(it, true);
    // Ajuste por redondeo: la suma de bases/IVAs tiene que dar EXACTO el neto/IVA
    // informado a ARCA. La diferencia (centavos) se carga al último ítem con importe.
    if (totales && items.length) {
        const conImporte = items.filter((i) => !i.esCambio && i._base > 0);
        const ultimo = conImporte[conImporte.length - 1] ?? items[items.length - 1];
        const dBase = (0, exports.redondear2)(totales.neto - items.reduce((s, i) => s + i._base, 0));
        const dIva = (0, exports.redondear2)(totales.iva - items.reduce((s, i) => s + i.importeIva, 0));
        if (Math.abs(dBase) > 1 || Math.abs(dIva) > 1) {
            return { items: [], faltantes, error: `Los ítems no cierran contra los importes de ARCA (neto ${totales.neto} vs ${(0, exports.redondear2)(totales.neto - dBase)}, iva ${totales.iva} vs ${(0, exports.redondear2)(totales.iva - dIva)})` };
        }
        ultimo._base = (0, exports.redondear2)(ultimo._base + dBase);
        ultimo.importeSinImpuestos = ultimo._base;
        ultimo.importeIva = (0, exports.redondear2)(ultimo.importeIva + dIva);
        ultimo.importe = (0, exports.redondear2)(ultimo._base + ultimo.importeIva);
    }
    return {
        faltantes: [...new Set(faltantes)],
        items: items.map(({ esCambio: _e, ...i }) => i),
    };
}
/**
 * Percepción de IIBB (tributos de ARCA) repartida por ítem proporcional al
 * neto, ajustada para que sume exacto `tributos`. La alícuota se reconstruye
 * (tributos / neto) porque la venta solo guarda el importe total.
 */
function percepcionesPorItem(items, tributos, cfg) {
    const total = (0, exports.redondear2)(tributos ?? 0);
    if (!(total > 0))
        return items.map(() => []);
    const neto = items.reduce((s, i) => s + i._base, 0);
    if (!(neto > 0))
        return items.map(() => []);
    const alicuota = Math.round((total / neto) * 100 * 100) / 100;
    const repartos = items.map((i) => (i._base > 0 ? (0, exports.redondear2)(i._base * (alicuota / 100)) : 0));
    const dif = (0, exports.redondear2)(total - repartos.reduce((s, x) => s + x, 0));
    const idx = repartos.map((x, k) => [x, k]).filter(([x]) => x > 0).pop()?.[1] ?? 0;
    repartos[idx] = (0, exports.redondear2)(repartos[idx] + dif);
    return items.map((i, k) => (repartos[k] > 0 ? [{
            codigoAlicuota: cfg.codigoAlicuotaPercepcionIIBB,
            codigoPercepcion: cfg.codigoPercepcionIIBB ?? '',
            porcentaje: alicuota,
            base: i._base,
            importe: repartos[k],
        }] : []));
}
/** Arma el comprobante completo para el Facturador. */
function armarComprobanteFacturador(payload, item, cfg, mapeos) {
    const docu0 = documentoDeVenta(payload);
    if (!docu0)
        return { error: 'La venta no tiene factura de ARCA emitida ni factura X interna: nada que registrar' };
    if ('error' in docu0)
        return { error: docu0.error };
    // La factura X de la app entra en Tango con letra A/B (no existe X para facturas).
    if (!docu0.fiscal && !mapeos.letraNoFiscal)
        return { error: 'Falta la letra (A/B) con la que Tango registra la factura X de promo (categoría de IVA del cliente)' };
    const docu = docu0.fiscal ? docu0 : { ...docu0, letra: mapeos.letraNoFiscal };
    const empresa = item.empresa ?? '?';
    const talonario = cfg.talonarios?.[docu.letra];
    if (!talonario)
        return { error: `Falta config/tango.facturador.${empresa}.talonarios.${docu.letra} (código de talonario para la letra ${docu.letra})` };
    const codigoCliente = payload.clienteCodigoTango;
    if (!codigoCliente)
        return { error: `La venta no trae clienteCodigoTango (cliente ${payload.clienteId} sin vincular a Tango)` };
    const formaPago = payload.formaPago ?? '';
    const cuenta = cfg.cuentas?.[formaPago];
    if (!cuenta && formaPago !== 'cuenta_corriente')
        return { error: `Falta config/tango.facturador.${empresa}.cuentas.${formaPago} (cuenta de tesorería)` };
    const sinIva = cfg.sinIva === true;
    const codigoTasaIva = sinIva ? (cfg.codigoTasaIvaCero ?? 10) : cfg.codigoTasaIva21;
    for (const k of ['condicionVenta', 'contracuenta', 'vendedor', ...(sinIva ? [] : ['codigoTasaIva21'])]) {
        if (cfg[k] === undefined || cfg[k] === null || cfg[k] === '')
            return { error: `Falta config/tango.facturador.${empresa}.${k}` };
    }
    const listaPrecio = typeof cfg.listaPrecio === 'object' && cfg.listaPrecio !== null
        ? cfg.listaPrecio[payload.canal ?? '']
        : cfg.listaPrecio;
    if (listaPrecio === undefined || listaPrecio === null)
        return { error: `Falta config/tango.facturador.${empresa}.listaPrecio (o .listaPrecio.${payload.canal})` };
    // Condición de venta: un código para todo, o uno por forma de pago
    // ({ contado, cuenta_corriente }) — la promo en cta. cte. va como factura
    // con cuota y Tango necesita la condición de cuenta corriente.
    const condicionVenta = typeof cfg.condicionVenta === 'object' && cfg.condicionVenta !== null
        ? cfg.condicionVenta[formaPago === 'cuenta_corriente' ? 'cuenta_corriente' : 'contado']
        : cfg.condicionVenta;
    if (condicionVenta === undefined || condicionVenta === null)
        return { error: `Falta config/tango.facturador.${empresa}.condicionVenta.${formaPago === 'cuenta_corriente' ? 'cuenta_corriente' : 'contado'}` };
    let totales = docu.importes
        ? { neto: Number(docu.importes.neto), iva: Number(docu.importes.iva), tributos: Number(docu.importes.tributos ?? 0), total: Number(docu.importes.total) }
        : null;
    const descargaStock = cfg.descargaStock !== false;
    // Factura X de promo sin nada vendido (solo cambios): en Rolito queda una
    // factura en $0 con los renglones de cambio, que es el papel del cambio.
    const soloCambios = !docu.fiscal && !(payload.items ?? []).some((i) => Number(i.cantidad) > 0) && (payload.cambios ?? []).some((i) => Number(i.cantidad) > 0);
    const r = itemsDeVenta(payload, {
        codigoArticulo: mapeos.codigoArticulo, preciosIncluyenIva: cfg.preciosIncluyenIva === true,
        codigoTasaIva: codigoTasaIva, codigoDeposito: mapeos.codigoDeposito, totales, sinIva,
        descargaStock, incluirCambios: soloCambios,
    });
    if (r.error)
        return { error: r.error };
    if (r.faltantes.length)
        return { error: `Falta el código de artículo Tango en config/tango.articulos para: ${r.faltantes.join(', ')}`, faltantes: r.faltantes };
    if (r.items.length === 0)
        return { error: 'La venta no tiene ítems con cantidad > 0' };
    if (!totales) {
        const neto = (0, exports.redondear2)(r.items.reduce((s, i) => s + i._base, 0));
        const iva = (0, exports.redondear2)(r.items.reduce((s, i) => s + i.importeIva, 0));
        totales = { neto, iva, tributos: 0, total: (0, exports.redondear2)(neto + iva) };
    }
    if (totales.tributos > 0 && !cfg.codigoAlicuotaPercepcionIIBB) {
        return { error: `La factura lleva percepción de IIBB (${totales.tributos}) y falta config/tango.facturador.${empresa}.codigoAlicuotaPercepcionIIBB` };
    }
    const percepciones = percepcionesPorItem(r.items, totales.tributos, cfg);
    const ref = (0, pedido_1.referenciaPedido)(item.origenColeccion, item.origenId);
    const fecha = fechaArcaAIso(docu.importes?.fecha) ?? (0, pedido_1.fechaISO)((0, pedido_1.fechaDe)(payload.fecha));
    const numeroInterno = (0, pedido_1.numeroComprobanteInterno)(payload.comprobanteInterno);
    // Quién vendió (cajero o chofer) va en la leyenda 3 y en las observaciones;
    // el vendedor del comprobante (codigoVendedor) es el supervisor del cliente.
    const vende = (0, pedido_1.quienVende)(payload, mapeos.etiquetaCamion ?? payload.camionId ?? '');
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
        ...(mapeos.codigoDeposito ? { codigoDeposito: mapeos.codigoDeposito } : {}), // obligatorio para el Facturador aunque no descargue
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
            const { _base, ...it } = i;
            return percepciones[k].length ? { ...it, percepciones: percepciones[k] } : it;
        }),
    };
    if (totales.total <= 0) {
        // Factura en $0 (solo cambios): no hay nada que cobrar ni que imputar. Si el
        // Facturador exige un pago o una cuota igual, se ajusta con la prueba en TestingRH.
    }
    else if (formaPago === 'cuenta_corriente') {
        comprobante.cuotasCuentaCorriente = [{ fechaVencimiento: fecha, importe: totales.total }];
    }
    else {
        comprobante.pagos = [{ tipo: cfg.tipoPago?.[formaPago] ?? 'Efectivo', codigoDeCuenta: cuenta, monto: totales.total }];
    }
    return { comprobante, fiscal: docu.fiscal, referencia: ref };
}
/** Interpreta la respuesta del Facturador: { Message, Comprobantes[], Succeeded }. */
function interpretarRespuestaFacturador(data, numeroEsperado) {
    const d = (data ?? {});
    const lista = (d.Comprobantes ?? d.comprobantes ?? []);
    const c = lista.find((x) => String(x.numeroComprobante ?? '').replace(/\s+/g, '').endsWith(numeroEsperado)) ?? lista[0];
    const succeeded = (d.Succeeded ?? d.succeeded) === true;
    const ok = succeeded && (!c || /^ok$/i.test(String(c.estado ?? 'Ok')));
    const mensaje = [c?.mensaje, c?.exceptionMessage, d.Message ?? d.message].filter(Boolean).join(' | ');
    const yaExistia = /\(51016\)|ya existe el n(ú|u)mero de comprobante/i.test(mensaje);
    return { ok: ok || yaExistia, yaExistia, mensaje, numeroComprobante: c?.numeroComprobante ?? null };
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
function armarNotaCreditoFacturador(payload, item, cfg, mapeos) {
    const nc = payload.notaCredito;
    if (!nc || nc.estado !== 'emitida' || typeof nc.numero !== 'number' || !nc.cae) {
        return { error: 'La anulación no tiene una nota de crédito emitida por ARCA (notaCredito.estado/numero/cae)' };
    }
    const letra = exports.LETRA_NC_POR_CBTE_TIPO[nc.cbteTipo ?? -1];
    if (!letra)
        return { error: `cbteTipo ${nc.cbteTipo} no es una nota de crédito conocida (3=A, 8=B, 13=C)` };
    const asociado = nc.cbtesAsoc?.[0];
    if (!asociado)
        return { error: 'La nota de crédito no trae el comprobante asociado (cbtesAsoc)' };
    const letraFactura = exports.LETRA_POR_CBTE_TIPO[asociado.Tipo];
    if (!letraFactura)
        return { error: `El comprobante asociado tiene tipo ${asociado.Tipo}, que no es una factura` };
    const empresa = item.empresa ?? '?';
    const talonario = cfg.talonariosNC?.[letra];
    if (!talonario)
        return { error: `Falta config/tango.facturador.${empresa}.talonariosNC.${letra} (talonario de nota de crédito ${letra})` };
    const base = armarComprobanteFacturador(payload, item, cfg, mapeos);
    if (base.error !== undefined)
        return base;
    if (!base.fiscal)
        return { error: 'Solo se anulan por nota de crédito las facturas con CAE de ARCA' };
    const totalFactura = Number(base.comprobante.total);
    const totalNc = Number(nc.importes?.total ?? totalFactura);
    if (Math.abs(totalFactura - totalNc) > 0.011) {
        return { error: `El total de la nota de crédito (${totalNc}) no coincide con el de la factura (${totalFactura}); no se registra` };
    }
    const ref = `ROLITO:NC:${item.origenId}`;
    const numeroFactura = numeroComprobanteTango(letraFactura, asociado.PtoVta, asociado.Nro);
    const anulacion = payload.anulacion ?? {};
    const motivo = anulacion.motivo ? `${anulacion.motivo}${anulacion.nota ? ` - ${anulacion.nota}` : ''}` : (anulacion.nota ?? '');
    const comprobante = {
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
        codigoMotivo: String(cfg.codigoMotivoNC ?? exports.CODIGO_MOTIVO_NC_DEFAULT),
        leyenda1: recortar(ref, 60),
        leyenda2: recortar(`Anula ${letraFactura} ${String(asociado.PtoVta).padStart(5, '0')}-${String(asociado.Nro).padStart(8, '0')} app`, 60),
        leyenda3: recortar(motivo, 60),
        leyenda4: recortar(anulacion.resueltaPor ? `Autorizo: ${anulacion.resueltaPor}` : '', 60),
        leyenda5: recortar(anulacion.solicitadoPor ? `Pidio: ${anulacion.solicitadoPor}` : '', 60),
        observaciones: recortar(`${ref}. Nota de credito por anulacion de la factura ${numeroFactura} (${base.referencia}). ${motivo}. Pidio ${anulacion.solicitadoPor ?? 'caja'}, autorizo ${anulacion.resueltaPor ?? '?'}.`, 280),
    };
    return { comprobante, fiscal: true, referencia: ref };
}
//# sourceMappingURL=factura.js.map