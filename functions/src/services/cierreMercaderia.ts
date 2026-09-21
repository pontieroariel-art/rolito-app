/**
 * Cierre de MERCADERÍA de un viaje (2026-09-18).
 *
 * La liquidación de un viaje se cierra en dos mitades independientes: la PLATA
 * la liquida caja (de 6 a 18) y la MERCADERÍA la cierra el muelle al contar la
 * descarga (a cualquier hora). Este archivo arma la segunda.
 *
 * Lo escribe el SERVIDOR, no la tablet, por la misma razón por la que existe
 * `revisionDescarga`: el muelle cuenta A CIEGAS — las reglas no le dejan leer
 * `ventasCamion` y la pantalla nunca le muestra el teórico. Si el cierre lo
 * armara el cliente, el conteo dejaría de ser ciego.
 *
 * Es una RÉPLICA de `src/utils/liquidacion.mercaderiaDelViaje` + `utils/envases`
 * + `utils/faltantes.calcularFaltante`, porque `functions/tsconfig.json` tiene
 * `include: ["src"]` y functions no puede importar de la app (mismo patrón que
 * `revisionDescarga.ts`). Si se toca el cálculo de un lado, hay que tocarlo del
 * otro: los dos números se muestran juntos en la pantalla de caja.
 */

import { descargasVigentes, type UmbralFaltantes, UMBRAL_FALTANTES_DEFAULT } from './revisionDescarga'

// ── Formas mínimas de los docs (solo lo que el cálculo mira) ────────────────

export interface ItemMercaderia { productoId: string; nombre: string; cantidad: number }

/** Lo que viene de Firestore puede estar sucio (undefined, null, NaN): vale 0. */
const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** `*Simples` (2026-09-21): parte del total de su tipo, solo la base, sin puntales; no suman implícitos. */
export interface EnvasesCargaDoc { tarimasMadera: number; palletsMetal: number; tarimasMaderaSimples?: number; palletsMetalSimples?: number; racks: number[] }
export interface EnvasesDescargaDoc { tarimasMadera: number; palletsMetal: number; tarimasMaderaSimples?: number; palletsMetalSimples?: number; puntales: number; aros: number; sombreros?: number; racks: number[] }

export interface RemitoParaCierre {
  id:            string
  codigo?:       string
  plantaId?:     string
  choferId?:     string
  choferNombre?: string
  depositoTango?:       string | null
  depositoTangoNombre?: string | null
  items?:        ItemMercaderia[]
  palletsCarga?: number
  envases?:      EnvasesCargaDoc | null
}

export interface VentaParaCierre {
  canal?:     string
  items?:     ItemMercaderia[]
  cambios?:   ItemMercaderia[] | null
  anulacion?: { estado?: string } | null
}

export interface DescargaParaCierre {
  id?:          string
  codigo?:      string | null
  rectificaA?:  string
  items?:       ItemMercaderia[]
  bolsasRotas?: ItemMercaderia[]
  envases?:     EnvasesDescargaDoc | null
  // LEGACY (descargas anteriores al 2026-09-07).
  palletsCompletos?: number
  palletsParciales?: number
  palletsVacios?:    number
}

export interface ProductoCierre {
  productoId:        string
  nombre:            string
  carga:             number
  ventaContado:      number
  ventaPromo:        number
  cambios:           number
  devolucionTeorica: number
  descarga:          number
  diferencia:        number
  rotas:             number
}

export interface ConteoEnvasesCierre { tarimasMadera: number; palletsMetal: number; puntales: number; aros: number; sombreros: number }
export interface CuadreEnvases {
  salieron:       ConteoEnvasesCierre & { racks: number[] }
  volvieron:      ConteoEnvasesCierre & { racks: number[] }
  diferencia:     ConteoEnvasesCierre
  racksFaltantes: number[]
  racksSobrantes: number[]
}

export interface FaltanteCierre {
  bolsasFaltantes: number
  bolsasSobrantes: number
  productos:       { productoId: string; nombre: string; faltan: number }[]
  grave:           boolean
  umbral:          number
}

// ── Envases (réplica de src/utils/envases.ts) ───────────────────────────────

/** 4 puntales y 1 sombrero por pallet de cualquier tipo; el aro es solo de la tarima de madera. */
export const PUNTALES_POR_PALLET = 4
export const AROS_POR_TARIMA_MADERA = 1
export const SOMBREROS_POR_PALLET = 1

const conteoVacio = (): ConteoEnvasesCierre => ({ tarimasMadera: 0, palletsMetal: 0, puntales: 0, aros: 0, sombreros: 0 })

// Los simples (solo la base, 2026-09-21) son parte del total y no suman
// implícitos: réplica de utils/envases.ts (implicitosDe).
const implicitosDe = (tarimasMadera: number, palletsMetal: number, simplesMadera = 0, simplesMetal = 0) => {
  const madera = Math.max(0, tarimasMadera - simplesMadera)
  const metal  = Math.max(0, palletsMetal - simplesMetal)
  return {
    puntales:  (madera + metal) * PUNTALES_POR_PALLET,
    aros:      madera * AROS_POR_TARIMA_MADERA,
    sombreros: (madera + metal) * SOMBREROS_POR_PALLET,
  }
}

/**
 * Lo que salió según el remito. Un remito anterior al 2026-09-07 (sin
 * `envases`) se lee como `palletsCarga` pallets de METAL: ese era el modelo
 * viejo, y así un viaje viejo cuadra sin inventar tarimas que no existieron.
 */
function envasesDeRemito(r: Pick<RemitoParaCierre, 'palletsCarga' | 'envases'>): ConteoEnvasesCierre & { racks: number[] } {
  if (r.envases) {
    return {
      tarimasMadera: n(r.envases.tarimasMadera),
      palletsMetal:  n(r.envases.palletsMetal),
      ...implicitosDe(n(r.envases.tarimasMadera), n(r.envases.palletsMetal), n(r.envases.tarimasMaderaSimples), n(r.envases.palletsMetalSimples)),
      racks: [...(r.envases.racks ?? [])],
    }
  }
  const pallets = n(r.palletsCarga)
  return { tarimasMadera: 0, palletsMetal: pallets, ...implicitosDe(0, pallets), racks: [] }
}

/** Lo que volvió según la descarga; las viejas traían completos/parciales/vacíos. */
function envasesDeDescarga(d: DescargaParaCierre): ConteoEnvasesCierre & { racks: number[] } {
  if (d.envases) {
    // `sombreros` no existía antes del 2026-09-12: una descarga vieja es 0 contados.
    return {
      tarimasMadera: n(d.envases.tarimasMadera), palletsMetal: n(d.envases.palletsMetal),
      puntales: n(d.envases.puntales), aros: n(d.envases.aros), sombreros: n(d.envases.sombreros),
      racks: [...(d.envases.racks ?? [])],
    }
  }
  const pallets = n(d.palletsCompletos) + n(d.palletsParciales) + n(d.palletsVacios)
  return { tarimasMadera: 0, palletsMetal: pallets, ...implicitosDe(0, pallets), racks: [] }
}

const sumarConteos = (a: ConteoEnvasesCierre, b: ConteoEnvasesCierre): ConteoEnvasesCierre => ({
  tarimasMadera: a.tarimasMadera + b.tarimasMadera, palletsMetal: a.palletsMetal + b.palletsMetal,
  puntales: a.puntales + b.puntales, aros: a.aros + b.aros, sombreros: a.sombreros + b.sombreros,
})
const restarConteos = (a: ConteoEnvasesCierre, b: ConteoEnvasesCierre): ConteoEnvasesCierre => ({
  tarimasMadera: a.tarimasMadera - b.tarimasMadera, palletsMetal: a.palletsMetal - b.palletsMetal,
  puntales: a.puntales - b.puntales, aros: a.aros - b.aros, sombreros: a.sombreros - b.sombreros,
})

const ordenados = (racks: Iterable<number>) => [...new Set(racks)].sort((a, b) => a - b)

/** Cuadre por tipo y por número de rack: Σ remitos vs Σ descargas. */
export function cuadrarEnvases(remitos: RemitoParaCierre[], descargas: DescargaParaCierre[]): CuadreEnvases {
  let salieron = conteoVacio(), volvieron = conteoVacio()
  const racksSalieron: number[] = [], racksVolvieron: number[] = []
  for (const r of remitos) { const e = envasesDeRemito(r); salieron = sumarConteos(salieron, e); racksSalieron.push(...e.racks) }
  for (const d of descargas) { const e = envasesDeDescarga(d); volvieron = sumarConteos(volvieron, e); racksVolvieron.push(...e.racks) }
  const s = new Set(racksSalieron), v = new Set(racksVolvieron)
  return {
    salieron:       { ...salieron, racks: ordenados(s) },
    volvieron:      { ...volvieron, racks: ordenados(v) },
    diferencia:     restarConteos(volvieron, salieron),
    racksFaltantes: ordenados([...s].filter((x) => !v.has(x))),
    racksSobrantes: ordenados([...v].filter((x) => !s.has(x))),
  }
}

// ── Mercadería por producto (réplica de mercaderiaDelViaje) ─────────────────

const PREFIJO_CAMBIO = 'cambio_'
/** Los renglones de cambio vienen con el id prefijado: se agrupan en el producto que son. */
const productoDelCambio = (id: string): string => (id.startsWith(PREFIJO_CAMBIO) ? id.slice(PREFIJO_CAMBIO.length) : id)
const nombreDelCambio = (nombre: string): string => (nombre.startsWith('Cambio ') ? nombre.slice('Cambio '.length) : nombre)

export interface MercaderiaCalculada {
  productos: ProductoCierre[]
  envases:   CuadreEnvases
  cambios:   { registrados: number; rotasRecibidas: number }
}

/**
 * Por producto: carga − ventas − cambios = devolución teórica, contra lo que
 * el muelle contó. Ni un gramo de plata: el muelle nunca ve importes.
 */
export function mercaderiaDelViaje(
  remitos:   RemitoParaCierre[],
  ventas:    VentaParaCierre[],
  cambios:   ItemMercaderia[],
  descargas: DescargaParaCierre[],
): MercaderiaCalculada {
  // Una factura anulada con nota de crédito (2026-09-11) no cuenta: la NC ya
  // devolvió el stock, esa mercadería tenía que volver en el camión.
  const ventasVigentes = ventas.filter((v) => v.anulacion?.estado !== 'anulada')
  // Un conteo rectificado no suma dos veces: vale la corrección en lugar del original.
  const vigentes = descargasVigentes(descargas)

  const porProducto = new Map<string, ProductoCierre>()
  const fila = (productoId: string, nombre: string): ProductoCierre => {
    let f = porProducto.get(productoId)
    if (!f) {
      f = { productoId, nombre, carga: 0, ventaContado: 0, ventaPromo: 0, cambios: 0, devolucionTeorica: 0, descarga: 0, diferencia: 0, rotas: 0 }
      porProducto.set(productoId, f)
    }
    return f
  }

  remitos.forEach((r) => (r.items ?? []).forEach((i) => { fila(i.productoId, i.nombre).carga += n(i.cantidad) }))
  ventasVigentes.forEach((v) => (v.items ?? []).forEach((i) => {
    const f = fila(i.productoId, i.nombre)
    if (v.canal === 'contado') f.ventaContado += n(i.cantidad)
    else f.ventaPromo += n(i.cantidad)
  }))
  // Los cambios viajan adentro de la venta (renglones en $0 del mismo papel);
  // `cambiosCamion` es el registro viejo, de cuando el cambio era otra pantalla.
  ventasVigentes.forEach((v) => (v.cambios ?? []).forEach((i) => {
    fila(productoDelCambio(i.productoId), nombreDelCambio(i.nombre)).cambios += n(i.cantidad)
  }))
  cambios.forEach((c) => { fila(productoDelCambio(c.productoId), nombreDelCambio(c.nombre)).cambios += n(c.cantidad) })
  vigentes.forEach((d) => (d.items ?? []).forEach((i) => { fila(i.productoId, i.nombre).descarga += n(i.cantidad) }))
  // Rotas por producto (fase B del stock, 2026-09-17): son la merma real que va
  // camión → 99. El id puede venir con prefijo cambio_ en descargas viejas.
  vigentes.forEach((d) => (d.bolsasRotas ?? []).forEach((i) => {
    fila(productoDelCambio(i.productoId), nombreDelCambio(i.nombre)).rotas += n(i.cantidad)
  }))

  const productos = [...porProducto.values()].map((f) => {
    const devolucionTeorica = f.carga - f.ventaContado - f.ventaPromo - f.cambios
    return { ...f, devolucionTeorica, diferencia: f.descarga - devolucionTeorica }
  }).sort((a, b) => a.nombre.localeCompare(b.nombre))

  const registrados =
    ventasVigentes.reduce((s, v) => s + (v.cambios ?? []).reduce((x, i) => x + n(i.cantidad), 0), 0) +
    cambios.reduce((s, c) => s + n(c.cantidad), 0)
  const rotasRecibidas = vigentes.reduce((s, d) => s + (d.bolsasRotas ?? []).reduce((x, i) => x + n(i.cantidad), 0), 0)

  return { productos, envases: cuadrarEnvases(remitos, vigentes), cambios: { registrados, rotasRecibidas } }
}

/**
 * Un sobrante NO compensa un faltante: si faltan 12 bolsas de 3 kg y sobran 12
 * de escamas no es que "está", son dos desvíos, y taparlos entre sí es la fuga
 * que este control busca. Por eso el umbral se mide contra los faltantes solos.
 */
export function calcularFaltante(productos: ProductoCierre[], umbral: UmbralFaltantes = UMBRAL_FALTANTES_DEFAULT): FaltanteCierre {
  const faltan = productos
    .filter((p) => p.diferencia < 0)
    .map((p) => ({ productoId: p.productoId, nombre: p.nombre, faltan: -p.diferencia }))
    .sort((a, b) => b.faltan - a.faltan || a.nombre.localeCompare(b.nombre))
  const bolsasFaltantes = faltan.reduce((s, p) => s + p.faltan, 0)
  const bolsasSobrantes = productos.reduce((s, p) => s + Math.max(0, p.diferencia), 0)
  return {
    bolsasFaltantes,
    bolsasSobrantes,
    productos: faltan,
    grave: umbral.habilitado && umbral.bolsas > 0 && bolsasFaltantes >= umbral.bolsas,
    umbral: umbral.bolsas,
  }
}

// ── A qué viaje pertenece una venta (réplica de src/utils/viajeDeVenta.ts) ──
//
// Desde el 2026-09-18 la venta lo trae escrito (`VentaCamion.remitoId`). Lo de
// abajo es para las anteriores y para las del acompañante, que sale sin remito
// propio. No se deduce por horarios a propósito: la descarga se cuenta muchas
// veces al día siguiente y el chofer que vuelve en otro camión deja el suyo
// varado días, así que cortar por la hora del conteo metía las ventas de los
// viajes siguientes adentro del viaje viejo.

export interface Ubicable {
  remitoId?: string
  camionId?: string
  choferId?: string
  fecha:     { toDate(): Date }
}

export interface ViajeCandidato {
  id:        string
  camionId?: string
  choferId?: string
  fecha:     { toDate(): Date }
}

/** El día 'yyyy-MM-dd' en hora argentina: en Cloud Functions el reloj local es UTC. */
export const claveDiaAr = (d: Date): string =>
  d.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

export function viajeDeVenta(venta: Ubicable, viajes: ViajeCandidato[]): string | null {
  if (venta.remitoId) return venta.remitoId
  if (!viajes.length) return null

  const cuando = venta.fecha.toDate().getTime()
  const dia = claveDiaAr(venta.fecha.toDate())

  const delDia = viajes.filter((r) => claveDiaAr(r.fecha.toDate()) === dia)
  const mismos = venta.camionId
    ? delDia.filter((r) => r.camionId === venta.camionId)
    : venta.choferId
      ? delDia.filter((r) => r.choferId === venta.choferId)
      : []
  if (!mismos.length) return null

  // El último viaje que ya había salido cuando se hizo la venta. Si la venta es
  // anterior a todos (reloj corrido, venta cargada antes de salir), el primero.
  const anteriores = mismos
    .filter((r) => r.fecha.toDate().getTime() <= cuando)
    .sort((a, b) => b.fecha.toDate().getTime() - a.fecha.toDate().getTime())
  if (anteriores.length) return anteriores[0].id

  return [...mismos].sort((a, b) => a.fecha.toDate().getTime() - b.fecha.toDate().getTime())[0].id
}

/** Las ventas (o cobranzas) de UN viaje. */
export const ventasDelViaje = <T extends Ubicable>(movimientos: T[], viajes: ViajeCandidato[], remitoId: string): T[] =>
  movimientos.filter((m) => viajeDeVenta(m, viajes) === remitoId)

// ── El documento ────────────────────────────────────────────────────────────

/**
 * `cierresMercaderia/{remitoId}`. El timestamp es genérico para no atar este
 * módulo puro al Admin SDK (el trigger le pasa un `Timestamp`, los tests un
 * número).
 */
export interface CierreMercaderiaDoc<TS> {
  id:            string
  remitoId:      string
  remitoCodigo:  string
  plantaId:      string
  choferId:      string
  choferNombre:  string
  depositoTango?:       string | null
  depositoTangoNombre?: string | null
  diaReparto:    string
  productos:     ProductoCierre[]
  envases:       CuadreEnvases
  faltante:      FaltanteCierre
  descargaIds:     string[]
  descargaCodigos: string[]
  contadaPor:    { uid: string; nombre: string }
  contadaEn:     TS
}

export interface ArmarCierreArgs<TS> {
  remito:     RemitoParaCierre
  ventas:     VentaParaCierre[]
  cambios:    ItemMercaderia[]
  /** TODAS las descargas del remito, incluida la que dispara el cierre; acá se descartan las rectificadas. */
  descargas:  DescargaParaCierre[]
  umbral?:    UmbralFaltantes
  diaReparto: string
  contadaPor: { uid: string; nombre: string }
  contadaEn:  TS
}

export function armarCierreMercaderia<TS>(args: ArmarCierreArgs<TS>): CierreMercaderiaDoc<TS> {
  const { remito, ventas, cambios, descargas, diaReparto, contadaPor, contadaEn } = args
  const vigentes = descargasVigentes(descargas)
  const { productos, envases } = mercaderiaDelViaje([remito], ventas, cambios, descargas)
  return {
    id:           remito.id,
    remitoId:     remito.id,
    remitoCodigo: remito.codigo ?? '',
    plantaId:     remito.plantaId ?? '',
    choferId:     remito.choferId ?? '',
    choferNombre: remito.choferNombre ?? '',
    // Admin SDK rechaza `undefined`: sin depósito va null explícito.
    depositoTango:       remito.depositoTango ?? null,
    depositoTangoNombre: remito.depositoTangoNombre ?? null,
    diaReparto,
    productos,
    envases,
    faltante:        calcularFaltante(productos, args.umbral),
    // Solo las vigentes: una rectificada no compone el cierre (la reemplazó otra).
    descargaIds:     vigentes.map((d) => d.id).filter((id): id is string => !!id),
    descargaCodigos: vigentes.map((d) => d.codigo).filter((c): c is string => !!c),
    contadaPor,
    contadaEn,
  }
}
