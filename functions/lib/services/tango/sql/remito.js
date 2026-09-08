"use strict";
// Remito de ventas directo en la base de Tango (STA14 / STA20 / STA19), copiando
// exactamente lo que hace la pantalla "Emisión de remitos" — relevado con una
// traza de Extended Events el 2026-09-04 (docs/tango/sql/traza-remito-2026-09-04.txt).
//
// Qué escribe Tango al grabar un remito, en orden:
//   1. INSERT STA14  cabecera (T_COMP 'REM', TCOMP_IN_S 'RE', NCOMP_IN_S = nº interno
//      de stock de 8 dígitos, N_COMP/N_REMITO = 'R' + pto vta (5) + número (8),
//      ESTADO_MOV 'P' = pendiente de facturar, MOTIVO_REM 'V' = venta).
//      Triggers de Tango completan solos ID_STA13 (talonario) e ID_GVA14 (cliente).
//   2. INSERT STA20  un renglón por artículo (TIPO_MOV 'S' = salida, CANTIDAD y
//      CANT_PEND iguales, ID_MEDIDA_STOCK/VENTAS del artículo). Triggers completan
//      ID_STA11 (artículo) e ID_STA14 (cabecera, por TCOMP_IN_S + NCOMP_IN_S).
//   3. UPDATE STA19  descuenta el stock del depósito con concurrencia optimista
//      (WHERE con el CANT_STOCK anterior). Triggers completan ID_STA22 / ID_STA11.
//   4. INSERT STA14TY la imagen del talonario para reimprimir. NO se replica: la app
//      imprime su propio remito; Tango lo toma igual sin esa fila (a verificar en la
//      prueba de TestingRH — si la reimpresión desde Tango falla, se agrega).
//
// Lo que NO hace Tango acá y por eso tampoco nosotros: tocar la cuenta corriente
// (el remito no es un comprobante de cta. cte.), ni GVA43 (el número lo tipeó el
// operador; para la app el talonario 1105 es exclusivo y la numeración es nuestra).
//
// Idempotencia: antes de insertar se busca STA14 por T_COMP + N_COMP; si existe, se
// devuelve sin escribir. Un reintento nunca duplica.
//
// La cabecera, el renglón y el update de stock se arman en comun.ts, compartidos
// con el writer de movimientos de stock (movimientoStock.ts).
Object.defineProperty(exports, "__esModule", { value: true });
exports.remitoDeVenta = remitoDeVenta;
exports.sentenciaExiste = sentenciaExiste;
exports.sentenciasRemito = sentenciasRemito;
exports.leerDatosRemito = leerDatosRemito;
exports.escribirRemito = escribirRemito;
exports.resumenSentencias = resumenSentencias;
const tipos_1 = require("./tipos");
const comun_1 = require("./comun");
/**
 * Del payload de la venta (tango-outbox) al remito de Tango. Los cambios (bolsas
 * repuestas sin cargo) también salen del depósito, así que van como renglones.
 * Los artículos se mapean con config/tango.articulos igual que en el pedido/factura.
 */
function remitoDeVenta(payload, origenId, articulos, codDeposito, puntoVenta) {
    const ci = payload.comprobanteInterno;
    if (!ci || ci.tipo !== 'remito' || !ci.numero)
        throw new Error('la venta no tiene remito interno numerado (comprobanteInterno.tipo=remito)');
    if (!payload.clienteCodigoTango)
        throw new Error('la venta no tiene clienteCodigoTango');
    const pv = ci.puntoVenta ?? puntoVenta;
    const renglones = (0, comun_1.renglonesDeItems)([payload.items, payload.cambios], articulos);
    if (renglones.length === 0)
        throw new Error('remito sin renglones');
    return {
        numero: ci.numero,
        puntoVenta: pv,
        nComp: (0, tipos_1.numeroComprobanteTango)('R', pv, ci.numero),
        codCliente: payload.clienteCodigoTango,
        codDeposito,
        fecha: (0, comun_1.fechaDePayload)(payload.fecha),
        renglones,
        observacion: `ROLITO:VC:${origenId}`,
    };
}
/** ¿Ya existe este remito en Tango? (idempotencia: T_COMP + N_COMP). */
function sentenciaExiste(r) {
    return {
        etiqueta: 'SELECT STA14 existe',
        sql: `SELECT ID_STA14, NCOMP_IN_S FROM STA14 WHERE T_COMP = 'REM' AND N_COMP = @N_COMP`,
        params: [(0, tipos_1.varchar)('N_COMP', r.nComp, 14)],
    };
}
/**
 * Las sentencias de escritura, en el orden en que las hace Tango. Puras: no tocan la
 * base. `datos` viene de leerDatosRemito (o del test).
 */
function sentenciasRemito(r, datos, cfg, ahora = new Date()) {
    const out = [];
    // 1. Cabecera — mismas 60 columnas y valores que la traza.
    out.push((0, comun_1.cabeceraSta14)({
        tComp: 'REM', tcompInS: 'RE', talonario: cfg.talonario,
        nComp: r.nComp, nRemito: r.nComp, ncompInS: datos.ncompInS,
        codCliente: r.codCliente, codDeposito: r.codDeposito,
        estadoMov: 'P', motivoRem: 'V', codTransp: cfg.codigoTransporte,
        fecha: r.fecha, ahora, usuario: cfg.usuario, terminal: cfg.terminal,
        // La referencia idempotente va en LEYENDA1 (varchar 60): se lee desde Tango y
        // sirve para cruzar contra ventasCamion sin depender solo del número.
        leyendas: [r.observacion],
        idDireccionEntrega: datos.idDireccionEntrega, nroSucursalDestino: datos.nroSucursalDestino, condVta: datos.condVta,
    }));
    // 2. Renglones: salida del depósito, cantidad y pendiente de facturar iguales.
    r.renglones.forEach((ren, i) => {
        const art = datos.articulos[ren.codArticu];
        if (!art)
            throw new Error(`falta leer el artículo ${ren.codArticu} de Tango (unidades / stock)`);
        out.push((0, comun_1.renglonSta20)({
            etiqueta: `INSERT STA20 ${ren.codArticu}`,
            codArticu: ren.codArticu, cantidad: ren.cantidad, tipoMov: 'S', codDeposito: r.codDeposito,
            nRenglon: i + 1, tcompInS: 'RE', ncompInS: datos.ncompInS, fecha: r.fecha,
            idMedidaStock: art.idMedidaStock, idMedidaVentas: art.idMedidaVentas,
            cantPendiente: ren.cantidad,
            impuestoInternoFijo: 1, // así lo graba Tango en un remito sin precios
        }));
    });
    // 3. Stock del depósito, con la misma concurrencia optimista de Tango.
    for (const ren of r.renglones) {
        const art = datos.articulos[ren.codArticu];
        // Sin fila de saldo en el depósito (artículo de cambio que el camión nunca cargó,
        // 2026-09-08 CAMBIOHIELO3KG en el depósito 21): se crea con el egreso, igual que
        // hace el writer de transferencias. Antes esto abortaba el remito.
        out.push(art.stockActual === null
            ? (0, comun_1.insertSta19)(`INSERT STA19 stock ${ren.codArticu}`, ren.codArticu, r.codDeposito, -ren.cantidad)
            : (0, comun_1.updateSta19)(`UPDATE STA19 stock ${ren.codArticu}`, ren.codArticu, r.codDeposito, art.stockActual, -ren.cantidad));
    }
    return out;
}
/**
 * Lee de Tango lo que las sentencias necesitan. Las consultas marcadas (*) son la
 * mejor hipótesis sobre el esquema y se confirman en la prueba de TestingRH
 * (docs/tango/INTEGRACION.md §21, "preguntas abiertas").
 */
async function leerDatosRemito(db, r) {
    // Cliente: condición de venta e id.
    const cli = await db.query(`SELECT ID_GVA14, COND_VTA FROM GVA14 WHERE COD_GVA14 = @COD`, [(0, tipos_1.varchar)('COD', r.codCliente, 6)]);
    if (!cli.length)
        throw new Error(`cliente ${r.codCliente} no existe en Tango`);
    // Dirección de entrega habitual del cliente (STA14.ID_DIRECCION_ENTREGA; 8470 en
    // la traza). Tango la exige al facturar desde el remito: sin ella tira "No hay
    // un domicilio de entrega con el id: 0" (2026-09-08). La tabla NO tiene
    // NRO_SUCURSAL (la consulta anterior lo pedía, fallaba y el catch dejaba NULL
    // en TODOS los remitos): se lee solo el id, y si el cliente no tiene ninguna
    // dirección cargada el remito no se escribe, para que el error se vea en la cola.
    const dir = await db.query(`SELECT TOP 1 ID_DIRECCION_ENTREGA FROM DIRECCION_ENTREGA WHERE ID_GVA14 = @ID ORDER BY CASE WHEN HABITUAL = 'S' THEN 0 ELSE 1 END, ID_DIRECCION_ENTREGA`, [(0, tipos_1.int)('ID', cli[0].ID_GVA14)]);
    if (!dir.length)
        throw new Error(`el cliente ${r.codCliente} no tiene dirección de entrega cargada en Tango (DIRECCION_ENTREGA): cargarla en la ficha y reintentar`);
    const idDireccionEntrega = dir[0].ID_DIRECCION_ENTREGA;
    const nroSucursalDestino = 0;
    const ncompInS = await (0, comun_1.siguienteNcompInS)(db, 'RE');
    // Artículos: unidades de medida y stock actual en el depósito.
    const articulos = {};
    for (const ren of r.renglones) {
        const art = await (0, comun_1.leerArticulo)(db, ren.codArticu);
        const stockActual = await (0, comun_1.leerStock)(db, ren.codArticu, r.codDeposito);
        articulos[ren.codArticu] = { ...art, stockActual };
    }
    return { ncompInS, condVta: Number(cli[0].COND_VTA ?? 0), idDireccionEntrega, nroSucursalDestino, articulos };
}
/**
 * Escribe el remito en Tango. El llamador abre la transacción y pasa un ejecutor
 * atado a ella (así el UPDATE de stock y los INSERT quedan juntos o no queda nada).
 */
async function escribirRemito(db, r, cfg, log = () => undefined) {
    const existe = await db.query(sentenciaExiste(r).sql, sentenciaExiste(r).params);
    if (existe.length) {
        log(`remito ${r.nComp} ya estaba en Tango (ID_STA14 ${existe[0].ID_STA14}); no se reescribe`);
        return { yaExistia: true, idSta14: existe[0].ID_STA14, ncompInS: existe[0].NCOMP_IN_S, nComp: r.nComp };
    }
    const datos = await leerDatosRemito(db, r);
    let idSta14 = null;
    for (const s of sentenciasRemito(r, datos, cfg)) {
        const filas = await db.query(s.sql, s.params);
        log(s.etiqueta);
        if (s.etiqueta === 'INSERT STA14' && filas[0]?.ID != null)
            idSta14 = Number(filas[0].ID);
        if (s.etiqueta.startsWith('UPDATE STA19') && filas[0]?.affected === 0) {
            throw new Error(`${s.etiqueta}: el stock cambió mientras se grababa el remito; se reintenta`);
        }
    }
    return { yaExistia: false, idSta14, ncompInS: datos.ncompInS, nComp: r.nComp };
}
/** Para los tests y el log: lista compacta de lo que se va a ejecutar. */
function resumenSentencias(ss) {
    return ss.map((s) => `${s.etiqueta} (${s.params.length} params)`);
}
//# sourceMappingURL=remito.js.map