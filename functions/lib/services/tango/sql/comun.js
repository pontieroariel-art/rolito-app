"use strict";
// Piezas compartidas por los writers de STOCK directo en la base de Tango
// (remito de ventas y movimientos de stock: egreso / transferencia). Las
// tablas son las mismas (STA14 cabecera, STA20 renglones, STA19 saldos): lo
// que cambia entre un remito y una transferencia son los valores de una
// docena de columnas, así que la cabecera y el renglón se arman acá una sola
// vez y cada writer pasa lo suyo. Los valores por defecto son los de las
// trazas y muestras reales (docs/tango/sql/traza-remito-2026-09-04.txt y
// muestras-stock-2026-09-04.json).
Object.defineProperty(exports, "__esModule", { value: true });
exports.nombreDePlanta = exports.redondear7 = void 0;
exports.fechaDePayload = fechaDePayload;
exports.siguienteNcompInS = siguienteNcompInS;
exports.referenciaVenta = referenciaVenta;
exports.numeroInternoDe = numeroInternoDe;
exports.leyendaQuienVende = leyendaQuienVende;
exports.usuarioCorto = usuarioCorto;
exports.renglonesDeItems = renglonesDeItems;
exports.numeroComprobanteStock = numeroComprobanteStock;
exports.cabeceraSta14 = cabeceraSta14;
exports.renglonSta20 = renglonSta20;
exports.updateSta19 = updateSta19;
exports.insertSta19 = insertSta19;
exports.leerArticulo = leerArticulo;
exports.leerStock = leerStock;
const tipos_1 = require("./tipos");
/** Timestamp de Firestore (admin o cliente), Date, ISO o epoch → Date. Sin dato: ahora. */
function fechaDePayload(f) {
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
/** Las cantidades de Tango son numeric(22,7): se redondea a 7 decimales para que el WHERE optimista compare igual. */
const redondear7 = (n) => Math.round(n * 1e7) / 1e7;
exports.redondear7 = redondear7;
/**
 * Próximo número interno de stock (STA14.NCOMP_IN_S, 8 dígitos). Tango lo toma
 * como MAX + 1 dentro del tipo interno (traza del 2026-09-05: el egreso VS y la
 * transferencia TI leen "TOP 1 ... WHERE TCOMP_IN_S = X ORDER BY NCOMP_IN_S DESC").
 * Para el remito se conserva el contador INCREMENTAL_VALUE si existe
 * (`usarContador`), como estaba probado en producción.
 */
async function siguienteNcompInS(db, tcompInS, usarContador = true) {
    if (usarContador)
        try {
            const inc = await db.query(`SELECT UltimoValor FROM dbo.INCREMENTAL_VALUE WHERE Tabla = 'STA14' AND Campo = 'NCOMP_IN_S'`);
            if (inc.length) {
                const siguiente = Number(inc[0].UltimoValor) + 1;
                await db.query(`UPDATE dbo.INCREMENTAL_VALUE SET UltimoValor = @V WHERE Tabla = 'STA14' AND Campo = 'NCOMP_IN_S' AND UltimoValor = @ANT`, [(0, tipos_1.int)('V', siguiente), (0, tipos_1.int)('ANT', Number(inc[0].UltimoValor))]);
                return String(siguiente).padStart(8, '0');
            }
        }
        catch { /* sin tabla de contadores → MAX+1 */ }
    const mx = await db.query(`SELECT MAX(NCOMP_IN_S) AS MAXN FROM STA14 WHERE TCOMP_IN_S = @T`, [(0, tipos_1.varchar)('T', tcompInS, 2)]);
    return String((Number(mx[0]?.MAXN ?? '0') || 0) + 1).padStart(8, '0');
}
/**
 * Referencia idempotente de una venta en Tango ('ROLITO:VC:<id>' camión,
 * 'ROLITO:VV:<id>' ventanilla). Misma regla que pedido.ts (referenciaPedido);
 * duplicada acá porque esta carpeta se copia sola al servidor (C:RolitoSyncsqllib).
 */
function referenciaVenta(origenColeccion, origenId) {
    return `ROLITO:${origenColeccion === 'ventasVentanilla' ? 'VV' : 'VC'}:${origenId}`;
}
/** "00003-00000120" del comprobante interno de la app, o null si salió sin numerar. */
function numeroInternoDe(ci) {
    if (!ci || typeof ci.numero !== 'number')
        return null;
    return `${String(ci.puntoVenta ?? 0).padStart(5, '0')}-${String(ci.numero).padStart(8, '0')}`;
}
// ── Quién vendió / cobró (2026-09-09) ────────────────────────────────────────
// El VENDEDOR de los comprobantes es el supervisor del cliente (ficha de Tango).
// La persona que hizo la operación (cajero de ventanilla, chofer, supervisor)
// queda en una leyenda y en el USUARIO del comprobante. Mismos textos que
// pedido.ts (quienVende); duplicados porque esta carpeta se copia sola a la VM.
const NOMBRE_PLANTA = { torcuato: 'Torcuato', merlo: 'Merlo' };
const nombreDePlanta = (plantaId) => NOMBRE_PLANTA[plantaId ?? ''] ?? (plantaId ?? '');
exports.nombreDePlanta = nombreDePlanta;
/** "Caja Nicolas Diaz - Torcuato" (ventanilla) | "Chofer Pedro - dep 21" (camión). */
function leyendaQuienVende(p, sufijo) {
    if (p.cajaId)
        return `Caja ${p.cajaNombre ?? p.cajaId} - ${sufijo}`.trim();
    return `Chofer ${p.choferNombre ?? p.choferId ?? ''} - ${sufijo}`.trim();
}
/**
 * Usuario de Tango (STA14.USUARIO, varchar 10) a partir del nombre de una
 * persona: inicial + apellido, mayúsculas, sin acentos ("Nicolas Diaz" → NDIAZ,
 * "Juan Cruz Vañek" → JVANEK). Sin nombre → el fallback (el usuario fijo de config).
 */
function usuarioCorto(nombre, fallback = 'ROLITO') {
    const limpio = String(nombre ?? '').normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').trim();
    if (!limpio)
        return fallback;
    const partes = limpio.split(/\s+/);
    const corto = partes.length >= 2 ? `${partes[0][0]}${partes[partes.length - 1]}` : partes[0];
    return corto.slice(0, 10) || fallback;
}
/**
 * Renglones de stock a partir de listas de ítems de la app (items, cambios…),
 * agregados por artículo REAL de Tango. Un cambio viene como `cambio_<producto>`:
 * si no tiene mapeo propio cae al del producto (la bolsa que se repone es la
 * misma que se vende). Mapeo = config/tango.articulos.
 */
function renglonesDeItems(listas, articulos) {
    const acum = new Map();
    for (const lista of listas) {
        for (const it of lista ?? []) {
            const cantidad = Number(it.cantidad);
            if (!(cantidad > 0))
                continue;
            let cod = articulos[it.productoId];
            if (!cod && it.productoId.startsWith('cambio_'))
                cod = articulos[it.productoId.slice('cambio_'.length)];
            if (!cod)
                throw new Error(`producto ${it.productoId} sin artículo de Tango en config/tango.articulos`);
            acum.set(cod, (0, exports.redondear7)((acum.get(cod) ?? 0) + cantidad));
        }
    }
    return [...acum.entries()].map(([codArticu, cantidad]) => ({ codArticu, cantidad }));
}
/**
 * Número de un comprobante de STOCK como lo guarda Tango en STA14.N_COMP
 * (varchar 14): un ESPACIO + sucursal del talonario (5) + número (8), por ejemplo
 * ' 0090000000001' (traza del 2026-09-05, igual en el egreso VPR y en la
 * transferencia TRA). Los que grababa Bluesoft usaban 4 dígitos de sucursal y sin
 * espacio; el ancho queda parametrizado por si hace falta leerlos.
 */
function numeroComprobanteStock(sucursal, numero, anchoSucursal = 5) {
    return `${anchoSucursal === 5 ? ' ' : ''}${String(sucursal).padStart(anchoSucursal, '0')}${String(numero).padStart(8, '0')}`;
}
/** INSERT STA14 con las 60 columnas que graba Tango (misma lista y orden que la traza del remito). */
function cabeceraSta14(c) {
    const fechaMov = (0, tipos_1.soloDia)(c.fecha);
    const hoy = (0, tipos_1.soloDia)(c.ahora);
    const hora = (0, tipos_1.horaHHMMSS)(c.ahora);
    const ley = (i) => {
        const v = (c.leyendas[i - 1] ?? '').slice(0, 60);
        return (0, tipos_1.varchar)(`LEYENDA${i}`, v, v ? 60 : 1);
    };
    const obs = (c.observacion ?? '').slice(0, 60);
    return (0, tipos_1.insert)('INSERT STA14', 'STA14', [
        (0, tipos_1.varchar)('FILLER', '', 1),
        (0, tipos_1.varchar)('COD_PRO_CL', c.codCliente ?? '', c.codCliente ? 6 : 1),
        (0, tipos_1.numeric)('COTIZ', 1),
        (0, tipos_1.varchar)('ESTADO_MOV', c.estadoMov ?? '', 1),
        (0, tipos_1.bit)('EXPORTADO', false),
        (0, tipos_1.bit)('EXP_STOCK', false),
        (0, tipos_1.datetime)('FECHA_ANU', tipos_1.FECHA_NULA_TANGO),
        (0, tipos_1.datetime)('FECHA_MOV', fechaMov),
        (0, tipos_1.varchar)('HORA', '0000', 4),
        (0, tipos_1.smallint)('LISTA_REM', 0),
        (0, tipos_1.float)('LOTE', 0),
        (0, tipos_1.float)('LOTE_ANU', 0),
        (0, tipos_1.bit)('MON_CTE', true),
        (0, tipos_1.varchar)('MOTIVO_REM', c.motivoRem ?? '', 1),
        (0, tipos_1.varchar)('N_COMP', c.nComp, 14),
        (0, tipos_1.varchar)('N_REMITO', c.nRemito ?? '', c.nRemito ? 14 : 1),
        (0, tipos_1.varchar)('NCOMP_IN_S', c.ncompInS, 8),
        (0, tipos_1.varchar)('NCOMP_ORIG', '', 1),
        (0, tipos_1.smallint)('NRO_SUCURS', 0),
        (0, tipos_1.varchar)('OBSERVACIO', obs, obs ? 60 : 1),
        (0, tipos_1.smallint)('SUC_ORIG', 0),
        (0, tipos_1.varchar)('T_COMP', c.tComp, 3),
        (0, tipos_1.smallint)('TALONARIO', c.talonario),
        (0, tipos_1.varchar)('TCOMP_IN_S', c.tcompInS, 2),
        (0, tipos_1.varchar)('TCOMP_ORIG', '', 1),
        (0, tipos_1.varchar)('USUARIO', c.usuario.slice(0, 10), 10),
        (0, tipos_1.varchar)('COD_TRANSP', c.codTransp ?? '', c.codTransp ? 2 : 1),
        (0, tipos_1.varchar)('HORA_COMP', hora, 6),
        (0, tipos_1.float)('ID_A_RENTA', 0),
        (0, tipos_1.bit)('DOC_ELECTR', false),
        (0, tipos_1.varchar)('COD_CLASIF', '', 1),
        (0, tipos_1.varchar)('AUDIT_IMP', '', 1),
        (0, tipos_1.numeric)('IMP_IVA', 0),
        (0, tipos_1.numeric)('IMP_OTIMP', 0),
        (0, tipos_1.numeric)('IMPORTE_BO', 0),
        (0, tipos_1.numeric)('IMPORTE_TO', 0),
        (0, tipos_1.varchar)('DIFERENCIA', 'N', 1),
        (0, tipos_1.smallint)('SUC_DESTIN', 0),
        (0, tipos_1.varchar)('T_DOC_DTE', '', 1),
        ley(1), ley(2), ley(3), ley(4), ley(5),
        (0, tipos_1.numeric)('DCTO_CLIEN', 0),
        (0, tipos_1.varchar)('T_INT_ORI', '', 1),
        (0, tipos_1.varchar)('N_INT_ORI', '', 1),
        (0, tipos_1.datetime)('FECHA_INGRESO', hoy),
        (0, tipos_1.varchar)('HORA_INGRESO', hora, 6),
        (0, tipos_1.varchar)('USUARIO_INGRESO', c.usuario.slice(0, 10), 10),
        (0, tipos_1.varchar)('TERMINAL_INGRESO', c.terminal.slice(0, 8), 8),
        (0, tipos_1.numeric)('IMPORTE_TOTAL_CON_IMPUESTOS', 0),
        (0, tipos_1.numeric)('CANTIDAD_KILOS', 0),
        (0, tipos_1.int)('ID_DIRECCION_ENTREGA', c.idDireccionEntrega ?? null),
        (0, tipos_1.smallint)('NRO_SUCURSAL_DESTINO_REMITO', c.nroSucursalDestino ?? 0),
        (0, tipos_1.varchar)('COD_DEPOSI', c.codDeposito ?? '', c.codDeposito ? 2 : 1),
        (0, tipos_1.smallint)('COND_VTA', c.condVta ?? 0),
        // Tango deja en estos tres la hora/usuario/terminal de la sesión aunque el
        // remito no esté anulado (dato residual de su pantalla); en los movimientos
        // de stock los graba NULL. Acá: vacíos o NULL según el comprobante.
        (0, tipos_1.varchar)('HORA_ANU', c.anulacionNull ? null : '', c.anulacionNull ? 1 : 6),
        (0, tipos_1.varchar)('USUARIO_ANU', c.anulacionNull ? null : '', c.anulacionNull ? 1 : 10),
        (0, tipos_1.varchar)('TERMINAL_ANU', c.anulacionNull ? null : '', c.anulacionNull ? 1 : 8),
    ], true);
}
/** INSERT STA20 con las 50 columnas que graba Tango. */
function renglonSta20(r) {
    return (0, tipos_1.insert)(r.etiqueta, 'STA20', [
        (0, tipos_1.varchar)('FILLER', '', 1),
        (0, tipos_1.numeric)('CAN_EQUI_V', r.cantidad),
        (0, tipos_1.numeric)('CANT_DEV', 0),
        (0, tipos_1.numeric)('CANT_OC', 0),
        (0, tipos_1.numeric)('CANT_PEND', r.cantPendiente ?? 0),
        (0, tipos_1.numeric)('CANT_SCRAP', 0),
        (0, tipos_1.numeric)('CANTIDAD', r.cantidad),
        (0, tipos_1.numeric)('CANT_FACTU', 0),
        (0, tipos_1.varchar)('COD_ARTICU', r.codArticu, 15),
        (0, tipos_1.varchar)('COD_DEPOSI', r.codDeposito, 2),
        (0, tipos_1.varchar)('DEPOSI_DDE', r.depositoDesde ?? '', r.depositoDesde ? 2 : 1),
        (0, tipos_1.numeric)('EQUIVALENC', 1),
        (0, tipos_1.datetime)('FECHA_MOV', (0, tipos_1.soloDia)(r.fecha)),
        (0, tipos_1.varchar)('N_ORDEN_CO', '', 1),
        (0, tipos_1.int)('N_RENGL_OC', 0),
        (0, tipos_1.int)('N_RENGL_S', r.nRenglon),
        (0, tipos_1.varchar)('NCOMP_IN_S', r.ncompInS, 8),
        (0, tipos_1.numeric)('PLISTA_REM', 0),
        (0, tipos_1.numeric)('PPP_EX', 0),
        (0, tipos_1.numeric)('PPP_LO', 0),
        (0, tipos_1.numeric)('PRECIO', 0),
        (0, tipos_1.numeric)('PRECIO_REM', 0),
        (0, tipos_1.varchar)('TCOMP_IN_S', r.tcompInS, 2),
        (0, tipos_1.varchar)('TIPO_MOV', r.tipoMov, 1),
        (0, tipos_1.varchar)('COD_CLASIF', '', 1),
        (0, tipos_1.numeric)('DCTO_FACTU', 0),
        (0, tipos_1.numeric)('CANT_DEV_2', 0),
        (0, tipos_1.numeric)('CANT_PEND_2', 0),
        (0, tipos_1.numeric)('CANTIDAD_2', 0),
        (0, tipos_1.numeric)('CANT_FACTU_2', 0),
        (0, tipos_1.numeric)('CANT_OC_2', 0),
        (0, tipos_1.int)('ID_MEDIDA_STOCK_2', null),
        (0, tipos_1.int)('ID_MEDIDA_STOCK', r.idMedidaStock),
        (0, tipos_1.int)('ID_MEDIDA_VENTAS', r.idMedidaVentas),
        (0, tipos_1.int)('ID_MEDIDA_COMPRA', null),
        (0, tipos_1.varchar)('UNIDAD_MEDIDA_SELECCIONADA', 'P', 1),
        (0, tipos_1.numeric)('PRECIO_REMITO_VENTAS', 0),
        (0, tipos_1.int)('RENGL_PADR', 0),
        (0, tipos_1.varchar)('COD_ARTICU_KIT', '', 1),
        (0, tipos_1.bit)('PROMOCION', false),
        (0, tipos_1.smallint)('TALONARIO_OC', 0),
        (0, tipos_1.varchar)('COD_DEPOSI_INGRESO', '', 1),
        (0, tipos_1.varchar)('OBSERVACIONES', '', 1),
        (0, tipos_1.numeric)('IMPUESTO_INTERNO_FIJO', r.impuestoInternoFijo ?? 0),
        (0, tipos_1.numeric)('IMPORTE_SIN_IMPUESTOS', 0),
        (0, tipos_1.numeric)('IMPORTE_CON_IMPUESTOS', 0),
        (0, tipos_1.numeric)('BASE_CALCULO_II_VARIABLE', 0),
        (0, tipos_1.numeric)('CANTIDAD_PARTIDAS', 0),
        (0, tipos_1.numeric)('CANTIDAD_PARTIDAS_2', 0),
        (0, tipos_1.varchar)('NRO_OC_COMP', '', 1),
    ], true);
}
/**
 * UPDATE del saldo de un depósito (STA19) con la misma concurrencia optimista de
 * Tango: el WHERE lleva el CANT_STOCK leído; si otro movimiento lo cambió en el
 * medio, afecta 0 filas y el writer aborta la transacción (el reintento relee).
 * `delta` negativo descuenta, positivo suma.
 */
function updateSta19(etiqueta, codArticu, codDeposito, stockAnterior, delta) {
    return {
        etiqueta,
        sql: `UPDATE "STA19" SET "CANT_STOCK" = @CANT_NUEVA WHERE "COD_ARTICU" = @COD_ARTICU AND "COD_DEPOSI" = @COD_DEPOSI AND "CANT_STOCK" = @CANT_ANTERIOR AND "COD_UBIC1" = '' AND "COD_UBIC2" = '' AND "COD_UBIC3" = ''`,
        params: [
            (0, tipos_1.numeric)('CANT_NUEVA', (0, exports.redondear7)(stockAnterior + delta)),
            (0, tipos_1.varchar)('COD_ARTICU', codArticu, 15),
            (0, tipos_1.varchar)('COD_DEPOSI', codDeposito, 2),
            (0, tipos_1.numeric)('CANT_ANTERIOR', stockAnterior),
        ],
    };
}
/**
 * Fila nueva de saldo (STA19) para un artículo en un depósito que todavía no
 * la tiene (camión tercerizado que carga por primera vez, depósito recién
 * creado). Columnas = las que Tango escribe en su UPDATE de fila completa
 * (traza 2026-09-05: FILLER, CANT_STOCK, COD_ARTICU, COD_DEPOSI, COD_UBIC1..3,
 * UBIC_TXT); ID_STA19 es identity y los triggers completan ID_STA11 / ID_STA22.
 * `cantidad` puede ser negativa (egreso de un camión sin inventario inicial).
 */
function insertSta19(etiqueta, codArticu, codDeposito, cantidad) {
    return {
        etiqueta,
        sql: `INSERT INTO "STA19" ("FILLER", "CANT_STOCK", "COD_ARTICU", "COD_DEPOSI", "COD_UBIC1", "COD_UBIC2", "COD_UBIC3", "UBIC_TXT") VALUES ('', @CANT_STOCK, @COD_ARTICU, @COD_DEPOSI, '', '', '', '')`,
        params: [
            (0, tipos_1.numeric)('CANT_STOCK', (0, exports.redondear7)(cantidad)),
            (0, tipos_1.varchar)('COD_ARTICU', codArticu, 15),
            (0, tipos_1.varchar)('COD_DEPOSI', codDeposito, 2),
        ],
    };
}
/** Unidades de medida de un artículo (STA11). Error claro si no existe. */
async function leerArticulo(db, codArticu) {
    const art = await db.query(`SELECT ID_MEDIDA_STOCK, ID_MEDIDA_VENTAS FROM STA11 WHERE COD_ARTICU = @COD`, [(0, tipos_1.varchar)('COD', codArticu, 15)]);
    if (!art.length)
        throw new Error(`artículo ${codArticu} no existe en Tango`);
    return { idMedidaStock: art[0].ID_MEDIDA_STOCK, idMedidaVentas: art[0].ID_MEDIDA_VENTAS };
}
/** Saldo actual de un artículo en un depósito (STA19, sin ubicaciones). `null` si no hay fila. */
async function leerStock(db, codArticu, codDeposito) {
    const stock = await db.query(`SELECT CANT_STOCK FROM STA19 WHERE COD_ARTICU = @COD AND COD_DEPOSI = @DEP AND COD_UBIC1 = '' AND COD_UBIC2 = '' AND COD_UBIC3 = ''`, [(0, tipos_1.varchar)('COD', codArticu, 15), (0, tipos_1.varchar)('DEP', codDeposito, 2)]);
    return stock.length ? Number(stock[0].CANT_STOCK) : null;
}
//# sourceMappingURL=comun.js.map