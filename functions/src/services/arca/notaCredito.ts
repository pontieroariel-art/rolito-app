/**
 * Nota de crédito que anula TODA la factura de una venta.
 *
 * Espejo de `facturarVenta`, con la misma obsesión: **una venta produce a lo
 * sumo una nota de crédito**. El estado vive en `facturasArca/nc_{ventaId}` y
 * cada corrida decide según lo que encuentre:
 *
 *   ya emitida                       → no hace nada
 *   con número reservado sin resolver → pregunta a ARCA (nunca reintenta a ciegas)
 *   rechazada con el número liberado  → se puede volver a emitir (re-aprobación)
 *   sin número                        → verifica la factura en ARCA y emite
 *
 * Los importes de la NC son exactamente los de la factura (ver
 * `construirDetalleNotaCreditoTotal`). Antes de reservar un número se confirma
 * con FECompConsultar que la factura existe y que su total coincide con lo
 * guardado: anular algo que ARCA no tiene, o con otro importe, es un rechazo
 * seguro y un número quemado.
 */

import type { DbLike } from './numeracion'
import type { PuertoArca } from './emision'
import { emitirDetalle, resolverIncierto } from './emision'
import type { ConfigArca } from './configuracion'
import type { CbteAsoc, DatosReceptor, FacturaOrigen } from './comprobante'
import { construirDetalleNotaCreditoTotal, redondear2 } from './comprobante'
import type { FacturaGuardada, RegistroFactura } from './facturacionVenta'

export interface OpcionesEmitirNotaCredito {
  db: DbLike
  arca: PuertoArca
  config: ConfigArca
  ventaId: string
  anulacionId: string
  /** La factura que se anula (de `facturasArca/{ventaId}` + el espejo en la venta). */
  factura: FacturaOrigen
  /** Solo hace falta si la factura no guardó su `detalle` (anteriores al 2026-09-09). */
  receptor?: DatosReceptor
  ahora?: Date
  /** Lee `facturasArca/nc_{ventaId}`; undefined si nunca se intentó. */
  leer: () => Promise<FacturaGuardada | undefined>
  guardar: (registro: RegistroFactura) => Promise<void>
}

function leerNumero(f: FacturaGuardada | undefined): { numero: number; cbteTipo: number } | null {
  if (!f) return null
  const numero = typeof f.numero === 'number' ? f.numero : null
  const cbteTipo = typeof f.cbteTipo === 'number' ? f.cbteTipo : null
  if (numero === null || cbteTipo === null) return null
  return { numero, cbteTipo }
}

export async function emitirNotaCreditoTotal(opts: OpcionesEmitirNotaCredito): Promise<RegistroFactura> {
  const { db, arca, config, ventaId, anulacionId, factura } = opts
  const base = { ventaId, anulacionId, tipo: 'nota_credito' as const, puntoVenta: factura.puntoVenta }

  const previo = await opts.leer()

  // 1. Ya salió: no se toca. Repetir acá sería anular dos veces la misma factura.
  if (previo?.estado === 'emitida') {
    const n = leerNumero(previo)
    return {
      ...base,
      estado: 'emitida',
      cbteTipo: n?.cbteTipo ?? 0,
      numero: n?.numero ?? 0,
      cae: typeof previo.cae === 'string' ? previo.cae : null,
      caeFchVto: typeof previo.caeFchVto === 'string' ? previo.caeFchVto : null,
      ...(previo.importes ? { importes: previo.importes as RegistroFactura['importes'] } : {}),
    }
  }

  // 2. Hay un número de un intento anterior que todavía puede haber llegado a
  //    ARCA: se pregunta. Salvo que ARCA ya haya confirmado el rechazo y el
  //    número esté liberado: ahí sí se vuelve a emitir (caso re-aprobación).
  const pendiente = leerNumero(previo)
  const liberado = previo?.estado === 'rechazada' && previo.numeroLiberado === true
  if (pendiente && !liberado) {
    const r = await resolverIncierto(db, arca, factura.puntoVenta, pendiente.cbteTipo, pendiente.numero)
    const registro: RegistroFactura =
      r.estado === 'emitido'
        ? { ...base, estado: 'emitida', cbteTipo: r.cbteTipo, numero: r.numero, cae: r.cae, caeFchVto: r.caeFchVto }
        : {
            ...base, estado: 'rechazada', cbteTipo: r.cbteTipo, numero: r.numero,
            motivo: r.estado === 'rechazado' ? r.motivo : 'sin resolver',
            numeroLiberado: r.estado === 'rechazado' ? r.numeroLiberado : false,
          }
    await opts.guardar(registro)
    return registro
  }

  // 3. Sin número: antes de quemar uno, confirmar que la factura existe en ARCA
  //    tal como la tenemos guardada.
  const consulta = await arca.consultarComprobante(factura.puntoVenta, factura.cbteTipo, factura.numero)
  if (!consulta.existe) {
    throw new Error(
      `La factura ${factura.puntoVenta}-${factura.numero} (tipo ${factura.cbteTipo}) no existe en ARCA: no se puede anular`,
    )
  }
  if (typeof consulta.impTotal === 'number' && redondear2(consulta.impTotal) !== redondear2(factura.importes.total)) {
    throw new Error(
      `El total de la factura en ARCA (${consulta.impTotal}) no coincide con el guardado (${factura.importes.total}): ` +
      'la nota de crédito hay que cargarla desde Tango',
    )
  }
  if (!factura.importes.fecha && consulta.cbteFch) factura.importes.fecha = consulta.cbteFch

  const ahora = opts.ahora ?? new Date()
  const armar = (numero: number) => construirDetalleNotaCreditoTotal(factura, {
    numeroComprobante: numero,
    fechaEmision: ahora,
    cuitEmisor: config.cuit,
    tributoIdPercepcionIIBB: config.tributoIdPercepcionIIBB,
    receptor: opts.receptor,
  })
  // Con número provisorio: valida todo (tipo, receptor, importes) antes de reservar.
  const provisorio = armar(1)
  const cbteTipo = provisorio.cbteTipo
  const cbtesAsoc: CbteAsoc[] = provisorio.detalle.CbtesAsoc ?? []

  const resultado = await emitirDetalle({
    db, arca,
    ptoVta: factura.puntoVenta,
    cbteTipo,
    armarDetalle: (numero) => armar(numero).detalle,
    onNumeroReservado: async (numero, tipo) => {
      await opts.guardar({ ...base, estado: 'incierta', cbteTipo: tipo, numero, motivo: 'emisión en curso', cbtesAsoc })
    },
  })

  const registro: RegistroFactura =
    resultado.estado === 'emitido'
      ? {
          ...base, estado: 'emitida',
          cbteTipo: resultado.cbteTipo, numero: resultado.numero,
          cae: resultado.cae, caeFchVto: resultado.caeFchVto,
          observaciones: resultado.observaciones,
          importes: resultado.importes,
          ...(resultado.detalle ? { detalle: resultado.detalle } : {}),
          cbtesAsoc,
        }
      : {
          ...base,
          estado: resultado.estado === 'incierto' ? 'incierta' : 'rechazada',
          cbteTipo: resultado.cbteTipo, numero: resultado.numero,
          motivo: resultado.motivo,
          cbtesAsoc,
          ...(resultado.estado === 'rechazado' ? { numeroLiberado: resultado.numeroLiberado } : {}),
        }

  await opts.guardar(registro)
  return registro
}
