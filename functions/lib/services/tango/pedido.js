"use strict";
// Armado PURO del pedido de Tango (GVA21, process 19845) a partir de una venta
// del camión / ventanilla. Port a TypeScript de scripts/tango/tango-pedido.mjs
// para el worker en Cloud Functions (ver triggers/tangoWorker.ts). Misma lógica,
// mismos tests.
//
// Por qué un PEDIDO y no un remito: ninguna API de Axoft crea remitos
// (docs/tango/INTEGRACION.md §6.2 y §14). El remito firmado vive en la app; en
// Tango entra como pedido al circuito de facturación por lote, con el depósito
// del REPARTIDOR (los choferes son depósitos en Tango) y el número del remito
// de la app como referencia.
Object.defineProperty(exports, "__esModule", { value: true });
exports.referenciaPedido = referenciaPedido;
exports.fechaDe = fechaDe;
exports.fechaISO = fechaISO;
exports.numeroComprobanteInterno = numeroComprobanteInterno;
exports.renglonesDeVenta = renglonesDeVenta;
exports.armarPedido = armarPedido;
exports.prop = prop;
exports.idDeFila = idDeFila;
/** Referencia idempotente del pedido en Tango: LEYENDA_1 = 'ROLITO:VC:<id venta>'. */
function referenciaPedido(origenColeccion, origenId) {
    return `ROLITO:${origenColeccion === 'ventasVentanilla' ? 'VV' : 'VC'}:${origenId}`;
}
/** Timestamp de Firestore (admin o cliente), Date o ISO → Date. */
function fechaDe(valor, fallback = new Date()) {
    if (!valor)
        return fallback;
    if (valor instanceof Date)
        return valor;
    const v = valor;
    if (typeof v.toDate === 'function')
        return v.toDate();
    if (typeof v.seconds === 'number')
        return new Date(v.seconds * 1000);
    if (typeof v._seconds === 'number')
        return new Date(v._seconds * 1000);
    const d = new Date(valor);
    return Number.isNaN(d.getTime()) ? fallback : d;
}
/** yyyy-MM-dd en hora local. */
function fechaISO(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
/** "00002-00000015" del comprobante interno de la app, o null si salió sin numerar. */
function numeroComprobanteInterno(ci) {
    if (!ci || typeof ci.numero !== 'number')
        return null;
    return `${String(ci.puntoVenta ?? 0).padStart(5, '0')}-${String(ci.numero).padStart(8, '0')}`;
}
const recortar = (s, n) => (s == null ? '' : String(s)).slice(0, n);
/**
 * Renglones: ítems vendidos más cambios (bolsas rotas repuestas sin cargo,
 * precio 0). Los cambios buscan primero un artículo propio (`cambio_<id>`,
 * Tango tiene "CAMBIO HIELO ROLITO 2 KG" etc.) y si no caen al artículo base.
 */
function renglonesDeVenta(payload, codigoArticulo) {
    const renglones = [];
    const faltantes = [];
    const agregar = (item, esCambio) => {
        const cantidad = Number(item.cantidad);
        if (!(cantidad > 0))
            return;
        let productoId = item.productoId;
        let codigo = codigoArticulo(productoId);
        if (!codigo && esCambio && productoId.startsWith('cambio_')) {
            productoId = productoId.slice('cambio_'.length);
            codigo = codigoArticulo(productoId);
        }
        if (!codigo) {
            faltantes.push(item.productoId);
            return;
        }
        renglones.push({
            productoId: item.productoId,
            codigoArticulo: codigo,
            cantidad,
            precio: esCambio ? 0 : Number(item.precioUnitario ?? 0),
            descripcion: item.nombre ?? item.productoId,
        });
    };
    for (const it of payload.items ?? [])
        agregar(it, false);
    for (const it of payload.cambios ?? [])
        agregar(it, true);
    return { renglones, faltantes: [...new Set(faltantes)] };
}
/** Body de `POST Api/Create?process=19845` (PedidoData del repo oficial). */
function armarPedido(payload, item, ids, renglones, opciones = {}) {
    const ref = referenciaPedido(item.origenColeccion, item.origenId);
    const fecha = fechaISO(fechaDe(payload.fecha));
    const numero = numeroComprobanteInterno(payload.comprobanteInterno);
    const canal = payload.canal === 'promo' ? 'Promo' : 'Contado';
    const camion = opciones.etiquetaCamion ?? payload.camionId ?? '';
    const tipoDoc = payload.comprobanteInterno?.tipo === 'facturaX' ? 'Factura X' : 'Remito';
    const pedido = {
        FECHA_PEDIDO: fecha,
        FECHA_ENTREGA: fecha,
        ID_GVA14: ids.idGva14,
        ES_CLIENTE_HABITUAL: true,
        ID_MONEDA: ids.idMoneda,
        PORCENTAJE_DESCUENTO_GENERAL: 0,
        ESTADO: opciones.estadoPedido ?? 2, // 2 = ingresa aprobado
        COMPROMETE_STOCK: opciones.comprometeStock ?? true,
        VALIDA_LIMITE_CREDITO: false,
        APLICA_DESCUENTO_CLIENTE: false,
        CALCULA_PROMOCIONES: false,
        LEYENDA_1: recortar(ref, 60),
        LEYENDA_2: recortar(`${tipoDoc} app ${numero ?? 'SIN NUMERO'} - ${canal}`, 60),
        LEYENDA_3: recortar(`Chofer ${payload.choferNombre ?? ''} - ${camion}`, 60),
        LEYENDA_4: recortar(payload.firmanteNombre ? `Firmo: ${payload.firmanteNombre}` : '', 60),
        OBSERVACIONES: recortar(`Venta ${canal} desde el camión ${camion}. ${tipoDoc} ${numero ?? 'sin número'} firmado en la app por ` +
            `${payload.firmanteNombre ?? 'el cliente'} (${payload.clienteNombre ?? ''}). Forma de pago: ${payload.formaPago ?? ''}. ` +
            `Total app: ${payload.total ?? 0}. Ref ${ref}.`, 8000),
        RENGLON_DTO: renglones.map((r) => ({
            ID_STA11: ids.articulos[r.codigoArticulo],
            MODULO_UNIDAD_MEDIDA: 'GV',
            CANTIDAD_PEDIDA: r.cantidad,
            CANTIDAD_A_FACTURAR: r.cantidad,
            CANTIDAD_A_DESCARGAR: r.cantidad,
            PRECIO: r.precio,
            PORCENTAJE_BONIFICACION: 0,
            ...(ids.idDeposito ? { ID_STA22: ids.idDeposito } : {}),
        })),
    };
    if (ids.idDeposito)
        pedido.ID_STA22 = ids.idDeposito;
    if (ids.talonarioId)
        pedido.ID_GVA43_TALON_PED = ids.talonarioId;
    if (ids.vendedorId)
        pedido.ID_GVA23 = ids.vendedorId;
    if (ids.condicionVentaId)
        pedido.ID_GVA01 = ids.condicionVentaId;
    if (ids.listaPreciosId)
        pedido.ID_GVA10 = ids.listaPreciosId;
    return pedido;
}
/** Lee una propiedad tolerando PascalCase/camelCase (la API mezcla según el endpoint). */
function prop(obj, ...nombres) {
    if (!obj || typeof obj !== 'object')
        return undefined;
    const o = obj;
    for (const n of nombres) {
        if (o[n] !== undefined)
            return o[n];
        const alt = Object.keys(o).find((k) => k.toLowerCase() === n.toLowerCase());
        if (alt)
            return o[alt];
    }
    return undefined;
}
/** Primer campo `ID_*` de una fila de Tango (ID_STA11, ID_STA22, ID_MONEDA…). */
function idDeFila(fila, preferido) {
    if (!fila || typeof fila !== 'object')
        return undefined;
    const f = fila;
    if (preferido && f[preferido] !== undefined)
        return f[preferido];
    const k = Object.keys(f).find((x) => /^ID_/i.test(x));
    return k ? f[k] : undefined;
}
//# sourceMappingURL=pedido.js.map