import type { Cobranza, Liquidacion, Sobre, VentaVentanilla } from '@/types'
import { cajonPorEmpresa, seccionesDelActa } from './actaComoPantalla'
import { dibujarSecciones, tarjetaCajon } from './actaPantallaPdf'
import { MOTIVOS_DIFERENCIA_LIQUIDACION, PLANTAS } from '@/types'
import { formatoARS } from './money'
import { ESTILO_CABECERA_TABLA, encabezadoA4, finTabla, firmaA4, nuevoA4, pieA4, salidaPdf } from './pdfBase'
import { claveDeCheque, claveDeRetencion } from './sobres'
import { DENOMINACIONES, etiquetaDenominacion } from './billetes'
import type { PersonaDelActa } from './actaSobre'
import { compartirArchivo } from './compartir'

// Acta del sobre de rendición de fondos (2026-09-14): lo que el sistema dice
// que tenía que haber, lo que declaró quien rindió, la diferencia con su
// motivo, los valores en papel tildados por caja (y por tesorería si ya se
// recibió), el bloque de recepción y las dos firmas. Sirve recién rendido
// (firma de tesorería pendiente) y ya recibido. Mismo papel que los demás
// documentos operativos (pdfBase).

export const nombreArchivoSobre = (s: Pick<Sobre, 'fecha' | 'codigo'>) => `liquidacion-caja-${s.fecha}-${s.codigo}.pdf`

/**
 * Detalle que no vive en el sobre: qué le rindió cada chofer o cobrador al
 * cajero, recibo por recibo (2026-09-14). Lo trae `services/actaSobreService`
 * desde las liquidaciones del sobre; `sinDetalle` cuando no se pudo leer.
 */
export interface DetalleActaSobre {
  personas?:   PersonaDelActa[]
  /** Los anticipos del mismo turno (2026-09-23): restan en la tabla, igual que en la pantalla. */
  anticipos?:  Sobre[]
  sinDetalle?: boolean
  /** Con estos tres (2026-09-24) el acta se dibuja IGUAL a la pantalla de Liquidación de caja. */
  ventas?:        VentaVentanilla[]
  cobranzas?:     Cobranza[]
  liquidaciones?: Liquidacion[]
}
const fechaLarga = (d: Date) => d.toLocaleString('es-AR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

const fechaHora = (d: Date) => d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
const signo = (n: number) => `${n > 0 ? '+' : ''}${formatoARS(n)}`
const ddmmaa = (f: string | undefined) => (f && f.length >= 10 ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}` : '—')

export async function generateActaSobre(s: Sobre, detalle: DetalleActaSobre = {}, opts: { descargar?: boolean } = {}): Promise<Blob> {
  const base = await nuevoA4()
  const { doc, autoTable, pageW, pageH } = base
  const head = ESTILO_CABECERA_TABLA
  const recibida = s.estado === 'recibida' && !!s.recepcion
  const rec = s.recepcion

  const anticipo = s.tipo === 'anticipo'
  const anticipos = detalle.anticipos ?? []
  const estadoTxt = recibida ? (anticipo ? 'Contado por tesorería' : 'Recibida por tesorería') : anticipo ? `Entregado a ${s.entrega?.recibio.nombre ?? 'tesorería'}, sin contar` : 'Cerrada, tesorería todavía no la contó'
  encabezadoA4(base, anticipo ? 'Anticipo de caja a tesorería' : 'Liquidación de caja',
    `${s.codigo}  ·  ${PLANTAS[s.plantaId].label}  ·  ${anticipo ? fechaHora(s.cerradaEn.toDate()) : `cierre ${fechaLarga(s.cerradaEn.toDate())}`}`,
    { tamSubtitulo: 9, yLinea: 30 })
  // Segunda línea del subtítulo (2026-09-24): en una sola línea pisaba el logo.
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(80)
  doc.text(estadoTxt, pageW - 14, 25, { align: 'right' })
  doc.setTextColor(0)

  // ── Igual a la pantalla (2026-09-24): la tarjeta del cajón y los bloques como tarjetas, sin barras verdes ──
  const comoPantalla = !anticipo && !!detalle.ventas && !!detalle.cobranzas && !!detalle.liquidaciones
  let yPantalla = 36
  if (comoPantalla) {
    yPantalla = tarjetaCajon(base, yPantalla, s, cajonPorEmpresa(s))
    const secciones = seccionesDelActa({ sobre: s, ventas: detalle.ventas!, cobranzas: detalle.cobranzas!, liquidaciones: detalle.liquidaciones!, anticipos })
    yPantalla = dibujarSecciones(base, yPantalla, secciones)
  }
  // ── Sistema vs declarado (formato anterior, para sobres sin el detalle de la pantalla) ──
  const d = s.sistema.detalle
  const personas = detalle.personas ?? []
  const nLiq = s.sistema.origenIds.liquidacionesIds.length
  const pe = s.sistema.porEmpresa
  const v = (n: number) => (n ? formatoARS(n) : '—')
  // Guion ASCII y no el signo menos tipográfico (U+2212): la Helvetica de jsPDF no lo tiene y desarmaba el espaciado de la celda (2026-09-24).
  const neg = (n: number) => (n ? `-${formatoARS(n)}` : '—')
  const rolito = (a: Pick<Sobre, 'anticipo'>) => a.anticipo?.empresa === 'rolito'
  const filasSistema: (string | number)[][] = anticipo
    ? [[`Anticipo de ${rolito(s) ? 'Rolito' : 'Redonhielo'} entregado antes del cierre del turno`, rolito(s) ? '—' : formatoARS(s.sistema.efectivo), rolito(s) ? formatoARS(s.sistema.efectivo) : '—', formatoARS(s.sistema.efectivo)]]
    : pe
      ? [
          ...(d?.fondoInicial ? [['Fondo inicial', formatoARS(d.fondoInicial), '—', formatoARS(d.fondoInicial)]] : []),
          [`Ventas de ventanilla en efectivo (${s.sistema.origenIds.ventasIds.length})`, v(pe.redonhielo.ventasEfectivo), v(pe.rolito.ventasEfectivo), v(pe.redonhielo.ventasEfectivo + pe.rolito.ventasEfectivo)],
          [`Cobranzas de mostrador en efectivo (${s.sistema.origenIds.cobranzasIds.length})`, v(pe.redonhielo.cobranzasEfectivo), v(pe.rolito.cobranzasEfectivo), v(pe.redonhielo.cobranzasEfectivo + pe.rolito.cobranzasEfectivo)],
          [`Liquidaciones de choferes y cobradores (${nLiq}, detalle abajo)`, v(pe.redonhielo.recibidoDeLiquidaciones + pe.redonhielo.recibidoDeSobres), v(pe.rolito.recibidoDeLiquidaciones + pe.rolito.recibidoDeSobres), v(pe.redonhielo.recibidoDeLiquidaciones + pe.rolito.recibidoDeLiquidaciones + pe.redonhielo.recibidoDeSobres + pe.rolito.recibidoDeSobres)],
          ...personas.map((p) => [`      ${p.nombre}${p.codigo ? ` · ${p.codigo}` : ''}`, '', '', formatoARS(p.efectivoRecibido)]),
          ...(anticipos.length
            ? anticipos.map((a) => [`Anticipo ${a.codigo} · recibió ${a.entrega?.recibio.nombre ?? '—'} ${fechaHora(a.cerradaEn.toDate())}${a.recepcion ? ' · contado' : ''}`, rolito(a) ? '—' : neg(a.sistema.efectivo), rolito(a) ? neg(a.sistema.efectivo) : '—', neg(a.sistema.efectivo)])
            : (pe.redonhielo.anticipos || pe.rolito.anticipos) ? [['Anticipos a tesorería', neg(pe.redonhielo.anticipos ?? 0), neg(pe.rolito.anticipos ?? 0), neg((pe.redonhielo.anticipos ?? 0) + (pe.rolito.anticipos ?? 0))]] : []),
        ]
      : d
        ? [
            ['Fondo inicial', formatoARS(d.fondoInicial), '—', formatoARS(d.fondoInicial)],
            ['Ventas en efectivo', formatoARS(d.ventasEfectivo), '—', formatoARS(d.ventasEfectivo)],
            ['Cobranzas de mostrador en efectivo', formatoARS(d.cobranzasEfectivo), '—', formatoARS(d.cobranzasEfectivo)],
            [`Recibido de choferes y cobradores (${nLiq})`, formatoARS(d.recibidoDeLiquidaciones), '—', formatoARS(d.recibidoDeLiquidaciones)],
            ...personas.map((p) => [`      ${p.nombre}${p.codigo ? ` · ${p.codigo}` : ''}`, '', '', formatoARS(p.efectivoRecibido)]),
          ]
        : []
  const filaTotal: (string | number)[] = pe
    ? ['Efectivo en el sobre (sistema)', formatoARS(pe.redonhielo.efectivo), formatoARS(pe.rolito.efectivo), formatoARS(s.sistema.efectivo)]
    : ['Efectivo en el sobre (sistema)', formatoARS(s.sistema.efectivo), '—', formatoARS(s.sistema.efectivo)]
  const filasValores: (string | number)[][] = pe && !anticipo
    ? [
        [`Cheques (${s.sistema.cheques.length}, detalle abajo)`, v(pe.redonhielo.cheques.total), v(pe.rolito.cheques.total), v(pe.redonhielo.cheques.total + pe.rolito.cheques.total)],
        [`Retenciones (${s.sistema.retenciones.length})`, v(pe.redonhielo.retenciones.total), v(pe.rolito.retenciones.total), v(pe.redonhielo.retenciones.total + pe.rolito.retenciones.total)],
      ]
    : []

  if (!comoPantalla) autoTable(doc, {
    startY: 36,
    head: [['De dónde sale, por empresa', 'Redonhielo', 'Rolito', 'Total']],
    body: [...filasSistema, filaTotal, ...filasValores],
    styles: { fontSize: 8, cellPadding: 1.8 }, headStyles: head,
    columnStyles: { 0: { cellWidth: 92 }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    didParseCell: (data) => {
      if (data.section === 'body' && data.row.index === filasSistema.length) data.cell.styles.fontStyle = 'bold'
      if (data.section === 'body' && String(data.cell.raw).startsWith('-')) data.cell.styles.textColor = [153, 27, 27]
    },
    margin: { left: 14, right: 14 },
  })
  const yIzq = comoPantalla ? yPantalla + 2 : finTabla(doc, 36) + 4

  const motivo = s.motivoDiferencia ? `${MOTIVOS_DIFERENCIA_LIQUIDACION[s.motivoDiferencia.motivo]}${s.motivoDiferencia.nota ? ` · ${s.motivoDiferencia.nota}` : ''}` : ''
  autoTable(doc, {
    startY: yIzq,
    head: [[anticipo ? 'Entregado' : 'Declarado por caja', '']],
    body: [
      ['A rendir', formatoARS(s.sistema.efectivo)],
      ['Declaré', formatoARS(s.declarado.efectivo)],
      ['Diferencia de caja', signo(s.diferenciaDeclarada.efectivo)],
      ['Valores en papel', `${s.sistema.cheques.length + s.sistema.retenciones.length} · faltan ${s.diferenciaDeclarada.valoresFaltantes.cantidad}${s.diferenciaDeclarada.valoresFaltantes.cantidad ? ` (${formatoARS(s.diferenciaDeclarada.valoresFaltantes.total)})` : ''}`],
      ...(motivo ? [['Motivo', motivo]] : []),
      ...(s.declarado.observacion ? [['Observación', s.declarado.observacion]] : []),
    ],
    styles: { fontSize: 8.5, cellPadding: 2 }, headStyles: head,
    columnStyles: { 0: { cellWidth: 34, fontStyle: 'bold' }, 1: { halign: 'right' } },
    didParseCell: (data) => {
      if (data.section === 'body' && data.row.index === 2 && s.diferenciaDeclarada.efectivo !== 0) data.cell.styles.textColor = [153, 27, 27]
    },
    margin: { left: 14, right: 104 },
  })
  let y = finTabla(doc, yIzq) + 6

  // ── Composición de billetes (2026-09-16, pedido de Ariel): lo que contó caja, billete por billete ──
  const cb = s.declarado.conteoBilletes
  if (cb) {
    autoTable(doc, {
      startY: y,
      head: [['Billetes contados por caja', 'Cantidad', 'Subtotal']],
      body: [
        ...DENOMINACIONES.map((den) => [etiquetaDenominacion(den), String(cb.billetes[`${den}`] ?? 0), formatoARS(den * (cb.billetes[`${den}`] ?? 0))]),
        ['Monedas / cambio chico', '', formatoARS(cb.cambioChico ?? 0)],
        [{ content: cb.sinEfectivo ? 'Caja marcó: sin efectivo' : 'Total contado', styles: { fontStyle: 'bold' } }, '', { content: formatoARS(cb.total), styles: { fontStyle: 'bold' } }],
      ],
      styles: { fontSize: 8.5, cellPadding: 2 }, headStyles: head,
      columnStyles: { 1: { halign: 'right', cellWidth: 22 }, 2: { halign: 'right', cellWidth: 30 } },
      margin: { left: 14, right: 110 },
    })
    y = finTabla(doc, y) + 6
  }

  // ── Recibido de cada chofer / cobrador, recibo por recibo ────────────────
  // Lo que pidió Ariel el 14/09: cuando la caja no cuadra, que el acta diga
  // de quién era la plata y qué cobró cada uno.
  // Con el acta como la pantalla, las liquidaciones ya están arriba bloque por bloque.
  if (!comoPantalla && nLiq && (personas.length || detalle.sinDetalle)) {
    if (detalle.sinDetalle || !personas.length) {
      doc.setFontSize(8.5); doc.setTextColor(153, 27, 27)
      doc.text('No se pudo leer el detalle de las rendiciones recibidas (choferes y cobradores). Reimprimí el acta con conexión.', 14, y + 3)
      doc.setTextColor(0, 0, 0)
      y += 8
    }
    for (const p of personas) {
      const dif = p.diferencia
      const titulo = `${p.nombre}${p.codigo ? ` · ${p.codigo}` : ''}  ·  a rendir ${formatoARS(p.efectivoARendir)}  ·  entregó ${formatoARS(p.efectivoRecibido)}${dif ? `  ·  diferencia ${signo(dif)}` : ''}`
      const medio = (r: PersonaDelActa['recibos'][number]) => [
        ...r.cheques.map((ch) => `cheque ${ch.numero} ${ch.bancoNombre} ${formatoARS(ch.importe)}`),
        ...r.retenciones.map((re) => `ret. ${re.tipo.toUpperCase()} ${re.nroCertificado} ${formatoARS(re.importe)}`),
        ...(r.transferencia ? [`transferencia ${formatoARS(r.transferencia)}`] : []),
      ].join(' · ') || '—'
      const body: (string | number)[][] = p.recibos.map((r) => [r.numeroRecibo, r.clienteNombre, formatoARS(r.efectivo), medio(r)])
      if (p.ventasEfectivo) body.unshift(['Ventas', 'Ventas de contado en efectivo del reparto', formatoARS(p.ventasEfectivo), '—'])
      if (p.recibosSinDetalle) body.push(['', `${p.recibosSinDetalle} recibo(s) sin detalle disponible`, '', ''])
      if (!body.length) body.push(['', 'Sin cobranzas en esta rendición', '', ''])
      const valores = p.valores.cheques || p.valores.retenciones
        ? `${p.valores.cheques} cheque(s) ${formatoARS(p.valores.chequesTotal)}${p.valores.retenciones ? ` · ${p.valores.retenciones} ret. ${formatoARS(p.valores.retencionesTotal)}` : ''} (valores en papel, aparte)`
        : 'sin valores en papel'
      body.push(['', 'Efectivo entregado a caja', formatoARS(p.efectivoRecibido), valores])
      const filaTotal = body.length - 1
      if (p.motivo) body.push(['', `Motivo de la diferencia: ${MOTIVOS_DIFERENCIA_LIQUIDACION[p.motivo.motivo as keyof typeof MOTIVOS_DIFERENCIA_LIQUIDACION] ?? p.motivo.motivo}${p.motivo.nota ? ` · ${p.motivo.nota}` : ''}`, '', ''])
      autoTable(doc, {
        startY: y,
        head: [[{ content: titulo, colSpan: 4 }], ['Recibo', 'Cliente', 'Efectivo', 'Cheques / retenciones / transferencia']],
        body,
        styles: { fontSize: 8, cellPadding: 1.8 }, headStyles: head,
        columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 70 }, 2: { halign: 'right', cellWidth: 26 } },
        didParseCell: (data) => {
          if (data.section === 'body' && data.row.index === filaTotal) data.cell.styles.fontStyle = 'bold'
          if (data.section === 'body' && p.motivo && data.row.index === body.length - 1) data.cell.styles.textColor = [153, 27, 27]
        },
        margin: { left: 14, right: 14 },
      })
      y = finTabla(doc, y) + 4
    }
    y += 2
  }

  // ── Valores en papel ─────────────────────────────────────────────────────
  if (s.sistema.cheques.length || s.sistema.retenciones.length) {
    const declaro = (clave: string) => {
      const v = [...s.declarado.cheques, ...s.declarado.retenciones].find((x) => x.clave === clave)
      return v ? (v.presente ? 'Sí' : 'NO') : '—'
    }
    const conto = (clave: string) => {
      if (!rec) return 'pendiente'
      const v = [...rec.cheques, ...rec.retenciones].find((x) => x.clave === clave)
      return v ? (v.recibido ? 'Sí' : `NO${v.motivoNoRecibido ? ` · ${v.motivoNoRecibido}` : ''}`) : '—'
    }
    autoTable(doc, {
      startY: y,
      head: [['Cheques y retenciones', 'Emisor · empresa', 'Banco · N°', 'Emisión', 'Pago', 'Lo cobró', 'Importe', 'Declaró caja', 'Contó tesorería']],
      body: [
        ...s.sistema.cheques.map((ch) => [`Cheque${ch.esEcheq ? ' electrónico' : ''}`, `${ch.clienteNombre} · ${ch.empresa === 'rolito' ? 'Rolito' : 'Redonhielo'}${ch.numeroRecibo ? ` · ${ch.numeroRecibo}` : ''}`, `${ch.bancoNombre} · ${ch.numero}`, ddmmaa(ch.fechaEmision), ddmmaa(ch.fechaAcreditacion), `${ch.cobradoPor ?? '—'}${ch.origenCodigo ? ` (${ch.origenCodigo})` : ''}`, formatoARS(ch.importe), declaro(claveDeCheque(ch)), conto(claveDeCheque(ch))]),
        ...s.sistema.retenciones.map((re) => [`Retención ${re.tipo.toUpperCase()}`, `${re.clienteNombre} · ${re.empresa === 'rolito' ? 'Rolito' : 'Redonhielo'}${re.numeroRecibo ? ` · ${re.numeroRecibo}` : ''}`, `cert. ${re.nroCertificado}`, '', '', '—', formatoARS(re.importe), declaro(claveDeRetencion(re)), conto(claveDeRetencion(re))]),
      ],
      styles: { fontSize: 7.5, cellPadding: 1.6 }, headStyles: head,
      columnStyles: { 0: { cellWidth: 20 }, 3: { cellWidth: 16 }, 4: { cellWidth: 16 }, 6: { halign: 'right', cellWidth: 22 }, 7: { cellWidth: 18 }, 8: { cellWidth: 30 } },
      didParseCell: (data) => { if (data.section === 'body' && (data.column.index === 7 || data.column.index === 8) && String(data.cell.raw).startsWith('NO')) data.cell.styles.textColor = [153, 27, 27] },
      margin: { left: 14, right: 14 },
    })
    y = finTabla(doc, y) + 6
  }

  // ── Recepción ────────────────────────────────────────────────────────────
  if (rec) {
    const difR = rec.diferencia
    autoTable(doc, {
      startY: y,
      head: [['Recepción de tesorería', '']],
      body: [
        ['Recibió', `${rec.recibio.nombre} · ${fechaHora(rec.en.toDate())}`],
        ['Contado por tesorería', formatoARS(rec.efectivoContado)],
        ...(rec.fajos ? [['Contado por fajo', `Redonhielo ${formatoARS(rec.fajos.redonhielo)} · Rolito ${formatoARS(rec.fajos.rolito)}`]] : []),
        ['Diferencia de recepción', signo(rec.efectivoContado - s.sistema.efectivo)],
        ['Conformidad', rec.conformidad === 'conforme' ? 'Conforme' : 'Con diferencia'],
        ...(difR ? [['Motivo', `${MOTIVOS_DIFERENCIA_LIQUIDACION[difR.motivo]}${difR.nota ? ` · ${difR.nota}` : ''}`]] : []),
        ...(difR?.valoresFaltantes.cantidad ? [['Valores sin recibir', `${difR.valoresFaltantes.cantidad} (${formatoARS(difR.valoresFaltantes.total)})`]] : []),
      ],
      styles: { fontSize: 8.5, cellPadding: 2 }, headStyles: head,
      columnStyles: { 0: { cellWidth: 45, fontStyle: 'bold' } },
      didParseCell: (data) => { if (data.section === 'body' && String(data.cell.raw) === 'Con diferencia') data.cell.styles.textColor = [153, 27, 27] },
      margin: { left: 14, right: 90 },
    })
    y = finTabla(doc, y) + 6
  }

  // ── Firmas: izquierda quien rinde (caja), derecha quien recibe (tesorería) ──
  if (y > pageH - 50) { doc.addPage(); y = 20 }
  firmaA4(base, { x: 14, y, etiqueta: anticipo ? 'Entregó (caja)' : 'Rindió (caja)', firma: s.firmaRinde || undefined, aclaracion: `${s.firmanteRinde} · ${fechaHora(s.cerradaEn.toDate())}`, ancho: 45 })
  // Entrega en mano: solo cuando existió (anticipos y sobres anteriores al 23/09). Desde el
  // rediseño cerrar el turno es entregar, y la firma de tesorería es la de la recepción.
  if (s.entrega) {
    firmaA4(base, {
      x: 72, y, etiqueta: anticipo ? 'Recibió el anticipo' : 'Recibió el sobre cerrado', ancho: 45,
      firma: s.entrega.firmaRecibe,
      aclaracion: `${s.entrega.firmanteRecibe} · ${fechaHora(s.entrega.en.toDate())}`,
    })
  }
  firmaA4(base, {
    x: pageW - 66, y, etiqueta: 'Contó (tesorería)', ancho: 45,
    firma: rec?.firmaRecibe,
    aclaracion: rec ? `${rec.firmanteRecibe} · ${fechaHora(rec.en.toDate())}` : 'Todavía sin contar',
  })
  pieA4(base)

  return salidaPdf(doc, nombreArchivoSobre(s), opts.descargar)
}

/**
 * Comparte el acta por el menú del sistema (WhatsApp, mail) o la descarga si el
 * dispositivo no puede. Para verla en pantalla: `actaSobreBlob` + visor (2026-09-15).
 */
export async function compartirActaSobre(sobre: Sobre, detalle: DetalleActaSobre = {}): Promise<'compartido' | 'descargado' | 'cancelado'> {
  const blob = await generateActaSobre(sobre, detalle)
  return compartirArchivo(blob, nombreArchivoSobre(sobre), { titulo: `Liquidación de caja ${sobre.codigo}`, texto: `Liquidación de caja ${sobre.codigo} del ${sobre.fecha} de ${sobre.rindio.nombre}` })
}
