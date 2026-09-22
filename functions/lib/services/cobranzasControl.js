"use strict";
/**
 * Control del recibo del lado servidor (auditoría 2026-09-22).
 *
 * La triple igualdad del recibo (valores recibidos = importe; imputado ≤
 * recibido; a cuenta = recibido − imputado) se validaba SOLO en el navegador
 * del que cobra (cobranzaService.crearCobranzaCompleta) y las reglas no
 * pueden sumar arrays. Un recibo armado a mano con la consola viajaba a Tango
 * igual. Acá se recalcula con la misma cuenta, en centavos; si no cuadra, la
 * cobranza se marca (`control.descuadre`), NO se encola a Tango ni descuenta
 * el saldo, y se avisa a la oficina. No se corrige el doc: es la prueba de lo
 * que se declaró.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.controlarRecibo = controlarRecibo;
exports.avisoDescuadre = avisoDescuadre;
const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const cent = (v) => Math.round(n(v) * 100);
const suma = (xs, campo) => Array.isArray(xs) ? xs.reduce((s, x) => s + cent(x?.[campo]), 0) : 0;
/** `null` si el recibo cuadra (tolerancia de $1 por redondeos); si no, los motivos. */
function controlarRecibo(c, tolerancia = 100) {
    const m = c.medios ?? {};
    const aplicado = suma(m.aCuentaAplicado, 'importe');
    const totalMedios = cent(m.efectivo) + cent(m.transferencia) + suma(m.cheques, 'importe') + suma(m.retenciones, 'importe') + aplicado;
    const totalImputado = suma(c.imputaciones, 'importeImputado');
    const importe = cent(c.importe);
    const aCuenta = cent(c.aCuenta);
    const motivos = [];
    if (totalMedios <= 0)
        motivos.push('No hay valores recibidos.');
    if (Math.abs(importe - totalMedios) > tolerancia)
        motivos.push('El importe del recibo no es la suma de los valores recibidos.');
    if (totalImputado > totalMedios + tolerancia)
        motivos.push('Lo imputado a facturas supera los valores recibidos.');
    const aCuentaEsperado = Math.max(0, totalMedios - totalImputado);
    if (Math.abs(aCuenta - aCuentaEsperado) > tolerancia)
        motivos.push('Lo que queda a cuenta no es recibido menos imputado.');
    if (aplicado > 0 && aCuenta > tolerancia)
        motivos.push('Aplica saldo a favor y deja plata a cuenta en el mismo recibo.');
    if (Array.isArray(c.imputaciones)) {
        for (const i of c.imputaciones) {
            const imp = cent(i?.importeImputado), saldo = cent(i?.saldoAlMomento);
            if (imp <= 0) {
                motivos.push('Hay una imputación en cero.');
                break;
            }
            if (saldo > 0 && imp > saldo + tolerancia) {
                motivos.push('Hay una imputación mayor al saldo de la factura.');
                break;
            }
        }
    }
    if (Array.isArray(m.aCuentaAplicado) && m.aCuentaAplicado.some((a) => cent(a?.importe) <= 0 || !a?.reciboNumero)) {
        motivos.push('Hay un saldo a favor aplicado en cero o sin recibo.');
    }
    if (!motivos.length)
        return null;
    return { motivos, importe: importe / 100, totalMedios: totalMedios / 100, totalImputado: totalImputado / 100, aCuenta: aCuenta / 100 };
}
const pesos = (x) => '$' + x.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
function avisoDescuadre(c, d) {
    const quien = String(c.registradoPor?.nombre ?? '').trim();
    return {
        titulo: 'Recibo que no cuadra',
        cuerpo: `${c.numeroRecibo ? `Recibo ${String(c.numeroRecibo)}` : 'Recibo sin número'}${quien ? ` de ${quien}` : ''} a ${String(c.clienteNombre ?? '')}: importe ${pesos(d.importe)}, valores ${pesos(d.totalMedios)}, imputado ${pesos(d.totalImputado)}. ${d.motivos[0]} No se mandó a Tango.`,
    };
}
//# sourceMappingURL=cobranzasControl.js.map