// El QR de la RG 4892, obligatorio en todo comprobante electrónico.
//
// Vive aparte porque lo necesitan los dos comprobantes que imprime la app y no
// tienen nada más en común: el histórico que se reimprime en el recupero
// (`facturaPdf.ts`) y el que la app emite con ARCA (`facturaArcaPdf.ts`).

export interface DatosQrArca {
  fechaEmision: Date
  cuitEmisor:   string
  puntoVenta:   number
  /** Código de tipo de comprobante de ARCA: '01' = Factura A, '06' = Factura B. */
  codigoTipo:   string
  numero:       number
  importeTotal: number
  cuitReceptor: string
  cae:          string
}

const soloDigitos = (s: string) => String(s ?? '').replace(/\D/g, '')

function aBase64(texto: string): string {
  if (typeof btoa === 'function') return btoa(texto)
  return Buffer.from(texto, 'utf-8').toString('base64')
}

/**
 * Arma la URL que codifica el QR: el JSON del comprobante en base64, colgado de
 * la página de ARCA que lo valida.
 */
export function urlQrArca(d: DatosQrArca): string {
  const datos = {
    ver:        1,
    fecha:      `${d.fechaEmision.getFullYear()}-${String(d.fechaEmision.getMonth() + 1).padStart(2, '0')}-${String(d.fechaEmision.getDate()).padStart(2, '0')}`,
    cuit:       Number(soloDigitos(d.cuitEmisor)),
    ptoVta:     d.puntoVenta,
    tipoCmp:    Number(d.codigoTipo),
    nroCmp:     d.numero,
    importe:    Number(d.importeTotal.toFixed(2)),
    moneda:     'PES',
    ctz:        1,
    tipoDocRec: 80,                                // 80 = CUIT
    nroDocRec:  Number(soloDigitos(d.cuitReceptor)),
    tipoCodAut: 'E',                               // E = CAE
    codAut:     Number(soloDigitos(d.cae)),
  }
  return `https://www.afip.gob.ar/fe/qr/?p=${aBase64(JSON.stringify(datos))}`
}
