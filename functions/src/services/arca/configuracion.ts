/**
 * Configuración de la facturación electrónica.
 *
 * Vive en Firestore (`config/arca`) y no en el código, porque son valores que
 * cambian sin tocar el programa: el punto de venta, el ambiente, el código de
 * tributo de la percepción. Lo que sí está en el código es la **validación**:
 * si falta algo o viene con un valor imposible, no se factura.
 *
 * El criterio general de este módulo, igual que en el resto de la integración:
 * ante la duda, frenar. Un comprobante mal emitido no se borra, se corrige con
 * una nota de crédito.
 */

import type { DbLike } from './numeracion'
import type { AmbienteArca } from './wsaa'

export interface ConfigArca {
  /** `homologacion` para probar sin efecto fiscal, `produccion` para emitir de verdad. */
  ambiente: AmbienteArca
  /** CUIT del emisor, sin guiones. Contado = Redonhielo. */
  cuit: string
  /** Punto de venta propio de la app. NUNCA compartido con el que usa Tango. */
  puntoVenta: number
  /**
   * Si los precios del catálogo ya traen el IVA adentro.
   *
   * Confirmado por el negocio el 2026-09-01: los precios son **netos**, se les
   * suma el IVA encima → `false`. Se deja configurable igual porque un cambio de
   * criterio comercial no debería requerir un deploy, pero **no tiene default**:
   * si falta en Firestore, se rechaza la configuración en vez de asumir.
   */
  preciosIncluyenIva: boolean
  /**
   * Código de tributo de ARCA para la percepción de IIBB de CABA.
   * Sale de `FEParamGetTiposTributos` — ver `scripts/arca/verificar-conexion.mjs`.
   */
  tributoIdPercepcionIIBB: number
  /**
   * Tope (IVA incluido) hasta el cual un consumidor final del mostrador puede
   * facturarse sin identificar (DocTipo 99). Lo fija ARCA (RG 5003 y sus
   * actualizaciones) y cambia cada tanto, por eso vive acá. 0 = siempre pedir
   * CUIT o DNI.
   */
  topeConsumidorFinalSinIdentificar: number
  /** Interruptor general: con esto en false no se emite nada. */
  habilitado: boolean
}

export class ConfigArcaInvalida extends Error {
  constructor(readonly problemas: string[]) {
    super(`Configuración de ARCA incompleta o inválida: ${problemas.join('; ')}`)
    this.name = 'ConfigArcaInvalida'
  }
}

export const RUTA_CONFIG = 'config/arca'

/**
 * Valida y normaliza lo que hay guardado.
 *
 * Se exporta aparte de la lectura para poder testearla sin Firestore, y para
 * que el panel de administración pueda validar antes de guardar.
 */
export function validarConfig(data: Record<string, unknown> | undefined): ConfigArca {
  const problemas: string[] = []
  const d = data ?? {}

  const ambiente = d.ambiente
  if (ambiente !== 'homologacion' && ambiente !== 'produccion') {
    problemas.push('`ambiente` debe ser "homologacion" o "produccion"')
  }

  const cuit = String(d.cuit ?? '').replace(/\D/g, '')
  if (cuit.length !== 11) problemas.push('`cuit` debe tener 11 dígitos')

  const puntoVenta = Number(d.puntoVenta)
  if (!Number.isInteger(puntoVenta) || puntoVenta < 1 || puntoVenta > 99998) {
    // El rango sale de la validación 10004 del manual de ARCA.
    problemas.push('`puntoVenta` debe ser un entero entre 1 y 99998')
  }

  if (typeof d.preciosIncluyenIva !== 'boolean') {
    problemas.push(
      '`preciosIncluyenIva` debe estar definido explícitamente (true/false): ' +
      'de esto depende si el total lleva el IVA adentro o encima',
    )
  }

  const tributoId = Number(d.tributoIdPercepcionIIBB)
  if (!Number.isInteger(tributoId) || tributoId < 1) {
    problemas.push(
      '`tributoIdPercepcionIIBB` debe ser el código de tributo de ARCA ' +
      '(se obtiene con FEParamGetTiposTributos)',
    )
  }

  // Opcional: ausente = 0 = el consumidor final del mostrador siempre se
  // identifica. Si viene, tiene que ser un número no negativo.
  const tope = d.topeConsumidorFinalSinIdentificar
  const topeNum = tope === undefined || tope === null ? 0 : Number(tope)
  if (!Number.isFinite(topeNum) || topeNum < 0) {
    problemas.push('`topeConsumidorFinalSinIdentificar` debe ser un número >= 0 (tope de la RG 5003)')
  }

  if (problemas.length > 0) throw new ConfigArcaInvalida(problemas)

  return {
    ambiente: ambiente as AmbienteArca,
    cuit,
    puntoVenta,
    preciosIncluyenIva: d.preciosIncluyenIva as boolean,
    tributoIdPercepcionIIBB: tributoId,
    topeConsumidorFinalSinIdentificar: topeNum,
    // El default es NO emitir: una configuración a medio cargar no debe
    // empezar a facturar sola.
    habilitado: d.habilitado === true,
  }
}

/** Lee y valida la configuración. Tira `ConfigArcaInvalida` si algo falta. */
export async function leerConfig(db: DbLike): Promise<ConfigArca> {
  const ref = db.doc(RUTA_CONFIG)
  const data = await db.runTransaction(async (tx) => (await tx.get(ref)).data())
  return validarConfig(data)
}

/**
 * Igual que `leerConfig` pero además exige que la facturación esté encendida.
 *
 * Se usa en el camino de emisión; el panel de administración usa `leerConfig`
 * para poder mostrar la configuración aunque todavía esté apagada.
 */
export async function leerConfigParaEmitir(db: DbLike): Promise<ConfigArca> {
  const config = await leerConfig(db)
  if (!config.habilitado) {
    throw new ConfigArcaInvalida(['la facturación electrónica está deshabilitada (`habilitado: false`)'])
  }
  return config
}
