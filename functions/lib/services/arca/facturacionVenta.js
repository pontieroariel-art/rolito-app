"use strict";
/**
 * Facturación de una venta de contado del camión.
 *
 * Es el punto donde se juntan las piezas: configuración, ticket de acceso,
 * numeración, cálculo fiscal y emisión. Su responsabilidad propia es una sola,
 * pero crítica: **que una venta produzca a lo sumo una factura**.
 *
 * Por qué hace falta cuidarlo: los triggers de Cloud Functions son at-least-once.
 * El mismo evento puede llegar dos veces, y si cada llegada reservara un número
 * nuevo y llamara a ARCA, la segunda emitiría un duplicado. Por eso el estado de
 * la factura vive en `facturasArca/{ventaId}` —el ID es el de la venta, así que
 * no puede haber dos— y cada corrida decide qué hacer según lo que encuentre:
 *
 *   ya emitida        → no hace nada
 *   con número e incierta → pregunta a ARCA qué pasó, no reintenta a ciegas
 *   con número, sin resolver → idem: el número ya salió, hay que averiguar
 *   sin número        → recién ahí emite
 *
 * Ver docs/arca/FACTURACION_ELECTRONICA.md.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.rutaFactura = rutaFactura;
exports.facturarVenta = facturarVenta;
const emision_1 = require("./emision");
function rutaFactura(ventaId) {
    return `facturasArca/${ventaId}`;
}
function leerNumero(f) {
    if (!f)
        return null;
    const numero = typeof f.numero === 'number' ? f.numero : null;
    const cbteTipo = typeof f.cbteTipo === 'number' ? f.cbteTipo : null;
    if (numero === null || cbteTipo === null)
        return null;
    return { numero, cbteTipo };
}
/**
 * Factura una venta, o retoma lo que haya quedado a medio hacer.
 *
 * Es seguro llamarla varias veces con el mismo `ventaId`: eso es justamente
 * para lo que está pensada.
 */
async function facturarVenta(opts) {
    const { db, arca, config, ventaId, datos } = opts;
    const previo = await opts.leer();
    // 1. Ya está facturada: no se toca. Reintentar acá sería emitir un duplicado.
    if (previo?.estado === 'emitida') {
        const n = leerNumero(previo);
        return {
            ventaId,
            estado: 'emitida',
            puntoVenta: config.puntoVenta,
            cbteTipo: n?.cbteTipo ?? 0,
            numero: n?.numero ?? 0,
            cae: typeof previo.cae === 'string' ? previo.cae : null,
            caeFchVto: typeof previo.caeFchVto === 'string' ? previo.caeFchVto : null,
        };
    }
    // 2. Hay un número reservado de un intento anterior. Ese número YA pudo haber
    //    salido hacia ARCA, así que no se puede volver a emitir: hay que preguntar.
    const pendiente = leerNumero(previo);
    if (pendiente) {
        const r = await (0, emision_1.resolverIncierto)(db, arca, config.puntoVenta, pendiente.cbteTipo, pendiente.numero);
        const registro = r.estado === 'emitido'
            ? {
                ventaId, estado: 'emitida', puntoVenta: config.puntoVenta,
                cbteTipo: r.cbteTipo, numero: r.numero, cae: r.cae, caeFchVto: r.caeFchVto,
            }
            : {
                ventaId, estado: 'rechazada', puntoVenta: config.puntoVenta,
                cbteTipo: r.cbteTipo, numero: r.numero,
                motivo: r.estado === 'rechazado' ? r.motivo : 'sin resolver',
            };
        await opts.guardar(registro);
        return registro;
    }
    // 3. Venta sin facturar todavía: se emite.
    const calculo = {
        preciosIncluyenIva: config.preciosIncluyenIva,
        percepcionIIBB: opts.percepcionIIBB,
    };
    const resultado = await (0, emision_1.emitirComprobante)({
        db,
        arca,
        ptoVta: config.puntoVenta,
        datos: { ...datos, numeroComprobante: 0 }, // lo asigna la reserva
        calculo,
        ahora: opts.ahora,
        // Se deja constancia del número antes de que salga la llamada, para que un
        // corte en el medio sea reconciliable en vez de un misterio.
        onNumeroReservado: async (numero, cbteTipo) => {
            await opts.guardar({
                ventaId, estado: 'incierta', puntoVenta: config.puntoVenta,
                cbteTipo, numero, motivo: 'emisión en curso',
            });
        },
    });
    const registro = resultado.estado === 'emitido'
        ? {
            ventaId, estado: 'emitida', puntoVenta: config.puntoVenta,
            cbteTipo: resultado.cbteTipo, numero: resultado.numero,
            cae: resultado.cae, caeFchVto: resultado.caeFchVto,
            observaciones: resultado.observaciones,
            importes: resultado.importes,
        }
        : {
            ventaId,
            estado: resultado.estado === 'incierto' ? 'incierta' : 'rechazada',
            puntoVenta: config.puntoVenta,
            cbteTipo: resultado.cbteTipo, numero: resultado.numero,
            motivo: resultado.motivo,
        };
    await opts.guardar(registro);
    return registro;
}
//# sourceMappingURL=facturacionVenta.js.map