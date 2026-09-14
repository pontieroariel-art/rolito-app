import type { DescargaCamion, RemitoCarga, VentaVentanilla } from '../types'
import { descargasVigentes } from './rectificacionDescarga'

// Tiempos del muelle (2026-09-13). Todo sale de timestamps que la operación YA
// escribe: nadie tiene que cronometrar ni cargar nada extra.
//
//   · Espera de descarga    = descarga.fecha − remito.regreso.hora
//     (el camión volvió y estuvo en el playón hasta que lo contaron)
//   · Ocupación de dársena  = remito.salida.hora − (darsenaAsignadaEn ?? entregadoPor.hora)
//     (desde que se le dio la boca hasta que salió por el portón)
//   · Espera de ventanilla  = venta.llamadoAt − venta.fecha   (sacó turno → lo llamaron)
//   · Atención de ventanilla = entregadoPor.hora − llamadoAt  (lo llamaron → se llevó la mercadería)
//
// Los promedios solos mienten en tiempos de espera: un camión que quedó cuatro
// horas tirado corre el promedio de todo el día. Por eso cada resumen trae
// mediana y p90 — la mediana es el día normal y el p90 es el cuello de botella.

export interface MuestraTiempo {
  /** Minutos que duró (siempre > 0: las muestras imposibles se descartan). */
  minutos:  number
  /** Cuándo EMPEZÓ a contar: es lo que define la franja horaria. */
  desde:    Date
  /** Para la tabla: patente + chofer, o el turno. */
  etiqueta: string
  /** Por quién se agrupa (chofer/fletero, o el cajero de la ventanilla). */
  grupo:    string
  darsena?: number
}

export interface ResumenTiempos {
  cantidad: number
  promedio: number
  mediana:  number
  p90:      number
  maximo:   number
}

export const RESUMEN_VACIO: ResumenTiempos = { cantidad: 0, promedio: 0, mediana: 0, p90: 0, maximo: 0 }

const minutosEntre = (desde: Date, hasta: Date): number => (hasta.getTime() - desde.getTime()) / 60_000

/** Percentil por el método del más cercano (sin interpolar: son minutos, no física). */
function percentil(ordenados: number[], p: number): number {
  if (ordenados.length === 0) return 0
  const i = Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1)
  return ordenados[Math.max(0, i)]
}

export function resumir(muestras: MuestraTiempo[]): ResumenTiempos {
  if (muestras.length === 0) return RESUMEN_VACIO
  const ms = muestras.map((m) => m.minutos).sort((a, b) => a - b)
  const total = ms.reduce((s, n) => s + n, 0)
  return {
    cantidad: ms.length,
    promedio: Math.round((total / ms.length) * 10) / 10,
    mediana:  percentil(ms, 50),
    p90:      percentil(ms, 90),
    maximo:   ms[ms.length - 1],
  }
}

/** Una muestra solo vale si los dos extremos existen y el delta es positivo y sensato. */
const TOPE_MINUTOS = 24 * 60
const valida = (min: number): boolean => Number.isFinite(min) && min > 0 && min <= TOPE_MINUTOS

function muestra(desde: Date | null, hasta: Date | null, etiqueta: string, grupo: string, darsena?: number): MuestraTiempo | null {
  if (!desde || !hasta) return null
  const minutos = Math.round(minutosEntre(desde, hasta) * 10) / 10
  if (!valida(minutos)) return null
  return { minutos, desde, etiqueta, grupo, ...(darsena !== undefined ? { darsena } : {}) }
}

const hora = (ts: { toDate(): Date } | undefined | null): Date | null => ts ? ts.toDate() : null

/**
 * Cuánto esperó cada camión en el playón desde que volvió hasta que el muelle
 * le contó la descarga.
 *
 * La descarga dice a qué remito corresponde desde el 2026-09-13 (`remitoId`);
 * para las anteriores se busca el remito de ese repartidor cuyo regreso sea el
 * más reciente ANTES del conteo, que es el que se estaba descargando.
 */
export function esperaDeDescarga(remitos: RemitoCarga[], descargas: DescargaCamion[]): MuestraTiempo[] {
  const porId = new Map(remitos.map((r) => [r.id, r]))
  const conRegreso = remitos
    .filter((r) => r.regreso)
    .sort((a, b) => a.regreso!.hora.toMillis() - b.regreso!.hora.toMillis())

  return descargasVigentes(descargas)
    .map((d) => {
      const contada = d.fecha.toDate()
      const remito = d.remitoId
        ? porId.get(d.remitoId)
        : [...conRegreso].reverse().find((r) => r.choferId === d.choferId && r.regreso!.hora.toDate() <= contada)
      const volvio = hora(remito?.regreso?.hora)
      return muestra(
        volvio,
        contada,
        `${remito?.codigo ?? 'sin remito'} · ${d.choferNombre}`,
        d.choferNombre,
      )
    })
    .filter((m): m is MuestraTiempo => m !== null)
}

/**
 * Cuánto estuvo ocupada la boca: desde que muelle le asignó la dársena (o, en
 * los remitos anteriores al 2026-09-13, desde que le entregó la mercadería)
 * hasta que seguridad lo dejó salir por el portón.
 */
export function ocupacionDeDarsena(remitos: RemitoCarga[]): MuestraTiempo[] {
  return remitos
    .map((r) => muestra(
      hora(r.darsenaAsignadaEn) ?? hora(r.entregadoPor?.hora),
      hora(r.salida?.hora),
      `${r.codigo} · ${r.camionLabel || r.choferNombre}`,
      r.choferNombre,
      r.darsena,
    ))
    .filter((m): m is MuestraTiempo => m !== null)
}

/** Desde que el cliente sacó el turno hasta que lo llamaron a la dársena. */
export function esperaDeVentanilla(ventas: VentaVentanilla[]): MuestraTiempo[] {
  return ventas
    .map((v) => muestra(v.fecha.toDate(), hora(v.llamadoAt), `T-${v.turno} · ${v.clienteNombre}`, v.cajaNombre, v.darsena))
    .filter((m): m is MuestraTiempo => m !== null)
}

/** Desde que lo llamaron hasta que se llevó la mercadería (lo que tarda el muelle en cargarlo). */
export function atencionDeVentanilla(ventas: VentaVentanilla[]): MuestraTiempo[] {
  return ventas
    .map((v) => muestra(hora(v.llamadoAt), hora(v.entregadoPor?.hora), `T-${v.turno} · ${v.clienteNombre}`, v.cajaNombre, v.darsena))
    .filter((m): m is MuestraTiempo => m !== null)
}

/** Por hora del día (0-23), para ver en qué franja se tapona. Solo las horas con datos. */
export function porFranjaHoraria(muestras: MuestraTiempo[]): Array<{ hora: number; resumen: ResumenTiempos }> {
  const franjas = new Map<number, MuestraTiempo[]>()
  muestras.forEach((m) => {
    const h = m.desde.getHours()
    franjas.set(h, [...(franjas.get(h) ?? []), m])
  })
  return [...franjas.entries()]
    .map(([h, ms]) => ({ hora: h, resumen: resumir(ms) }))
    .sort((a, b) => a.hora - b.hora)
}

/** Por chofer/fletero (o cajero), del más lento al más rápido: es el orden en que se mira. */
export function porGrupo(muestras: MuestraTiempo[]): Array<{ grupo: string; resumen: ResumenTiempos }> {
  const grupos = new Map<string, MuestraTiempo[]>()
  muestras.forEach((m) => grupos.set(m.grupo, [...(grupos.get(m.grupo) ?? []), m]))
  return [...grupos.entries()]
    .map(([grupo, ms]) => ({ grupo, resumen: resumir(ms) }))
    .sort((a, b) => b.resumen.mediana - a.resumen.mediana || b.resumen.cantidad - a.resumen.cantidad)
}

/** Por dársena, para ver si hay una boca que siempre atrasa. */
export function porDarsena(muestras: MuestraTiempo[]): Array<{ darsena: number; resumen: ResumenTiempos }> {
  const bocas = new Map<number, MuestraTiempo[]>()
  muestras.filter((m) => m.darsena !== undefined).forEach((m) => {
    bocas.set(m.darsena!, [...(bocas.get(m.darsena!) ?? []), m])
  })
  return [...bocas.entries()]
    .map(([darsena, ms]) => ({ darsena, resumen: resumir(ms) }))
    .sort((a, b) => a.darsena - b.darsena)
}

/** "1 h 25 min" / "18 min" — los minutos pelados de tres cifras no se leen. */
export function duracion(minutos: number): string {
  const m = Math.round(minutos)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const resto = m % 60
  return resto === 0 ? `${h} h` : `${h} h ${resto} min`
}
