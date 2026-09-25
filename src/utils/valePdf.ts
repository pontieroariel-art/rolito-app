import { encabezadoA4, firmaA4, nuevoA4, pieA4, salidaPdf } from './pdfBase'
import { formatoARS } from './money'
import { PLANTAS, type ValeCaja } from '@/types'

// El vale de caja en papel (2026-09-25): media carilla A4 con el número, la
// plata, a quién, por qué y la firma de quien recibió. Se abre en el visor
// apenas se registra (nada se descarga solo) para imprimirlo y dejarlo en la
// caja; después viaja en el sobre.
const fechaHora = (d: Date) => d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

export async function generateVale(v: ValeCaja): Promise<{ blob: Blob; nombre: string }> {
  const base = await nuevoA4()
  const { doc, pageW } = base
  encabezadoA4(base, 'Vale de caja', `${v.codigo}  ·  ${PLANTAS[v.plantaId].label}  ·  ${fechaHora(v.emitidoEn.toDate())}`, { tamSubtitulo: 9, yLinea: 30 })
  let y = 44
  doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(0)
  doc.text(formatoARS(v.importe), 14, y)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(80)
  doc.text(`de ${v.empresa === 'rolito' ? 'Rolito' : 'Redonhielo'}`, 14, y + 6)
  doc.setTextColor(0)
  y += 18
  const linea = (rotulo: string, texto: string) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(100)
    doc.text(rotulo.toUpperCase(), 14, y)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(0)
    const lineas = doc.splitTextToSize(texto, pageW - 28) as string[]
    doc.text(lineas, 14, y + 5)
    y += 5 + lineas.length * 5 + 5
  }
  linea('Recibió', `${v.receptor.nombre}${v.receptor.dni ? ` · DNI ${v.receptor.dni}` : ''}`)
  linea('Motivo', v.motivo)
  linea('Entregó (caja)', `${v.emitio.nombre} · turno ${v.cajaSesionId.split('_').pop() ?? ''} · ${PLANTAS[v.plantaId].label}`)
  y += 4
  firmaA4(base, { x: 14, y, etiqueta: 'Recibí conforme', firma: v.firmaRecibe, aclaracion: `${v.firmanteRecibe} · ${fechaHora(v.emitidoEn.toDate())}`, ancho: 60 })
  firmaA4(base, { x: pageW - 74, y, etiqueta: 'Entregó (caja)', aclaracion: v.emitio.nombre, ancho: 60 })
  doc.setFontSize(8); doc.setTextColor(120)
  doc.text('Este vale queda registrado en la liquidación de caja y va adentro del sobre.', 14, y + 40, { maxWidth: pageW - 28 })
  doc.setTextColor(0)
  pieA4(base)
  const nombre = `vale-${v.codigo}.pdf`
  return { blob: salidaPdf(doc, nombre), nombre }
}
