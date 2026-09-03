"use strict";
// Writers hacia Tango para los items de tango-outbox: remito (→ pedido) y
// factura (→ Facturador). Port de scripts/tango/bridge-listener.mjs al worker
// en Cloud Functions; misma lógica, misma config en `config/tango`.
Object.defineProperty(exports, "__esModule", { value: true });
exports.enviarRemito = enviarRemito;
exports.enviarFactura = enviarFactura;
const client_1 = require("./client");
const pedido_1 = require("./pedido");
const factura_1 = require("./factura");
/** Depósito del REPARTIDOR (en Tango los choferes son depósitos); cae al camión. */
function codigoDeposito(cfg, payload) {
    const dep = cfg.depositos ?? {};
    return (payload.choferId && dep[payload.choferId]) || (payload.camionId && dep[payload.camionId]) || null;
}
/** Venta que NO factura ARCA → pedido en Tango (INTEGRACION.md §14). */
async function enviarRemito(payload, ctx) {
    const { tango, cfg, company, item, log } = ctx;
    const articulos = cfg.articulos ?? {};
    const pedidoCfg = cfg.pedido ?? {};
    const idGva14 = Number(payload.clienteIdGva14Tango);
    if (!Number.isInteger(idGva14) || idGva14 <= 0) {
        return { ok: false, error: `La venta no trae clienteIdGva14Tango (cliente ${payload.clienteId} sin vincular a Tango — corré el cruce por CUIT)` };
    }
    const { renglones, faltantes } = (0, pedido_1.renglonesDeVenta)(payload, (id) => articulos[id] ?? null);
    if (faltantes.length)
        return { ok: false, error: `Falta el código de artículo Tango en config/tango.articulos para: ${faltantes.join(', ')}` };
    if (renglones.length === 0)
        return { ok: false, error: 'La venta no tiene renglones con cantidad > 0' };
    const codDeposito = codigoDeposito(cfg, payload);
    if (!codDeposito) {
        return { ok: false, error: `Falta el depósito Tango del chofer ${payload.choferNombre ?? payload.choferId} (config/tango.depositos.${payload.choferId}) — los depósitos de Tango son por repartidor` };
    }
    try {
        const monedaCod = pedidoCfg.monedaCodigo ?? 'PES';
        const idMoneda = await tango.resolverId(company, `moneda:${monedaCod}`, client_1.PROCESOS.monedas, client_1.FILTROS.moneda(monedaCod), 'ID_MONEDA');
        if (idMoneda == null)
            return { ok: false, error: `Tango no devolvió la moneda ${monedaCod}` };
        const idDeposito = await tango.resolverId(company, `deposito:${codDeposito}`, client_1.PROCESOS.depositos, client_1.FILTROS.deposito(codDeposito), 'ID_STA22');
        if (idDeposito == null)
            return { ok: false, error: `Tango no tiene el depósito ${codDeposito} (chofer ${payload.choferNombre ?? ''}) en la empresa ${company}` };
        const idsArticulos = {};
        for (const cod of new Set(renglones.map((r) => r.codigoArticulo))) {
            const id = await tango.resolverId(company, `articulo:${cod}`, client_1.PROCESOS.articulos, client_1.FILTROS.articulo(cod), 'ID_STA11');
            if (id == null)
                return { ok: false, error: `Tango no tiene el artículo ${cod} en la empresa ${company}` };
            idsArticulos[cod] = id;
        }
        // Idempotencia: ¿ya existe un pedido con esta referencia?
        const ref = (0, pedido_1.referenciaPedido)(item.origenColeccion, item.origenId);
        try {
            const previo = await tango.getByFilter(company, client_1.PROCESOS.pedidos, client_1.FILTROS.pedidoRef(ref));
            if (previo.length > 0) {
                const savedId = (0, pedido_1.idDeFila)(previo[0], 'ID_GVA21');
                const nro = (0, pedido_1.prop)(previo[0], 'NRO_PEDIDO', 'N_PEDIDO', 'NUMERO');
                log(`${ref}: ya existía en Tango como pedido ${String(nro ?? savedId).trim()} — no se duplica`);
                return { ok: true, resultado: { savedId, pedidoNumero: nro ?? null, remitoNumero: String(nro ?? savedId).trim(), yaExistia: true } };
            }
        }
        catch (e) {
            log(`aviso: no se pudo verificar duplicado (${e.message}); se crea igual`);
        }
        const pedido = (0, pedido_1.armarPedido)(payload, item, {
            idGva14, idMoneda: idMoneda, idDeposito: idDeposito, articulos: idsArticulos,
            talonarioId: pedidoCfg.talonarioId ?? null,
            vendedorId: pedidoCfg.vendedorId ?? null,
            condicionVentaId: pedidoCfg.condicionVentaId ?? null,
            listaPreciosId: pedidoCfg.listaPreciosId?.[payload.canal ?? ''] ?? null,
        }, renglones, {
            estadoPedido: pedidoCfg.estado ?? 2,
            comprometeStock: pedidoCfg.comprometeStock ?? true,
            etiquetaCamion: `${codDeposito} ${cfg.camiones?.[payload.choferId ?? ''] ?? cfg.camiones?.[payload.camionId ?? ''] ?? ''}`.trim(),
        });
        const creado = await tango.create(company, client_1.PROCESOS.pedidos, pedido);
        const savedId = (0, pedido_1.prop)(creado, 'savedId');
        if (savedId == null)
            return { ok: false, error: `Tango no devolvió SavedId al crear el pedido: ${JSON.stringify(creado).slice(0, 300)}` };
        let pedidoNumero = null;
        try {
            const fila = await tango.getById(company, client_1.PROCESOS.pedidos, savedId);
            const n = (0, pedido_1.prop)(fila, 'NRO_PEDIDO', 'N_PEDIDO', 'NUMERO');
            pedidoNumero = n == null ? null : String(n).trim();
        }
        catch (e) {
            log(`aviso: no se pudo leer el número del pedido ${savedId} (${e.message})`);
        }
        log(`${ref}: pedido creado en Tango (Company ${company}) id=${savedId} nro=${pedidoNumero ?? '?'}`);
        return { ok: true, resultado: { savedId, pedidoNumero, remitoNumero: pedidoNumero ?? String(savedId) } };
    }
    catch (err) {
        return { ok: false, error: err.message };
    }
}
/** Factura de la app → Facturador de Tango (INTEGRACION.md §15). */
async function enviarFactura(payload, ctx) {
    const { tango, cfg, company, item, log } = ctx;
    const empresa = item.empresa ?? '?';
    const cfgEmpresa = cfg.facturador?.[empresa];
    if (!cfgEmpresa)
        return { ok: false, error: `Falta config/tango.facturador.${empresa} (talonarios, condicionVenta, listaPrecio, contracuenta, vendedor, codigoTasaIva21, cuentas, codigoAlicuotaPercepcionIIBB)` };
    const articulos = cfg.articulos ?? {};
    const codDeposito = codigoDeposito(cfg, payload) ?? (!payload.camionId ? cfgEmpresa.depositoVentanilla ?? null : null);
    if (!codDeposito) {
        return { ok: false, error: payload.camionId ? `Falta el depósito Tango del chofer ${payload.choferNombre ?? payload.choferId} (config/tango.depositos.${payload.choferId})` : `Falta config/tango.facturador.${empresa}.depositoVentanilla` };
    }
    // Vendedor = el chofer logueado (decisión de Ariel 2026-09-03): mapeo
    // chofer → COD_GVA23 en config/tango.vendedores (lo arma
    // sincronizar-choferes-tango.mjs); cae al vendedor fijo de la empresa si hay.
    const vendedor = cfg.vendedores?.[payload.choferId ?? ''] ?? cfgEmpresa.vendedor;
    if (vendedor === undefined || vendedor === null || vendedor === '') {
        return { ok: false, error: `El chofer ${payload.choferNombre ?? payload.choferId} no tiene vendedor de Tango (config/tango.vendedores.${payload.choferId}) — hay que darlo de alta como vendedor en Tango y sincronizar` };
    }
    // Condición de venta: contado = la configurada (default 1 CONTADO); cuenta
    // corriente = la que el CLIENTE tiene pactada en Tango (COND_VTA de su ficha),
    // no un valor fijo para todos.
    const condCfg = cfgEmpresa.condicionVenta;
    const condContado = (typeof condCfg === 'object' && condCfg !== null ? condCfg.contado : condCfg) ?? 1;
    let condCtaCte = typeof condCfg === 'object' && condCfg !== null ? condCfg.cuenta_corriente : undefined;
    const esPromo = !(payload.factura && payload.factura.estado === 'emitida');
    let letraNoFiscal;
    // Ficha del cliente en Tango: la condición de venta pactada (cta. cte.) y
    // la categoría de IVA (promo → letra A si es Responsable Inscripto, B si no).
    if (payload.formaPago === 'cuenta_corriente' || esPromo) {
        const idGva14 = Number(payload.clienteIdGva14Tango);
        if (!Number.isInteger(idGva14) || idGva14 <= 0)
            return { ok: false, error: `La venta no trae clienteIdGva14Tango (cliente ${payload.clienteId} sin vincular a Tango)` };
        try {
            const ficha = await tango.getById(company, client_1.PROCESOS.clientes, idGva14);
            const cond = (0, pedido_1.prop)(ficha, 'COND_VTA');
            if (cond !== undefined && cond !== null && cond !== '')
                condCtaCte = cond;
            const catIva = Number((0, pedido_1.prop)(ficha, 'ID_CATEGORIA_IVA'));
            if (Number.isInteger(catIva) && catIva > 0)
                letraNoFiscal = catIva === 1 ? 'A' : 'B'; // 1 = Responsable Inscripto
        }
        catch (e) {
            log(`aviso: no se pudo leer la ficha del cliente ${idGva14} en Tango (${e.message})`);
        }
        if (payload.formaPago === 'cuenta_corriente' && condCtaCte === undefined) {
            return { ok: false, error: `El cliente ${payload.clienteNombre ?? idGva14} no tiene condición de venta en Tango y no hay config/tango.facturador.${empresa}.condicionVenta.cuenta_corriente` };
        }
        if (esPromo && !letraNoFiscal)
            return { ok: false, error: `No se pudo leer la categoría de IVA del cliente ${payload.clienteNombre ?? idGva14} en Tango (define si la factura X entra como A o B)` };
    }
    const armado = (0, factura_1.armarComprobanteFacturador)(payload, item, {
        ...cfgEmpresa,
        vendedor,
        condicionVenta: { contado: condContado, ...(condCtaCte !== undefined ? { cuenta_corriente: condCtaCte } : {}) },
    }, {
        codigoArticulo: (id) => articulos[id] ?? null,
        codigoDeposito: codDeposito,
        etiquetaCamion: `${codDeposito} ${cfg.camiones?.[payload.choferId ?? ''] ?? ''}`.trim(),
        letraNoFiscal,
    });
    if (armado.error !== undefined)
        return { ok: false, error: armado.error };
    if (item.conCaePropio === true && !armado.comprobante.cAE) {
        return { ok: false, error: 'El item dice conCaePropio pero la venta no trae factura.cae — no se registra sin CAE' };
    }
    try {
        const data = await tango.registrarComprobantes(company, [armado.comprobante]);
        const numero = armado.comprobante.numeroComprobante;
        const r = (0, factura_1.interpretarRespuestaFacturador)(data, numero);
        if (!r.ok)
            return { ok: false, error: `Facturador rechazó ${numero}: ${r.mensaje || JSON.stringify(data).slice(0, 300)}` };
        log(`${armado.referencia}: factura ${numero} ${r.yaExistia ? 'ya estaba registrada' : 'registrada'} en Tango (Company ${company})${armado.comprobante.cAE ? ' con CAE' : ' sin CAE'}`);
        return { ok: true, resultado: { facturaNumero: numero, comprobanteNumero: r.numeroComprobante ?? numero, yaExistia: r.yaExistia, fiscal: armado.fiscal } };
    }
    catch (err) {
        return { ok: false, error: err.message };
    }
}
//# sourceMappingURL=writers.js.map