// PDF del remito de la venta del camión, en el mismo papel que la factura de
// promo (papelInternoPdf.ts) pero sin precios: columnas DESCRIPCIÓN / UM /
// CANTIDAD y total en bultos.
//
//   - Redonhielo (oficial): encabezado con los datos del emisor, letra R con
//     "Cód. 91" y el CAI del talonario al pie. Sin CAI cargado sale X.
//   - Rolito (promo): encabezado "FÁBRICA DE HIELO", letra X, "Código Nº: 00"
//     y número de control interno al pie.
// Firma del cliente al pie (decisión 2026-09-03).

import type { RemitoData } from './comprobanteInterno'
import { dibujarPapelInterno, type PapelInternoSpec } from './papelInternoPdf'

const fecha = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`

export function specRemito(d: RemitoData): PapelInternoSpec {
  const promo = d.empresa === 'rolito'
  const encabezado: PapelInternoSpec['encabezado'] = promo
    ? { titulo: 'FÁBRICA DE HIELO', lineas: [] }
    : {
        titulo: d.emisor.razonSocial,
        lineas: [
          `Domicilio: ${d.emisor.domicilio}`,
          `Tel.: ${d.emisor.telefono}  Email: ${d.emisor.email}`,
          `${d.emisor.condicionIva} - CUIT ${d.emisor.cuit}`,
          `Ing. Brutos: ${d.emisor.ingresosBrutos} - Inicio de actividades: ${d.emisor.inicioActividad}`,
        ],
      }
  const pieLineas = d.control.tipo === 'cai'
    ? [`CAI Nº: ${d.control.cai}`, `Fecha vto. CAI: ${fecha(d.control.vencimiento)}`]
    : [`Nº de control interno: ${d.control.codigo}`]
  pieLineas.push(`Entregado por: ${d.entrega.chofer}${d.entrega.camion ? ` - Camión ${d.entrega.camion}` : ''}`)

  return {
    encabezado,
    letra: d.letra,
    codigoLetra: d.letra === 'R' ? 'Cód. 91' : 'Código Nº: 00',
    tituloDocumento: promo ? 'REMITO PROMOCIÓN' : 'REMITO',
    numero: d.numero ?? 'SIN NÚMERO',
    fecha: fecha(d.fechaEmision),
    cliente: {
      nombre:         d.cliente.razonSocial,
      domicilio:      d.cliente.domicilio,
      localidadCp:    d.cliente.localidadCp,
      condicionIva:   d.cliente.condicionIva,
      codigo:         d.cliente.codigoCliente,
      cuit:           d.cliente.cuit,
      vendedor:       d.cliente.vendedor,
      condicionVenta: d.cliente.condicionVenta.toUpperCase(),
    },
    conPrecios: false,
    renglones: d.renglones.map((r) => ({
      descripcion: r.descripcion.toUpperCase(),
      um:          'UNI',
      cantidad:    r.cantidad,
      ...(r.esCambio ? { nota: 'cambio sin cargo' } : {}),
    })),
    totalBultos: d.bultos,
    marcaAgua: promo ? 'GRACIAS POR SU COMPRA' : undefined,
    pie: { lineas: pieLineas, leyenda: d.leyenda },
    ...(d.firma ? { firma: d.firma } : {}),
  }
}

export async function generateRemitoPdf(
  d: RemitoData,
  opts: { descargar?: boolean } = {},
): Promise<Blob | void> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  dibujarPapelInterno(doc, specRemito(d))
  if (opts.descargar === false) return doc.output('blob')
  doc.save(d.archivo)
}
