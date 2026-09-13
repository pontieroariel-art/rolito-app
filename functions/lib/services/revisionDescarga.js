"use strict";
/**
 * Faltante de la descarga contada (2026-09-13, control de fugas en expedición).
 *
 * Muelle cuenta A CIEGAS: la tablet no ve ni retiene lo que tendría que haber
 * vuelto, y las reglas no le dejan leer `ventasCamion`. Así que el faltante lo
 * calcula el servidor cuando la descarga se crea, y lo escribe en
 * `descargasCamion.revision`.
 *
 * ES UNA FOTO DEL MOMENTO DEL CONTEO. Si el chofer sube ventas más tarde (venía
 * sin señal), el faltante de esta marca queda inflado. Por eso lo que TRABA el
 * cierre de la liquidación es el recálculo en vivo que hace caja, con todas las
 * ventas del día a la vista; esto es la marca de auditoría y el disparador del
 * aviso. Misma regla que el front (src/utils/faltantes.ts): un sobrante NO
 * compensa un faltante.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.UMBRAL_FALTANTES_DEFAULT = void 0;
exports.calcularRevision = calcularRevision;
exports.normalizarUmbralFaltantes = normalizarUmbralFaltantes;
exports.UMBRAL_FALTANTES_DEFAULT = { habilitado: true, bolsas: 10 };
const PREFIJO_CAMBIO = 'cambio_';
/** Los renglones de cambio vienen con el id prefijado; se agrupan en el producto que son. */
const productoDelCambio = (id) => id.startsWith(PREFIJO_CAMBIO) ? id.slice(PREFIJO_CAMBIO.length) : id;
const nombreDelCambio = (nombre) => nombre.startsWith('Cambio ') ? nombre.slice('Cambio '.length) : nombre;
/** Igual que utils/liquidacion.ts: devolución teórica = carga − ventas − cambios. */
function calcularRevision(remitos, ventas, cambiosViejos, descargas, umbral = exports.UMBRAL_FALTANTES_DEFAULT) {
    const filas = new Map();
    const fila = (productoId, nombre) => {
        let f = filas.get(productoId);
        if (!f) {
            f = { nombre, teorico: 0, descarga: 0 };
            filas.set(productoId, f);
        }
        return f;
    };
    remitos.forEach((r) => (r.items ?? []).forEach((i) => { fila(i.productoId, i.nombre).teorico += i.cantidad; }));
    // Una venta anulada con nota de crédito no cuenta: la NC ya devolvió el stock.
    ventas
        .filter((v) => v.anulacion?.estado !== 'anulada')
        .forEach((v) => {
        (v.items ?? []).forEach((i) => { fila(i.productoId, i.nombre).teorico -= i.cantidad; });
        (v.cambios ?? []).forEach((i) => {
            fila(productoDelCambio(i.productoId), nombreDelCambio(i.nombre)).teorico -= i.cantidad;
        });
    });
    // Registro viejo de cambios (cuando el cambio era una pantalla aparte).
    cambiosViejos.forEach((c) => { fila(productoDelCambio(c.productoId), nombreDelCambio(c.nombre)).teorico -= c.cantidad; });
    descargas.forEach((d) => (d.items ?? []).forEach((i) => { fila(i.productoId, i.nombre).descarga += i.cantidad; }));
    const productos = [];
    let bolsasFaltantes = 0;
    let bolsasSobrantes = 0;
    filas.forEach((f, productoId) => {
        const diferencia = f.descarga - f.teorico;
        if (diferencia < 0) {
            productos.push({ productoId, nombre: f.nombre, faltan: -diferencia });
            bolsasFaltantes += -diferencia;
        }
        else
            bolsasSobrantes += diferencia;
    });
    productos.sort((a, b) => b.faltan - a.faltan || a.nombre.localeCompare(b.nombre));
    return {
        requiere: umbral.habilitado && umbral.bolsas > 0 && bolsasFaltantes >= umbral.bolsas,
        bolsasFaltantes,
        bolsasSobrantes,
        productos,
        umbral: umbral.bolsas,
    };
}
/** Sanea config/liquidacion.faltantes (mismo criterio que el front). */
function normalizarUmbralFaltantes(raw) {
    const o = (raw ?? {});
    const bolsas = typeof o.bolsas === 'number' && Number.isFinite(o.bolsas) && o.bolsas > 0
        ? Math.round(o.bolsas)
        : exports.UMBRAL_FALTANTES_DEFAULT.bolsas;
    return {
        habilitado: typeof o.habilitado === 'boolean' ? o.habilitado : exports.UMBRAL_FALTANTES_DEFAULT.habilitado,
        bolsas,
    };
}
//# sourceMappingURL=revisionDescarga.js.map