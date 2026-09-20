"use strict";
// Anular en Tango el remito que el chofer anuló en la app (2026-09-20).
//
// Hasta hoy ese remito lo anulaba la oficina a mano y la app solo avisaba. En
// la práctica tardaba días —cuatro, seis, ocho— y en esa ventana Tango llegaba
// a FACTURAR la mercadería: el 20/09, de siete remitos anulados en la app, tres
// ya estaban facturados y no se podían anular más. Eso es una factura al
// cliente por mercadería que no se entregó, y una divergencia entre la app y
// Tango que no se arregla nunca.
//
// La secuencia está copiada de la traza real de una anulación hecha desde
// Tango Ventas → Anulación de remitos (R0110500000957 de KLIVE, 20/09), no
// inventada. La receta completa, con las tablas y los valores medidos, está en
// docs/tango/ANULACION-REMITO-receta.md.
//
// Lo esencial: **el remito no se borra, se vacía**. Los renglones se eliminan,
// el stock vuelve al depósito y la cabecera queda con ESTADO_MOV = 'A' y los
// campos de anulación. El cliente NO se toca (a diferencia de lo que Tango hace
// con los recibos, que sí quedan sin cliente).
Object.defineProperty(exports, "__esModule", { value: true });
exports.sentenciaCabecera = sentenciaCabecera;
exports.sentenciasAnulacion = sentenciasAnulacion;
exports.leerRenglones = leerRenglones;
exports.anularRemitoEnTango = anularRemitoEnTango;
const tipos_1 = require("./tipos");
const comun_1 = require("./comun");
/** ¿Existe el remito y en qué estado está? */
function sentenciaCabecera(nComp) {
    return {
        etiqueta: 'SELECT STA14 cabecera',
        sql: `SELECT ID_STA14, N_COMP, TCOMP_IN_S, NCOMP_IN_S, COD_DEPOSI, TALONARIO, ESTADO_MOV
          FROM STA14 WHERE T_COMP = 'REM' AND N_COMP = @N_COMP`,
        params: [(0, tipos_1.varchar)('N_COMP', nComp, 14)],
    };
}
/**
 * Las sentencias de la anulación, en el mismo orden que las hace Tango. Puras:
 * no tocan la base. `renglones` sale de leerRenglones (o del test).
 */
function sentenciasAnulacion(cab, renglones, cfg, ahora = new Date()) {
    const out = [];
    const clave = [(0, tipos_1.varchar)('TCOMP', cab.tcompInS, 2), (0, tipos_1.varchar)('NCOMP', cab.ncompInS, 8)];
    const claveRenglon = (n) => [...clave.map((p) => ({ ...p })), (0, tipos_1.int)('RENGL', n)];
    // 1. Por renglón: devolver el stock y limpiar lo que cuelga del movimiento.
    for (const ren of renglones) {
        // El stock vuelve al depósito por la cantidad del renglón. Si no hay fila de
        // saldo (nunca debería, el remito la creó al salir) se crea, igual que hace
        // el writer del remito.
        out.push(ren.stockActual === null
            ? (0, comun_1.insertSta19)(`INSERT STA19 stock ${ren.codArticu}`, ren.codArticu, cab.codDeposito, ren.cantidad)
            : (0, comun_1.updateSta19)(`UPDATE STA19 stock ${ren.codArticu}`, ren.codArticu, cab.codDeposito, ren.stockActual, ren.cantidad));
        for (const tabla of ['STA09', 'STA07', 'GVA106', 'GVA54']) {
            out.push({
                etiqueta: `DELETE ${tabla} renglón ${ren.nRenglon}`,
                sql: `DELETE FROM ${tabla} WHERE TCOMP_IN_S = @TCOMP AND NCOMP_IN_S = @NCOMP AND N_RENGL_S = @RENGL`,
                params: claveRenglon(ren.nRenglon),
            });
        }
    }
    // 2. Los renglones del movimiento de stock, todos juntos.
    out.push({
        etiqueta: 'DELETE STA20 renglones',
        sql: `DELETE FROM STA20 WHERE TCOMP_IN_S = @TCOMP AND NCOMP_IN_S = @NCOMP`,
        params: clave,
    });
    // 3. Lo que cuelga del comprobante de ventas.
    out.push({
        etiqueta: 'DELETE GVA45',
        sql: `DELETE FROM GVA45 WHERE TALONARIO = @TALONARIO AND T_COMP = 'REM' AND N_COMP = @N_COMP`,
        params: [(0, tipos_1.int)('TALONARIO', cab.talonario), (0, tipos_1.varchar)('N_COMP', cab.nComp, 14)],
    });
    out.push({
        etiqueta: 'DELETE GVA55',
        sql: `DELETE FROM GVA55 WHERE T_COMP = 'REM' AND N_COMP = @N_COMP`,
        params: [(0, tipos_1.varchar)('N_COMP', cab.nComp, 14)],
    });
    // 4. Recién ahora la cabecera queda anulada. COD_PRO_CL no se toca: Tango se
    //    lo deja al remito (al recibo sí se lo borra), y gracias a eso el remito
    //    anulado se sigue viendo en la ficha del cliente.
    out.push({
        etiqueta: 'UPDATE STA14 anulación',
        sql: `UPDATE "STA14" SET "ESTADO_MOV" = 'A', "FECHA_ANU" = @FECHA_ANU, "HORA_ANU" = @HORA_ANU,
          "USUARIO_ANU" = @USUARIO_ANU, "TERMINAL_ANU" = @TERMINAL_ANU
          WHERE "ID_STA14" = @ID_STA14 AND "ESTADO_MOV" = 'P'`,
        params: [
            (0, tipos_1.datetime)('FECHA_ANU', (0, tipos_1.soloDia)(ahora)),
            (0, tipos_1.varchar)('HORA_ANU', (0, tipos_1.horaHHMMSS)(ahora), 6),
            (0, tipos_1.varchar)('USUARIO_ANU', cfg.usuario.slice(0, 10), 10),
            (0, tipos_1.varchar)('TERMINAL_ANU', cfg.terminal.slice(0, 8), 8),
            (0, tipos_1.int)('ID_STA14', cab.idSta14),
        ],
    });
    return out;
}
/** Los renglones del remito, con el saldo actual de cada artículo en el depósito. */
async function leerRenglones(db, cab) {
    const filas = await db.query(`SELECT N_RENGL_S, COD_ARTICU, CANTIDAD FROM STA20
     WHERE TCOMP_IN_S = @TCOMP AND NCOMP_IN_S = @NCOMP ORDER BY N_RENGL_S`, [(0, tipos_1.varchar)('TCOMP', cab.tcompInS, 2), (0, tipos_1.varchar)('NCOMP', cab.ncompInS, 8)]);
    const out = [];
    for (const f of filas) {
        const codArticu = String(f.COD_ARTICU).trim();
        out.push({
            nRenglon: Number(f.N_RENGL_S),
            codArticu,
            cantidad: Number(f.CANTIDAD),
            stockActual: await (0, comun_1.leerStock)(db, codArticu, cab.codDeposito),
        });
    }
    return out;
}
/**
 * Anula el remito en Tango. El llamador abre la transacción y pasa un ejecutor
 * atado a ella: si algo falla a la mitad, no puede quedar el stock devuelto con
 * el remito todavía vivo.
 *
 * No lanza por los casos previstos (ya anulado, facturado, inexistente): los
 * devuelve, porque cada uno tiene su tratamiento aguas arriba.
 */
async function anularRemitoEnTango(db, nComp, cfg, log = () => undefined) {
    const s = sentenciaCabecera(nComp);
    const filas = await db.query(s.sql, s.params);
    if (!filas.length) {
        log(`remito ${nComp} no existe en Tango`);
        return { estado: 'inexistente' };
    }
    const cab = {
        idSta14: Number(filas[0].ID_STA14),
        nComp,
        tcompInS: String(filas[0].TCOMP_IN_S).trim(),
        ncompInS: String(filas[0].NCOMP_IN_S).trim(),
        codDeposito: String(filas[0].COD_DEPOSI).trim(),
        talonario: Number(filas[0].TALONARIO),
        estadoMov: String(filas[0].ESTADO_MOV).trim().toUpperCase(),
    };
    if (cab.estadoMov === 'A') {
        log(`remito ${nComp} ya estaba anulado en Tango`);
        return { estado: 'ya_anulado', idSta14: cab.idSta14 };
    }
    if (cab.estadoMov !== 'P') {
        // 'F' = facturado. Anular el remito acá dejaría la factura colgada.
        log(`remito ${nComp} está en estado ${cab.estadoMov}: no se anula`);
        return { estado: 'facturado', idSta14: cab.idSta14 };
    }
    const renglones = await leerRenglones(db, cab);
    for (const sent of sentenciasAnulacion(cab, renglones, cfg)) {
        const r = await db.query(sent.sql, sent.params);
        log(sent.etiqueta);
        // El UPDATE de stock lleva el saldo anterior en el WHERE: si no afectó
        // ninguna fila, alguien lo movió mientras tanto y hay que reintentar todo.
        if (sent.etiqueta.startsWith('UPDATE STA19') && r[0]?.affected === 0) {
            throw new Error(`${sent.etiqueta}: el stock cambió mientras se anulaba el remito; se reintenta`);
        }
        if (sent.etiqueta === 'UPDATE STA14 anulación' && r[0]?.affected === 0) {
            throw new Error(`${sent.etiqueta}: el remito dejó de estar en 'P' mientras se anulaba; se reintenta`);
        }
    }
    log(`remito ${nComp} anulado en Tango (${renglones.length} renglones, stock devuelto al depósito ${cab.codDeposito})`);
    return { estado: 'anulado', idSta14: cab.idSta14, renglones: renglones.length };
}
//# sourceMappingURL=anulacionRemito.js.map