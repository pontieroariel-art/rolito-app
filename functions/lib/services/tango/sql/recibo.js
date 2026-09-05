"use strict";
// Recibo de cobranza directo en la base de Tango, copiando lo que hace la pantalla
// "Cobranzas" (Ventas → Cuentas Corrientes) — relevado con Extended Events el
// 2026-09-04 (docs/tango/sql/traza-recibo-2026-09-04.txt; INTEGRACION.md §21.2).
//
// Qué escribe Tango al grabar un recibo (y qué hacen sus triggers solos):
//   Cuenta corriente
//   1. INSERT GVA12   el recibo (T_COMP 'REC', TCOMP_IN_V 'RC', ESTADO 'IMP'). Con
//      NCOMP_IN_V en 0 un trigger lo pone = ID_GVA12.
//   2. INSERT gva07   una imputación por factura (T_COMP/N_COMP = la factura,
//      T_COMP_CAN/N_COMP_CAN = el recibo). Los triggers de gva07 recalculan solos los
//      estados de la factura y del recibo (CTA/IMP/PAG/CAN) y los vencimientos (GVA46).
//   3. INSERT HISTORIAL_CUENTAS_CORRIENTES  el rastro de la imputación (ORIGEN 'Cobranzas').
//   4. UPDATE GVA14   saldo del cliente: SALDO_CC y SALDO_CC_U bajan el importe (optimista).
//   Tesorería
//   5. INSERT SBA04   cabecera del movimiento (COD_COMP 'REC', N_INTERNO del contador
//      dbo.INCREMENTAL_VALUE, ID_SBA02 = tipo REC).
//   6. INSERT SBA05   renglón 0 = contracuenta (deudores, 'H'); renglones 1..n = medios
//      (caja/banco, 'D'). Triggers completan ID_SBA01 / ID_SBA04.
//   7. INSERT COMPROBANTE_COTIZACION_SB   cotización del comprobante (pesos, 1.0).
//   8. UPDATE SBA01   saldos de cada cuenta: 'D' suma, 'H' resta (optimista).
//   9. INSERT ASIENTO_COMPROBANTE_SB + ASIENTO_SB  el asiento contable del movimiento
//      (una línea por cuenta, con la cuenta CONTABLE mapeada desde la de tesorería).
//   No se replica: UPDATE GVA43 PROXIMO (codificado → talonario exclusivo de la app),
//   UPDATE GVA16 COTIZ (no-op en pesos), INSERT gva12ty (imagen para reimprimir).
//
// Ids explícitos (HISTORIAL_CUENTAS_CORRIENTES, COMPROBANTE_COTIZACION_SB, ASIENTO_*):
// Tango los manda él. Si la columna es IDENTITY se omite; si no, el ejecutor los
// reserva (INCREMENTAL_VALUE o MAX+1) antes de armar las sentencias — ver `IdsRecibo`.
// Se decide con la consulta (a) de §21.3.
//
// Cheques de terceros (relevado el 2026-09-05, docs/tango/sql/traza-recibo-cheque-2026-09-05.txt):
//   el cheque es un medio más: un renglón SBA05 'D' sobre la cuenta de cartera (VALORES A
//   DEPOSITAR 1112000; e-cheq 1112002) con la SUMA de los cheques de esa cuenta, y por cada
//   cheque: INSERT SBA14 (el cheque en cartera: ESTADO 'C', TIPO_CHEQU 'D'/'C', fechas, banco,
//   CUIT y razón social del librador — triggers completan ID_GVA14/ID_CPA01), INSERT SBA23
//   (historial del cheque, estado 'C') e INSERT MOVIMIENTO_CHEQUE_TERCERO (ID_SBA14 ↔ ID_SBA05
//   del renglón de cartera, 'INGR'). El asiento lleva la cuenta contable de la cartera (602).
//   SBA90 (grilla temporal de la pantalla) no se replica. SBA14.N_INTERNO sale de `siguiente()`.
// Retenciones → error explícito hasta relevarlas (TestingRH no tiene códigos de retención cargados).
Object.defineProperty(exports, "__esModule", { value: true });
exports.reciboDeCobranza = reciboDeCobranza;
exports.sentenciaExisteRecibo = sentenciaExisteRecibo;
exports.sentenciasRecibo = sentenciasRecibo;
exports.leerDatosRecibo = leerDatosRecibo;
exports.tablasConIdentity = tablasConIdentity;
exports.escribirRecibo = escribirRecibo;
const tipos_1 = require("./tipos");
const r2 = (n) => Math.round(n * 100) / 100;
function reciboDeCobranza(p, cobranzaId, cfg) {
    if (!p.clienteCodigoTango)
        throw new Error('la cobranza no tiene clienteCodigoTango');
    const numero = Number(String(p.numeroRecibo ?? '').replace(/\D/g, ''));
    if (!numero)
        throw new Error(`numeroRecibo inválido: ${p.numeroRecibo}`);
    const imputaciones = (p.imputaciones ?? []).filter((i) => Number(i.importeImputado) > 0).map((i) => ({ tComp: i.comprobanteTipo, nComp: i.comprobanteNumero, importe: r2(Number(i.importeImputado)) }));
    if (!imputaciones.length)
        throw new Error('la cobranza no imputa ninguna factura');
    const medios = [];
    const m = p.medios ?? {};
    if (Number(m.efectivo) > 0)
        medios.push({ cuenta: cfg.cuentas.efectivo, importe: r2(Number(m.efectivo)) });
    if (Number(m.transferencia) > 0) {
        if (!cfg.cuentas.transferencia)
            throw new Error('cobranza por transferencia sin cuenta de tesorería configurada (config/tango.sql.recibo.cuentas.transferencia)');
        medios.push({ cuenta: cfg.cuentas.transferencia, importe: r2(Number(m.transferencia)) });
    }
    if ((m.retenciones?.length ?? 0) > 0)
        throw new Error('las retenciones todavía no se escriben en Tango por SQL (pendiente de relevar)');
    // Cheques: uno o más por cuenta de cartera (papel / e-cheq). El renglón de tesorería de
    // cada cartera lleva la SUMA; cada cheque va aparte a SBA14 (ver chequeDePayload).
    const cheques = (m.cheques ?? []).map((c, i) => chequeDePayload(c, i, cfg));
    for (const cuenta of [...new Set(cheques.map((c) => c.cuenta))]) {
        medios.push({ cuenta, importe: r2(cheques.filter((c) => c.cuenta === cuenta).reduce((s, c) => s + c.importe, 0)) });
    }
    const importe = r2(Number(p.importe ?? 0));
    const sumImp = r2(imputaciones.reduce((s, i) => s + i.importe, 0));
    const sumMed = r2(medios.reduce((s, x) => s + x.importe, 0));
    if (sumImp !== importe || sumMed !== importe)
        throw new Error(`el recibo no cierra: importe ${importe}, imputado ${sumImp}, medios ${sumMed}`);
    return {
        numero, puntoVenta: cfg.puntoVenta,
        nComp: (0, tipos_1.numeroComprobanteTango)('X', cfg.puntoVenta, numero),
        codCliente: p.clienteCodigoTango, fecha: fechaDe(p.fecha), importe, imputaciones, medios, cheques,
        leyenda: p.referenciaIdempotente ?? `ROLITO:${cobranzaId}`,
    };
}
function chequeDePayload(c, i, cfg) {
    const numero = Number(String(c.numero ?? '').replace(/\D/g, ''));
    if (!numero)
        throw new Error(`cheque ${i + 1}: número inválido "${c.numero}"`);
    const importe = r2(Number(c.importe ?? 0));
    if (!(importe > 0))
        throw new Error(`cheque ${numero}: importe inválido`);
    const bancoCodigo = String(c.bancoCodigo ?? '').trim();
    if (!bancoCodigo)
        throw new Error(`cheque ${numero}: sin código de banco`);
    const fechaEmision = fechaDeIso(c.fechaEmision);
    const fechaCobro = c.fechaAcreditacion ? fechaDeIso(c.fechaAcreditacion) : fechaEmision;
    if (!fechaEmision || !fechaCobro)
        throw new Error(`cheque ${numero}: fechas inválidas (${c.fechaEmision} / ${c.fechaAcreditacion})`);
    const dias = c.dias != null ? Number(c.dias) : Math.round((fechaCobro.getTime() - fechaEmision.getTime()) / 86400000);
    const esEcheq = c.esEcheq === true;
    const cuenta = esEcheq ? cfg.cuentas.echeq : cfg.cuentas.cheques;
    if (!cuenta)
        throw new Error(`cobranza con ${esEcheq ? 'e-cheq' : 'cheque'} sin cuenta de cartera configurada (config/tango.sql.recibo.cuentas.${esEcheq ? 'echeq' : 'cheques'})`);
    return { numero, bancoCodigo, fechaEmision, fechaCobro, dias: Math.max(0, dias), importe, cuenta, esEcheq };
}
/** 'yyyy-MM-dd' → Date local a las 00:00 (como guarda Tango F_EMISION / FECHA_CHEQ). */
function fechaDeIso(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? ''));
    if (!m)
        return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function fechaDe(f) {
    if (f instanceof Date)
        return f;
    if (f && typeof f === 'object') {
        const o = f;
        if (typeof o.toDate === 'function')
            return o.toDate();
        const s = o.seconds ?? o._seconds;
        if (typeof s === 'number')
            return new Date(s * 1000);
    }
    if (typeof f === 'string' || typeof f === 'number') {
        const d = new Date(f);
        if (!isNaN(d.getTime()))
            return d;
    }
    return new Date();
}
const clave = (i) => `${i.tComp}|${i.nComp}`;
function sentenciaExisteRecibo(r) {
    return { etiqueta: 'SELECT GVA12 existe', sql: `SELECT ID_GVA12 FROM GVA12 WHERE T_COMP = 'REC' AND N_COMP = @N_COMP`, params: [(0, tipos_1.varchar)('N_COMP', r.nComp, 14)] };
}
/** Sentencias del recibo, en el orden de Tango. Puras. El ID del recibo (GVA12) se
 *  obtiene al ejecutar el primer INSERT; las que lo necesitan usan el marcador
 *  `@ID_RECIBO`, que el ejecutor resuelve (ver escribirRecibo). */
function sentenciasRecibo(r, d, cfg, ahora = new Date()) {
    const fecha = (0, tipos_1.soloDia)(r.fecha);
    const hoy = (0, tipos_1.soloDia)(ahora);
    const hora = (0, tipos_1.horaHHMMSS)(ahora);
    const term = cfg.terminal.slice(0, 12);
    const usr = cfg.usuario.slice(0, 10);
    const out = [];
    // 1. GVA12 — 39 columnas, mismos valores que la traza. NCOMP_IN_V 0 → trigger = ID_GVA12.
    out.push((0, tipos_1.insert)('INSERT GVA12', 'GVA12', [
        (0, tipos_1.smallint)('CANT_HOJAS', 1),
        (0, tipos_1.varchar)('CENT_STK', 'N', 1),
        (0, tipos_1.varchar)('CENT_COB', 'N', 1),
        (0, tipos_1.varchar)('COD_CLIENT', r.codCliente, 6),
        (0, tipos_1.varchar)('COD_VENDED', cfg.codVendedor, 10),
        (0, tipos_1.bit)('CONTFISCAL', false),
        (0, tipos_1.numeric)('COTIZ', 1),
        (0, tipos_1.varchar)('ESTADO', 'IMP', 3),
        (0, tipos_1.datetime)('FECHA_EMIS', fecha),
        (0, tipos_1.numeric)('IMPORTE', r.importe),
        (0, tipos_1.bit)('MON_CTE', true),
        (0, tipos_1.varchar)('N_COMP', r.nComp, 14),
        (0, tipos_1.numeric)('PROPINA', 0),
        (0, tipos_1.numeric)('PROPINA_EX', 0),
        (0, tipos_1.smallint)('TALONARIO', cfg.talonario),
        (0, tipos_1.varchar)('TCOMP_IN_V', 'RC', 2),
        (0, tipos_1.varchar)('TIPO_VEND', 'V', 1),
        (0, tipos_1.varchar)('T_COMP', 'REC', 3),
        (0, tipos_1.numeric)('UNIDADES', r.importe),
        (0, tipos_1.varchar)('ESTADO_UNI', 'IMP', 3),
        (0, tipos_1.varchar)('HORA_COMP', hora, 6),
        (0, tipos_1.varchar)('AFEC_CIERR', 'N', 1),
        (0, tipos_1.bit)('REBAJA_DEB', true),
        (0, tipos_1.float)('NCOMP_IN_V', 0),
        (0, tipos_1.varchar)('GENERA_ASIENTO', 'N', 1),
        (0, tipos_1.datetime)('FECHA_INGRESO', hoy),
        (0, tipos_1.varchar)('HORA_INGRESO', hora, 6),
        (0, tipos_1.varchar)('USUARIO_INGRESO', usr, 120),
        (0, tipos_1.varchar)('TERMINAL_INGRESO', term, 255),
        { nombre: 'OBS_COMERC', tipo: { kind: 'text' }, valor: null },
        { nombre: 'OBSERVAC', tipo: { kind: 'text' }, valor: null },
        (0, tipos_1.varchar)('LEYENDA_1', r.leyenda.slice(0, 60), 60),
        (0, tipos_1.varchar)('LEYENDA_2', null, 60),
        (0, tipos_1.varchar)('LEYENDA_3', null, 60),
        (0, tipos_1.varchar)('LEYENDA_4', null, 60),
        (0, tipos_1.varchar)('LEYENDA_5', null, 60),
        { nombre: 'FECHA_DESCARGA_PDF', tipo: { kind: 'datetime' }, valor: null },
        { nombre: 'HORA_DESCARGA_PDF', tipo: { kind: 'datetime' }, valor: null },
        (0, tipos_1.varchar)('USUARIO_DESCARGA_PDF', null, 120),
    ], true));
    // 2 y 3. Por factura: imputación + historial.
    r.imputaciones.forEach((imp, i) => {
        const f = d.facturas[clave(imp)];
        if (!f)
            throw new Error(`falta leer la factura ${imp.tComp} ${imp.nComp} de Tango`);
        const comunes = [
            (0, tipos_1.datetime)('FECHA_VTO', f.fechaVto),
            (0, tipos_1.datetime)('F_COMP_CAN', fecha),
            (0, tipos_1.numeric)('IMPORTE_VT', f.importe),
            (0, tipos_1.numeric)('IMPORT_CAN', imp.importe),
            (0, tipos_1.bit)('MISMO_CLIE', true),
            (0, tipos_1.varchar)('N_COMP', imp.nComp, 14),
            (0, tipos_1.varchar)('N_COMP_CAN', r.nComp, 14),
            (0, tipos_1.varchar)('T_COMP', imp.tComp, 3),
            (0, tipos_1.varchar)('T_COMP_CAN', 'REC', 3),
            (0, tipos_1.numeric)('IMP_CAN_UN', imp.importe),
            (0, tipos_1.numeric)('IMP_VT_UNI', f.unidades),
            (0, tipos_1.int)('ID_GVA12_CAN', -1), // marcador: se reemplaza por el ID del recibo al ejecutar
        ];
        out.push(marcarIdRecibo((0, tipos_1.insert)(`INSERT gva07 ${imp.nComp}`, 'gva07', comunes, true)));
        const idHist = d.ids.historial[i];
        out.push(marcarIdRecibo((0, tipos_1.insert)(`INSERT HISTORIAL_CUENTAS_CORRIENTES ${imp.nComp}`, 'HISTORIAL_CUENTAS_CORRIENTES', [
            ...(idHist != null ? [(0, tipos_1.int)('ID_HISTORIAL_CUENTAS_CORRIENTES', idHist)] : []),
            ...comunes,
            (0, tipos_1.varchar)('ORIGEN', 'Cobranzas', 100),
            (0, tipos_1.varchar)('OPERACION', 'A', 1),
            (0, tipos_1.datetime)('FECHA', ahora),
            (0, tipos_1.varchar)('USUARIO', usr, 120),
            (0, tipos_1.varchar)('TERMINAL', term, 255),
            { nombre: 'MOTIVO', tipo: { kind: 'text' }, valor: '' },
            (0, tipos_1.varchar)('ESTADO', '', 3),
            (0, tipos_1.varchar)('ESTADO_UNI', '', 3),
            (0, tipos_1.numeric)('SALDO', 0),
            (0, tipos_1.numeric)('SALDO_UNI', 0),
        ])));
    });
    // 4. Saldo del cliente (optimista).
    out.push({
        etiqueta: 'UPDATE GVA14 saldo',
        sql: `UPDATE "GVA14" SET "SALDO_CC"=@SALDO_CC,"SALDO_DOC"=@SALDO_DOC,"SALDO_D_UN"=@SALDO_D_UN,"SALDO_CC_U"=@SALDO_CC_U WHERE "ID_GVA14"=@ID_GVA14 AND "SALDO_CC"=@ANT_CC AND "SALDO_DOC"=@ANT_DOC AND "SALDO_D_UN"=@ANT_D_UN AND "SALDO_CC_U"=@ANT_CC_U`,
        params: [
            (0, tipos_1.numeric)('SALDO_CC', r2(d.cliente.saldoCc - r.importe)), (0, tipos_1.numeric)('SALDO_DOC', d.cliente.saldoDoc),
            (0, tipos_1.numeric)('SALDO_D_UN', d.cliente.saldoDUn), (0, tipos_1.numeric)('SALDO_CC_U', r2(d.cliente.saldoCcU - r.importe)),
            (0, tipos_1.int)('ID_GVA14', d.cliente.idGva14),
            (0, tipos_1.numeric)('ANT_CC', d.cliente.saldoCc), (0, tipos_1.numeric)('ANT_DOC', d.cliente.saldoDoc), (0, tipos_1.numeric)('ANT_D_UN', d.cliente.saldoDUn), (0, tipos_1.numeric)('ANT_CC_U', d.cliente.saldoCcU),
        ],
    });
    // 5. SBA04 — cabecera de tesorería.
    out.push((0, tipos_1.insert)('INSERT SBA04', 'SBA04', [
        (0, tipos_1.varchar)('FILLER', ' ', 20),
        (0, tipos_1.smallint)('BARRA', 0),
        (0, tipos_1.bit)('CERRADO', false),
        (0, tipos_1.smallint)('CLASE', 1),
        (0, tipos_1.varchar)('COD_COMP', 'REC', 3),
        (0, tipos_1.varchar)('CONCEPTO', cfg.concepto.slice(0, 20), 20),
        (0, tipos_1.numeric)('COTIZACION', 1),
        (0, tipos_1.bit)('EXPORTADO', false),
        (0, tipos_1.bit)('EXTERNO', true),
        (0, tipos_1.datetime)('FECHA', fecha),
        (0, tipos_1.datetime)('FECHA_ING', hoy),
        (0, tipos_1.varchar)('HORA_ING', hora, 6),
        (0, tipos_1.varchar)('N_COMP', r.nComp, 14),
        (0, tipos_1.float)('N_INTERNO', d.nInternoSba04),
        (0, tipos_1.bit)('PASE', false),
        (0, tipos_1.varchar)('SITUACION', 'N', 1),
        (0, tipos_1.varchar)('TERMINAL', term, 12),
        (0, tipos_1.varchar)('USUARIO', usr, 10),
        (0, tipos_1.smallint)('BARRA_ORI', 0),
        (0, tipos_1.datetime)('FECHA_EMIS', fecha),
        (0, tipos_1.varchar)('GENERA_ASIENTO', 'S', 1),
        (0, tipos_1.int)('ID_GVA81', null),
        (0, tipos_1.int)('ID_SBA02', cfg.idSba02Recibo),
        (0, tipos_1.varchar)('COD_GVA14', r.codCliente, 6),
        (0, tipos_1.varchar)('COD_CPA01', null, 1),
        (0, tipos_1.int)('ID_CODIGO_RELACION', null),
        (0, tipos_1.int)('ID_LEGAJO', null),
        (0, tipos_1.varchar)('TIPO_COD_RELACIONADO', 'C', 1),
        (0, tipos_1.varchar)('CN_ASTOR', 'S', 1),
        (0, tipos_1.numeric)('TOTAL_IMPORTE_CTE', r.importe),
        (0, tipos_1.numeric)('TOTAL_IMPORTE_EXT', r.importe),
        (0, tipos_1.varchar)('TRANSFERENCIA_DEVOLUCION_CUPONES', 'N', 1),
    ], true));
    // 6. SBA05 — renglón 0 contracuenta 'H', luego un renglón 'D' por medio.
    const renglones = [
        { cuenta: cfg.cuentas.contracuenta, dh: 'H', importe: r.importe },
        ...r.medios.map((m) => ({ cuenta: m.cuenta, dh: 'D', importe: m.importe })),
    ];
    renglones.forEach((ren, i) => {
        out.push((0, tipos_1.insert)(`INSERT SBA05 ${ren.cuenta} ${ren.dh}`, 'SBA05', [
            (0, tipos_1.smallint)('BARRA', 0),
            (0, tipos_1.numeric)('CANT_MONE', ren.importe),
            (0, tipos_1.smallint)('CLASE', 1),
            (0, tipos_1.varchar)('COD_COMP', 'REC', 3),
            (0, tipos_1.float)('COD_CTA', ren.cuenta),
            (0, tipos_1.varchar)('COD_OPERAC', '', 1),
            (0, tipos_1.numeric)('COTIZ_MONE', 1),
            (0, tipos_1.varchar)('D_H', ren.dh, 1),
            (0, tipos_1.datetime)('FECHA', fecha),
            (0, tipos_1.varchar)('LEYENDA', '', 1),
            (0, tipos_1.numeric)('MONTO', ren.importe),
            (0, tipos_1.varchar)('N_COMP', r.nComp, 14),
            (0, tipos_1.int)('RENGLON', i),
            (0, tipos_1.numeric)('UNIDADES', ren.importe),
            (0, tipos_1.varchar)('VA_DIRECTO', 'N', 1),
            (0, tipos_1.int)('ID_SBA02', cfg.idSba02Recibo),
            (0, tipos_1.int)('ID_GVA81', null),
            (0, tipos_1.varchar)('COMENTARIO', '', 1),
            (0, tipos_1.varchar)('COMENTARIO_EFT', '', 1),
            (0, tipos_1.varchar)('COD_GVA14', r.codCliente, 6),
            (0, tipos_1.varchar)('COD_CPA01', null, 1),
            (0, tipos_1.int)('ID_CODIGO_RELACION', null),
            (0, tipos_1.int)('ID_LEGAJO', null),
            (0, tipos_1.varchar)('TIPO_COD_RELACIONADO', 'C', 1),
            (0, tipos_1.int)('ID_SBA11', null),
        ], true));
    });
    // 7. Cotización del comprobante.
    out.push((0, tipos_1.insert)('INSERT COMPROBANTE_COTIZACION_SB', 'COMPROBANTE_COTIZACION_SB', [
        ...(d.ids.cotizacion != null ? [(0, tipos_1.int)('ID_COMPROBANTE_COTIZACION_SB', d.ids.cotizacion)] : []),
        (0, tipos_1.int)('ID_MONEDA', 2), (0, tipos_1.int)('ID_TIPO_COTIZACION', 1), (0, tipos_1.numeric)('COTIZACION', 1, 17, 7),
        (0, tipos_1.int)('ID_SBA02', cfg.idSba02Recibo), (0, tipos_1.varchar)('N_COMP', r.nComp, 14), (0, tipos_1.smallint)('BARRA', 0),
    ]));
    // 7b. Cheques de terceros: SBA14 (cartera) + SBA23 (historial) + vínculo con el renglón de
    //     tesorería de su cuenta (MOVIMIENTO_CHEQUE_TERCERO, resuelto al ejecutar). Traza del 2026-09-05.
    r.cheques.forEach((ch, i) => {
        const dc = d.cheques?.[i];
        if (!dc)
            throw new Error(`falta leer los datos del cheque ${ch.numero} (nº interno / banco)`);
        const cuit = (d.cliente.cuit ?? '').slice(0, 13);
        const razon = (d.cliente.razonSocial ?? '').slice(0, 60);
        out.push(marcarIdSba14((0, tipos_1.insert)(`INSERT SBA14 cheque ${ch.numero}`, 'SBA14', [
            (0, tipos_1.smallint)('BARRA_REC', 0), (0, tipos_1.smallint)('BARRA_RECH', 0), (0, tipos_1.smallint)('BARRA_SAL', 0),
            (0, tipos_1.varchar)('CLIENTE', r.codCliente, 6),
            (0, tipos_1.float)('CTA_CARTER', ch.cuenta), (0, tipos_1.float)('CTA_DESTIN', 0), (0, tipos_1.float)('CTA_RECEP', ch.cuenta),
            (0, tipos_1.varchar)('CUENTA_TIP', 'C', 1),
            (0, tipos_1.smallint)('DIAS', ch.dias),
            (0, tipos_1.varchar)('ESTADO', 'C', 1), // C = en cartera
            (0, tipos_1.datetime)('F_EMISION', (0, tipos_1.soloDia)(ch.fechaEmision)),
            (0, tipos_1.datetime)('FECHA_CHEQ', (0, tipos_1.soloDia)(ch.fechaCobro)),
            (0, tipos_1.datetime)('FECHA_REC', fecha),
            (0, tipos_1.datetime)('FECHA_RECH', tipos_1.FECHA_NULA_TANGO), (0, tipos_1.datetime)('FECHA_SAL', tipos_1.FECHA_NULA_TANGO),
            (0, tipos_1.numeric)('IMPORTE_CH', ch.importe),
            (0, tipos_1.float)('N_CHEQUE', ch.numero),
            (0, tipos_1.varchar)('N_COMP_REC', r.nComp, 14), (0, tipos_1.varchar)('N_COMP_RCH', '', 1), (0, tipos_1.varchar)('N_COMP_SAL', '', 1),
            (0, tipos_1.varchar)('N_CUIT', cuit, 13),
            (0, tipos_1.float)('N_INTERNO', dc.nInterno),
            (0, tipos_1.varchar)('REGISTRADO', 'N', 1),
            (0, tipos_1.varchar)('T_COMP_REC', 'REC', 3), (0, tipos_1.varchar)('T_COMP_RCH', '', 1), (0, tipos_1.varchar)('T_COMP_SAL', '', 1),
            (0, tipos_1.varchar)('TIPO_CHEQU', ch.dias > 0 ? 'D' : 'C', 1), // D = diferido, C = común
            (0, tipos_1.varchar)('TIPO_SAL', '', 1),
            (0, tipos_1.smallint)('ULT_BARRA', 0), (0, tipos_1.varchar)('ULT_N_COMP', r.nComp, 14), (0, tipos_1.varchar)('ULT_T_COMP', 'REC', 3),
            (0, tipos_1.bit)('EXPORTADO', false),
            (0, tipos_1.smallint)('NRO_SUCURS', d.nroSucursalCheques ?? 0),
            (0, tipos_1.float)('N_INT_ORI', dc.nInterno),
            (0, tipos_1.int)('ID_BANCO', dc.idBanco),
            (0, tipos_1.int)('ID_SBA02_REC', cfg.idSba02Recibo), (0, tipos_1.int)('ID_SBA02_ULT', cfg.idSba02Recibo),
            (0, tipos_1.bit)('CONCILIADO_SAL', false), (0, tipos_1.varchar)('COMENTARIO_SAL', '', 1),
            (0, tipos_1.bit)('CONCILIADO_RECH', false), (0, tipos_1.varchar)('COMENTARIO_RECH', '', 1),
            (0, tipos_1.varchar)('COD_GVA14', r.codCliente, 6),
            (0, tipos_1.varchar)('RAZON_EMIS', razon, 60),
        ], true), i));
        out.push((0, tipos_1.insert)(`INSERT SBA23 cheque ${ch.numero}`, 'SBA23', [
            (0, tipos_1.smallint)('BARRA', 0), (0, tipos_1.varchar)('CLIENTE', r.codCliente, 6), (0, tipos_1.varchar)('ESTADO', 'C', 1),
            (0, tipos_1.datetime)('FECHA_MOV', fecha), (0, tipos_1.varchar)('HORA_MOV', hora.slice(0, 4), 4),
            (0, tipos_1.varchar)('N_COMP', r.nComp, 14), (0, tipos_1.float)('N_INTERNO', dc.nInterno), (0, tipos_1.varchar)('T_COMP', 'REC', 3),
            (0, tipos_1.varchar)('USUARIO', usr, 10),
        ], true));
        out.push(marcarVinculoCheque((0, tipos_1.insert)(`INSERT MOVIMIENTO_CHEQUE_TERCERO cheque ${ch.numero}`, 'MOVIMIENTO_CHEQUE_TERCERO', [
            (0, tipos_1.int)('ID_SBA14', -1), (0, tipos_1.int)('ID_SBA05', -1), (0, tipos_1.varchar)('TIPO_MOVIMIENTO', 'INGR', 4),
        ], true), i, ch.cuenta));
    });
    // 8. Saldos de las cuentas: 'D' suma, 'H' resta (así se movieron en la traza).
    for (const ren of renglones) {
        const c = d.cuentas[String(ren.cuenta)];
        if (!c)
            throw new Error(`falta leer la cuenta de tesorería ${ren.cuenta} (SBA01)`);
        const delta = ren.dh === 'D' ? ren.importe : -ren.importe;
        out.push({
            etiqueta: `UPDATE SBA01 saldo ${ren.cuenta}`,
            sql: `UPDATE "SBA01" SET "SALDO_A_MO"=@MO,"SALDO_A_UN"=@UN,"SALDO_ACT"=@ACT WHERE "SALDO_A_MO"=@ANT_MO AND "SALDO_A_UN"=@ANT_UN AND "SALDO_ACT"=@ANT_ACT AND "ID_SBA01"=@ID`,
            params: [
                (0, tipos_1.numeric)('MO', r2(c.saldoAMo + delta)), (0, tipos_1.numeric)('UN', r2(c.saldoAUn + delta)), (0, tipos_1.numeric)('ACT', r2(c.saldoAct + delta)),
                (0, tipos_1.numeric)('ANT_MO', c.saldoAMo), (0, tipos_1.numeric)('ANT_UN', c.saldoAUn), (0, tipos_1.numeric)('ANT_ACT', c.saldoAct), (0, tipos_1.int)('ID', c.idSba01),
            ],
        });
    }
    // 9. Asiento contable del movimiento de tesorería.
    const idAc = d.ids.asientoComprobante;
    out.push((0, tipos_1.insert)('INSERT ASIENTO_COMPROBANTE_SB', 'ASIENTO_COMPROBANTE_SB', [
        ...(idAc != null ? [(0, tipos_1.int)('ID_ASIENTO_COMPROBANTE_SB', idAc)] : []),
        (0, tipos_1.float)('N_INTERNO', d.nInternoSba04), (0, tipos_1.varchar)('ASIENTO_ANULACION', 'N', 1), (0, tipos_1.varchar)('CONTABILIZADO', 'S', 1),
        (0, tipos_1.varchar)('USUARIO_CONTABILIZACION', usr, 10), (0, tipos_1.datetime)('FECHA_CONTABILIZACION', ahora), (0, tipos_1.varchar)('TERMINAL_CONTABILIZACION', term, 12),
        (0, tipos_1.varchar)('TRANSFERIDO_CN', 'N', 1),
    ], idAc == null));
    renglones.forEach((ren, i) => {
        const idCuenta = cfg.cuentasContables[String(ren.cuenta)];
        if (!idCuenta)
            throw new Error(`la cuenta de tesorería ${ren.cuenta} no tiene cuenta contable en config/tango.sql.recibo.cuentasContables`);
        const idRen = d.ids.asientoRenglones[i];
        out.push(marcarIdAsiento((0, tipos_1.insert)(`INSERT ASIENTO_SB ${ren.cuenta}`, 'ASIENTO_SB', [
            ...(idRen != null ? [(0, tipos_1.int)('ID_ASIENTO_SB', idRen)] : []),
            (0, tipos_1.int)('ID_ASIENTO_COMPROBANTE_SB', idAc ?? -1),
            (0, tipos_1.int)('NRO_RENGLON_ASIENTO_SB', i + 1), (0, tipos_1.int)('ID_CUENTA', idCuenta), (0, tipos_1.varchar)('D_H', ren.dh, 1),
            { nombre: 'IMPORTE_RENGLON_BASE_SB', tipo: { kind: 'numeric', precision: 19, scale: 4 }, valor: ren.importe },
            { nombre: 'IMPORTE_RENGLON_ALTER_SB', tipo: { kind: 'numeric', precision: 19, scale: 4 }, valor: ren.importe },
            (0, tipos_1.varchar)('EDITA_CUENTA', ren.dh === 'H' ? 'N' : 'S', 1),
        ]), idAc == null));
    });
    return out;
}
const marcarIdRecibo = (s) => ({ ...s, necesitaIdRecibo: true });
const marcarIdAsiento = (s, si) => (si ? { ...s, necesitaIdAsiento: true } : s);
const marcarIdSba14 = (s, chequeIdx) => ({ ...s, chequeIdx });
const marcarVinculoCheque = (s, vinculaCheque, cuentaCartera) => ({ ...s, vinculaCheque, cuentaCartera });
/** Lee de Tango lo que hace falta. Consultas marcadas (*) = hipótesis a confirmar (§21.3). */
async function leerDatosRecibo(db, r, cfg, identity) {
    const cli = await db.query(`SELECT ID_GVA14, SALDO_CC, SALDO_DOC, SALDO_D_UN, SALDO_CC_U FROM GVA14 WHERE COD_GVA14 = @COD`, [(0, tipos_1.varchar)('COD', r.codCliente, 6)]);
    if (!cli.length)
        throw new Error(`cliente ${r.codCliente} no existe en Tango`);
    const c = cli[0];
    const facturas = {};
    for (const imp of r.imputaciones) {
        const f = await db.query(`SELECT ID_GVA12, IMPORTE, UNIDADES, COD_CLIENT FROM GVA12 WHERE T_COMP = @T AND N_COMP = @N`, [(0, tipos_1.varchar)('T', imp.tComp, 3), (0, tipos_1.varchar)('N', imp.nComp, 14)]);
        if (!f.length)
            throw new Error(`la factura ${imp.tComp} ${imp.nComp} no existe en Tango`);
        if (f[0].COD_CLIENT.trim() !== r.codCliente)
            throw new Error(`la factura ${imp.nComp} es del cliente ${f[0].COD_CLIENT}, no de ${r.codCliente}`);
        // (*) vencimiento: el primero pendiente en GVA46; si no hay, la fecha del recibo.
        let fechaVto = (0, tipos_1.soloDia)(r.fecha);
        try {
            const v = await db.query(`SELECT TOP 1 FECHA_VTO FROM GVA46 WHERE T_COMP = @T AND N_COMP = @N ORDER BY CASE WHEN ESTADO_VTO = 'PEN' THEN 0 ELSE 1 END, FECHA_VTO`, [(0, tipos_1.varchar)('T', imp.tComp, 3), (0, tipos_1.varchar)('N', imp.nComp, 14)]);
            if (v.length && v[0].FECHA_VTO)
                fechaVto = new Date(v[0].FECHA_VTO);
        }
        catch { /* sin GVA46 → fecha del recibo */ }
        facturas[clave(imp)] = { idGva12: f[0].ID_GVA12, importe: Number(f[0].IMPORTE), unidades: Number(f[0].UNIDADES), fechaVto };
    }
    const cuentas = {};
    for (const cod of [cfg.cuentas.contracuenta, ...r.medios.map((m) => m.cuenta)]) {
        const q = await db.query(`SELECT ID_SBA01, SALDO_A_MO, SALDO_A_UN, SALDO_ACT FROM SBA01 WHERE COD_CTA = @COD`, [(0, tipos_1.float)('COD', cod)]);
        if (!q.length)
            throw new Error(`la cuenta de tesorería ${cod} no existe en Tango (SBA01)`);
        cuentas[String(cod)] = { idSba01: q[0].ID_SBA01, saldoAMo: Number(q[0].SALDO_A_MO), saldoAUn: Number(q[0].SALDO_A_UN), saldoAct: Number(q[0].SALDO_ACT) };
    }
    const nInternoSba04 = await siguiente(db, 'SBA04', 'N_INTERNO');
    // Cheques: CUIT y razón social del cliente (el librador, como lo precarga la pantalla),
    // ID_BANCO por código BCRA, sucursal y nº interno de cada cheque.
    let cliCheques = {};
    let cheques;
    let nroSucursalCheques;
    if (r.cheques.length) {
        for (const t of ['SBA14', 'SBA23', 'MOVIMIENTO_CHEQUE_TERCERO']) {
            if (!identity.has(t))
                throw new Error(`${t} no tiene columna IDENTITY: hay que relevar cómo asigna Tango su id antes de escribir cheques`);
        }
        try {
            const q = await db.query(`SELECT CUIT, RAZON_SOCI FROM GVA14 WHERE COD_GVA14 = @COD`, [(0, tipos_1.varchar)('COD', r.codCliente, 6)]);
            cliCheques = { cuit: (q[0]?.CUIT ?? '').trim(), razonSocial: (q[0]?.RAZON_SOCI ?? '').trim() };
        }
        catch {
            cliCheques = {};
        }
        nroSucursalCheques = cfg.cheques?.nroSucursal;
        if (nroSucursalCheques == null) {
            const s = await db.query(`SELECT TOP 1 NRO_SUCURS AS N FROM SBA14 ORDER BY ID_SBA14 DESC`);
            nroSucursalCheques = Number(s[0]?.N ?? 0) || 0;
        }
        const tabla = cfg.cheques?.tablaBancos ?? 'BANCO';
        const col = cfg.cheques?.columnaCodigoBanco ?? 'COD_BANCO';
        cheques = [];
        for (const ch of r.cheques) {
            let idBanco = cfg.cheques?.bancos?.[ch.bancoCodigo];
            if (idBanco == null) {
                const b = await db.query(`SELECT ID_BANCO FROM ${tabla} WHERE ${col} = @COD`, [(0, tipos_1.varchar)('COD', ch.bancoCodigo, 10)]);
                if (!b.length)
                    throw new Error(`el banco ${ch.bancoCodigo} del cheque ${ch.numero} no existe en Tango (${tabla}.${col}); cargarlo o mapearlo en config/tango.sql.recibo.cheques.bancos`);
                idBanco = Number(b[0].ID_BANCO);
            }
            cheques.push({ nInterno: await siguiente(db, 'SBA14', 'N_INTERNO'), idBanco });
        }
    }
    const ids = {
        historial: await Promise.all(r.imputaciones.map(() => identity.has('HISTORIAL_CUENTAS_CORRIENTES') ? null : siguiente(db, 'HISTORIAL_CUENTAS_CORRIENTES', 'ID_HISTORIAL_CUENTAS_CORRIENTES'))),
        cotizacion: identity.has('COMPROBANTE_COTIZACION_SB') ? null : await siguiente(db, 'COMPROBANTE_COTIZACION_SB', 'ID_COMPROBANTE_COTIZACION_SB'),
        asientoComprobante: identity.has('ASIENTO_COMPROBANTE_SB') ? null : await siguiente(db, 'ASIENTO_COMPROBANTE_SB', 'ID_ASIENTO_COMPROBANTE_SB'),
        asientoRenglones: [],
    };
    const nRenglones = 1 + r.medios.length;
    for (let i = 0; i < nRenglones; i++)
        ids.asientoRenglones.push(identity.has('ASIENTO_SB') ? null : await siguiente(db, 'ASIENTO_SB', 'ID_ASIENTO_SB'));
    return {
        cliente: { idGva14: c.ID_GVA14, saldoCc: Number(c.SALDO_CC), saldoDoc: Number(c.SALDO_DOC), saldoDUn: Number(c.SALDO_D_UN), saldoCcU: Number(c.SALDO_CC_U), ...cliCheques },
        facturas, cuentas, nInternoSba04, ids, cheques, nroSucursalCheques,
    };
}
/**
 * Próximo valor de un id/contador de Tango, en este orden:
 *  1. Si la columna tiene DEFAULT `NEXT VALUE FOR SEQUENCE_x` (Delta 6: HISTORIAL_CUENTAS_CORRIENTES,
 *     COMPROBANTE_COTIZACION_SB, ASIENTO_COMPROBANTE_SB y ASIENTO_SB — script 04), se pide a esa
 *     secuencia. Si el login no tiene UPDATE sobre la secuencia el error sale tal cual (nunca se
 *     cae a MAX+1: chocaría con Tango más adelante).
 *  2. dbo.INCREMENTAL_VALUE (como hace Tango con SBA04.N_INTERNO).
 *  3. MAX+1 (último recurso, solo si no hay ni secuencia ni contador).
 */
async function siguiente(db, tabla, campo) {
    const def = await db.query(`SELECT dc.definition AS D FROM sys.columns c JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id WHERE c.object_id = OBJECT_ID(@T) AND c.name = @C`, [(0, tipos_1.varchar)('T', tabla, 128), (0, tipos_1.varchar)('C', campo, 128)]);
    let seq = def[0]?.D ? /NEXT VALUE FOR \[?(?:dbo\]?\.\[?)?(\w+)\]?/i.exec(def[0].D)?.[1] : undefined;
    if (!seq) {
        // El login del servicio puede no ver la definición del DEFAULT (visibilidad de metadata);
        // Tango nombra las secuencias SEQUENCE_<tabla>, y con UPDATE sobre ellas sí aparecen en sys.sequences.
        const porNombre = await db.query(`SELECT name FROM sys.sequences WHERE name = @S`, [(0, tipos_1.varchar)('S', `SEQUENCE_${tabla.toUpperCase()}`, 128)]);
        seq = porNombre[0]?.name;
    }
    if (seq) {
        const v = await db.query(`SELECT NEXT VALUE FOR [${seq}] AS V`);
        if (v[0]?.V == null)
            throw new Error(`la secuencia ${seq} (${tabla}.${campo}) no devolvió valor`);
        return Number(v[0].V);
    }
    const inc = await db.query(`SELECT UltimoValor FROM dbo.INCREMENTAL_VALUE WHERE Tabla = @T AND Campo = @C`, [(0, tipos_1.varchar)('T', tabla, 50), (0, tipos_1.varchar)('C', campo, 50)]);
    if (inc.length) {
        const ultimo = Number(inc[0].UltimoValor), sig = ultimo + 1;
        const upd = await db.query(`UPDATE dbo.INCREMENTAL_VALUE SET UltimoValor = @V WHERE Tabla = @T AND Campo = @C AND UltimoValor = @ANT`, [(0, tipos_1.int)('V', sig), (0, tipos_1.varchar)('T', tabla, 50), (0, tipos_1.varchar)('C', campo, 50), (0, tipos_1.int)('ANT', ultimo)]);
        if (upd[0]?.affected === 0)
            throw new Error(`contador ${tabla}.${campo} cambió mientras se reservaba; se reintenta`);
        return sig;
    }
    const mx = await db.query(`SELECT MAX(${campo}) AS M FROM ${tabla}`);
    return (Number(mx[0]?.M ?? 0) || 0) + 1;
}
/** Columnas IDENTITY de las tablas del recibo (consulta (a) §21.3), para no mandar ids explícitos donde SQL Server los asigna. */
async function tablasConIdentity(db) {
    const rows = await db.query(`SELECT OBJECT_NAME(object_id) AS tabla FROM sys.identity_columns WHERE OBJECT_NAME(object_id) IN ('GVA12','GVA07','HISTORIAL_CUENTAS_CORRIENTES','SBA04','SBA05','COMPROBANTE_COTIZACION_SB','ASIENTO_COMPROBANTE_SB','ASIENTO_SB','SBA14','SBA23','MOVIMIENTO_CHEQUE_TERCERO')`);
    return new Set(rows.map((x) => x.tabla.toUpperCase()));
}
async function escribirRecibo(db, r, cfg, log = () => undefined) {
    const ex = sentenciaExisteRecibo(r);
    const existe = await db.query(ex.sql, ex.params);
    if (existe.length) {
        log(`recibo ${r.nComp} ya estaba en Tango (ID_GVA12 ${existe[0].ID_GVA12}); no se reescribe`);
        return { yaExistia: true, idGva12: existe[0].ID_GVA12, nComp: r.nComp, nInternoSba04: null };
    }
    const identity = await tablasConIdentity(db);
    const datos = await leerDatosRecibo(db, r, cfg, identity);
    let idGva12 = null;
    let idAsiento = datos.ids.asientoComprobante;
    const idSba05PorCuenta = new Map(); // renglón 'D' de cada cuenta de cartera
    const idSba14PorCheque = new Map(); // índice del cheque → ID_SBA14
    for (const s of sentenciasRecibo(r, datos, cfg)) {
        const params = s.params.map((p) => {
            if (s.necesitaIdRecibo && p.nombre === 'ID_GVA12_CAN')
                return { ...p, valor: idGva12 };
            if (s.necesitaIdAsiento && p.nombre === 'ID_ASIENTO_COMPROBANTE_SB')
                return { ...p, valor: idAsiento };
            if (s.vinculaCheque != null && p.nombre === 'ID_SBA14')
                return { ...p, valor: idSba14PorCheque.get(s.vinculaCheque) ?? null };
            if (s.cuentaCartera != null && p.nombre === 'ID_SBA05')
                return { ...p, valor: idSba05PorCuenta.get(s.cuentaCartera) ?? null };
            return p;
        });
        if (s.necesitaIdRecibo && idGva12 == null)
            throw new Error('no se obtuvo el ID_GVA12 del recibo');
        if (s.vinculaCheque != null && (params.find((p) => p.nombre === 'ID_SBA14')?.valor == null || params.find((p) => p.nombre === 'ID_SBA05')?.valor == null)) {
            throw new Error(`${s.etiqueta}: no se obtuvo el ID_SBA14 del cheque o el ID_SBA05 del renglón de cartera ${s.cuentaCartera}`);
        }
        const filas = await db.query(s.sql, params);
        log(s.etiqueta);
        if (s.etiqueta === 'INSERT GVA12' && filas[0]?.ID != null)
            idGva12 = Number(filas[0].ID);
        if (s.etiqueta === 'INSERT ASIENTO_COMPROBANTE_SB' && idAsiento == null && filas[0]?.ID != null)
            idAsiento = Number(filas[0].ID);
        const renglonD = /^INSERT SBA05 (\d+) D$/.exec(s.etiqueta);
        if (renglonD && filas[0]?.ID != null)
            idSba05PorCuenta.set(Number(renglonD[1]), Number(filas[0].ID));
        if (s.chequeIdx != null && filas[0]?.ID != null)
            idSba14PorCheque.set(s.chequeIdx, Number(filas[0].ID));
        if (s.etiqueta.startsWith('UPDATE') && filas[0]?.affected === 0)
            throw new Error(`${s.etiqueta}: el saldo cambió mientras se grababa el recibo; se reintenta`);
    }
    const res = { yaExistia: false, idGva12, nComp: r.nComp, nInternoSba04: datos.nInternoSba04 };
    if (r.cheques.length)
        res.cheques = r.cheques.map((c, i) => ({ numero: c.numero, idSba14: idSba14PorCheque.get(i) ?? null, nInterno: datos.cheques?.[i]?.nInterno ?? null }));
    return res;
}
//# sourceMappingURL=recibo.js.map