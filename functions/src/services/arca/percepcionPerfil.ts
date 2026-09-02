/**
 * La percepción de IIBB del cliente, leída de su perfil.
 *
 * Se espera en `users/{uid}.percepcionIIBB`, con la alícuota que AGIP publica
 * cada mes y su período de vigencia. Lo escribe
 * `scripts/arca/importar-padron-iibb.mjs`.
 *
 * Vive acá y no en el trigger porque tiene una regla propia que hay que poder
 * testear: **sin vigencia no se factura**. Sin ella no se puede distinguir una
 * alícuota del mes en curso de una del mes pasado, y usar la vieja no falla en
 * ningún lado: factura mal, en silencio.
 *
 * La vigencia puede venir de dos formas, y las dos son válidas:
 *
 *   - `Timestamp` de Firestore (si algún día la escribe una Cloud Function)
 *   - texto `'AAAA-MM-DD'`, que es lo que escribe el importador — el padrón de
 *     AGIP habla de días de calendario, no de instantes
 *
 * El texto se ancla al mediodía UTC (09:00 en Argentina): así el día de
 * calendario es el mismo mire desde donde mire, y el último día del mes sigue
 * siendo válido hasta que termina.
 */

import type { PercepcionIIBB } from './comprobante'

/** El mediodía UTC del día que nombra el texto — nunca cae en el día de al lado. */
function deTexto(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim())
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12))
  return Number.isNaN(d.getTime()) ? null : d
}

/** Acepta Timestamp de Firestore, Date o 'AAAA-MM-DD'. Devuelve null si no entiende. */
export function fechaDeVigencia(valor: unknown): Date | null {
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor
  if (typeof valor === 'string') return deTexto(valor)

  const conToDate = valor as { toDate?: () => Date } | null | undefined
  if (typeof conToDate?.toDate === 'function') {
    const d = conToDate.toDate()
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null
  }
  return null
}

export class PercepcionSinVigencia extends Error {
  constructor() {
    super(
      'El cliente tiene alícuota de percepción de IIBB pero sin período de vigencia. ' +
      'No se puede saber si el padrón está al día, así que no se factura.',
    )
    this.name = 'PercepcionSinVigencia'
  }
}

/**
 * Devuelve `undefined` si al cliente no le corresponde percepción — eso
 * significa "no está en el padrón", no "faltan datos". Tira si tiene alícuota
 * pero no se le puede creer la vigencia.
 */
export function leerPercepcionDePerfil(
  perfil: Record<string, unknown>,
  tributoId: number,
): PercepcionIIBB | undefined {
  const p = perfil.percepcionIIBB as Record<string, unknown> | undefined
  if (!p) return undefined

  const alicuota = Number(p.alicuota)
  if (!Number.isFinite(alicuota) || alicuota <= 0) return undefined

  const vigenciaDesde = fechaDeVigencia(p.vigenciaDesde)
  const vigenciaHasta = fechaDeVigencia(p.vigenciaHasta)
  if (!vigenciaDesde || !vigenciaHasta) throw new PercepcionSinVigencia()

  return {
    alicuota,
    tributoId,
    descripcion: 'Percepción IIBB CABA',
    vigenciaDesde,
    vigenciaHasta,
  }
}
