"use strict";
// CUIT/CUIL argentino: 11 dígitos con dígito verificador (módulo 11). Se usa
// para decidir si un CUIT de Tango identifica de verdad a un cliente (vínculo
// entre empresas, alta automática de cuentas, login por CUIT) o es un relleno
// tipo "00000000000" / "11111111111" / consumidor final.
Object.defineProperty(exports, "__esModule", { value: true });
exports.soloDigitos = void 0;
exports.cuitValido = cuitValido;
const soloDigitos = (v) => (v == null ? '' : String(v).replace(/\D/g, ''));
exports.soloDigitos = soloDigitos;
const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
function cuitValido(v) {
    const d = (0, exports.soloDigitos)(v);
    if (d.length !== 11)
        return false;
    if (/^(\d)\1{10}$/.test(d))
        return false; // 00000000000, 11111111111, …
    const suma = PESOS.reduce((s, p, i) => s + p * Number(d[i]), 0);
    const resto = suma % 11;
    const dv = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto;
    return dv === Number(d[10]);
}
//# sourceMappingURL=cuit.js.map