"use strict";
/**
 * Lógica fiscal pura para armar un comprobante electrónico de ARCA (WSFEv1).
 *
 * Todo lo de este archivo son funciones puras y testeables: NO habla con ARCA,
 * NO lee Firestore. El cliente SOAP vive en wsfev1.ts y la autenticación en
 * wsaa.ts. La separación es a propósito — esto es lo que decide cuánto IVA
 * paga un cliente, y tiene que poder probarse sin red ni credenciales.
 *
 * Referencia: manual "Facturación RG 4291 – Proyecto FE v4.8" de ARCA.
 * Relevamiento y decisiones en docs/arca/FACTURACION_ELECTRONICA.md.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_DIAS_DESFASE_EMISION = exports.CONCEPTO = exports.ALICUOTA_IVA = exports.TRIBUTO = exports.TIPO_DOCUMENTO = exports.FACTURA_POR_CLASE = exports.TIPO_COMPROBANTE = exports.CONDICION_IVA_NO_APLICA = exports.CONDICION_IVA_POR_CODIGO_TANGO = void 0;
exports.soloDigitos = soloDigitos;
exports.esCuitValido = esCuitValido;
exports.redondear2 = redondear2;
exports.percepcionVigente = percepcionVigente;
exports.calcularImportes = calcularImportes;
exports.validarReceptor = validarReceptor;
exports.diaCalendarioAr = diaCalendarioAr;
exports.formatearFechaArca = formatearFechaArca;
exports.validarVentanaEmision = validarVentanaEmision;
exports.construirDetalle = construirDetalle;
/**
 * Los `arcaId` fueron verificados contra `FEParamGetCondicionIvaReceptor` en
 * PRODUCCIÓN el 2026-09-01 y coinciden.
 *
 * ARCA acepta además 8 (Proveedor del Exterior), 9 (Cliente del Exterior),
 * 10 (IVA Liberado – Ley 19.640), 13 (Monotributista Social) y 16 (Monotributo
 * Trabajador Independiente Promovido). No están mapeados porque no sabemos con
 * qué código los representa Tango y ninguno aparece en la base actual; si
 * apareciera, `validarReceptor` lo frena con CONDICION_IVA_DESCONOCIDA en vez
 * de adivinar, que es lo que corresponde.
 */
exports.CONDICION_IVA_POR_CODIGO_TANGO = {
    RI: { arcaId: 1, descripcion: 'IVA Responsable Inscripto', clase: 'A' },
    RS: { arcaId: 6, descripcion: 'Responsable Monotributo', clase: 'A' },
    EX: { arcaId: 4, descripcion: 'IVA Sujeto Exento', clase: 'A' },
    CF: { arcaId: 5, descripcion: 'Consumidor Final', clase: 'B' },
    NC: { arcaId: 7, descripcion: 'Sujeto No Categorizado', clase: 'B' },
    NA: { arcaId: 15, descripcion: 'IVA No Alcanzado', clase: 'B' },
};
/**
 * Categorías que existen en Tango pero que NO corresponden a una venta de calle.
 * Se listan explícitamente para que caigan en "no facturable" con un motivo
 * claro, en vez de pasar por el default y emitir cualquier cosa.
 */
exports.CONDICION_IVA_NO_APLICA = {
    EXE: 'IVA exento por operación de exportación: no corresponde a una venta en calle',
};
// ── Tipos de comprobante (<CbteTipo>) ─────────────────────────────────────────
// Códigos estándar de ARCA. La lista autoritativa se consulta con
// FEParamGetTiposCbte; estos son los que usamos y no cambian.
exports.TIPO_COMPROBANTE = {
    FACTURA_A: 1,
    NOTA_DEBITO_A: 2,
    NOTA_CREDITO_A: 3,
    FACTURA_B: 6,
    NOTA_DEBITO_B: 7,
    NOTA_CREDITO_B: 8,
    FACTURA_C: 11,
    NOTA_DEBITO_C: 12,
    NOTA_CREDITO_C: 13,
};
exports.FACTURA_POR_CLASE = {
    A: exports.TIPO_COMPROBANTE.FACTURA_A,
    B: exports.TIPO_COMPROBANTE.FACTURA_B,
    C: exports.TIPO_COMPROBANTE.FACTURA_C,
};
// ── Tipos de documento del comprador (<DocTipo>) ──────────────────────────────
exports.TIPO_DOCUMENTO = {
    CUIT: 80,
    CUIL: 86,
    DNI: 96,
    /** Consumidor final sin identificar. Solo válido en B/C bajo el monto de la RG 4444. */
    SIN_IDENTIFICAR: 99,
};
// ── Tipos de tributo (<Tributos><Tributo><Id>) ────────────────────────────────
// Verificado contra FEParamGetTiposTributos en PRODUCCIÓN el 2026-09-01.
// El que nos interesa es el 7: la percepción de IIBB de CABA.
exports.TRIBUTO = {
    IMPUESTOS_NACIONALES: 1,
    IMPUESTOS_PROVINCIALES: 2,
    TRIBUTOS_MUNICIPALES: 3,
    IMPUESTOS_INTERNOS: 4,
    IIBB: 5,
    PERCEPCION_IVA: 6,
    /** Percepción de Ingresos Brutos — el que corresponde al padrón de AGIP. */
    PERCEPCION_IIBB: 7,
    PERCEPCION_TRIBUTOS_MUNICIPALES: 8,
    OTRAS_PERCEPCIONES: 9,
    PERCEPCION_IVA_NO_CATEGORIZADO: 13,
    OTRO: 99,
};
// ── Alícuotas de IVA (<Iva><AlicIva><Id>) ─────────────────────────────────────
// Verificado contra FEParamGetTiposIva en PRODUCCIÓN el 2026-09-01: los seis
// códigos coinciden exactamente con esta tabla.
exports.ALICUOTA_IVA = {
    CERO: { id: 3, porcentaje: 0 },
    DIEZ_CINCO: { id: 4, porcentaje: 10.5 },
    VEINTIUNO: { id: 5, porcentaje: 21 },
    VEINTISIETE: { id: 6, porcentaje: 27 },
    CINCO: { id: 8, porcentaje: 5 },
    DOS_CINCO: { id: 9, porcentaje: 2.5 },
};
/** Concepto del comprobante. La venta de hielo es siempre productos. */
exports.CONCEPTO = { PRODUCTOS: 1, SERVICIOS: 2, PRODUCTOS_Y_SERVICIOS: 3 };
// ── CUIT ──────────────────────────────────────────────────────────────────────
const PREFIJOS_CUIT_VALIDOS = ['20', '23', '24', '25', '26', '27', '30', '33', '34'];
const PESOS_CUIT = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
function soloDigitos(v) {
    return String(v ?? '').replace(/\D/g, '');
}
/**
 * Valida el dígito verificador de un CUIT.
 *
 * Importa más de lo que parece: un CUIT con 11 dígitos pero DV incorrecto pasa
 * cualquier chequeo de formato y después lo rechaza ARCA (validación 1417),
 * con el chofer ya en la calle y la mercadería entregada. Conviene detectarlo
 * antes de dejar facturar.
 */
function esCuitValido(cuit) {
    const d = soloDigitos(cuit);
    if (d.length !== 11)
        return false;
    if (/^(\d)\1{10}$/.test(d))
        return false;
    if (!PREFIJOS_CUIT_VALIDOS.includes(d.slice(0, 2)))
        return false;
    const suma = PESOS_CUIT.reduce((acc, peso, i) => acc + peso * Number(d[i]), 0);
    let dv = 11 - (suma % 11);
    if (dv === 11)
        dv = 0;
    if (dv === 10)
        dv = 9;
    return dv === Number(d[10]);
}
// ── Redondeo ──────────────────────────────────────────────────────────────────
/**
 * Redondeo "half even" (bancario) a 2 decimales — el mismo criterio que declara
 * usar ARCA en el manual. Con half-up nuestros totales podrían diferir de los
 * suyos por un centavo y hacer fallar la validación de que
 * ImpTotal = neto + IVA + exento + tributos.
 */
function redondear2(n) {
    const escalado = n * 100;
    const piso = Math.floor(escalado);
    const resto = escalado - piso;
    let redondeado;
    const EPS = 1e-9;
    if (Math.abs(resto - 0.5) < EPS) {
        redondeado = piso % 2 === 0 ? piso : piso + 1; // empate exacto → al par
    }
    else {
        redondeado = Math.round(escalado);
    }
    // El +0 evita devolver -0, que serializa como "-0" en el XML.
    return redondeado / 100 + 0;
}
/**
 * Verifica que el padrón del que salió la alícuota cubra la fecha de la venta.
 *
 * El padrón de AGIP vale un mes calendario. Usar una alícuota vencida no falla
 * en ningún lado: simplemente factura mal, en silencio. Por eso se chequea
 * explícitamente en vez de confiar en que el dato esté fresco.
 */
function percepcionVigente(p, fecha) {
    const f = diaCalendarioAr(fecha).indice;
    if (f < diaCalendarioAr(p.vigenciaDesde).indice || f > diaCalendarioAr(p.vigenciaHasta).indice) {
        const fmt = (d) => d.toISOString().slice(0, 10);
        return {
            vigente: false,
            motivo: `la alícuota de percepción de IIBB tiene vigencia ${fmt(p.vigenciaDesde)} a ` +
                `${fmt(p.vigenciaHasta)} y la venta es del ${fmt(fecha)}. ` +
                'Hay que importar el padrón de AGIP del mes en curso.',
        };
    }
    return { vigente: true };
}
/**
 * Calcula el desglose de IVA de un comprobante.
 *
 * Agrupa por alícuota (ARCA quiere un <AlicIva> por tasa, no uno por ítem) y
 * garantiza que ImpTotal sea exactamente la suma de sus partes, que es lo que
 * validan del otro lado.
 */
function calcularImportes(items, opciones) {
    if (items.length === 0)
        throw new Error('El comprobante no tiene ítems');
    // Acumula por alícuota, en centavos redondeados por ítem para que la suma no
    // arrastre fracciones invisibles.
    const porAlicuota = new Map();
    for (const item of items) {
        if (!(item.cantidad > 0)) {
            throw new Error(`Cantidad inválida en "${item.descripcion}": ${item.cantidad}`);
        }
        if (!(item.precioUnitario >= 0)) {
            throw new Error(`Precio inválido en "${item.descripcion}": ${item.precioUnitario}`);
        }
        const alic = item.alicuotaIva ?? exports.ALICUOTA_IVA.VEINTIUNO;
        const bruto = item.cantidad * item.precioUnitario;
        const factor = 1 + alic.porcentaje / 100;
        const base = redondear2(opciones.preciosIncluyenIva ? bruto / factor : bruto);
        const iva = redondear2(base * (alic.porcentaje / 100));
        const acc = porAlicuota.get(alic.id) ?? { porcentaje: alic.porcentaje, base: 0, iva: 0 };
        acc.base = redondear2(acc.base + base);
        acc.iva = redondear2(acc.iva + iva);
        porAlicuota.set(alic.id, acc);
    }
    const Iva = [...porAlicuota.entries()]
        .map(([Id, v]) => ({ Id, BaseImp: v.base, Importe: v.iva }))
        .sort((a, b) => a.Id - b.Id);
    const ImpNeto = redondear2(Iva.reduce((s, i) => s + i.BaseImp, 0));
    const ImpIVA = redondear2(Iva.reduce((s, i) => s + i.Importe, 0));
    // Sin operaciones no gravadas ni exentas en la venta de calle.
    const ImpTotConc = 0;
    const ImpOpEx = 0;
    // Percepción de IIBB: se calcula sobre el NETO, sin monto mínimo (CABA).
    const Tributos = [];
    const p = opciones.percepcionIIBB;
    if (p && p.alicuota > 0) {
        Tributos.push({
            Id: p.tributoId,
            Desc: p.descripcion ?? 'Percepción IIBB CABA',
            BaseImp: ImpNeto,
            Alic: p.alicuota,
            Importe: redondear2(ImpNeto * (p.alicuota / 100)),
        });
    }
    // ARCA valida que ImpTrib sea la suma de los importes de <Tributos>
    // (validación 10029), así que se deriva en vez de recibirse.
    const ImpTrib = redondear2(Tributos.reduce((s, t) => s + t.Importe, 0));
    return {
        ImpNeto,
        ImpIVA,
        ImpTotConc,
        ImpOpEx,
        ImpTrib,
        ImpTotal: redondear2(ImpNeto + ImpIVA + ImpTotConc + ImpOpEx + ImpTrib),
        Iva,
        Tributos,
    };
}
/**
 * Decide si a un cliente se le puede emitir factura, y con qué comprobante.
 *
 * Es el guard que pidió Ariel: mientras un cliente no tenga la configuración
 * impositiva correcta, la facturación no debe avanzar. Se usa en dos lugares —
 * la pantalla del chofer (para no dejar cerrar la venta en contado) y la Cloud
 * Function (que es donde realmente se hace cumplir; la UI solo oculta).
 */
function validarReceptor(datos) {
    const motivos = [];
    const detalles = [];
    const codigo = (datos.categoriaIvaTango ?? '').trim().toUpperCase();
    let condicion = null;
    if (!codigo) {
        motivos.push('SIN_CONDICION_IVA');
        detalles.push('el cliente no tiene condición frente al IVA cargada');
    }
    else if (exports.CONDICION_IVA_NO_APLICA[codigo]) {
        motivos.push('CONDICION_IVA_NO_APLICA');
        detalles.push(exports.CONDICION_IVA_NO_APLICA[codigo]);
    }
    else if (!exports.CONDICION_IVA_POR_CODIGO_TANGO[codigo]) {
        motivos.push('CONDICION_IVA_DESCONOCIDA');
        detalles.push(`condición frente al IVA no reconocida: "${codigo}"`);
    }
    else {
        condicion = exports.CONDICION_IVA_POR_CODIGO_TANGO[codigo];
    }
    const cuit = soloDigitos(datos.cuit);
    if (!cuit) {
        motivos.push('SIN_CUIT');
        detalles.push('el cliente no tiene CUIT cargado');
    }
    else if (!esCuitValido(cuit)) {
        motivos.push('CUIT_INVALIDO');
        detalles.push(`el CUIT ${cuit} no supera la validación de dígito verificador`);
    }
    if (!String(datos.razonSocial ?? '').trim()) {
        motivos.push('SIN_RAZON_SOCIAL');
        detalles.push('el cliente no tiene razón social');
    }
    if (motivos.length > 0 || !condicion) {
        return { facturable: false, motivos, detalle: detalles.join('; ') };
    }
    return { facturable: true, condicion, cuit, claseComprobante: condicion.clase };
}
/**
 * Descompone una fecha en su día calendario **de Argentina**.
 *
 * Todas las fechas fiscales son días calendario argentinos, no instantes UTC.
 * Comparar con `getTime()` o con `getMonth()` (que usa la zona de la máquina,
 * y en un servidor es UTC) hace que una venta de las 23:00 caiga en el día
 * siguiente: el 30 de septiembre a las 23 pasa a ser 1 de octubre y rompe tanto
 * el chequeo de cierre de mes como la vigencia del padrón.
 */
function diaCalendarioAr(fecha) {
    const enAr = new Date(fecha.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
    const anio = enAr.getFullYear();
    const mes = enAr.getMonth() + 1;
    const dia = enAr.getDate();
    return {
        anio,
        mes,
        dia,
        // Índice de día absoluto, para restar fechas sin que moleste el horario.
        indice: Math.floor(Date.UTC(anio, mes - 1, dia) / 86400000),
    };
}
/** Formatea una fecha como yyyymmdd en hora local de Argentina. */
function formatearFechaArca(fecha) {
    const { anio, mes, dia } = diaCalendarioAr(fecha);
    return `${anio}${String(mes).padStart(2, '0')}${String(dia).padStart(2, '0')}`;
}
/**
 * Diferencia en días entre la fecha de la venta y la de emisión.
 *
 * ARCA acepta que CbteFch esté hasta 5 días corrido antes o después de la fecha
 * de generación para Concepto=1 (Productos), sin cruzar el mes de presentación.
 * Es lo que nos permite vender sin señal y pedir el CAE después conservando la
 * fecha real de la venta.
 */
exports.MAX_DIAS_DESFASE_EMISION = 5;
function validarVentanaEmision(fechaVenta, fechaEmision) {
    const venta = diaCalendarioAr(fechaVenta);
    const emision = diaCalendarioAr(fechaEmision);
    const diff = Math.abs(emision.indice - venta.indice);
    if (diff > exports.MAX_DIAS_DESFASE_EMISION) {
        return {
            valida: false,
            motivo: `la venta es de hace ${diff} días y ARCA solo admite ${exports.MAX_DIAS_DESFASE_EMISION}`,
        };
    }
    if (venta.mes !== emision.mes || venta.anio !== emision.anio) {
        return {
            valida: false,
            motivo: 'la fecha del comprobante no puede exceder el mes de presentación',
        };
    }
    return { valida: true };
}
/**
 * Arma el detalle a mandarle a FECAESolicitar.
 *
 * Tira si el receptor no es facturable: es preferible fallar acá, con un motivo
 * legible, que mandarle a ARCA un comprobante que va a rechazar.
 */
function construirDetalle(datos, opciones) {
    const validacion = validarReceptor(datos.receptor);
    if (!validacion.facturable) {
        throw new Error(`Cliente no facturable: ${validacion.detalle}`);
    }
    // Si al cliente le corresponde percepción, el padrón del que salió la alícuota
    // tiene que cubrir la fecha de la venta. Un padrón vencido no da error en
    // ningún lado: factura mal y nadie se entera.
    if (opciones.percepcionIIBB) {
        const vig = percepcionVigente(opciones.percepcionIIBB, datos.fechaVenta);
        if (!vig.vigente)
            throw new Error(`No se puede facturar: ${vig.motivo}`);
    }
    const importes = calcularImportes(datos.items, opciones);
    return {
        claseComprobante: validacion.claseComprobante,
        cbteTipo: exports.FACTURA_POR_CLASE[validacion.claseComprobante],
        detalle: {
            Concepto: exports.CONCEPTO.PRODUCTOS,
            DocTipo: exports.TIPO_DOCUMENTO.CUIT,
            DocNro: Number(validacion.cuit),
            CbteDesde: datos.numeroComprobante,
            CbteHasta: datos.numeroComprobante,
            CbteFch: formatearFechaArca(datos.fechaVenta),
            ImpTotal: importes.ImpTotal,
            ImpTotConc: importes.ImpTotConc,
            ImpNeto: importes.ImpNeto,
            ImpOpEx: importes.ImpOpEx,
            ImpTrib: importes.ImpTrib,
            ImpIVA: importes.ImpIVA,
            MonId: 'PES',
            MonCotiz: 1,
            CondicionIVAReceptorId: validacion.condicion.arcaId,
            Iva: importes.Iva,
            Tributos: importes.Tributos,
        },
    };
}
//# sourceMappingURL=comprobante.js.map