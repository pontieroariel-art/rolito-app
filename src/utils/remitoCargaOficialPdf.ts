import type { RemitoCarga } from '@/types'
import type { RemitoData } from './comprobanteInterno'
import { EMISOR_REDONHIELO } from './emisores'
import { PLANTA_INFO, ROLITO_INFO } from './constants'
import { envasesDeRemito } from './envases'
import { formatoRespaldo } from './cot'
import { generateRemitoPdf } from './remitoPdf'

// Remito R oficial de la carga del camión (2026-09-10): el mismo papel que el
// remito del chofer (letra R, Cód. 91, CAI del talonario 00025 al pie) con el
// sello "PARA REPARTO", como salía de Bluesoft: de la planta al repartidor,
// con la mercadería y los envases como renglones, la patente y el COT de ARBA
// si ya lo tiene. Reemplaza al remito manual que caja llenaba para el COT.
// Pedido de Ariel 2026-09-10; ver docs/arba/COT.md.

const fechaDe = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, (m ?? 1) - 1, d ?? 1) }

export function armarRemitoCargaOficial(r: RemitoCarga): RemitoData | null {
  if (!r.remitoR) return null
  const planta = PLANTA_INFO[r.plantaId]
  const numero = formatoRespaldo({ prefijo: r.remitoR.puntoVenta, numero: r.remitoR.numero })
  const patente = r.camionLabel.split('·')[0]?.trim() ?? r.camionLabel
  const envases = envasesDeRemito(r)
  const renglones: RemitoData['renglones'] = r.items.map((i) => ({ descripcion: i.nombre, cantidad: i.cantidad, esCambio: false }))
  if (envases.tarimasMadera) renglones.push({ descripcion: 'PALLETS DE MADERA COMPLETOS', cantidad: envases.tarimasMadera, esCambio: false })
  if (envases.palletsMetal) renglones.push({ descripcion: 'PALLETS DE METAL COMPLETOS', cantidad: envases.palletsMetal, esCambio: false })
  if (envases.racks.length) renglones.push({ descripcion: `RACKS DE AGUA Nº ${envases.racks.join(', ')}`, cantidad: envases.racks.length, esCambio: false })
  const cot = r.cot?.estado === 'presentado' && r.cot.numero ? r.cot : null
  return {
    empresa:      'redonhielo',
    emisor:       EMISOR_REDONHIELO,
    letra:        'R',
    numero,
    fechaEmision: r.fecha.toDate(),
    cliente: {
      razonSocial:    r.choferNombre,
      cuit:           EMISOR_REDONHIELO.cuit,
      domicilio:      planta.direccion,
      localidadCp:    r.plantaId === 'torcuato' ? `${ROLITO_INFO.cp}, ${planta.localidad.toUpperCase()}` : planta.localidad.toUpperCase(),
      condicionIva:   'Depósito de reparto (mercadería propia)',
      codigoCliente:  r.depositoTango ?? '',
      vendedor:       r.creadoPor.nombre,
      condicionVenta: 'PARA REPARTO',
    },
    entrega:   { chofer: r.choferNombre, camion: patente },
    renglones,
    bultos:    { entregados: r.items.reduce((s, i) => s + i.cantidad, 0), cambios: 0 },
    control:   { tipo: 'cai', cai: r.remitoR.cai, vencimiento: fechaDe(r.remitoR.vencimiento) },
    marcaAgua: 'PARA REPARTO',
    firmaEnPapel: 'Firma del chofer',
    pieExtra:  [
      `Remito de carga ${r.codigo} · ${r.kg ? `${r.kg.toLocaleString('es-AR')} kg` : ''}`.replace(/ · $/, ''),
      ...(cot ? [`COT ARBA ${cot.numero}${cot.fechaValidez ? ` - válido hasta ${cot.fechaValidez.split('-').reverse().join('/')}` : ''}`] : []),
    ],
    leyenda:   `Remito de traslado de mercadería propia para reparto desde ${planta.localidad}. No válido como factura.`,
    archivo:   `remito-R-${numero}.pdf`,
  }
}

/** PDF del remito R de la carga (null si el remito no fue numerado por la app). */
export async function generateRemitoCargaOficial(r: RemitoCarga, opts: { descargar?: boolean } = {}): Promise<Blob | void | null> {
  const datos = armarRemitoCargaOficial(r)
  if (!datos) return null
  return generateRemitoPdf(datos, opts)
}
