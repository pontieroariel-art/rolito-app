"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orsDirections = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const params_1 = require("firebase-functions/params");
const orsKey = (0, params_1.defineSecret)('ORS_KEY');
// Proxy server-side de ORS Directions. La API key de OpenRouteService vive como
// secreto de Functions (ORS_KEY) y NUNCA se manda al navegador — antes viajaba
// en el bundle como VITE_ORS_KEY, extraíble por cualquiera para gastar la cuota.
// Solo el staff planifica rutas; el cliente no llama esto. Ante cualquier fallo
// de ORS se lanza HttpsError para que el cliente use su fallback local.
exports.orsDirections = (0, https_1.onCall)({ secrets: [orsKey] }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Requiere autenticación');
    const snap = await (0, firestore_1.getFirestore)().doc(`users/${request.auth.uid}`).get();
    const rol = (snap.data()?.rol ?? snap.data()?.role);
    if (!rol || rol === 'cliente') {
        throw new https_1.HttpsError('permission-denied', 'Solo el staff puede calcular rutas');
    }
    const { coordinates, avoidPolygons } = (request.data ?? {});
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
        throw new https_1.HttpsError('invalid-argument', 'Se requieren al menos 2 coordenadas');
    }
    const body = { coordinates };
    if (avoidPolygons && Array.isArray(avoidPolygons.coordinates) && avoidPolygons.coordinates.length > 0) {
        body.options = { avoid_polygons: avoidPolygons };
    }
    let data;
    try {
        const res = await fetch('https://api.openrouteservice.org/v2/directions/driving-hgv/geojson', {
            method: 'POST',
            headers: { Authorization: orsKey.value(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        data = await res.json();
    }
    catch (err) {
        throw new https_1.HttpsError('unavailable', `ORS inaccesible: ${err instanceof Error ? err.message : 'error'}`);
    }
    const feature = data.features?.[0];
    const segments = feature?.properties?.segments;
    if (!feature?.geometry?.coordinates || !segments) {
        throw new https_1.HttpsError('unavailable', data.error?.message ?? 'Sin ruta de ORS');
    }
    return { geometry: { coordinates: feature.geometry.coordinates }, segments };
});
//# sourceMappingURL=routing.js.map