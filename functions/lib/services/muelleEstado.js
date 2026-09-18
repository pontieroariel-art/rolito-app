"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.patenteDe = void 0;
exports.calcularOcupadas = calcularOcupadas;
exports.rangoDiaArt = rangoDiaArt;
/**
 * Estado público del muelle (2026-09-15): qué dársenas están ocupadas y por qué.
 *
 * Para qué: el camión que vuelve del reparto estaciona DIRECTO en una boca para
 * que le cuenten la descarga, y el chofer elige esa boca desde su teléfono. Pero el
 * chofer no puede leer los remitos de los demás ni la ventanilla (y no tiene por
 * qué), así que el servidor publica en `muelleEstado/{planta}` un resumen
 * sanitizado —número de boca, tipo y una etiqueta corta— y la app le muestra solo
 * las libres. Misma lógica que el TV del muelle usa para pintar cada boca.
 *
 * Prioridad por boca: un camión que volvió y espera conteo pisa a todo lo demás
 * (es la alerta roja); después el que está cargando; al final el turno de ventanilla.
 */
const firestore_1 = require("firebase-admin/firestore");
/** Patente sola: `camionLabel` viene como "AB123CD · Iveco" en los remitos. */
const patenteDe = (label) => String(label ?? '').split('·')[0].trim();
exports.patenteDe = patenteDe;
function calcularOcupadas(remitos, descargas, ventas, borradores = []) {
    const out = {};
    const poner = (n, o) => {
        if (typeof n !== 'number' || n < 1 || out[String(n)])
            return;
        out[String(n)] = o;
    };
    // Un camión contado deja de "estar volviendo" aunque el remito siga 'salido'.
    const contados = new Set(descargas.map((d) => d.choferId));
    for (const r of remitos) {
        if (r.regreso?.darsena && !contados.has(r.choferId))
            poner(r.regreso.darsena, { tipo: 'regreso', etiqueta: (0, exports.patenteDe)(r.camionLabel) });
    }
    for (const b of borradores) {
        if (b.estado === 'pendiente' && b.darsena)
            poner(b.darsena, { tipo: 'carga', etiqueta: (0, exports.patenteDe)(b.camionLabel) });
    }
    for (const v of ventas) {
        if (v.estado === 'pendiente_entrega' && v.turnoEstado === 'llamado' && v.darsena)
            poner(v.darsena, { tipo: 'ventanilla', etiqueta: `T-${v.turno ?? '?'}` });
    }
    return out;
}
/** Día operativo en hora argentina (UTC-3 fijo, AR no tiene horario de verano). */
function rangoDiaArt(ahora = Date.now()) {
    const art = new Date(ahora - 3 * 3600000);
    const ymd = art.toISOString().slice(0, 10);
    const desde = new Date(`${ymd}T03:00:00Z`); // 00:00 ART
    const hasta = new Date(desde.getTime() + 24 * 3600000);
    return { ymd, desde: firestore_1.Timestamp.fromDate(desde), hasta: firestore_1.Timestamp.fromDate(hasta) };
}
//# sourceMappingURL=muelleEstado.js.map