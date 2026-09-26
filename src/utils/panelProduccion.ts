// Cuentas del panel del encargado de producción (2026-09-25). Lógica pura:
// recibe pallets, turnos y ventas resumidas, devuelve lo que la pantalla
// pinta. Pedido de Ariel: en vivo del turno, estado de tablet/impresora,
// Tango, equipo del turno (capitán y operarios), calidad de carga, producido
// contra vendido, y trazabilidad por día y turno.
import type { PalletProduccion, PersonaTurno, ProductoHieloId } from '@/types'
import { PRODUCTOS_HIELO } from './produccionCatalogo'
import { palletVigente } from './cargaPallets'
import { rangoDeTurno, type TurnoProduccionDef } from './turnosProduccion'

const fechaDe = (p: Pick<PalletProduccion, 'fechaFabricacion'>) => p.fechaFabricacion.toDate()

/**
 * Pallets de un turno de un día. Los que tienen la foto del turno (desde el
 * 25/09) se cuentan por la foto: así un cambio de horarios no los mueve de
 * turno. Los viejos, por la hora de fabricación.
 */
export function palletsDelTurno<T extends Pick<PalletProduccion, 'fechaFabricacion' | 'turno'>>(
  pallets: T[], dia: string, turno: TurnoProduccionDef,
): T[] {
  const rango = rangoDeTurno(dia, turno)
  return pallets.filter((p) => {
    if (p.turno) return p.turno.dia === dia && p.turno.nombre === turno.nombre
    if (!rango) return false
    const t = fechaDe(p).getTime()
    return t >= rango.inicio.getTime() && t < rango.fin.getTime()
  })
}

export interface FilaOperario {
  uid:       string
  nombre:    string
  pallets:   number
  anulados:  number
  repetidos: number
  /** Asignado al turno en la configuración (o en la foto del turno). */
  asignado:  boolean
  capitan:   boolean
}

export interface ResumenTurno {
  pallets:        number
  unidades:       number
  kilos:          number
  porProducto:    Partial<Record<ProductoHieloId, number>>
  anulados:       PalletProduccion[]
  /** Confirmados igual después del aviso "¿Otro pallet de…?". */
  repetidos:      number
  tango:          { confirmados: number; pendientes: number; errores: PalletProduccion[] }
  ultimo:         Date | null
  equipo:         FilaOperario[]
  capitan:        PersonaTurno | null
}

/** Resumen de un conjunto de pallets (un turno o un día) con su equipo. */
export function resumirTurno(pallets: PalletProduccion[], turno: TurnoProduccionDef | null): ResumenTurno {
  const vigentes = pallets.filter(palletVigente)
  const porProducto: Partial<Record<ProductoHieloId, number>> = {}
  let unidades = 0, kilos = 0, repetidos = 0, confirmados = 0, pendientes = 0
  const errores: PalletProduccion[] = []
  let ultimo: Date | null = null
  for (const p of vigentes) {
    porProducto[p.productoId] = (porProducto[p.productoId] ?? 0) + 1
    unidades += p.unidades
    kilos += p.unidades * (PRODUCTOS_HIELO[p.productoId]?.kgPorUnidad ?? 0)
    if (p.avisoRepetidoSeg != null) repetidos++
    if (p.tango?.estado === 'confirmado') confirmados++
    else if (p.tango?.estado === 'error') errores.push(p)
    else pendientes++
    const f = fechaDe(p)
    if (!ultimo || f > ultimo) ultimo = f
  }

  // Equipo: la foto del turno manda (quién estaba asignado ESE día); si no
  // hay foto, la configuración actual del turno.
  const foto = pallets.find((p) => p.turno)?.turno
  const capitan = foto?.capitan ?? turno?.capitan ?? null
  const dotacion = foto?.dotacion ?? turno?.operarios ?? []
  const filas = new Map<string, FilaOperario>()
  const fila = (uid: string, nombre: string) => {
    let f = filas.get(uid)
    if (!f) { f = { uid, nombre, pallets: 0, anulados: 0, repetidos: 0, asignado: false, capitan: false }; filas.set(uid, f) }
    return f
  }
  for (const o of dotacion) fila(o.uid, o.nombre).asignado = true
  if (capitan) { const c = fila(capitan.uid, capitan.nombre); c.capitan = true; c.asignado = true }
  for (const p of pallets) {
    const f = fila(p.operador.uid, p.operador.nombre)
    if (!palletVigente(p)) { f.anulados++; continue }
    f.pallets++
    if (p.avisoRepetidoSeg != null) f.repetidos++
  }
  const equipo = [...filas.values()].sort((a, b) =>
    Number(b.capitan) - Number(a.capitan) || b.pallets - a.pallets || a.nombre.localeCompare(b.nombre))

  return {
    pallets: vigentes.length, unidades, kilos: Math.round(kilos), porProducto,
    anulados: pallets.filter((p) => !palletVigente(p)), repetidos,
    tango: { confirmados, pendientes, errores }, ultimo, equipo, capitan,
  }
}

/** Pallets vigentes por hora entre `inicio` y `fin` (una barra por hora). */
export function palletsPorHora(pallets: PalletProduccion[], inicio: Date, fin: Date): { hora: string; desde: Date; pallets: number }[] {
  const out: { hora: string; desde: Date; pallets: number }[] = []
  for (let t = inicio.getTime(); t < fin.getTime(); t += 3_600_000) {
    const d = new Date(t)
    out.push({ hora: `${String(d.getHours()).padStart(2, '0')}h`, desde: d, pallets: 0 })
  }
  for (const p of pallets) {
    if (!palletVigente(p)) continue
    const i = Math.floor((fechaDe(p).getTime() - inicio.getTime()) / 3_600_000)
    if (i >= 0 && i < out.length) out[i]!.pallets++
  }
  return out
}

/** Pallets vigentes hasta `hasta` (para comparar con ayer a la misma altura del turno). */
export function palletsHasta(pallets: PalletProduccion[], hasta: Date): number {
  return pallets.filter((p) => palletVigente(p) && fechaDe(p) <= hasta).length
}

/** Minutos desde el último pallet vigente, o null si no hubo ninguno. */
export function minutosSinCargar(ultimo: Date | null, ahora: Date): number | null {
  return ultimo ? Math.max(0, Math.floor((ahora.getTime() - ultimo.getTime()) / 60_000)) : null
}

/** A partir de cuántos minutos sin cargar, dentro del turno, se avisa. */
export const ALERTA_SIN_CARGAR_MIN = 30

// ── Producido contra vendido ────────────────────────────────────────────────

export interface FilaProducidoVendido {
  productoId:        ProductoHieloId
  producidoPallets:  number
  producidoUnidades: number
  vendidoUnidades:   number
  /** Vendido pasado a pallets (unidades / unidades por pallet), con un decimal. */
  vendidoPallets:    number
  /** Producido − vendido, en pallets: positivo = se levanta stock. */
  balancePallets:    number
}

export function producidoVsVendido(
  pallets: PalletProduccion[],
  vendidoPorProducto: Partial<Record<string, number>>,
  productos: ProductoHieloId[],
): FilaProducidoVendido[] {
  const r1 = (n: number) => Math.round(n * 10) / 10
  return productos.map((id) => {
    const prod = PRODUCTOS_HIELO[id]
    const propios = pallets.filter((p) => p.productoId === id && palletVigente(p))
    const producidoUnidades = propios.reduce((s, p) => s + p.unidades, 0)
    const vendidoUnidades = vendidoPorProducto[id] ?? 0
    const vendidoPallets = r1(vendidoUnidades / prod.unidadesPorPallet)
    return {
      productoId: id,
      producidoPallets: propios.length,
      producidoUnidades,
      vendidoUnidades,
      vendidoPallets,
      balancePallets: r1(propios.length - vendidoPallets),
    }
  })
}

/** Suma las ventas resumidas de varios días para una planta. */
export function vendidoDePlanta(dias: { porPlanta: Record<string, Record<string, number>> }[], planta: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const d of dias) {
    for (const [prod, n] of Object.entries(d.porPlanta?.[planta] ?? {})) out[prod] = (out[prod] ?? 0) + n
  }
  return out
}
