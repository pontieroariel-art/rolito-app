import type { EmpresaTango, TangoComprobantesDoc, UserProfile } from '@/types'
import type { GrupoRecibo } from './composicionSaldos'
import { mismoGrupo } from './composicionSaldos'
import { ESTADO_REMITO, formatoRemito, restarMeses, MESES_VISIBLES, type BloqueComposicion, type EstadoFila } from './comprobantesTango'
import { formatoFactura, parsearClaveTango } from './facturaClave'
import { formatoARS } from './money'
import { NOMBRE_EMPRESA_CORTO } from './tangoEmpresas'

// Comprobantes de un cliente como una lista plana para elegir y mandar en
// bloque (2026-09-10, facturación): las facturas/NC/ND de la composición (12
// meses, pendientes y pagas) y TODOS los remitos del índice de Tango (los que
// absorbió una factura, los pendientes de facturar y los anulados). Cada ítem
// tiene una clave estable para tildarlo y el título con que se nombra en el
// mail. Puro, sin Firebase.

export const TITULO_TIPO: Record<string, string> = { FAC: 'Factura', NC: 'Nota de crédito', ND: 'Nota de débito' }

export interface ItemFactura {
  clase:      'factura'
  clave:      string   // 'F|{empresa}|{codigo}|{tipo}|{numero}'
  empresa:    EmpresaTango
  codigo:     string
  tipo:       string   // 'FAC' | 'NC' | 'ND'
  numero:     string   // 'A0010100282787'
  titulo:     string   // 'Factura A 00101-00282787'
  fecha:      string   // yyyy-MM-dd ('' si no se conoce)
  fechaVencimiento?: string
  importe:    number
  pendiente:  number | null
  estado:     EstadoFila
  diasAtraso?: number
  remitos:    string[]
}

export interface ItemRemito {
  clase:      'remito'
  clave:      string   // 'R|{empresa}|{codigo}|{numero}'
  empresa:    EmpresaTango
  codigo:     string
  numero:     string   // 'R0110500000322'
  titulo:     string   // 'Remito 01105-00000322'
  fecha:      string
  estado:     string   // 'P' | 'F' | 'A'
  bultos:     number
  /** Facturas que lo absorbieron (números de Tango). */
  facturas:   string[]
}

export type ItemLote = ItemFactura | ItemRemito

export const esFactura = (i: ItemLote): i is ItemFactura => i.clase === 'factura'
export const esRemito = (i: ItemLote): i is ItemRemito => i.clase === 'remito'

export const tituloFactura = (tipo: string, numero: string): string => {
  const clave = parsearClaveTango(numero)
  return `${TITULO_TIPO[tipo] ?? tipo} ${clave ? formatoFactura(clave) : numero}`
}
export const tituloRemito = (numero: string): string => `Remito ${formatoRemito(numero)}`

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** yyyy-MM-dd → dd/mm/yyyy ('' si no hay fecha). */
export const fechaLarga = (s: string | undefined): string => {
  if (!s) return ''
  const [y, m, d] = s.split('-')
  return y && m && d ? `${d}/${m}/${y}` : s
}
/** yyyy-MM-dd → dd/mm/yy. */
export const fechaCorta = (s: string | undefined): string => {
  if (!s) return ''
  const [y, m, d] = s.split('-')
  return y && m && d ? `${d}/${m}/${y.slice(2)}` : s
}

/**
 * Lista plana con las facturas de los bloques (armarComposicion en modo 'todas')
 * y los remitos de los últimos 12 meses de cada índice, ordenada por fecha
 * descendente (a igual fecha, facturas antes que remitos, después por número).
 */
export function armarItemsLote(bloques: BloqueComposicion[], indices: TangoComprobantesDoc[], hoy: Date = new Date()): ItemLote[] {
  const desde = iso(restarMeses(hoy, MESES_VISIBLES))
  const items: ItemLote[] = []
  for (const b of bloques) {
    for (const f of b.filas) {
      items.push({
        clase: 'factura',
        clave: `F|${f.empresa}|${f.codigo}|${f.tipo}|${f.numero}`,
        empresa: f.empresa, codigo: f.codigo, tipo: f.tipo, numero: f.numero,
        titulo: tituloFactura(f.tipo, f.numero),
        fecha: f.fecha,
        ...(f.fechaVencimiento ? { fechaVencimiento: f.fechaVencimiento } : {}),
        importe: f.importe, pendiente: f.pendiente, estado: f.estado,
        ...(f.diasAtraso ? { diasAtraso: f.diasAtraso } : {}),
        remitos: f.remitos,
      })
    }
  }
  const vistos = new Set<string>()
  for (const idx of indices) {
    for (const [numero, r] of Object.entries(idx.remitos ?? {})) {
      const clave = `R|${idx.empresa}|${idx.codigo}|${numero}`
      if (vistos.has(clave) || !r.fecha || r.fecha < desde) continue
      vistos.add(clave)
      items.push({
        clase: 'remito', clave,
        empresa: idx.empresa, codigo: idx.codigo, numero,
        titulo: tituloRemito(numero),
        fecha: r.fecha, estado: r.estado, bultos: r.bultos ?? 0,
        facturas: r.facturas ?? [],
      })
    }
  }
  return items.sort((a, b) =>
    (b.fecha || '').localeCompare(a.fecha || '')
    || (a.clase === b.clase ? 0 : a.clase === 'factura' ? -1 : 1)
    || a.numero.localeCompare(b.numero))
}

export interface FiltroLote {
  clase?:     'todos' | 'facturas' | 'remitos'
  /** Solo facturas con saldo y remitos pendientes de facturar. */
  pendientes?: boolean
  sucursal?:  GrupoRecibo | null
  desde?:     string   // yyyy-MM-dd
  hasta?:     string
  /** Texto: número (con o sin guiones/letra), tipo o título. */
  texto?:     string
}

const soloDigitos = (s: string) => s.replace(/\D+/g, '')

export function filtrarItems(items: ItemLote[], f: FiltroLote): ItemLote[] {
  const clase = f.clase ?? 'todos'
  const q = (f.texto ?? '').trim().toLowerCase()
  const qDigitos = soloDigitos(q)
  return items.filter((i) => {
    if (clase === 'facturas' && i.clase !== 'factura') return false
    if (clase === 'remitos' && i.clase !== 'remito') return false
    if (f.pendientes && (i.clase === 'factura' ? i.estado !== 'pendiente' : i.estado !== 'P')) return false
    if (f.sucursal && !mismoGrupo(i, f.sucursal)) return false
    if (f.desde && i.fecha && i.fecha < f.desde) return false
    if (f.hasta && i.fecha && i.fecha > f.hasta) return false
    if (q) {
      const enTitulo = i.titulo.toLowerCase().includes(q) || i.numero.toLowerCase().includes(q)
      const enNumero = qDigitos.length >= 3 && soloDigitos(i.numero).includes(qDigitos)
      if (!enTitulo && !enNumero) return false
    }
    return true
  })
}

export interface ResumenLote {
  facturas: number
  remitos:  number
  total:    number
  /** Suma de importes de las facturas (NC restan). */
  importeFacturas: number
  desde:    string
  hasta:    string
}

export function resumenLote(items: ItemLote[]): ResumenLote {
  const facturas = items.filter(esFactura)
  const remitos = items.filter(esRemito)
  const fechas = items.map((i) => i.fecha).filter(Boolean).sort()
  const importe = facturas.reduce((s, f) => s + (f.tipo === 'NC' ? -f.importe : f.importe), 0)
  return {
    facturas: facturas.length, remitos: remitos.length, total: items.length,
    importeFacturas: Math.round(importe * 100) / 100,
    desde: fechas[0] ?? '', hasta: fechas[fechas.length - 1] ?? '',
  }
}

/** "3 facturas y 2 remitos" / "1 factura" / "4 remitos". */
export function describirLote(r: Pick<ResumenLote, 'facturas' | 'remitos'>): string {
  const partes: string[] = []
  if (r.facturas) partes.push(`${r.facturas} ${r.facturas === 1 ? 'factura' : 'facturas'}`)
  if (r.remitos) partes.push(`${r.remitos} ${r.remitos === 1 ? 'remito' : 'remitos'}`)
  return partes.join(' y ') || 'ningún comprobante'
}

export interface MailLote {
  asunto:        string
  mensaje:       string
  comprobante:   { tipo: string; numero: string; empresa?: EmpresaTango }
  comprobantes:  { tipo: string; numero: string; empresa: EmpresaTango }[]
  clienteUid:    string
  clienteNombre: string
  presentacion:  { titulo: string; emoji: string; filas: { label: string; value: string }[] }
}

/**
 * Asunto, mensaje y tarjeta del mail con varios comprobantes. El server
 * agrega la lista de adjuntos con los nombres de los PDF.
 */
export function armarMailLote(items: ItemLote[], cliente: Pick<UserProfile, 'uid' | 'razonSocial'>, hoy: Date = new Date()): MailLote {
  const r = resumenLote(items)
  const que = r.facturas && r.remitos ? 'Comprobantes' : r.facturas ? (r.facturas === 1 ? 'Factura' : 'Facturas') : (r.remitos === 1 ? 'Remito' : 'Remitos')
  const descripcion = describirLote(r)
  const facturas = items.filter(esFactura)
  const remitos = items.filter(esRemito)
  const listaFacturas = facturas.map((f) => `${f.tipo === 'FAC' ? '' : `${f.tipo} `}${f.numero.replace(/^([A-Z])(\d{5})(\d{8})$/, '$1 $2-$3')}`).join(', ')
  const listaRemitos = remitos.map((x) => formatoRemito(x.numero)).join(', ')
  const empresas = [...new Set(items.map((i) => i.empresa))]
  return {
    asunto: `${que} — ${cliente.razonSocial}`,
    mensaje: items.length === 1
      ? `Te enviamos adjunto ${items[0].clase === 'factura' ? 'la' : 'el'} ${items[0].titulo.toLowerCase()}.`
      : `Te enviamos adjuntos ${descripcion}${r.desde ? ` (${fechaLarga(r.desde)}${r.hasta !== r.desde ? ` al ${fechaLarga(r.hasta)}` : ''})` : ''}.`,
    comprobante: items.length === 1
      ? { tipo: items[0].clase === 'factura' ? items[0].tipo : 'REM', numero: items[0].numero, empresa: items[0].empresa }
      : { tipo: 'LOTE', numero: `${items.length} comprobantes ${iso(hoy)}`, ...(empresas.length === 1 ? { empresa: empresas[0] } : {}) },
    comprobantes: items.map((i) => ({ tipo: i.clase === 'factura' ? i.tipo : 'REM', numero: i.numero, empresa: i.empresa })),
    clienteUid: cliente.uid,
    clienteNombre: cliente.razonSocial,
    presentacion: {
      titulo: items.length === 1 ? items[0].titulo : `${items.length} comprobantes`,
      emoji: r.facturas && !r.remitos ? '🧾' : r.remitos && !r.facturas ? '🚚' : '📎',
      filas: [
        ...(r.facturas ? [{ label: r.facturas === 1 ? 'Factura' : 'Facturas', value: listaFacturas }] : []),
        ...(r.remitos ? [{ label: r.remitos === 1 ? 'Remito' : 'Remitos', value: listaRemitos }] : []),
        ...(r.desde ? [{ label: 'Período', value: r.hasta !== r.desde ? `${fechaLarga(r.desde)} al ${fechaLarga(r.hasta)}` : fechaLarga(r.desde) }] : []),
        ...(r.facturas > 1 ? [{ label: 'Total facturado', value: formatoARS(r.importeFacturas) }] : []),
        ...(empresas.length === 1 ? [{ label: 'Empresa', value: NOMBRE_EMPRESA_CORTO[empresas[0]] }] : []),
      ],
    },
  }
}

/** Etiqueta del estado para la tabla. */
export function etiquetaEstado(i: ItemLote): { texto: string; tono: 'ok' | 'pendiente' | 'neutro' | 'anulado' } {
  if (i.clase === 'factura') {
    if (i.estado === 'pendiente') return { texto: i.diasAtraso && i.diasAtraso > 0 ? `Debe · ${i.diasAtraso} d de atraso` : 'Debe', tono: 'pendiente' }
    if (i.estado === 'pagada') return { texto: 'Pagada', tono: 'ok' }
    return { texto: 'Anulada', tono: 'anulado' }
  }
  if (i.estado === 'P') return { texto: ESTADO_REMITO.P, tono: 'pendiente' }
  if (i.estado === 'A') return { texto: ESTADO_REMITO.A, tono: 'anulado' }
  return { texto: i.facturas.length ? `Facturado en ${i.facturas.map((n) => n.replace(/^([A-Z])(\d{5})(\d{8})$/, '$1 $2-$3')).join(', ')}` : ESTADO_REMITO.F, tono: 'neutro' }
}
