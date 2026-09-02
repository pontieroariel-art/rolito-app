// Factura en PDF — réplica del comprobante HISTÓRICO, el que emitía Bluesoft.
//
// ⚠️ Este es el formato de las facturas VIEJAS: el que los clientes con deuda
// anterior al corte ya recibieron alguna vez, con la conservadora de marca de
// agua. Se usa para reimprimir esas facturas (pantalla /admin/recupero-facturas),
// no para las que la app emita de acá en adelante. Si la facturación propia con
// ARCA termina necesitando otro diseño, va en un módulo aparte — este tiene que
// seguir produciendo el comprobante viejo tal cual, o las reimpresiones dejan
// de coincidir con los originales.
//
// Vive aparte de utils/pdf.ts a propósito: el resto de los generadores usan el
// estilo de la casa (logo arriba, línea verde, autoTable), y esto es un
// formulario FISCAL cuyo layout no se elige — replica el comprobante que los
// clientes ya conocen y tiene que cumplir la RG 4892 (QR) y el código de
// barras del pie. Cambiarlo por estética es un error, no una mejora.
//
// Todo el dibujo es sin DOM (rects y texto) salvo el logo, así que el mismo
// código corre en el browser y en Node — útil para previsualizar el layout.

import { generateQrDataUrl } from './qr'

// ── Datos del emisor ─────────────────────────────────────────────────────────
// Relevados de una factura A real (00101-00282302). El domicilio acá difiere
// del de ROLITO_INFO ("Ruta Panamericana Km. 25.700"): en el comprobante
// fiscal va tal cual está inscripto en ARCA.
export const EMISOR_REDONHIELO = {
  razonSocial:      'REDONHIELO S.A.',
  domicilio:        'Av. Panamericana Km 25,700',
  cp:               '1611',
  localidad:        'Don Torcuato, (Buenos Aires)',
  telefono:         '(011) 4741-8000',
  email:            'ventas@redonhielo.com.ar',
  condicionIva:     'Iva Responsable Inscripto',
  cbu:              '0720072420000001271304',
  cuit:             '30697668973',
  ingresosBrutos:   '9024264411',
  inicioActividad:  '1/7/1998',
}

export interface FacturaRenglon {
  descripcion:     string
  um:              string
  cantidad:        number
  precioUnitario:  number
  descuento?:      number      // % de bonificación
  importe:         number
  /** Líneas sueltas debajo del renglón (ej. la orden de compra del cliente). */
  notas?:          string[]
}

export interface FacturaPdfData {
  /** Letra del comprobante y su código ARCA ('01' = Factura A). */
  letra:        'A' | 'B' | 'C'
  codigoTipo:   string
  titulo:       string        // 'FACTURA' | 'NOTA DE CREDITO' | 'NOTA DE DEBITO'
  puntoVenta:   number
  numero:       number
  fechaEmision: Date
  fechaVencimiento?: Date | null

  emisor?: typeof EMISOR_REDONHIELO

  cliente: {
    razonSocial:    string
    domicilio:      string
    cp:             string
    localidad:      string
    condicionIva:   string
    cuit:           string
    codigo:         string
    vendedor:       string
    condicionVenta: string
  }

  remitosOC?:  string
  renglones:   FacturaRenglon[]

  totales: {
    netoGravado:      number
    exento:           number
    percIibbCaba:     number
    percIibbCabaAlic: number
    iva:              number
    ivaAlic:          number
    percIibbBa:       number
    percIibbBaAlic:   number
    internos:         number
    total:            number
  }

  cae:     string
  caeVto:  Date

  /** Ej. 'DUPLICADO — REIMPRESIÓN'. Se dibuja arriba a la derecha. */
  leyendaCopia?: string
  /** Logo ya en base64 (para correr fuera del browser). */
  logoDataUrl?: string
  /**
   * Marca de agua del cuerpo (la conservadora Rolito del comprobante
   * original), ya en base64. Si no viene, se toma de
   * `/marca-agua-factura.jpg`; si tampoco está, la factura sale sin marca.
   */
  marcaDeAguaDataUrl?: string
  /** 0 a 1. Por defecto 0,08: visible en papel sin comerse el texto. */
  marcaDeAguaOpacidad?: number
  /** Si es false, devuelve el blob en vez de descargar. */
  descargar?: boolean
}

// ── Formato de números ───────────────────────────────────────────────────────
// El comprobante original NO agrupa miles: "108432,94", no "108.432,94".
const fmt = (n: number) =>
  n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })

const fecha = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
const fechaISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const fechaCompacta = (d: Date) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`

// ── Importe en letras ────────────────────────────────────────────────────────
const UNIDADES = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE',
  'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE',
  'VEINTE', 'VEINTIUNO', 'VEINTIDOS', 'VEINTITRES', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISEIS',
  'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE']
const DECENAS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA']
const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS',
  'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS']

function menorAMil(n: number): string {
  if (n === 0) return ''
  if (n === 100) return 'CIEN'
  const c = Math.floor(n / 100)
  const r = n % 100
  const partes: string[] = []
  if (c > 0) partes.push(CENTENAS[c])
  if (r > 0) {
    if (r < 30) partes.push(UNIDADES[r])
    else {
      const dec = Math.floor(r / 10)
      const uni = r % 10
      partes.push(uni > 0 ? `${DECENAS[dec]} Y ${UNIDADES[uni]}` : DECENAS[dec])
    }
  }
  return partes.join(' ')
}

export function importeEnLetras(importe: number): string {
  // Se redondea a centavos ANTES de partir el número: hacerlo al revés deja
  // que un 1,999 salga como "UNO CON 100/100".
  const enCentavos = Math.round(Math.abs(importe) * 100)
  const entero     = Math.floor(enCentavos / 100)
  const centavos   = enCentavos % 100
  const centStr    = `${String(centavos).padStart(2, '0')}/100`
  if (entero === 0) return `CERO CON ${centStr}`

  const millones = Math.floor(entero / 1_000_000)
  const miles    = Math.floor((entero % 1_000_000) / 1000)
  const resto    = entero % 1000

  const partes: string[] = []
  if (millones > 0) partes.push(millones === 1 ? 'UN MILLON' : `${menorAMil(millones)} MILLONES`)
  if (miles > 0)    partes.push(miles === 1 ? 'MIL' : `${menorAMil(miles)} MIL`)
  if (resto > 0)    partes.push(menorAMil(resto))

  return `${partes.join(' ')} CON ${centStr}`
}

// ── Código de barras del pie (Interleaved 2 of 5, RG 4892) ───────────────────
// Se dibuja con rectángulos en vez de usar jsbarcode + <canvas>: la librería
// no hace I25 con el ancho que pide ARCA y el canvas ataría el generador al DOM.
const I25_PATRONES: Record<string, string> = {
  '0': 'NNWWN', '1': 'WNNNW', '2': 'NWNNW', '3': 'WWNNN', '4': 'NNWNW',
  '5': 'WNWNN', '6': 'NWWNN', '7': 'NNNWW', '8': 'WNNWN', '9': 'NWNWN',
}

/**
 * Dígito verificador del código de barras, según el algoritmo de ARCA:
 * suma de posiciones impares × 3 + suma de pares, completado al múltiplo de 10.
 */
export function digitoVerificadorBarras(cadena: string): number {
  let impares = 0
  let pares   = 0
  for (let i = 0; i < cadena.length; i++) {
    const digito = Number(cadena[i])
    // Posición 1 = índice 0 (impar).
    if (i % 2 === 0) impares += digito
    else pares += digito
  }
  const suma = impares * 3 + pares
  return (10 - (suma % 10)) % 10
}

/** CUIT(11) + tipo(2) + pto vta(4) + CAE(14) + vto CAE(AAAAMMDD) + DV. */
export function cadenaCodigoBarras(d: FacturaPdfData): string {
  const emisor = d.emisor ?? EMISOR_REDONHIELO
  const base =
    emisor.cuit.replace(/\D/g, '').padStart(11, '0') +
    d.codigoTipo.padStart(2, '0') +
    String(d.puntoVenta).padStart(4, '0') +
    d.cae.replace(/\D/g, '').padStart(14, '0') +
    fechaCompacta(d.caeVto)
  return base + digitoVerificadorBarras(base)
}

interface Lienzo { rect(x: number, y: number, w: number, h: number, style?: string): void }

/**
 * Dibuja la cadena en I25 ocupando exactamente `ancho` mm.
 *
 * El ratio ancho/angosto es 2:1 (el estándar admite de 2:1 a 3:1): con 40
 * dígitos y los ~74 mm que sobran a la derecha del pie, 3:1 dejaría el módulo
 * angosto en 0,20 mm — por debajo de lo que un lector de mano resuelve.
 */
function dibujarI25(doc: Lienzo, cadena: string, x: number, y: number, alto: number, ancho: number) {
  const digitos = cadena.length % 2 === 0 ? cadena : '0' + cadena
  // Módulos: start 4 + stop 5 + 7 por dígito (2 anchos de 2 + 3 angostos).
  const modulos = 4 + 5 + digitos.length * 7
  const N = ancho / modulos
  const W = N * 2
  let cursor = x

  const barra   = (ancho: number) => { doc.rect(cursor, y, ancho, alto, 'F'); cursor += ancho }
  const espacio = (ancho: number) => { cursor += ancho }

  // Start: barra-espacio-barra-espacio, todos angostos.
  barra(N); espacio(N); barra(N); espacio(N)

  for (let i = 0; i < digitos.length; i += 2) {
    const pBarras   = I25_PATRONES[digitos[i]]
    const pEspacios = I25_PATRONES[digitos[i + 1]]
    for (let k = 0; k < 5; k++) {
      barra(pBarras[k] === 'W' ? W : N)
      espacio(pEspacios[k] === 'W' ? W : N)
    }
  }

  // Stop: barra ancha, espacio angosto, barra angosta.
  barra(W); espacio(N); barra(N)
}

// ── QR de la RG 4892 ─────────────────────────────────────────────────────────
function aBase64(texto: string): string {
  if (typeof btoa === 'function') return btoa(texto)
  return Buffer.from(texto, 'utf-8').toString('base64')
}

export function urlQrAfip(d: FacturaPdfData): string {
  const emisor = d.emisor ?? EMISOR_REDONHIELO
  const datos = {
    ver:        1,
    fecha:      fechaISO(d.fechaEmision),
    cuit:       Number(emisor.cuit.replace(/\D/g, '')),
    ptoVta:     d.puntoVenta,
    tipoCmp:    Number(d.codigoTipo),
    nroCmp:     d.numero,
    importe:    Number(d.totales.total.toFixed(2)),
    moneda:     'PES',
    ctz:        1,
    tipoDocRec: 80,                                       // 80 = CUIT
    nroDocRec:  Number(d.cliente.cuit.replace(/\D/g, '')),
    tipoCodAut: 'E',                                      // E = CAE
    codAut:     Number(d.cae.replace(/\D/g, '')),
  }
  return `https://www.afip.gob.ar/fe/qr/?p=${aBase64(JSON.stringify(datos))}`
}

// ── El comprobante ───────────────────────────────────────────────────────────
const X0 = 8            // margen izquierdo del marco
const X1 = 202          // margen derecho
const XM = 105          // divisoria del encabezado

export async function generateFacturaPdf(d: FacturaPdfData): Promise<Blob | void> {
  // Named import, no `default`: así el módulo también se resuelve corriendo en
  // Node (el interop CJS no expone el constructor en `default`), que es como
  // lo usa el script de recupero de facturas viejas de Tango.
  const { jsPDF, GState }      = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  // A4 vertical. `compress` no es opcional acá: jsPDF re-embebe las imágenes
  // sin comprimir y cada factura pasa de ~100 KB a más de medio MB — con un
  // lote de mil comprobantes, la diferencia es media hora de mail.
  const doc    = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const emisor = d.emisor ?? EMISOR_REDONHIELO
  const nroStr = `${String(d.puntoVenta).padStart(5, '0')} - ${String(d.numero).padStart(8, '0')}`

  // ── Marca de agua ──────────────────────────────────────────────────────────
  // Va PRIMERO: jsPDF pinta en orden de llamada y no tiene z-index, así que
  // todo lo demás queda encima. El resto de los recuadros no tienen relleno
  // (salvo el de la letra, que la tapa a propósito, igual que el original).
  // Como JPEG: la marca es una foto sin transparencia y el PNG original suma
  // varios MB al PDF, que después se manda por mail.
  const marca = d.marcaDeAguaDataUrl ?? (await fetchImagenPublica('/marca-agua-factura.jpg', 700, 'JPEG'))
  if (marca) {
    const props = doc.getImageProperties(marca)
    const ANCHO = 95
    const alto  = (props.height / props.width) * ANCHO
    doc.saveGraphicsState()
    doc.setGState(new GState({ opacity: d.marcaDeAguaOpacidad ?? 0.08 }))
    doc.addImage(marca, props.fileType === 'JPEG' ? 'JPEG' : 'PNG', 105 - ANCHO / 2, 150 - alto / 2, ANCHO, alto)
    doc.restoreGraphicsState()
  }

  doc.setLineWidth(0.3)
  doc.setDrawColor(0)
  doc.setTextColor(0)

  // ── Encabezado ─────────────────────────────────────────────────────────────
  const HEAD_Y = 10
  const HEAD_H = 48
  doc.rect(X0, HEAD_Y, X1 - X0, HEAD_H)
  doc.line(XM, HEAD_Y, XM, HEAD_Y + HEAD_H)

  // Recuadro de la letra, montado sobre la divisoria.
  doc.setFillColor(255, 255, 255)
  doc.rect(XM - 9, HEAD_Y + 1, 18, 17, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(24)
  doc.text(d.letra, XM, HEAD_Y + 12, { align: 'center' })
  doc.setFontSize(3.6)
  doc.setFont('helvetica', 'normal')
  doc.text('COMPROBANTE AUTORIZADO', XM, HEAD_Y + 16, { align: 'center' })

  // Izquierda: logo + datos del emisor.
  const logo = d.logoDataUrl ?? (await fetchImagenPublica('/logo-rolito-factura.png'))
  if (logo) doc.addImage(logo, 'PNG', X0 + 4, HEAD_Y + 3, 26, 8.8)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text(emisor.razonSocial, X0 + 4, HEAD_Y + 21)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  let y = HEAD_Y + 26
  for (const linea of [
    `Domicilio: ${emisor.domicilio}`,
    `C.P.: ${emisor.cp}, ${emisor.localidad}`,
    `Tel.: ${emisor.telefono}`,
    `Email: ${emisor.email}`,
    emisor.condicionIva,
    `CBU. Nº: ${emisor.cbu}`,
  ]) {
    doc.text(linea, X0 + 4, y)
    y += 3.6
  }

  // Derecha: tipo, número y datos fiscales.
  doc.setFontSize(8)
  doc.text(`Código Nº: ${d.codigoTipo}`, XM + 12, HEAD_Y + 8)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text(d.titulo, XM + 32, HEAD_Y + 9)

  doc.setFontSize(9)
  doc.text(`Nº:${nroStr}`, XM + 32, HEAD_Y + 16)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  y = HEAD_Y + 22
  for (const [etiqueta, valor] of [
    ['Fecha:', fecha(d.fechaEmision)],
    ['Fecha vencimiento:', d.fechaVencimiento ? fecha(d.fechaVencimiento) : ''],
    ['C.U.I.T.:', emisor.cuit],
    ['ING. BRUTOS N:', emisor.ingresosBrutos],
    ['INICIO ACTIVIDAD', emisor.inicioActividad],
  ] as [string, string][]) {
    doc.text(etiqueta, XM + 32, y)
    doc.text(valor, XM + 68, y)
    y += 4.4
  }

  if (d.leyendaCopia) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(120)
    doc.text(d.leyendaCopia, X1 - 3, HEAD_Y + 4.5, { align: 'right' })
    doc.setTextColor(0)
  }

  // ── Cliente ────────────────────────────────────────────────────────────────
  const CLI_Y = HEAD_Y + HEAD_H
  const CLI_H = 36
  doc.rect(X0, CLI_Y, X1 - X0, CLI_H)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.text('SEÑOR(ES):', X0 + 4, CLI_Y + 6)

  // La razón social se achica hasta entrar en la mitad izquierda: hay clientes
  // con nombres largos ("OPERADORA DE ESTACIONES DE SERVICIOS S.A.(NORDELTA)")
  // que a 11 pt se meterían en la columna de la derecha.
  const ANCHO_RAZON = XM - X0 - 8
  let tamRazon = 11
  doc.setFontSize(tamRazon)
  while (doc.getTextWidth(d.cliente.razonSocial) > ANCHO_RAZON && tamRazon > 6) {
    tamRazon -= 0.5
    doc.setFontSize(tamRazon)
  }
  doc.text(d.cliente.razonSocial, X0 + 4, CLI_Y + 13)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(`Domicilio: ${d.cliente.domicilio}`, X0 + 4, CLI_Y + 19)
  doc.text(`C.P.: ${d.cliente.cp}, ${d.cliente.localidad}`, X0 + 4, CLI_Y + 25)
  doc.text(d.cliente.condicionIva, X0 + 4, CLI_Y + 30)

  // Arranca a la altura del domicilio, no de la razón social (igual que el
  // comprobante original).
  y = CLI_Y + 19
  for (const [etiqueta, valor] of [
    ['Cliente Código:', d.cliente.codigo],
    ['C.U.I.T.:', d.cliente.cuit],
    ['Vendedor:', d.cliente.vendedor],
    ['Condición de vta.:', d.cliente.condicionVenta],
  ] as [string, string][]) {
    doc.text(etiqueta, XM + 12, y)
    doc.text(valor, XM + 42, y)
    y += 4.6
  }

  // ── Remitos / orden de compra ──────────────────────────────────────────────
  const REM_Y = CLI_Y + CLI_H
  const REM_H = 11
  doc.rect(X0, REM_Y, X1 - X0, REM_H)
  doc.text('Remitos - O/C:', X0 + 4, REM_Y + 7)
  if (d.remitosOC) doc.text(d.remitosOC, X0 + 34, REM_Y + 7)

  // ── Detalle ────────────────────────────────────────────────────────────────
  // Se rellena con filas vacías hasta una altura fija: el formulario siempre
  // ocupa la misma caja, tenga 2 renglones o 15.
  const FILAS_MIN = 18
  const ANCHOS    = [88, 12, 22, 26, 20, 26]
  const body: string[][] = []
  for (const r of d.renglones) {
    body.push([
      r.descripcion,
      r.um,
      fmt(r.cantidad),
      fmt(r.precioUnitario),
      `% ${fmt(r.descuento ?? 0)}`,
      fmt(r.importe),
    ])
    for (const nota of r.notas ?? []) body.push([`  - (${nota})`, '', '', '', '', ''])
  }
  while (body.length < FILAS_MIN) body.push(['', '', '', '', '', ''])

  const TABLA_Y = REM_Y + REM_H
  autoTable(doc, {
    startY: TABLA_Y,
    head: [['DESCRIPCION', 'UM', 'CANTIDAD', 'P.UNIT.', '% DTO.', 'IMPORTE']],
    body,
    theme: 'plain',
    styles: {
      fontSize: 8, cellPadding: { top: 0.6, bottom: 0.6, left: 1.5, right: 1.5 },
      textColor: 0, lineWidth: 0,
    },
    headStyles: { fontStyle: 'bold', fontSize: 7.5, lineWidth: 0.3, lineColor: 0, halign: 'center' },
    columnStyles: {
      0: { cellWidth: ANCHOS[0] },
      1: { cellWidth: ANCHOS[1], halign: 'center' },
      2: { cellWidth: ANCHOS[2], halign: 'right' },
      3: { cellWidth: ANCHOS[3], halign: 'right' },
      4: { cellWidth: ANCHOS[4], halign: 'right' },
      5: { cellWidth: ANCHOS[5], halign: 'right' },
    },
    margin: { left: X0, right: 210 - X1 },
  })
  // @ts-expect-error jspdf-autotable agrega lastAutoTable en runtime
  const tablaFin: number = doc.lastAutoTable?.finalY ?? TABLA_Y + 100

  // Las verticales de la grilla se dibujan enteras acá (no celda por celda),
  // así el cuerpo queda como una caja continua aunque sobren filas vacías.
  doc.rect(X0, TABLA_Y, X1 - X0, tablaFin - TABLA_Y)
  let xCol = X0
  for (const ancho of ANCHOS.slice(0, -1)) {
    xCol += ancho
    doc.line(xCol, TABLA_Y, xCol, tablaFin)
  }

  // ── Totales ────────────────────────────────────────────────────────────────
  const TOT_Y = tablaFin
  const TOT_H = 28
  doc.rect(X0, TOT_Y, X1 - X0, TOT_H)

  doc.setFontSize(8.5)
  const t = d.totales
  const filaIzq: [string, string][] = [
    ['NETO GRAVADO:', fmt(t.netoGravado)],
    ['EXENTO:', fmt(t.exento)],
    [`PERC.II.BB. C.A.B.A.: ${fmt(t.percIibbCabaAlic)}%`, fmt(t.percIibbCaba)],
  ]
  const filaDer: [string, string, string][] = [
    ['IVA:', `${fmt(t.ivaAlic)}%`, fmt(t.iva)],
    ['PERC. II.BB. BA.:', `${fmt(t.percIibbBaAlic)}%`, fmt(t.percIibbBa)],
    ['INTERNOS:', '', fmt(t.internos)],
  ]
  y = TOT_Y + 5.5
  for (let i = 0; i < 3; i++) {
    doc.setFont('helvetica', 'bold')
    doc.text(filaIzq[i][0], X0 + 4, y)
    doc.setFont('helvetica', 'normal')
    doc.text(filaIzq[i][1], X0 + 82, y, { align: 'right' })

    doc.setFont('helvetica', 'bold')
    doc.text(filaDer[i][0], XM + 5, y)
    doc.setFont('helvetica', 'normal')
    if (filaDer[i][1]) doc.text(filaDer[i][1], XM + 34, y)
    doc.text(filaDer[i][2], X1 - 4, y, { align: 'right' })
    y += 5.5
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('TOTAL PESOS:', XM + 5, TOT_Y + TOT_H - 4)
  doc.text(fmt(t.total), X1 - 4, TOT_Y + TOT_H - 4, { align: 'right' })

  // ── Importe en letras + leyenda de mora ────────────────────────────────────
  const LET_Y = TOT_Y + TOT_H
  const LET_H = 14
  doc.rect(X0, LET_Y, X1 - X0, LET_H)
  doc.setFontSize(8.5)
  doc.text('SON PESOS:', X0 + 4, LET_Y + 5)
  doc.text(importeEnLetras(t.total), X0 + 34, LET_Y + 5)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(5.5)
  doc.text(
    'La mora en el pago de la factura producirá un interés punitorio del cero, dos por ciento (0,2%) diario acumulativo. Se deja expresamente establecido que el domicilio de pago del presente y el lugar',
    X0 + 4, LET_Y + 9.5,
  )
  doc.text(`de cumplimiento de la obligación son el de ${emisor.razonSocial}`, X0 + 4, LET_Y + 12.5)

  // ── Pie: ARCA, QR, CAE y código de barras ──────────────────────────────────
  const PIE_Y = LET_Y + LET_H
  const PIE_H = 289 - PIE_Y
  doc.rect(X0, PIE_Y, X1 - X0, PIE_H)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('ARCA', XM, PIE_Y + 10, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(4.5)
  doc.text('Agencia de Recaudación y Control Aduanero', XM, PIE_Y + 13, { align: 'center' })

  const qr = await generateQrDataUrl(urlQrAfip(d))
  doc.addImage(qr, 'PNG', XM - 12, PIE_Y + 15, 24, 24)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('CAE:', X0 + 4, PIE_Y + 26)
  doc.text('Vto. CAE:', X0 + 4, PIE_Y + 34)
  doc.setFont('helvetica', 'normal')
  doc.text(d.cae, X0 + 24, PIE_Y + 26)
  doc.text(fecha(d.caeVto), X0 + 24, PIE_Y + 34)

  // El barcode ocupa lo que queda entre el QR y el borde derecho.
  const cadena  = cadenaCodigoBarras(d)
  const BAR_X   = XM + 16
  const BAR_ANCHO = X1 - 4 - BAR_X
  doc.setFillColor(0, 0, 0)
  dibujarI25(doc, cadena, BAR_X, PIE_Y + 16, 14, BAR_ANCHO)
  doc.setFontSize(6.5)
  doc.text(cadena, BAR_X + BAR_ANCHO / 2, PIE_Y + 34, { align: 'center' })

  const nombre = `${d.titulo.toLowerCase()}-${String(d.puntoVenta).padStart(5, '0')}-${String(d.numero).padStart(8, '0')}.pdf`
  if (d.descargar === false) return doc.output('blob')
  doc.save(nombre)
}

// Carga una imagen de /public y la reescala a un ancho de impresión razonable
// (el logo fuente son 8334 px de ancho: sin reescalar, jsPDF lo reincrusta
// entero y el PDF pesa decenas de MB). Separado del gemelo de utils/pdf.ts
// para no arrastrar todo ese módulo cuando esto corra fuera del browser.
async function fetchImagenPublica(
  url: string,
  maxAncho = 400,
  formato: 'PNG' | 'JPEG' = 'PNG',
): Promise<string | null> {
  if (typeof document === 'undefined') return null
  try {
    const resp   = await fetch(url)
    if (!resp.ok) return null
    const blob   = await resp.blob()
    const bitmap = await createImageBitmap(blob)
    const scale  = Math.min(1, maxAncho / bitmap.width)
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width  = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    // JPEG necesita fondo: sin esto, lo transparente sale negro.
    if (formato === 'JPEG') {
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, w, h)
    }
    ctx.drawImage(bitmap, 0, 0, w, h)
    return formato === 'JPEG' ? canvas.toDataURL('image/jpeg', 0.75) : canvas.toDataURL('image/png')
  } catch {
    return null
  }
}
