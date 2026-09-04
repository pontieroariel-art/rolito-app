"use strict";
// Tipos comunes del writer SQL (remitos y recibos directo en la base de Tango).
// Ver docs/tango/INTEGRACION.md §20/§21 y las trazas reales en docs/tango/sql/.
//
// El writer no depende de un driver concreto: recibe un `EjecutorSql` (en la VM
// será `mssql`; en los tests, un fake). Todas las sentencias van parametrizadas
// con el tipo SQL explícito, copiado de lo que manda el propio Tango (varchar(n),
// numeric(22,7), datetime, bit, int, smallint, float).
Object.defineProperty(exports, "__esModule", { value: true });
exports.FECHA_NULA_TANGO = exports.float = exports.smallint = exports.int = exports.bit = exports.datetime = exports.numeric = exports.varchar = void 0;
exports.soloDia = soloDia;
exports.horaHHMMSS = horaHHMMSS;
exports.numeroComprobanteTango = numeroComprobanteTango;
exports.insert = insert;
// Helpers de tipado, para escribir los parámetros como los manda Tango.
const varchar = (nombre, valor, length) => ({ nombre, tipo: { kind: 'varchar', length }, valor });
exports.varchar = varchar;
const numeric = (nombre, valor, precision = 22, scale = 7) => ({ nombre, tipo: { kind: 'numeric', precision, scale }, valor });
exports.numeric = numeric;
const datetime = (nombre, valor) => ({ nombre, tipo: { kind: 'datetime' }, valor });
exports.datetime = datetime;
const bit = (nombre, valor) => ({ nombre, tipo: { kind: 'bit' }, valor });
exports.bit = bit;
const int = (nombre, valor) => ({ nombre, tipo: { kind: 'int' }, valor });
exports.int = int;
const smallint = (nombre, valor) => ({ nombre, tipo: { kind: 'smallint' }, valor });
exports.smallint = smallint;
const float = (nombre, valor) => ({ nombre, tipo: { kind: 'float' }, valor });
exports.float = float;
/** Fecha "de comprobante" de Tango: el día a las 00:00 (así la guarda en FECHA_MOV / FECHA_EMIS). */
function soloDia(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
/** Hora como la guarda Tango en HORA_COMP / HORA_INGRESO: 'HHMMSS'. */
function horaHHMMSS(d) {
    return `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
}
/** Fecha nula de Tango (FECHA_ANU de un comprobante vigente). */
exports.FECHA_NULA_TANGO = new Date(1800, 0, 1);
/** Número de comprobante como lo guarda Tango: letra + punto de venta (5) + número (8). Ej. 'R0000100480100'. */
function numeroComprobanteTango(letra, puntoVenta, numero) {
    return `${letra}${String(puntoVenta).padStart(5, '0')}${String(numero).padStart(8, '0')}`;
}
/** Arma un INSERT parametrizado a partir de pares columna → parámetro (misma forma que usa Tango). */
function insert(etiqueta, tabla, columnas, conIdentity = false) {
    const cols = columnas.map((c) => `"${c.nombre}"`).join(',');
    const vals = columnas.map((c) => `@${c.nombre}`).join(',');
    return {
        etiqueta,
        sql: `INSERT INTO "${tabla}" (${cols}) VALUES (${vals})${conIdentity ? '; SELECT SCOPE_IDENTITY() AS ID' : ''}`,
        params: columnas,
    };
}
//# sourceMappingURL=tipos.js.map