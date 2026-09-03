"use strict";
// Sincronización de PRECIOS y LISTAS desde Tango → app (Tango es la fuente
// maestra, decisión de Ariel 2026-09-03). Ver docs/tango/INTEGRACION.md §17.
//
// De dónde sale cada cosa (API de ABM vía Tango Connect):
//   - Listas de precios: process 984 (GVA10) → nro, nombre, incluye IVA.
//   - Precio de cada artículo en cada lista: la ficha del artículo (process 87,
//     GetById) trae `GVA17[]` = { NRO_DE_LIS, PRECIO } y, anidado, `GVA13[]` =
//     precios ESPECIALES por cliente { COD_CLIENT, NRO_LISTA, PRECIO }.
//   - Lista asignada a cada cliente: ficha del cliente (process 2117, Get
//     paginado) → GVA10_NRO_DE_LIS.
//
// Resultado en Firestore:
//   preciosTango/{empresa} = { actualizadoEn, company, productos, listas:
//     { [nroLista]: { nombre, incluyeIva, precios: { [productoId]: precio } } },
//     especiales: { [claveCliente]: { [productoId]: precio } } }
//   users/{uid}.listaTango = { redonhielo: nro, rolito: nro }
//
// Solo los productos del catálogo de la app (config/tango.articulos, sin los
// `cambio_*`): son ~11 artículos por empresa, así que la corrida entera son
// unas 30 consultas. La empresa de cada canal: contado → redonhielo, promo →
// rolito.
Object.defineProperty(exports, "__esModule", { value: true });
exports.claveCliente = exports.EMPRESAS = void 0;
exports.leerPreciosEmpresa = leerPreciosEmpresa;
exports.leerListasDeClientes = leerListasDeClientes;
exports.sincronizarPreciosTango = sincronizarPreciosTango;
exports.resolverPreciosCliente = resolverPreciosCliente;
const firestore_1 = require("firebase-admin/firestore");
const client_1 = require("./client");
const pedido_1 = require("./pedido");
exports.EMPRESAS = ['redonhielo', 'rolito'];
/** Firestore no admite '.' en nombres de campo: 'FC.280' → 'FC_280'. */
const claveCliente = (codigoTango) => String(codigoTango).replace(/\./g, '_');
exports.claveCliente = claveCliente;
const PAGE = 500;
async function todasLasFilas(tango, company, proceso) {
    const out = [];
    let i = 0, pages = 1;
    do {
        const data = await tango.request(company, 'GET', 'Get', { process: proceso, pageSize: PAGE, pageIndex: i, view: '' });
        out.push(...client_1.TangoClient.filas(data));
        const rd = (0, pedido_1.prop)(data, 'resultData');
        pages = Number((0, pedido_1.prop)(rd, 'totalPages') ?? 1);
        i++;
    } while (i < pages);
    return out;
}
/** Precios de una empresa: listas + precio por producto en cada lista + especiales por cliente. */
async function leerPreciosEmpresa(tango, company, articulos) {
    var _a;
    const errores = [];
    const listas = {};
    for (const l of await todasLasFilas(tango, company, client_1.PROCESOS.listas)) {
        const nro = String((0, pedido_1.prop)(l, 'NRO_DE_LIS') ?? '');
        if (!nro)
            continue;
        listas[nro] = { nombre: String((0, pedido_1.prop)(l, 'NOMBRE_LIS') ?? '').trim(), incluyeIva: (0, pedido_1.prop)(l, 'INCLUY_IVA') === true, precios: {} };
    }
    const especiales = {};
    const productos = {};
    for (const [productoId, cod] of Object.entries(articulos)) {
        if (productoId.startsWith('cambio_'))
            continue;
        productos[productoId] = cod;
        try {
            const id = await tango.resolverId(company, `articulo:${cod}`, client_1.PROCESOS.articulos, client_1.FILTROS.articulo(cod), 'ID_STA11');
            if (id == null) {
                errores.push(`${productoId}: artículo ${cod} no existe en la empresa ${company}`);
                continue;
            }
            const ficha = await tango.getById(company, client_1.PROCESOS.articulos, id);
            const gva17 = ((0, pedido_1.prop)(ficha, 'GVA17') ?? []);
            for (const p of gva17) {
                const nro = String((0, pedido_1.prop)(p, 'NRO_DE_LIS') ?? '');
                const precio = Number((0, pedido_1.prop)(p, 'PRECIO'));
                if (!nro || !Number.isFinite(precio))
                    continue;
                listas[nro] ?? (listas[nro] = { nombre: `Lista ${nro}`, incluyeIva: false, precios: {} });
                listas[nro].precios[productoId] = precio;
                for (const e of ((0, pedido_1.prop)(p, 'GVA13') ?? [])) {
                    const cod = String((0, pedido_1.prop)(e, 'COD_CLIENT') ?? '').trim();
                    const pe = Number((0, pedido_1.prop)(e, 'PRECIO'));
                    if (!cod || !Number.isFinite(pe))
                        continue;
                    (especiales[_a = (0, exports.claveCliente)(cod)] ?? (especiales[_a] = {}))[productoId] = pe;
                }
            }
        }
        catch (e) {
            errores.push(`${productoId}: ${e.message}`);
        }
    }
    return {
        company, productos, listas, especiales,
        resumen: { listas: Object.keys(listas).length, productos: Object.keys(productos).length, especiales: Object.keys(especiales).length, errores },
    };
}
/** Lista asignada a cada cliente (COD_GVA14 → NRO_LISTA) en una empresa. */
async function leerListasDeClientes(tango, company) {
    const out = new Map();
    for (const c of await todasLasFilas(tango, company, client_1.PROCESOS.clientes)) {
        const cod = String((0, pedido_1.prop)(c, 'COD_GVA14') ?? '').trim();
        const nro = Number((0, pedido_1.prop)(c, 'GVA10_NRO_DE_LIS') ?? (0, pedido_1.prop)(c, 'NRO_LISTA'));
        if (cod && Number.isFinite(nro) && nro > 0)
            out.set(cod, nro);
    }
    return out;
}
/**
 * Corrida completa: precios de las dos empresas + lista de cada cliente.
 * Escribe preciosTango/{empresa} y users/{uid}.listaTango.
 */
async function sincronizarPreciosTango(db, tango, cfg) {
    const articulos = cfg.articulos ?? {};
    const resumen = { empresas: {}, usuariosActualizados: 0 };
    const listasPorCliente = {};
    const docsPorEmpresa = {};
    for (const empresa of exports.EMPRESAS) {
        const company = cfg.companies?.[empresa];
        if (!Number.isInteger(company)) {
            resumen.empresas[empresa] = { listas: 0, productos: 0, especiales: 0, errores: [`config/tango.companies.${empresa} no está configurado`], clientesConLista: 0 };
            continue;
        }
        const doc = await leerPreciosEmpresa(tango, company, articulos);
        docsPorEmpresa[empresa] = doc;
        await db.doc(`preciosTango/${empresa}`).set({ ...doc, actualizadoEn: firestore_1.FieldValue.serverTimestamp() });
        listasPorCliente[empresa] = await leerListasDeClientes(tango, company);
        resumen.empresas[empresa] = { ...doc.resumen, clientesConLista: listasPorCliente[empresa].size };
    }
    // Para cada cliente vinculado (codigoTango) se guarda en su ficha:
    //   listaTango       = { redonhielo: nro, rolito: nro }
    //   listaTangoNombre = { redonhielo: 'HABITUALES', ... }
    //   preciosTango     = { redonhielo: { productoId: precio }, rolito: {...} }
    // Los precios ya vienen resueltos (especial del cliente > su lista; 0 = sin
    // precio, no se guarda) para que el propio cliente los vea en su perfil y en
    // el pedido sin tener acceso a preciosTango/*, que trae los precios de todos.
    const clientes = await db.collection('users').where('rol', '==', 'cliente').get();
    let batch = db.batch(), ops = 0;
    for (const d of clientes.docs) {
        const cod = String(d.data().codigoTango ?? '').trim();
        if (!cod)
            continue;
        const listaTango = {};
        const listaTangoNombre = {};
        const preciosTango = {};
        for (const empresa of exports.EMPRESAS) {
            const n = listasPorCliente[empresa]?.get(cod);
            if (n === undefined)
                continue;
            listaTango[empresa] = n;
            const doc = docsPorEmpresa[empresa];
            const lista = doc?.listas[String(n)];
            if (lista)
                listaTangoNombre[empresa] = lista.nombre;
            preciosTango[empresa] = resolverPreciosCliente(doc, cod, n);
        }
        if (!Object.keys(listaTango).length)
            continue;
        const data = d.data();
        const nuevo = { listaTango, listaTangoNombre, preciosTango };
        const actual = { listaTango: data.listaTango, listaTangoNombre: data.listaTangoNombre, preciosTango: data.preciosTango };
        if (JSON.stringify(actual) === JSON.stringify(nuevo))
            continue;
        batch.update(d.ref, nuevo);
        resumen.usuariosActualizados++;
        if (++ops >= 400) {
            await batch.commit();
            batch = db.batch();
            ops = 0;
        }
    }
    if (ops)
        await batch.commit();
    return resumen;
}
/** Precio final de cada producto para un cliente: especial > lista; sin 0. */
function resolverPreciosCliente(doc, codigoCliente, nroLista) {
    const out = {};
    if (!doc)
        return out;
    const especiales = doc.especiales[(0, exports.claveCliente)(codigoCliente)] ?? {};
    const lista = doc.listas[String(nroLista)]?.precios ?? {};
    for (const productoId of Object.keys(doc.productos)) {
        const valido = (p) => typeof p === 'number' && Number.isFinite(p) && p > 0;
        const precio = valido(especiales[productoId]) ? especiales[productoId] : lista[productoId];
        if (valido(precio))
            out[productoId] = precio;
    }
    return out;
}
//# sourceMappingURL=precios.js.map