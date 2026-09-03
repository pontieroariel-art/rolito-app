"use strict";
// Cliente HTTP de la API de Tango (Plataforma/Ventas) vía Tango Connect.
//
// Confirmado 2026-09-03 contra el Tango real: la API está expuesta a internet
// en `https://{llave}.connect.axoft.com` (llave 001174/003 → `001174-003`),
// misma superficie que `http://rhielotg:17000` en la red interna: headers
// `ApiAuthorization` (token de desarrollador) + `Company` (1 = Redonhielo,
// 3 = Rolito), endpoints `Api/Get`, `Api/GetByFilter`, `Api/GetById`,
// `Api/Create`, y el Facturador en `Api/FacturadorVenta/registrar`.
//
// Formas de respuesta (verificadas):
//   Get         → { resultData: { list, totalCount, totalPages }, succeeded }
//   GetByFilter → { list: [...] }   (sin succeeded; filtroSql DEBE empezar con "WHERE ")
//   GetById     → { value: {...}, succeeded }
//   Create      → { Succeeded, SavedId, Message, ExceptionInfo }
//   Facturador  → { Message, Comprobantes: [{ numeroComprobante, estado, mensaje }], Succeeded }
Object.defineProperty(exports, "__esModule", { value: true });
exports.TangoClient = exports.FILTROS = exports.PROCESOS = void 0;
const pedido_1 = require("./pedido");
exports.PROCESOS = { pedidos: 19845, articulos: 87, depositos: 2941, monedas: 1660, clientes: 2117, listas: 984 };
exports.FILTROS = {
    articulo: (cod) => `WHERE AXV_ARTICULO.COD_STA11 = '${sql(cod)}'`,
    deposito: (cod) => `WHERE STA22.COD_STA22 = '${sql(cod)}'`,
    moneda: (cod) => `WHERE MONEDA.COD_MONEDA = '${sql(cod)}'`,
    pedidoRef: (ref) => `WHERE AXV_PEDIDO.LEYENDA_1 = '${sql(ref)}'`,
};
const sql = (s) => String(s).replace(/'/g, "''");
class TangoClient {
    constructor(cfg) {
        this.cfg = cfg;
        this.cacheIds = new Map();
    }
    async request(company, metodo, accion, params, body) {
        const qs = Object.entries(params ?? {}).map(([k, v]) => `${k}=${encodeURIComponent(String(v ?? ''))}`).join('&');
        const uri = `${this.cfg.baseUrl.replace(/\/+$/, '')}/Api/${accion}${qs ? '?' + qs : ''}`;
        const resp = await fetch(uri, {
            method: metodo,
            headers: { ApiAuthorization: this.cfg.token, Company: String(company), 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 30000),
        });
        const texto = await resp.text();
        let data;
        try {
            data = texto ? JSON.parse(texto) : {};
        }
        catch {
            throw new Error(`Tango respondió ${resp.status} con cuerpo no JSON en ${accion}: ${texto.slice(0, 200)}`);
        }
        if (!resp.ok && !(data.Comprobantes || data.comprobantes)) {
            throw new Error(`Tango respondió ${resp.status} en ${accion}: ${(0, pedido_1.prop)(data, 'message') ?? texto.slice(0, 200)}`);
        }
        if ((0, pedido_1.prop)(data, 'succeeded') === false) {
            const info = (0, pedido_1.prop)(data, 'exceptionInfo');
            const msgs = info?.messages;
            throw new Error(`Tango succeeded=false en ${accion}: ${(Array.isArray(msgs) ? msgs.join('; ') : null) ?? (0, pedido_1.prop)(data, 'message') ?? JSON.stringify(data).slice(0, 300)}`);
        }
        return data;
    }
    static filas(data) {
        const rd = (0, pedido_1.prop)(data, 'resultData');
        const lista = (0, pedido_1.prop)(rd, 'list') ?? (Array.isArray(rd) ? rd : null) ?? (0, pedido_1.prop)(data, 'list');
        return Array.isArray(lista) ? lista : [];
    }
    async getByFilter(company, proceso, filtroSql) {
        return TangoClient.filas(await this.request(company, 'GET', 'GetByFilter', { process: proceso, view: '', filtroSql }));
    }
    /** ID interno de un maestro por código, cacheado por empresa (artículos, depósitos, moneda). */
    async resolverId(company, clave, proceso, filtroSql, campoId) {
        const k = `${company}|${clave}`;
        if (this.cacheIds.has(k))
            return this.cacheIds.get(k);
        const filas = await this.getByFilter(company, proceso, filtroSql);
        if (filas.length === 0)
            return null;
        const id = (0, pedido_1.idDeFila)(filas[0], campoId);
        if (id === undefined)
            return null;
        this.cacheIds.set(k, id);
        return id;
    }
    async getById(company, proceso, id) {
        const det = await this.request(company, 'GET', 'GetById', { process: proceso, view: '', id: String(id) });
        return ((0, pedido_1.prop)(det, 'value') ?? (0, pedido_1.prop)(det, 'resultData') ?? det);
    }
    async create(company, proceso, body) {
        return this.request(company, 'POST', 'Create', { process: proceso }, body);
    }
    async registrarComprobantes(company, comprobantes) {
        return this.request(company, 'POST', 'FacturadorVenta/registrar', undefined, comprobantes);
    }
}
exports.TangoClient = TangoClient;
//# sourceMappingURL=client.js.map