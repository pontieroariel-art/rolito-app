"use strict";
/**
 * Numeración correlativa de comprobantes.
 *
 * ARCA **no asigna el número**: lo lleva el emisor y ellos solo validan que no
 * haya saltos ni repeticiones (validación 10016, "el número de comprobante no
 * es correlativo"). Eso convierte al contador en una pieza delicada:
 *
 * - Dos ventas simultáneas del mismo punto de venta NO pueden tomar el mismo
 *   número → la asignación va en una transacción de Firestore.
 * - Un número reservado que después no se usa deja un HUECO, y ARCA rechaza el
 *   siguiente comprobante por no correlativo → los huecos hay que resolverlos,
 *   no ignorarlos (ver `marcarNumeroLibre`).
 * - La fuente de verdad última es ARCA, no nuestro contador: si se pierde el
 *   documento o se desincroniza, se resiembra con FECompUltimoAutorizado.
 *
 * Ver docs/arca/FACTURACION_ELECTRONICA.md.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.rutaContador = rutaContador;
exports.inicializarContador = inicializarContador;
exports.reservarNumero = reservarNumero;
exports.marcarNumeroLibre = marcarNumeroLibre;
exports.verificarSincronizacion = verificarSincronizacion;
/**
 * Un contador por punto de venta y tipo de comprobante: las facturas A y B de un
 * mismo punto de venta llevan numeraciones independientes.
 */
function rutaContador({ ptoVta, cbteTipo }) {
    return `config/arcaNumeracion_${ptoVta}_${cbteTipo}`;
}
function leerEstado(snap) {
    if (!snap.exists)
        return null;
    const d = snap.data() ?? {};
    const ultimoAsignado = typeof d.ultimoAsignado === 'number' ? d.ultimoAsignado : null;
    if (ultimoAsignado === null)
        return null;
    return {
        ultimoAsignado,
        librados: Array.isArray(d.librados) ? d.librados.filter((n) => typeof n === 'number') : [],
    };
}
/**
 * Siembra el contador con el último número que ARCA tiene registrado.
 *
 * Se hace FUERA de la transacción de reserva a propósito: pedirle a ARCA por red
 * dentro de una transacción de Firestore es mala idea (la transacción se
 * reintenta y repetiría la llamada). Es idempotente: si el contador ya existe,
 * no lo toca.
 */
async function inicializarContador(db, clave, obtenerUltimoDeArca) {
    const ref = db.doc(rutaContador(clave));
    const existente = await db.runTransaction(async (tx) => leerEstado(await tx.get(ref)));
    if (existente)
        return existente;
    // ARCA devuelve 0 cuando el punto de venta no emitió nada todavía: el primer
    // comprobante será el 1.
    const ultimoEnArca = await obtenerUltimoDeArca();
    return db.runTransaction(async (tx) => {
        // Se relee dentro de la transacción por si otra instancia lo creó mientras
        // consultábamos a ARCA.
        const actual = leerEstado(await tx.get(ref));
        if (actual)
            return actual;
        const estado = { ultimoAsignado: ultimoEnArca, librados: [] };
        tx.set(ref, { ...estado, ptoVta: clave.ptoVta, cbteTipo: clave.cbteTipo }, { merge: true });
        return estado;
    });
}
/**
 * Reserva el próximo número disponible.
 *
 * Prioriza reutilizar un número liberado antes de avanzar el contador: si quedó
 * un hueco (por ejemplo, una venta que se canceló después de reservar), hay que
 * consumirlo primero o ARCA rechazará todo lo que venga después.
 *
 * Tira si el contador no está inicializado: es preferible fallar a inventar un
 * número y arruinar la correlatividad.
 */
async function reservarNumero(db, clave) {
    const ref = db.doc(rutaContador(clave));
    return db.runTransaction(async (tx) => {
        const estado = leerEstado(await tx.get(ref));
        if (!estado) {
            throw new Error(`El contador ${rutaContador(clave)} no está inicializado. ` +
                'Correr inicializarContador() con FECompUltimoAutorizado antes de emitir.');
        }
        if (estado.librados.length > 0) {
            const [numero, ...resto] = [...estado.librados].sort((a, b) => a - b);
            tx.set(ref, { librados: resto }, { merge: true });
            return numero;
        }
        const numero = estado.ultimoAsignado + 1;
        tx.set(ref, { ultimoAsignado: numero }, { merge: true });
        return numero;
    });
}
/**
 * Devuelve al pozo un número reservado que finalmente no se usó.
 *
 * Solo se puede llamar cuando hay CERTEZA de que ARCA no lo autorizó — o sea,
 * después de un `FECompConsultar` que responda que no existe. Liberar un número
 * que en realidad sí quedó autorizado provocaría un duplicado, que es un
 * problema fiscal.
 */
async function marcarNumeroLibre(db, clave, numero) {
    const ref = db.doc(rutaContador(clave));
    await db.runTransaction(async (tx) => {
        const estado = leerEstado(await tx.get(ref));
        if (!estado)
            return;
        // Si era el último asignado, se retrocede el contador en vez de anotarlo
        // como hueco: es más simple y deja el estado más limpio.
        if (numero === estado.ultimoAsignado) {
            tx.set(ref, { ultimoAsignado: numero - 1 }, { merge: true });
            return;
        }
        if (estado.librados.includes(numero))
            return; // ya estaba liberado
        tx.set(ref, { librados: [...estado.librados, numero] }, { merge: true });
    });
}
/**
 * Compara nuestro contador contra ARCA.
 *
 * Sirve para un chequeo periódico: si divergen, algo se emitió por fuera de la
 * app (o se perdió una escritura) y hay que mirarlo antes de seguir emitiendo.
 */
async function verificarSincronizacion(db, clave, obtenerUltimoDeArca) {
    const ref = db.doc(rutaContador(clave));
    const estado = await db.runTransaction(async (tx) => leerEstado(await tx.get(ref)));
    const arca = await obtenerUltimoDeArca();
    return {
        enSync: estado !== null && estado.ultimoAsignado === arca && estado.librados.length === 0,
        local: estado?.ultimoAsignado ?? null,
        arca,
    };
}
//# sourceMappingURL=numeracion.js.map