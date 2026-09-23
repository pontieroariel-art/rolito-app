"use strict";
/**
 * Cierre de MERCADERÍA de un viaje (2026-09-18).
 *
 * La liquidación de un viaje se cierra en dos mitades independientes: la PLATA
 * la liquida caja (de 6 a 18) y la MERCADERÍA la cierra el muelle al contar la
 * descarga (a cualquier hora). Este archivo arma la segunda.
 *
 * Lo escribe el SERVIDOR, no la tablet, por la misma razón por la que existe
 * `revisionDescarga`: el muelle cuenta A CIEGAS — las reglas no le dejan leer
 * `ventasCamion` y la pantalla nunca le muestra el teórico. Si el cierre lo
 * armara el cliente, el conteo dejaría de ser ciego.
 *
 * Es una RÉPLICA de `src/utils/liquidacion.mercaderiaDelViaje` + `utils/envases`
 * + `utils/faltantes.calcularFaltante`, porque `functions/tsconfig.json` tiene
 * `include: ["src"]` y functions no puede importar de la app (mismo patrón que
 * `revisionDescarga.ts`). Si se toca el cálculo de un lado, hay que tocarlo del
 * otro: los dos números se muestran juntos en la pantalla de caja.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ventasDelViaje = exports.claveDiaAr = exports.SOMBREROS_POR_PALLET = exports.AROS_POR_TARIMA_MADERA = exports.PUNTALES_POR_PALLET = void 0;
exports.cuadrarEnvases = cuadrarEnvases;
exports.mercaderiaDelViaje = mercaderiaDelViaje;
exports.calcularFaltante = calcularFaltante;
exports.viajeDeVenta = viajeDeVenta;
exports.armarCierreMercaderia = armarCierreMercaderia;
const revisionDescarga_1 = require("./revisionDescarga");
/** Lo que viene de Firestore puede estar sucio (undefined, null, NaN): vale 0. */
const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
// ── Envases (réplica de src/utils/envases.ts) ───────────────────────────────
/** 4 puntales y 1 sombrero por pallet de cualquier tipo; el aro es solo de la tarima de madera. */
exports.PUNTALES_POR_PALLET = 4;
exports.AROS_POR_TARIMA_MADERA = 1;
exports.SOMBREROS_POR_PALLET = 1;
const conteoVacio = () => ({ tarimasMadera: 0, palletsMetal: 0, puntales: 0, aros: 0, sombreros: 0 });
// Los simples (solo la base, 2026-09-21) son parte del total y no suman
// implícitos: réplica de utils/envases.ts (implicitosDe).
const implicitosDe = (tarimasMadera, palletsMetal, simplesMadera = 0, simplesMetal = 0) => {
    const madera = Math.max(0, tarimasMadera - simplesMadera);
    const metal = Math.max(0, palletsMetal - simplesMetal);
    return {
        puntales: (madera + metal) * exports.PUNTALES_POR_PALLET,
        aros: madera * exports.AROS_POR_TARIMA_MADERA,
        sombreros: (madera + metal) * exports.SOMBREROS_POR_PALLET,
    };
};
/**
 * Lo que salió según el remito. Un remito anterior al 2026-09-07 (sin
 * `envases`) se lee como `palletsCarga` pallets de METAL: ese era el modelo
 * viejo, y así un viaje viejo cuadra sin inventar tarimas que no existieron.
 */
function envasesDeRemito(r) {
    if (r.envases) {
        return {
            tarimasMadera: n(r.envases.tarimasMadera),
            palletsMetal: n(r.envases.palletsMetal),
            ...implicitosDe(n(r.envases.tarimasMadera), n(r.envases.palletsMetal), n(r.envases.tarimasMaderaSimples), n(r.envases.palletsMetalSimples)),
            racks: [...(r.envases.racks ?? [])],
        };
    }
    const pallets = n(r.palletsCarga);
    return { tarimasMadera: 0, palletsMetal: pallets, ...implicitosDe(0, pallets), racks: [] };
}
/** Lo que volvió según la descarga; las viejas traían completos/parciales/vacíos. */
function envasesDeDescarga(d) {
    if (d.envases) {
        // `sombreros` no existía antes del 2026-09-12: una descarga vieja es 0 contados.
        return {
            tarimasMadera: n(d.envases.tarimasMadera), palletsMetal: n(d.envases.palletsMetal),
            puntales: n(d.envases.puntales), aros: n(d.envases.aros), sombreros: n(d.envases.sombreros),
            racks: [...(d.envases.racks ?? [])],
        };
    }
    const pallets = n(d.palletsCompletos) + n(d.palletsParciales) + n(d.palletsVacios);
    return { tarimasMadera: 0, palletsMetal: pallets, ...implicitosDe(0, pallets), racks: [] };
}
const sumarConteos = (a, b) => ({
    tarimasMadera: a.tarimasMadera + b.tarimasMadera, palletsMetal: a.palletsMetal + b.palletsMetal,
    puntales: a.puntales + b.puntales, aros: a.aros + b.aros, sombreros: a.sombreros + b.sombreros,
});
const restarConteos = (a, b) => ({
    tarimasMadera: a.tarimasMadera - b.tarimasMadera, palletsMetal: a.palletsMetal - b.palletsMetal,
    puntales: a.puntales - b.puntales, aros: a.aros - b.aros, sombreros: a.sombreros - b.sombreros,
});
const ordenados = (racks) => [...new Set(racks)].sort((a, b) => a - b);
/** Cuadre por tipo y por número de rack: Σ remitos vs Σ descargas. */
function cuadrarEnvases(remitos, descargas) {
    let salieron = conteoVacio(), volvieron = conteoVacio();
    const racksSalieron = [], racksVolvieron = [];
    for (const r of remitos) {
        const e = envasesDeRemito(r);
        salieron = sumarConteos(salieron, e);
        racksSalieron.push(...e.racks);
    }
    for (const d of descargas) {
        const e = envasesDeDescarga(d);
        volvieron = sumarConteos(volvieron, e);
        racksVolvieron.push(...e.racks);
    }
    const s = new Set(racksSalieron), v = new Set(racksVolvieron);
    return {
        salieron: { ...salieron, racks: ordenados(s) },
        volvieron: { ...volvieron, racks: ordenados(v) },
        diferencia: restarConteos(volvieron, salieron),
        racksFaltantes: ordenados([...s].filter((x) => !v.has(x))),
        racksSobrantes: ordenados([...v].filter((x) => !s.has(x))),
    };
}
// ── Mercadería por producto (réplica de mercaderiaDelViaje) ─────────────────
const PREFIJO_CAMBIO = 'cambio_';
/** Los renglones de cambio vienen con el id prefijado: se agrupan en el producto que son. */
const productoDelCambio = (id) => (id.startsWith(PREFIJO_CAMBIO) ? id.slice(PREFIJO_CAMBIO.length) : id);
const nombreDelCambio = (nombre) => (nombre.startsWith('Cambio ') ? nombre.slice('Cambio '.length) : nombre);
/**
 * Por producto: carga − ventas − cambios = devolución teórica, contra lo que
 * el muelle contó. Ni un gramo de plata: el muelle nunca ve importes.
 */
function mercaderiaDelViaje(remitos, ventas, cambios, descargas, entregasFabrica = []) {
    // Una factura anulada con nota de crédito (2026-09-11) no cuenta: la NC ya
    // devolvió el stock, esa mercadería tenía que volver en el camión.
    const ventasVigentes = ventas.filter((v) => v.anulacion?.estado !== 'anulada');
    // Un conteo rectificado no suma dos veces: vale la corrección en lugar del original.
    const vigentes = (0, revisionDescarga_1.descargasVigentes)(descargas);
    const porProducto = new Map();
    const fila = (productoId, nombre) => {
        let f = porProducto.get(productoId);
        if (!f) {
            f = { productoId, nombre, carga: 0, ventaContado: 0, ventaPromo: 0, cambios: 0, devolucionTeorica: 0, descarga: 0, diferencia: 0, rotas: 0, entregasFabrica: 0 };
            porProducto.set(productoId, f);
        }
        return f;
    };
    remitos.forEach((r) => (r.items ?? []).forEach((i) => { fila(i.productoId, i.nombre).carga += n(i.cantidad); }));
    // Entregas con remito de fábrica (Coto/Carrefour, 2026-09-23): bajaron del
    // camión sin venta de la app; Tango ya las tiene por el remito de la oficina.
    entregasFabrica.forEach((e) => (e.productos ?? []).forEach((i) => { fila(i.productoId, i.nombre).entregasFabrica += n(i.cantidad); }));
    ventasVigentes.forEach((v) => (v.items ?? []).forEach((i) => {
        const f = fila(i.productoId, i.nombre);
        if (v.canal === 'contado')
            f.ventaContado += n(i.cantidad);
        else
            f.ventaPromo += n(i.cantidad);
    }));
    // Los cambios viajan adentro de la venta (renglones en $0 del mismo papel);
    // `cambiosCamion` es el registro viejo, de cuando el cambio era otra pantalla.
    ventasVigentes.forEach((v) => (v.cambios ?? []).forEach((i) => {
        fila(productoDelCambio(i.productoId), nombreDelCambio(i.nombre)).cambios += n(i.cantidad);
    }));
    cambios.forEach((c) => { fila(productoDelCambio(c.productoId), nombreDelCambio(c.nombre)).cambios += n(c.cantidad); });
    vigentes.forEach((d) => (d.items ?? []).forEach((i) => { fila(i.productoId, i.nombre).descarga += n(i.cantidad); }));
    // Rotas por producto (fase B del stock, 2026-09-17): son la merma real que va
    // camión → 99. El id puede venir con prefijo cambio_ en descargas viejas.
    vigentes.forEach((d) => (d.bolsasRotas ?? []).forEach((i) => {
        fila(productoDelCambio(i.productoId), nombreDelCambio(i.nombre)).rotas += n(i.cantidad);
    }));
    const productos = [...porProducto.values()].map((f) => {
        const devolucionTeorica = f.carga - f.ventaContado - f.ventaPromo - f.cambios - f.entregasFabrica;
        return { ...f, devolucionTeorica, diferencia: f.descarga - devolucionTeorica };
    }).sort((a, b) => a.nombre.localeCompare(b.nombre));
    const registrados = ventasVigentes.reduce((s, v) => s + (v.cambios ?? []).reduce((x, i) => x + n(i.cantidad), 0), 0) +
        cambios.reduce((s, c) => s + n(c.cantidad), 0);
    const rotasRecibidas = vigentes.reduce((s, d) => s + (d.bolsasRotas ?? []).reduce((x, i) => x + n(i.cantidad), 0), 0);
    return { productos, envases: cuadrarEnvases(remitos, vigentes), cambios: { registrados, rotasRecibidas } };
}
/**
 * Un sobrante NO compensa un faltante: si faltan 12 bolsas de 3 kg y sobran 12
 * de escamas no es que "está", son dos desvíos, y taparlos entre sí es la fuga
 * que este control busca. Por eso el umbral se mide contra los faltantes solos.
 */
function calcularFaltante(productos, umbral = revisionDescarga_1.UMBRAL_FALTANTES_DEFAULT) {
    const faltan = productos
        .filter((p) => p.diferencia < 0)
        .map((p) => ({ productoId: p.productoId, nombre: p.nombre, faltan: -p.diferencia }))
        .sort((a, b) => b.faltan - a.faltan || a.nombre.localeCompare(b.nombre));
    const bolsasFaltantes = faltan.reduce((s, p) => s + p.faltan, 0);
    const bolsasSobrantes = productos.reduce((s, p) => s + Math.max(0, p.diferencia), 0);
    return {
        bolsasFaltantes,
        bolsasSobrantes,
        productos: faltan,
        grave: umbral.habilitado && umbral.bolsas > 0 && bolsasFaltantes >= umbral.bolsas,
        umbral: umbral.bolsas,
    };
}
/** El día 'yyyy-MM-dd' en hora argentina: en Cloud Functions el reloj local es UTC. */
const claveDiaAr = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
exports.claveDiaAr = claveDiaAr;
function viajeDeVenta(venta, viajes) {
    if (venta.remitoId)
        return venta.remitoId;
    if (!viajes.length)
        return null;
    const cuando = venta.fecha.toDate().getTime();
    const dia = (0, exports.claveDiaAr)(venta.fecha.toDate());
    const delDia = viajes.filter((r) => (0, exports.claveDiaAr)(r.fecha.toDate()) === dia);
    const mismos = venta.camionId
        ? delDia.filter((r) => r.camionId === venta.camionId)
        : venta.choferId
            ? delDia.filter((r) => r.choferId === venta.choferId)
            : [];
    if (!mismos.length)
        return null;
    // El último viaje que ya había salido cuando se hizo la venta. Si la venta es
    // anterior a todos (reloj corrido, venta cargada antes de salir), el primero.
    const anteriores = mismos
        .filter((r) => r.fecha.toDate().getTime() <= cuando)
        .sort((a, b) => b.fecha.toDate().getTime() - a.fecha.toDate().getTime());
    const ultimoAnterior = anteriores[0];
    if (ultimoAnterior)
        return ultimoAnterior.id;
    // `mismos` no está vacío (chequeado arriba): el más viejo siempre existe.
    return [...mismos].sort((a, b) => a.fecha.toDate().getTime() - b.fecha.toDate().getTime())[0].id;
}
/** Las ventas (o cobranzas) de UN viaje. */
const ventasDelViaje = (movimientos, viajes, remitoId) => movimientos.filter((m) => viajeDeVenta(m, viajes) === remitoId);
exports.ventasDelViaje = ventasDelViaje;
function armarCierreMercaderia(args) {
    const { remito, ventas, cambios, descargas, diaReparto, contadaPor, contadaEn } = args;
    const vigentes = (0, revisionDescarga_1.descargasVigentes)(descargas);
    const { productos, envases } = mercaderiaDelViaje([remito], ventas, cambios, descargas, args.entregasFabrica ?? []);
    return {
        id: remito.id,
        remitoId: remito.id,
        remitoCodigo: remito.codigo ?? '',
        plantaId: remito.plantaId ?? '',
        choferId: remito.choferId ?? '',
        choferNombre: remito.choferNombre ?? '',
        // Admin SDK rechaza `undefined`: sin depósito va null explícito.
        depositoTango: remito.depositoTango ?? null,
        depositoTangoNombre: remito.depositoTangoNombre ?? null,
        diaReparto,
        productos,
        envases,
        faltante: calcularFaltante(productos, args.umbral),
        // Solo las vigentes: una rectificada no compone el cierre (la reemplazó otra).
        descargaIds: vigentes.map((d) => d.id).filter((id) => !!id),
        descargaCodigos: vigentes.map((d) => d.codigo).filter((c) => !!c),
        contadaPor,
        contadaEn,
    };
}
//# sourceMappingURL=cierreMercaderia.js.map