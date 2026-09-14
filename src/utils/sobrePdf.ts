import type { Sobre } from '@/types'
import { MOTIVOS_DIFERENCIA_LIQUIDACION, PLANTAS } from '@/types'
import { formatoARS } from './money'
import { ESTILO_CABECERA_TABLA, encabezadoA4, finTabla, firmaA4, nuevoA4, pieA4, salidaPdf } from './pdfBase'
import { claveDeCheque, claveDeRetencion } from './sobres'
import { compartirArchivo } from './compartir'

// Acta del sobre de rendición de fondos (2026-09-14): lo que el sistema dice
// que tenía que haber, lo que declaró quien rindió, la diferencia con su
// motivo, los valores en papel tildados por caja (y por tesorería si ya se
// recibió), el bloque de recepción y las dos firmas. Sirve recién rendido
// (firma de tesorería pendiente) y ya recibido. Mismo papel que los demás
// documentos operativos (pdfBase).

export const nombreArchivoSobre = (s: Pick<Sobre, 'fecha' | 'codigo'>) => `rendicion-${s.fecha}-${s.codigo}.pdf`

/** Detalle opcional que no vive en el sobre (la pantalla lo tiene al cerrar). */
export interface DetalleActaSobre {
  liquidaciones?: { codigo?: string; choferNombre: string; efectivoRecibido: number }[]
}

const fechaHora = (d: Date) => d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
const signo = (n: number) => `${n > 0 ? '+' : ''}${formatoARS(n)}`

export async function generateActaSobre(s: Sobre, detalle: DetalleActaSobre = {}, opts: { descargar?: boolean } = {}): Promise<Blob | void> {
  const base = await nuevoA4()
  const { doc, autoTable, pageW, pageH } = base
  const head = ESTILO_CABECERA_TABLA
  const recibida = s.estado === 'recibida' && !!s.recepcion
  const rec = s.recepcion

  encabezadoA4(base, 'Rendición de fondos a tesorería',
    `${s.codigo}  ·  ${PLANTAS[s.plantaId].label}  ·  ${fechaHora(s.cerradaEn.toDate())}  ·  ${recibida ? 'Recibida por tesorería' : 'En camino a tesorería'}`,
    { tamSubtitulo: 9 })

  // ── Sistema vs declarado ─────────────────────────────────────────────────
  const d = s.sistema.detalle
  const liqs = detalle.liquidaciones ?? []
  const filasSistema: (string | number)[][] = d
    ? [
        ['Fondo inicial', formatoARS(d.fondoInicial)],
        ['Ventas en efectivo', formatoARS(d.ventasEfectivo)],
        ['Cobranzas de mostrador en efectivo', formatoARS(d.cobranzasEfectivo)],
        [`Recibido de choferes (${s.sistema.origenIds.liquidacionesIds.length} liquidaciones)`, formatoARS(d.recibidoDeLiquidaciones)],
        ...liqs.map((l) => [`      ${l.choferNombre}${l.codigo ? ` · ${l.codigo}` : ''}`, formatoARS(l.efectivoRecibido)]),
        ...(d.recibidoDeSobres ? [['Recibido de cobradores', formatoARS(d.recibidoDeSobres)]] : []),
      ]
    : []
  autoTable(doc, {
    startY: 32,
    head: [['Sistema (a rendir)', '']],
    body: [...filasSistema, ['A rendir', formatoARS(s.sistema.efectivo)]],
    styles: { fontSize: 8.5, cellPadding: 2 }, headStyles: head,
    columnStyles: { 0: { cellWidth: 70 }, 1: { halign: 'right' } },
    didParseCell: (data) => { if (data.section === 'body' && data.row.index === filasSistema.length) data.cell.styles.fontStyle = 'bold' },
    margin: { left: 14, right: 104 },
  })
  const yIzq = finTabla(doc, 32)

  const motivo = s.motivoDiferencia ? `${MOTIVOS_DIFERENCIA_LIQUIDACION[s.motivoDiferencia.motivo]}${s.motivoDiferencia.nota ? ` · ${s.motivoDiferencia.nota}` : ''}` : ''
  autoTable(doc, {
    startY: 32,
    head: [['Declarado por caja', '']],
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
    margin: { left: 110, right: 14 },
  })
  let y = Math.max(yIzq, finTabla(doc, 32)) + 6

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
      head: [['Valores en papel', 'Cliente', 'Recibo', 'Importe', 'Declaró caja', 'Contado por tesorería']],
      body: [
        ...s.sistema.cheques.map((ch) => [`Cheque ${ch.esEcheq ? 'electrónico ' : ''}${ch.numero} · ${ch.bancoNombre} · acredita ${ch.fechaAcreditacion || '—'}`, ch.clienteNombre, ch.numeroRecibo ?? '', formatoARS(ch.importe), declaro(claveDeCheque(ch)), conto(claveDeCheque(ch))]),
        ...s.sistema.retenciones.map((re) => [`Retención ${re.tipo.toUpperCase()} cert. ${re.nroCertificado}`, re.clienteNombre, re.numeroRecibo ?? '', formatoARS(re.importe), declaro(claveDeRetencion(re)), conto(claveDeRetencion(re))]),
      ],
      styles: { fontSize: 8, cellPadding: 1.8 }, headStyles: head,
      columnStyles: { 3: { halign: 'right' }, 4: { cellWidth: 22 }, 5: { cellWidth: 36 } },
      didParseCell: (data) => { if (data.section === 'body' && (data.column.index === 4 || data.column.index === 5) && String(data.cell.raw).startsWith('NO')) data.cell.styles.textColor = [153, 27, 27] },
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
        ['Diferencia de recepción', signo(rec.efectivoContado - s.sistema.efectivo)],
        ['Conformidad', rec.conformidad === 'conforme' ? 'Conforme' : 'Con diferencia'],
        ...(difR ? [['Motivo', `${MOTIVOS_DIFERENCIA_LIQUIDACION[difR.motivo]}${difR.nota ? ` · ${difR.nota}` : ''}`]] : []),
        ...(difR?.valoresFaltantes.cantidad ? [['Valores sin recibir', `${difR.valoresFaltantes.cantidad} (${formatoARS(difR.valoresFaltantes.total)})`]] : []),
      ],
      styles: { fontSize: 8.5, cellPadding: 2 }, headStyles: head,
      columnStyles: { 0: { cellWidth: 45, fontStyle: 'bold' } },
      didParseCell: (data) => { if (data.section === 'body' && data.row.index === 3 && rec.conformidad !== 'conforme') data.cell.styles.textColor = [153, 27, 27] },
      margin: { left: 14, right: 90 },
    })
    y = finTabla(doc, y) + 6
  }

  // ── Firmas: izquierda quien rinde (caja), derecha quien recibe (tesorería) ──
  if (y > pageH - 50) { doc.addPage(); y = 20 }
  firmaA4(base, { x: 14, y, etiqueta: 'Rindió (caja)', firma: s.firmaRinde, aclaracion: `${s.firmanteRinde} · ${fechaHora(s.cerradaEn.toDate())}` })
  firmaA4(base, {
    x: pageW - 88, y, etiqueta: 'Recibió (tesorería)',
    firma: rec?.firmaRecibe,
    aclaracion: rec ? `${rec.firmanteRecibe} · ${fechaHora(rec.en.toDate())}` : 'Pendiente de recepción',
  })
  pieA4(base)

  return salidaPdf(doc, nombreArchivoSobre(s), opts.descargar)
}

/**
 * `imprimir`: baja el PDF (el diálogo de impresión del navegador). `compartir`:
 * menú del sistema (WhatsApp, mail) o descarga si el dispositivo no puede.
 */
export async function imprimirActaSobre(sobre: Sobre, modo: 'imprimir' | 'compartir' = 'imprimir', detalle: DetalleActaSobre = {}): Promise<'compartido' | 'descargado' | 'cancelado'> {
  if (modo === 'imprimir') { await generateActaSobre(sobre, detalle); return 'descargado' }
  const blob = (await generateActaSobre(sobre, detalle, { descargar: false })) as Blob
  return compartirArchivo(blob, nombreArchivoSobre(sobre), { titulo: `Rendición ${sobre.codigo}`, texto: `Rendición de fondos ${sobre.codigo} del ${sobre.fecha} de ${sobre.rindio.nombre}` })
}
