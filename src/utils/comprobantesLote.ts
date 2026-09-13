import type { EmpresaTango, FamiliaComprobante, TangoComprobantesDoc, UserProfile } from '@/types'
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

/**
 * Cómo se llama cada familia en pantalla. La familia la decide TANGO (GVA12.TCOMP_IN_V) y la
 * publica el lector: no hay lista de códigos que mantener acá, porque cada empresa inventa
 * los suyos (Redonhielo usa 16). 'otro' es el comprobante que el lector no pudo clasificar:
 * se muestra con su código de Tango antes que arriesgar un nombre equivocado.
 */
export const NOMBRE_FAMILIA: Record<FamiliaComprobante, string> = {
  factura: 'Factura', credito: 'Nota de crédito', debito: 'Nota de débito', recibo: 'Recibo', otro: 'Comprobante',
}

/** Nombre del comprobante: el de su familia, más el código de Tango cuando no es el clásico. */
export const tituloTipo = (tipo: string, familia: FamiliaComprobante = 'otro'): string => {
  const nombre = NOMBRE_FAMILIA[familia] ?? 'Comprobante'
  const clasico = { factura: 'FAC', credito: 'NC', debito: 'ND', recibo: 'REC', otro: '' }[familia]
  return tipo && tipo !== clasico ? `${nombre} ${tipo}` : nombre
}

/** Resta en la cuenta del cliente (crédito a su favor). */
export const esCredito = (familia: FamiliaComprobante): boolean => familia === 'credito'

/** Le BAJA la deuda al cliente: una nota de crédito o un recibo. Se muestra en negativo. */
export const restaEnCuenta = (i: ItemLote): boolean =>
  i.clase === 'factura' && (i.familia === 'credito' || i.familia === 'recibo')

/** Todo lo que no es factura ni recibo: notas de crédito, de débito y ajustes. */
export const esNota = (i: ItemLote): i is ItemFactura =>
  i.clase === 'factura' && i.familia !== 'factura' && i.familia !== 'recibo'

export const esRecibo = (i: ItemLote): i is ItemFactura => i.clase === 'factura' && i.familia === 'recibo'

export interface ItemFactura {
  clase:      'factura'
  clave:      string   // 'F|{empresa}|{codigo}|{tipo}|{numero}'
  empresa:    EmpresaTango
  codigo:     string
  tipo:       string   // código de Tango: 'FAC' | 'NCB' | 'C/E' | 'REC' | el que use la empresa
  /** Qué es: lo dice Tango, no el código. */
  familia:    FamiliaComprobante
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

export const tituloFactura = (tipo: string, numero: string, familia: FamiliaComprobante = 'otro'): string => {
  const clave = parsearClaveTango(numero)
  return `${tituloTipo(tipo, familia)} ${clave ? formatoFactura(clave) : numero}`
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
        empresa: f.empresa, codigo: f.codigo, tipo: f.tipo, familia: f.familia, numero: f.numero,
        titulo: tituloFactura(f.tipo, f.numero, f.familia),
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
  /** 'notas' = crédito, débito y ajustes; 'recibos' = la cobranza (REC). */
  clase?:     'todos' | 'facturas' | 'notas' | 'recibos' | 'remitos'
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
    if (clase === 'facturas' && !(i.clase === 'factura' && i.familia === 'factura')) return false
    if (clase === 'notas' && !esNota(i)) return false
    if (clase === 'recibos' && !esRecibo(i)) return false
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
  /** Notas de crédito, de débito y ajustes. */
  notas:    number
  recibos:  number
  /** Cuántos hay de cada cosa que no sea factura ni remito, para nombrarlas en el mail. */
  notasPorTipo: { tipo: string; familia: FamiliaComprobante; cantidad: number }[]
  remitos:  number
  total:    number
  /** Facturas, notas y recibos: los créditos y los recibos restan (le bajan la deuda). */
  importeFacturas: number
  desde:    string
  hasta:    string
}

const ORDEN_FAMILIA: FamiliaComprobante[] = ['factura', 'credito', 'debito', 'otro', 'recibo']

export function resumenLote(items: ItemLote[]): ResumenLote {
  const deTango = items.filter(esFactura)
  const facturas = deTango.filter((f) => f.familia === 'factura')
  const recibos = deTango.filter((f) => f.familia === 'recibo')
  const notas = deTango.filter(esNota)
  const remitos = items.filter(esRemito)
  const fechas = items.map((i) => i.fecha).filter(Boolean).sort()
  const importe = deTango.reduce((s, f) => s + (esCredito(f.familia) || f.familia === 'recibo' ? -f.importe : f.importe), 0)
  const porTipo = new Map<string, { familia: FamiliaComprobante; cantidad: number }>()
  for (const n of [...notas, ...recibos]) {
    const prev = porTipo.get(n.tipo)
    porTipo.set(n.tipo, { familia: n.familia, cantidad: (prev?.cantidad ?? 0) + 1 })
  }
  return {
    facturas: facturas.length,
    notas: notas.length,
    recibos: recibos.length,
    // Orden fijo (crédito, débito, sin clasificar, recibo) para que la frase del mail no
    // dependa de en qué orden vinieron los comprobantes.
    notasPorTipo: [...porTipo]
      .map(([tipo, x]) => ({ tipo, familia: x.familia, cantidad: x.cantidad }))
      .sort((a, b) => ORDEN_FAMILIA.indexOf(a.familia) - ORDEN_FAMILIA.indexOf(b.familia) || a.tipo.localeCompare(b.tipo)),
    remitos: remitos.length,
    total: items.length,
    importeFacturas: Math.round(importe * 100) / 100,
    desde: fechas[0] ?? '', hasta: fechas[fechas.length - 1] ?? '',
  }
}

/** "1 nota de crédito" / "2 notas de crédito": pluraliza el sustantivo, no la última palabra. */
const plural = (n: number, nombre: string): string => {
  if (n === 1) return `1 ${nombre}`
  const [sustantivo, ...resto] = nombre.split(' ')
  return `${n} ${sustantivo}s${resto.length ? ` ${resto.join(' ')}` : ''}`
}

/** "3 facturas, 1 nota de crédito y 2 remitos" / "1 factura" / "4 remitos". */
export function describirLote(r: Pick<ResumenLote, 'facturas' | 'remitos' | 'notasPorTipo'>): string {
  const partes: string[] = []
  if (r.facturas) partes.push(plural(r.facturas, 'factura'))
  // Se agrupa por FAMILIA, no por código: NC y NCB son las dos notas de crédito y al cliente
  // le decimos "3 notas de crédito", no "1 nota de crédito y 2 notas de crédito". Los que no
  // se pudieron clasificar van por su código de Tango ("2 comprobantes CDE").
  const porFamilia = new Map<string, { familia: FamiliaComprobante; tipo: string; cantidad: number }>()
  for (const { tipo, familia, cantidad } of r.notasPorTipo ?? []) {
    const k = familia === 'otro' ? `otro|${tipo}` : familia
    const prev = porFamilia.get(k)
    porFamilia.set(k, { familia, tipo, cantidad: (prev?.cantidad ?? 0) + cantidad })
  }
  for (const { tipo, familia, cantidad } of porFamilia.values()) {
    partes.push(plural(cantidad, familia === 'otro' ? `comprobante ${tipo}` : NOMBRE_FAMILIA[familia].toLowerCase()))
  }
  if (r.remitos) partes.push(plural(r.remitos, 'remito'))
  if (!partes.length) return 'ningún comprobante'
  if (partes.length === 1) return partes[0]
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
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
  // Asunto: solo se especializa cuando el lote es de una sola cosa; si mezcla facturas,
  // notas y remitos, "Comprobantes".
  const clases = [r.facturas > 0, r.notas > 0, r.remitos > 0].filter(Boolean).length
  const que = clases > 1 ? 'Comprobantes'
    : r.facturas ? (r.facturas === 1 ? 'Factura' : 'Facturas')
      : r.notas ? (r.notas === 1 ? tituloTipo(r.notasPorTipo[0].tipo) : 'Comprobantes')
        : (r.remitos === 1 ? 'Remito' : 'Remitos')
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
      emoji: facturas.length && !r.remitos ? '🧾' : r.remitos && !facturas.length ? '🚚' : '📎',
      filas: [
        ...(facturas.length ? [{ label: r.notas ? 'Comprobantes' : r.facturas === 1 ? 'Factura' : 'Facturas', value: listaFacturas }] : []),
        ...(r.remitos ? [{ label: r.remitos === 1 ? 'Remito' : 'Remitos', value: listaRemitos }] : []),
        ...(r.desde ? [{ label: 'Período', value: r.hasta !== r.desde ? `${fechaLarga(r.desde)} al ${fechaLarga(r.hasta)}` : fechaLarga(r.desde) }] : []),
        ...(facturas.length > 1 ? [{ label: r.notas ? 'Total' : 'Total facturado', value: formatoARS(r.importeFacturas) }] : []),
        ...(empresas.length === 1 ? [{ label: 'Empresa', value: NOMBRE_EMPRESA_CORTO[empresas[0]] }] : []),
      ],
    },
  }
}

/** Etiqueta del estado para la tabla. */
export function etiquetaEstado(i: ItemLote): { texto: string; tono: 'ok' | 'pendiente' | 'neutro' | 'anulado' } {
  if (i.clase === 'factura') {
    if (i.estado === 'pendiente') return { texto: i.diasAtraso && i.diasAtraso > 0 ? `Debe · ${i.diasAtraso} d de atraso` : 'Debe', tono: 'pendiente' }
    // Una nota de crédito no se "paga": se aplica contra la cuenta del cliente; un recibo ES el pago.
    if (i.estado === 'pagada') return { texto: esCredito(i.familia) ? 'Aplicada' : i.familia === 'recibo' ? 'Cobrado' : 'Pagada', tono: 'ok' }
    return { texto: 'Anulada', tono: 'anulado' }
  }
  if (i.estado === 'P') return { texto: ESTADO_REMITO.P, tono: 'pendiente' }
  if (i.estado === 'A') return { texto: ESTADO_REMITO.A, tono: 'anulado' }
  return { texto: i.facturas.length ? `Facturado en ${i.facturas.map((n) => n.replace(/^([A-Z])(\d{5})(\d{8})$/, '$1 $2-$3')).join(', ')}` : ESTADO_REMITO.F, tono: 'neutro' }
}
