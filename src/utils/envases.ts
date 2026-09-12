import type { ConteoEnvases, DescargaCamion, EnvasesCarga, LiquidacionEnvases, RemitoCarga } from '@/types'

// Envases retornables del camión (2026-09-07): lógica pura, sin Firebase.
//
// Lo que sale lo declara caja en el remito (`envases`: tarimas de madera,
// pallets de metal y números de rack); puntales, aros y sombreros van
// implícitos: 4 puntales y 1 sombrero por pallet de cualquier tipo, y 1 aro
// solo por tarima de madera (el pallet de metal no lleva aro, 2026-09-12). Lo que vuelve lo cuenta muelle suelto en la descarga. Acá se
// normalizan las dos puntas (incluidos los docs anteriores al cambio, que solo
// tenían un número de pallets) y se cuadran por tipo para la liquidación.

export const PUNTALES_POR_PALLET = 4
/** Solo las tarimas de madera llevan aro; el pallet de metal no. */
export const AROS_POR_TARIMA_MADERA = 1
/** Sombrero: 1 por pallet, de madera o de metal (2026-09-12). */
export const SOMBREROS_POR_PALLET = 1
/** Tope de racks por viaje — espejado en firestore.rules (racksOk). */
export const MAX_RACKS_POR_VIAJE = 60

export type OrigenEnvases = 'envases' | 'legacy'
export type EnvasesNormalizados = ConteoEnvases & { racks: number[]; origen: OrigenEnvases }

export const conteoVacio = (): ConteoEnvases => ({ tarimasMadera: 0, palletsMetal: 0, puntales: 0, aros: 0, sombreros: 0 })

export const envasesCargaVacio = (): EnvasesCarga => ({ tarimasMadera: 0, palletsMetal: 0, racks: [] })

/** Implícitos: 4 puntales y 1 sombrero por pallet (madera o metal), 1 aro solo por tarima de madera. */
export const implicitosDe = (tarimasMadera: number, palletsMetal: number) => ({
  puntales: (tarimasMadera + palletsMetal) * PUNTALES_POR_PALLET,
  aros: tarimasMadera * AROS_POR_TARIMA_MADERA,
  sombreros: (tarimasMadera + palletsMetal) * SOMBREROS_POR_PALLET,
})

/**
 * Lo que salió según el remito. Un remito anterior al cambio (sin `envases`)
 * se lee como `palletsCarga` pallets de metal: ese era el modelo viejo (base
 * de metal + 4 puntales), y así un día viejo sigue cuadrando sin fantasmas.
 */
export function envasesDeRemito(r: Pick<RemitoCarga, 'palletsCarga' | 'envases'>): EnvasesNormalizados {
  if (r.envases) {
    return { tarimasMadera: r.envases.tarimasMadera, palletsMetal: r.envases.palletsMetal, ...implicitosDe(r.envases.tarimasMadera, r.envases.palletsMetal), racks: [...r.envases.racks], origen: 'envases' }
  }
  const pallets = r.palletsCarga ?? 0
  return { tarimasMadera: 0, palletsMetal: pallets, ...implicitosDe(0, pallets), racks: [], origen: 'legacy' }
}

/**
 * Lo que volvió según la descarga. Una descarga anterior al cambio traía
 * pallets completos/parciales/vacíos: se traducen a pallets de metal con sus
 * puntales y aros implícitos (ver envasesDeRemito).
 */
export function envasesDeDescarga(d: Pick<DescargaCamion, 'envases' | 'palletsCompletos' | 'palletsParciales' | 'palletsVacios'>): EnvasesNormalizados {
  // `sombreros` no existía antes del 2026-09-12: una descarga vieja se lee como 0 contados.
  if (d.envases) return { tarimasMadera: d.envases.tarimasMadera, palletsMetal: d.envases.palletsMetal, puntales: d.envases.puntales, aros: d.envases.aros, sombreros: d.envases.sombreros ?? 0, racks: [...d.envases.racks], origen: 'envases' }
  const pallets = (d.palletsCompletos ?? 0) + (d.palletsParciales ?? 0) + (d.palletsVacios ?? 0)
  return { tarimasMadera: 0, palletsMetal: pallets, ...implicitosDe(0, pallets), racks: [], origen: 'legacy' }
}

export const sumarConteos = (a: ConteoEnvases, b: ConteoEnvases): ConteoEnvases => ({
  tarimasMadera: a.tarimasMadera + b.tarimasMadera, palletsMetal: a.palletsMetal + b.palletsMetal, puntales: a.puntales + b.puntales, aros: a.aros + b.aros, sombreros: a.sombreros + b.sombreros,
})
export const restarConteos = (a: ConteoEnvases, b: ConteoEnvases): ConteoEnvases => ({
  tarimasMadera: a.tarimasMadera - b.tarimasMadera, palletsMetal: a.palletsMetal - b.palletsMetal, puntales: a.puntales - b.puntales, aros: a.aros - b.aros, sombreros: a.sombreros - b.sombreros,
})

const ordenados = (racks: Iterable<number>) => [...new Set(racks)].sort((a, b) => a - b)

/** Cuadre del día: Σ remitos vs Σ descargas, por tipo y por número de rack. */
export function cuadrarEnvases(
  remitos:   Array<Pick<RemitoCarga, 'palletsCarga' | 'envases'>>,
  descargas: Array<Pick<DescargaCamion, 'envases' | 'palletsCompletos' | 'palletsParciales' | 'palletsVacios'>>,
): LiquidacionEnvases {
  let salieron: ConteoEnvases = conteoVacio(), volvieron: ConteoEnvases = conteoVacio()
  const racksSalieron: number[] = [], racksVolvieron: number[] = []
  for (const r of remitos) { const e = envasesDeRemito(r); salieron = sumarConteos(salieron, e); racksSalieron.push(...e.racks) }
  for (const d of descargas) { const e = envasesDeDescarga(d); volvieron = sumarConteos(volvieron, e); racksVolvieron.push(...e.racks) }
  const s = new Set(racksSalieron), v = new Set(racksVolvieron)
  return {
    salieron:       { ...salieron, racks: ordenados(s) },
    volvieron:      { ...volvieron, racks: ordenados(v) },
    diferencia:     restarConteos(volvieron, salieron),
    racksFaltantes: ordenados([...s].filter((n) => !v.has(n))),
    racksSobrantes: ordenados([...v].filter((n) => !s.has(n))),
  }
}

/** "12, 15 18;20" → [12, 15, 18, 20]: enteros positivos, sin repetidos, en el orden en que se escribieron. */
export function parseRacks(texto: string): number[] {
  const out: number[] = []
  for (const t of String(texto ?? '').split(/[^0-9]+/)) {
    if (!t) continue
    const n = Number(t)
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n)
  }
  return out.slice(0, MAX_RACKS_POR_VIAJE)
}

export const describirRacks = (racks: number[]): string =>
  racks.length ? `Nº ${[...racks].sort((a, b) => a - b).join(', ')}` : 'sin racks'

/** "3 madera · 2 metal · 20 puntales · 3 aros · 5 sombreros · racks Nº 12, 15" (omite los ceros; vacío si no hay nada). */
export function describirEnvases(e: Omit<ConteoEnvases, 'sombreros'> & { sombreros?: number; racks?: number[] }): string {
  const partes: string[] = []
  if (e.tarimasMadera) partes.push(`${e.tarimasMadera} madera`)
  if (e.palletsMetal) partes.push(`${e.palletsMetal} metal`)
  if (e.puntales) partes.push(`${e.puntales} puntales`)
  if (e.aros) partes.push(`${e.aros} aro${e.aros === 1 ? '' : 's'}`)
  if (e.sombreros) partes.push(`${e.sombreros} sombrero${e.sombreros === 1 ? '' : 's'}`)
  if (e.racks?.length) partes.push(`racks ${describirRacks(e.racks)}`)
  return partes.join(' · ')
}

/** Filas "tipo → cantidad" para listados y PDF (solo las que tienen algo). */
export function filasDeEnvases(e: EnvasesNormalizados): Array<{ nombre: string; q: number }> {
  if (e.origen === 'legacy') return e.palletsMetal ? [{ nombre: 'Pallets (sin composición)', q: e.palletsMetal }] : []
  return [
    { nombre: 'Pallets de madera', q: e.tarimasMadera },
    { nombre: 'Pallets de metal', q: e.palletsMetal },
    { nombre: 'Puntales', q: e.puntales },
    { nombre: 'Aros', q: e.aros },
    { nombre: 'Sombreros', q: e.sombreros },
    { nombre: `Racks de agua ${e.racks.length ? describirRacks(e.racks) : ''}`.trim(), q: e.racks.length },
  ].filter((f) => f.q > 0)
}
