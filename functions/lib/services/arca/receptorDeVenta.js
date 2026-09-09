"use strict";
/**
 * El receptor fiscal de una venta: el cliente registrado sale de su perfil
 * (datos de Tango); el ocasional del mostrador no tiene perfil y es consumidor
 * final con el CUIT o DNI que haya cargado caja (o sin identificar hasta el
 * tope, ver validarReceptor). Compartido por la factura y la nota de crédito.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.receptorDeVenta = receptorDeVenta;
async function receptorDeVenta(db, ventaId, venta, coleccion) {
    const clienteId = String(venta.clienteId ?? '');
    const perfil = clienteId ? (await db.doc(`users/${clienteId}`).get()).data() : undefined;
    const ocasional = venta.clienteOcasional;
    if (perfil) {
        return {
            perfil,
            receptor: {
                razonSocial: String(perfil.razonSocial ?? ''),
                cuit: String(perfil.cuit ?? ''),
                categoriaIvaTango: String(perfil.categoriaIvaTango ?? ''),
            },
        };
    }
    if (coleccion === 'ventasVentanilla' && ocasional) {
        return {
            perfil: undefined,
            receptor: {
                razonSocial: String(ocasional.nombre ?? ''),
                cuit: String(ocasional.cuit ?? ''),
                dni: String(ocasional.dni ?? ''),
                categoriaIvaTango: 'CF',
                mostrador: true,
            },
        };
    }
    throw new Error(`La venta ${ventaId} no tiene un cliente resoluble`);
}
//# sourceMappingURL=receptorDeVenta.js.map