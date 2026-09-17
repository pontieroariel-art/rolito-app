"use strict";
// Writers hacia Tango para los items de tango-outbox: remito (→ pedido) y
// factura (→ Facturador). Port de scripts/tango/bridge-listener.mjs al worker
// en Cloud Functions; misma lógica, misma config en `config/tango`.
Object.defineProperty(exports, "__esModule", { value: true });
exports.enviarNotaCredito = exports.enviarFactura = void 0;
exports.enviarRemito = enviarRemito;
exports.resolverClienteOcasional = resolverClienteOcasional;
const client_1 = require("./client");
const pedido_1 = require("./pedido");
const factura_1 = require("./factura");
/**
 * Depósito de Tango de la venta: el del REPARTIDOR (en Tango los choferes son depósitos; cae al
 * camión) o, en ventanilla, el de la PLANTA donde se vendió (no hay depósito en tránsito: la
 * mercadería sale de la cámara — decisión de Ariel 2026-09-04, STOCK_REPARTO.md).
 */
function codigoDeposito(cfg, payload) {
    // El depósito explícito del doc (expedición por depósito, 2026-09-06) manda;
    // el mapa uid/camión → código queda como respaldo para docs anteriores.
    if (typeof payload.depositoTango === 'string' && payload.depositoTango.trim())
        return payload.depositoTango.trim();
    const dep = cfg.depositos ?? {};
    const porPlanta = cfg.depositosPlanta ?? {};
    return (payload.choferId && dep[payload.choferId]) || (payload.camionId && dep[payload.camionId])
        || (payload.plantaId && porPlanta[payload.plantaId]) || null;
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
const enviarFactura = (payload, ctx) => registrarEnFacturador(payload, ctx, 'factura');
exports.enviarFactura = enviarFactura;
/**
 * Nota de crédito que anula una factura de ventanilla (INTEGRACION.md §33):
 * mismo camino que la factura (ficha del cliente, depósito, armado) con el
 * comprobante 'CDE' referenciando a la factura.
 */
const enviarNotaCredito = (payload, ctx) => registrarEnFacturador(payload, ctx, 'notaCredito');
exports.enviarNotaCredito = enviarNotaCredito;
/**
 * Venta de ventanilla a un consumidor final sin ficha (2026-09-17): el
 * Facturador exige un cliente, así que va sobre la cuenta genérica de la
 * empresa (`clienteConsumidorFinal`). El id se resuelve por API con el código
 * la primera vez y queda en memoria. Con ficha, el payload vuelve intacto.
 */
async function resolverClienteOcasional(payload, ctx) {
    const idGva14 = Number(payload.clienteIdGva14Tango);
    if (Number.isInteger(idGva14) && idGva14 > 0)
        return { payload };
    if (!payload.clienteOcasional)
        return { payload };
    const empresa = ctx.item.empresa ?? '?';
    const generico = ctx.cfg.facturador?.[empresa]?.clienteConsumidorFinal;
    const codigo = String(generico?.codigo ?? '').trim();
    if (!codigo)
        return { error: `Venta a consumidor final sin ficha: falta config/tango.facturador.${empresa}.clienteConsumidorFinal.codigo (COD_CLIENT de la cuenta CONSUMIDOR FINAL en Tango)` };
    let id = Number(generico?.idGva14);
    if (!Number.isInteger(id) || id <= 0) {
        // 1) GetByFilter con caché, como artículos/depósitos/monedas. 2) Si el
        // filtro rebota o no encuentra, se recorre el padrón (Api/Get paginado,
        // como la sync de clientes) y se busca el código a mano. En cualquier caso
        // el id se guarda en config/tango para no volver a buscarlo.
        let motivo = '';
        try {
            id = Number(await ctx.tango.resolverId(ctx.company, `cliente:${codigo}`, client_1.PROCESOS.clientes, client_1.FILTROS.cliente(codigo), 'ID_GVA14'));
        }
        catch (e) {
            motivo = e.message;
            id = 0;
        }
        if (!Number.isInteger(id) || id <= 0) {
            ctx.log(`consumidor final: GetByFilter no resolvió "${codigo}"${motivo ? ` (${motivo})` : ''}; se recorre el padrón`);
            try {
                const filas = await ctx.tango.getAll(ctx.company, client_1.PROCESOS.clientes, 200);
                const fila = filas.find((f) => String((0, pedido_1.prop)(f, 'COD_GVA14') ?? '').trim() === codigo);
                id = Number((0, pedido_1.prop)(fila ?? {}, 'ID_GVA14'));
            }
            catch (e) {
                return { error: `No se pudo buscar la cuenta CONSUMIDOR FINAL "${codigo}" en Tango: ${e.message}` };
            }
        }
        if (!Number.isInteger(id) || id <= 0)
            return { error: `La cuenta CONSUMIDOR FINAL "${codigo}" no existe en Tango (Company ${ctx.company}); revisá config/tango.facturador.${empresa}.clienteConsumidorFinal.codigo` };
        ctx.log(`consumidor final: cuenta ${codigo} → ID_GVA14 ${id}`);
        if (ctx.guardarIdConsumidorFinal)
            await ctx.guardarIdConsumidorFinal(empresa, id).catch((e) => ctx.log(`aviso: no se pudo guardar el id en config/tango (${e.message})`));
    }
    return { payload: { ...payload, clienteIdGva14Tango: id, clienteCodigoTango: codigo, clienteNombre: payload.clienteNombre?.trim() && payload.clienteNombre.trim() !== '.' ? payload.clienteNombre : 'CONSUMIDOR FINAL' } };
}
async function registrarEnFacturador(payloadOriginal, ctx, tipo) {
    const { tango, cfg, company, item, log } = ctx;
    const empresa = item.empresa ?? '?';
    const cfgEmpresa = cfg.facturador?.[empresa];
    if (!cfgEmpresa)
        return { ok: false, error: `Falta config/tango.facturador.${empresa} (talonarios, condicionVenta, listaPrecio, contracuenta, vendedor, codigoTasaIva21, cuentas, codigoAlicuotaPercepcionIIBB)` };
    const ocasional = await resolverClienteOcasional(payloadOriginal, ctx);
    if ('error' in ocasional)
        return { ok: false, error: ocasional.error };
    const payload = ocasional.payload;
    const articulos = cfg.articulos ?? {};
    const codDeposito = codigoDeposito(cfg, payload) ?? (!payload.camionId ? cfgEmpresa.depositoVentanilla ?? null : null);
    // El Facturador exige el depósito aunque la factura no descargue stock
    // (Rolito, descargaStock: false — probado 2026-09-06).
    if (!codDeposito) {
        return { ok: false, error: payload.camionId ? `Falta el depósito Tango del chofer ${payload.choferNombre ?? payload.choferId} (config/tango.depositos.${payload.choferId})` : `Falta el depósito Tango de la planta ${payload.plantaId ?? '?'} (config/tango.depositosPlanta)` };
    }
    // Vendedor del comprobante = el SUPERVISOR del cliente (COD_VENDED de su
    // ficha en Tango: la oficina filtra ventas por supervisor; decisión de Ariel
    // 2026-09-09, antes iba el chofer y pisaba ese filtro). Quién vendió
    // físicamente (chofer o cajero) va en la leyenda 3. Sin vendedor en la ficha
    // (ocasionales, clientes nuevos) cae al genérico de la empresa ('AP').
    let vendedor = cfgEmpresa.vendedor;
    if (vendedor === undefined || vendedor === null || vendedor === '') {
        return { ok: false, error: `Falta config/tango.facturador.${empresa}.vendedor (vendedor genérico para clientes sin vendedor en su ficha)` };
    }
    // Condición de venta: contado = la configurada (default 1 CONTADO); cuenta
    // corriente = la que el CLIENTE tiene pactada en Tango (COND_VTA de su ficha),
    // no un valor fijo para todos.
    const condCfg = cfgEmpresa.condicionVenta;
    const condContado = (typeof condCfg === 'object' && condCfg !== null ? condCfg.contado : condCfg) ?? 1;
    let condCtaCte = typeof condCfg === 'object' && condCfg !== null ? condCfg.cuenta_corriente : undefined;
    const esPromo = !(payload.factura && payload.factura.estado === 'emitida');
    let letraNoFiscal;
    let listaPrecio;
    // Ficha del cliente en Tango: la condición de venta pactada (cta. cte.), la
    // lista de precios asignada (las listas de Tango son por cliente; la app manda
    // los precios explícitos, la lista es referencia) y la categoría de IVA
    // (promo → letra A si es Responsable Inscripto, B si no).
    {
        const idGva14 = Number(payload.clienteIdGva14Tango);
        if (!Number.isInteger(idGva14) || idGva14 <= 0)
            return { ok: false, error: `La venta no trae clienteIdGva14Tango (cliente ${payload.clienteId} sin vincular a Tango)` };
        try {
            const ficha = await tango.getById(company, client_1.PROCESOS.clientes, idGva14);
            const cond = (0, pedido_1.prop)(ficha, 'COND_VTA');
            if (cond !== undefined && cond !== null && cond !== '')
                condCtaCte = cond;
            const vend = (0, pedido_1.prop)(ficha, 'COD_VENDED');
            if (typeof vend === 'string' && vend.trim() !== '')
                vendedor = vend.trim();
            const lista = (0, pedido_1.prop)(ficha, 'NRO_LISTA');
            if (lista !== undefined && lista !== null && lista !== '' && Number(lista) > 0)
                listaPrecio = lista;
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
    const armar = tipo === 'notaCredito' ? factura_1.armarNotaCreditoFacturador : factura_1.armarComprobanteFacturador;
    const armado = armar(payload, item, {
        ...cfgEmpresa,
        vendedor,
        condicionVenta: { contado: condContado, ...(condCtaCte !== undefined ? { cuenta_corriente: condCtaCte } : {}) },
        ...(listaPrecio !== undefined ? { listaPrecio } : {}),
    }, {
        codigoArticulo: (id) => articulos[id] ?? null,
        codigoDeposito: codDeposito,
        etiquetaCamion: `${codDeposito ?? ''} ${cfg.camiones?.[payload.choferId ?? ''] ?? ''}`.trim(),
        letraNoFiscal,
    });
    if (armado.error !== undefined)
        return { ok: false, error: armado.error };
    if (item.conCaePropio === true && !armado.comprobante.cAE) {
        return { ok: false, error: `El item dice conCaePropio pero ${tipo === 'notaCredito' ? 'la nota de crédito' : 'la venta'} no trae CAE — no se registra sin CAE` };
    }
    try {
        const data = await tango.registrarComprobantes(company, [armado.comprobante]);
        const numero = armado.comprobante.numeroComprobante;
        const r = (0, factura_1.interpretarRespuestaFacturador)(data, numero);
        if (!r.ok)
            return { ok: false, error: `Facturador rechazó ${numero}: ${r.mensaje || JSON.stringify(data).slice(0, 300)}` };
        const que = tipo === 'notaCredito' ? 'nota de crédito' : 'factura';
        log(`${armado.referencia}: ${que} ${numero} ${r.yaExistia ? 'ya estaba registrada' : 'registrada'} en Tango (Company ${company})${armado.comprobante.cAE ? ' con CAE' : ' sin CAE'}`);
        return tipo === 'notaCredito'
            ? { ok: true, resultado: { notaCreditoNumero: numero, comprobanteNumero: r.numeroComprobante ?? numero, yaExistia: r.yaExistia, fiscal: true } }
            : { ok: true, resultado: { facturaNumero: numero, comprobanteNumero: r.numeroComprobante ?? numero, yaExistia: r.yaExistia, fiscal: armado.fiscal } };
    }
    catch (err) {
        return { ok: false, error: err.message };
    }
}
//# sourceMappingURL=writers.js.map