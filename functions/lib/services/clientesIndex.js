"use strict";
// Índice liviano de clientes para buscar (2026-09-10). La búsqueda de cliente en
// la app (chofer al vender/cobrar, supervisor, ventanilla) bajaba la ficha
// completa de los 2.000+ clientes activos (precios de las dos empresas,
// direcciones, datos de Tango…): varios MB por 4G cada vez. Este índice tiene
// solo lo que hace falta para buscar y mostrar en la lista; la ficha completa
// se baja recién cuando se elige el cliente. Lo mantiene el trigger
// onClienteIndexado (users/{uid}) y lo carga el script backfill-clientes-index.
// Puro: sin Firebase.
Object.defineProperty(exports, "__esModule", { value: true });
exports.indiceDeCliente = indiceDeCliente;
exports.mismoIndice = mismoIndice;
const txt = (v) => String(v ?? '').trim();
/** Índice de un perfil de cliente; null si no es un cliente (rol distinto). */
function indiceDeCliente(uid, p) {
    if (!p || p.rol !== 'cliente')
        return null;
    const codigos = new Set();
    for (const x of [...(p.tangoIds?.redonhielo ?? []), ...(p.tangoIds?.rolito ?? [])])
        if (x?.codigo)
            codigos.add(txt(x.codigo));
    if (p.codigoTango && typeof p.idGva14Tango === 'number' && p.idGva14Tango > 0)
        codigos.add(txt(p.codigoTango));
    const principal = p.addresses?.find((a) => a?.esPrincipal) ?? p.addresses?.[0];
    const sucursales = [...new Set((p.addresses ?? []).map((a) => txt(a?.nombre)).filter((n) => n && n !== 'Principal'))];
    return {
        uid,
        razonSocial: txt(p.razonSocial) || txt(p.nombreContacto) || txt(p.nombre) || txt(p.email),
        nombreContacto: txt(p.nombreContacto),
        cuit: txt(p.cuit),
        ...(p.sinCuit ? { sinCuit: true } : {}),
        ...(txt(p.codigoCliente) ? { codigoCliente: txt(p.codigoCliente) } : {}),
        codigos: [...codigos],
        sucursales,
        direccion: txt(principal?.address) || txt(p.address),
        localidad: txt(p.localidadTango),
        estado: txt(p.estado) || 'pendiente',
        vinculadoTango: codigos.size > 0,
    };
}
/** ¿Cambió algo del índice? (para no reescribirlo cuando solo cambiaron precios u otros campos). */
function mismoIndice(a, b) {
    if (!a || !b)
        return a === b;
    const claves = ['uid', 'razonSocial', 'nombreContacto', 'cuit', 'sinCuit', 'codigoCliente', 'direccion', 'localidad', 'estado', 'vinculadoTango'];
    for (const k of claves)
        if ((a[k] ?? null) !== (b[k] ?? null))
            return false;
    return a.codigos.join('|') === b.codigos.join('|') && a.sucursales.join('|') === b.sucursales.join('|');
}
//# sourceMappingURL=clientesIndex.js.map