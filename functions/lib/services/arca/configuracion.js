"use strict";
/**
 * Configuración de la facturación electrónica.
 *
 * Vive en Firestore (`config/arca`) y no en el código, porque son valores que
 * cambian sin tocar el programa: el punto de venta, el ambiente, el código de
 * tributo de la percepción. Lo que sí está en el código es la **validación**:
 * si falta algo o viene con un valor imposible, no se factura.
 *
 * El criterio general de este módulo, igual que en el resto de la integración:
 * ante la duda, frenar. Un comprobante mal emitido no se borra, se corrige con
 * una nota de crédito.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RUTA_CONFIG = exports.ConfigArcaInvalida = void 0;
exports.validarConfig = validarConfig;
exports.leerConfig = leerConfig;
exports.leerConfigParaEmitir = leerConfigParaEmitir;
class ConfigArcaInvalida extends Error {
    constructor(problemas) {
        super(`Configuración de ARCA incompleta o inválida: ${problemas.join('; ')}`);
        this.problemas = problemas;
        this.name = 'ConfigArcaInvalida';
    }
}
exports.ConfigArcaInvalida = ConfigArcaInvalida;
exports.RUTA_CONFIG = 'config/arca';
/**
 * Valida y normaliza lo que hay guardado.
 *
 * Se exporta aparte de la lectura para poder testearla sin Firestore, y para
 * que el panel de administración pueda validar antes de guardar.
 */
function validarConfig(data) {
    const problemas = [];
    const d = data ?? {};
    const ambiente = d.ambiente;
    if (ambiente !== 'homologacion' && ambiente !== 'produccion') {
        problemas.push('`ambiente` debe ser "homologacion" o "produccion"');
    }
    const cuit = String(d.cuit ?? '').replace(/\D/g, '');
    if (cuit.length !== 11)
        problemas.push('`cuit` debe tener 11 dígitos');
    const puntoVenta = Number(d.puntoVenta);
    if (!Number.isInteger(puntoVenta) || puntoVenta < 1 || puntoVenta > 99998) {
        // El rango sale de la validación 10004 del manual de ARCA.
        problemas.push('`puntoVenta` debe ser un entero entre 1 y 99998');
    }
    if (typeof d.preciosIncluyenIva !== 'boolean') {
        problemas.push('`preciosIncluyenIva` debe estar definido explícitamente (true/false): ' +
            'de esto depende si el total lleva el IVA adentro o encima');
    }
    const tributoId = Number(d.tributoIdPercepcionIIBB);
    if (!Number.isInteger(tributoId) || tributoId < 1) {
        problemas.push('`tributoIdPercepcionIIBB` debe ser el código de tributo de ARCA ' +
            '(se obtiene con FEParamGetTiposTributos)');
    }
    if (problemas.length > 0)
        throw new ConfigArcaInvalida(problemas);
    return {
        ambiente: ambiente,
        cuit,
        puntoVenta,
        preciosIncluyenIva: d.preciosIncluyenIva,
        tributoIdPercepcionIIBB: tributoId,
        // El default es NO emitir: una configuración a medio cargar no debe
        // empezar a facturar sola.
        habilitado: d.habilitado === true,
    };
}
/** Lee y valida la configuración. Tira `ConfigArcaInvalida` si algo falta. */
async function leerConfig(db) {
    const ref = db.doc(exports.RUTA_CONFIG);
    const data = await db.runTransaction(async (tx) => (await tx.get(ref)).data());
    return validarConfig(data);
}
/**
 * Igual que `leerConfig` pero además exige que la facturación esté encendida.
 *
 * Se usa en el camino de emisión; el panel de administración usa `leerConfig`
 * para poder mostrar la configuración aunque todavía esté apagada.
 */
async function leerConfigParaEmitir(db) {
    const config = await leerConfig(db);
    if (!config.habilitado) {
        throw new ConfigArcaInvalida(['la facturación electrónica está deshabilitada (`habilitado: false`)']);
    }
    return config;
}
//# sourceMappingURL=configuracion.js.map