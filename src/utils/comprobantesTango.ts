import type {
  ComprobanteSaldoTango, EmpresaTango, FacturaTangoDetalle, RemitoTangoDetalle, TangoComprobantesDoc, UserProfile,
} from '@/types'
import type { FacturaPdfData } from './facturaPdf'
import { EMISOR_REDONHIELO as EMISOR_FACTURA } from './facturaPdf'
import type { RemitoData } from './comprobanteInterno'
import { EMISOR_REDONHIELO, EMISOR_ROLITO } from './emisores'
import { empresaDe, type GrupoRecibo, mismoGrupo } from './composicionSaldos'
import { EMPRESAS_TANGO, NOMBRE_EMPRESA_CORTO, tangoIdsDe } from './tangoEmpresas'
import { nombreSucursal } from './sucursalesTango'

// Composición de saldos con historial y remitos (2026-09-09): une los
// comprobantes PENDIENTES (saldosTango, dato en vivo) con el índice de facturas
// y remitos de Tango de los últimos meses (tangoComprobantes, lo publica el
// lector de la VM) para mostrar "todas" las facturas de 12 meses, el remito de
// cada una y los remitos pendientes de facturar; y arma los PDF de una factura
// o un remito de Tango con los renderers de la app. Puro, sin Firebase.

export const MESES_VISIBLES = 12

export const ESTADO_REMITO: Record<string, string> = { P: 'Pendiente de facturar', F: 'Facturado', A: 'Anulado' }

export type EstadoFila = 'pendiente' | 'pagada' | 'anulada'

export interface FilaComposicion {
  clave:             string   // '{empresa}|{codigo}|{tipo}|{numero}'
  empresa:           EmpresaTango
  codigo:            string
  tipo:              string   // 'FAC' | 'NC' | 'ND' | …
  numero:            string
  fecha:             string   // emisión yyyy-MM-dd ('' si no se conoce)
  fechaVencimiento?: string
  importe:           number
  /** Saldo pendiente (solo las pendientes). */
  pendiente:         number | null
  diasAtraso?:       number
  estado:            EstadoFila
  remitos:           string[]
  /** true si la fila viene del dato en vivo (saldosTango); false si solo está en el índice. */
  enVivo:            boolean
}

export interface RemitoSuelto {
  empresa: EmpresaTango
  codigo:  string
  numero:  string
  fecha:   string
  estado:  string
  bultos:  number
}

export interface BloqueComposicion {
  grupo:         GrupoRecibo
  filas:         FilaComposicion[]
  /** Remitos del código que todavía no fueron facturados. */
  remitosSinFacturar: RemitoSuelto[]
  subtotalPendiente: number
}

export const restarMeses = (d: Date, meses: number): Date => new Date(d.getFullYear(), d.getMonth() - meses, d.getDate())
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const tipoCorto = (t: string) => t.replace('/', '').trim().toUpperCase()
const claveIndice = (tipo: string, numero: string) => `${tipoCorto(tipo)}_${numero.trim().toUpperCase()}`
const redondear = (n: number) => Math.round(n * 100) / 100

/**
 * Bloques por empresa y código con las filas de la composición. `modo`
 * 'pendientes' = solo lo adeudado (dato en vivo, con remitos del índice);
 * 'todas' = además las facturas pagadas/anuladas de los últimos 12 meses.
 */
export function armarComposicion(
  pendientes: ComprobanteSaldoTango[],
  indices: TangoComprobantesDoc[],
  modo: 'pendientes' | 'todas',
  hoy: Date = new Date(),
): BloqueComposicion[] {
  const desde = iso(restarMeses(hoy, MESES_VISIBLES))
  const indicePor = new Map(indices.map((i) => [`${i.empresa}|${i.codigo}`, i]))
  const bloques = new Map<string, BloqueComposicion>()
  const bloque = (grupo: GrupoRecibo) => {
    const k = `${grupo.empresa}|${grupo.codigo}`
    if (!bloques.has(k)) bloques.set(k, { grupo, filas: [], remitosSinFacturar: [], subtotalPendiente: 0 })
    return bloques.get(k)!
  }

  const vistas = new Set<string>()
  for (const c of pendientes) {
    const empresa = empresaDe(c)
    const codigo = c.codigoTango ?? ''
    const tipo = tipoCorto(c.tipo)
    const numero = c.numero.trim().toUpperCase()
    const idx = indicePor.get(`${empresa}|${codigo}`)
    const enIndice = idx?.facturas?.[claveIndice(tipo, numero)]
    const b = bloque({ empresa, codigo })
    b.filas.push({
      clave: `${empresa}|${codigo}|${tipo}|${numero}`,
      empresa, codigo, tipo, numero,
      fecha: c.fechaEmision || enIndice?.fecha || '',
      ...(c.fechaVencimiento ? { fechaVencimiento: c.fechaVencimiento } : {}),
      importe: c.importeOriginal,
      pendiente: c.saldoPendiente,
      ...(c.diasAtraso && c.diasAtraso > 0 ? { diasAtraso: c.diasAtraso } : {}),
      estado: 'pendiente',
      remitos: enIndice?.remitos ?? [],
      enVivo: true,
    })
    b.subtotalPendiente = redondear(b.subtotalPendiente + c.saldoPendiente)
    vistas.add(`${empresa}|${codigo}|${claveIndice(tipo, numero)}`)
  }

  for (const idx of indices) {
    const b = bloque({ empresa: idx.empresa, codigo: idx.codigo })
    if (modo === 'todas') {
      for (const [clave, f] of Object.entries(idx.facturas ?? {})) {
        if (vistas.has(`${idx.empresa}|${idx.codigo}|${clave}`)) continue
        if (!f.fecha || f.fecha < desde) continue
        const anulada = f.estado === 'ANU'
        b.filas.push({
          clave: `${idx.empresa}|${idx.codigo}|${f.tipo}|${f.numero}`,
          empresa: idx.empresa, codigo: idx.codigo, tipo: f.tipo, numero: f.numero,
          fecha: f.fecha, importe: f.importe, pendiente: null,
          estado: anulada ? 'anulada' : 'pagada',
          remitos: f.remitos ?? [],
          enVivo: false,
        })
      }
    }
    for (const [numero, r] of Object.entries(idx.remitos ?? {})) {
      if (r.estado !== 'P' || !r.fecha || r.fecha < desde) continue
      b.remitosSinFacturar.push({ empresa: idx.empresa, codigo: idx.codigo, numero, fecha: r.fecha, estado: r.estado, bultos: r.bultos })
    }
  }

  const out = [...bloques.values()].filter((b) => b.filas.length || b.remitosSinFacturar.length)
  for (const b of out) {
    b.filas.sort((a, c) => (c.fecha || '').localeCompare(a.fecha || '') || a.numero.localeCompare(c.numero))
    b.remitosSinFacturar.sort((a, c) => c.fecha.localeCompare(a.fecha))
  }
  const orden = (g: GrupoRecibo) => `${EMPRESAS_TANGO.indexOf(g.empresa)}|${g.codigo}`
  return out.sort((a, c) => orden(a.grupo).localeCompare(orden(c.grupo)))
}

/** Solo el bloque de la sucursal elegida (null = todas). */
export const filtrarPorSucursal = (bloques: BloqueComposicion[], sel: GrupoRecibo | null): BloqueComposicion[] =>
  sel ? bloques.filter((b) => mismoGrupo(b.grupo, sel)) : bloques

export const totalPendiente = (bloques: BloqueComposicion[]): number =>
  redondear(bloques.reduce((s, b) => s + b.subtotalPendiente, 0))

export interface OpcionSucursal { grupo: GrupoRecibo; etiqueta: string }

/**
 * Opciones del selector "Todas / cada sucursal": los códigos del cliente en
 * cada empresa (perfil) más los que aparezcan con deuda o historial. Vacío si
 * el cliente tiene un solo código en total (no hace falta elegir).
 */
export function opcionesSucursal(cliente: UserProfile, bloques: BloqueComposicion[]): OpcionSucursal[] {
  const vistos = new Map<string, GrupoRecibo>()
  const ids = tangoIdsDe(cliente)
  for (const empresa of EMPRESAS_TANGO) for (const x of ids[empresa] ?? []) vistos.set(`${empresa}|${x.codigo}`, { empresa, codigo: x.codigo })
  for (const b of bloques) vistos.set(`${b.grupo.empresa}|${b.grupo.codigo}`, b.grupo)
  if (vistos.size <= 1) return []
  return [...vistos.values()].map((grupo) => {
    const suc = nombreSucursal(cliente, grupo.empresa, grupo.codigo)
    return { grupo, etiqueta: `${NOMBRE_EMPRESA_CORTO[grupo.empresa]} · ${grupo.codigo}${suc ? ` · ${suc}` : ''}` }
  })
}

// ── Remitos ──────────────────────────────────────────────────────────────────

/** 'R0110500000322' → { puntoVenta: 1105, numero: 322 }; null si no tiene ese formato. */
export function parsearRemito(n: string): { puntoVenta: number; numero: number } | null {
  const m = /^R(\d{5})(\d{8})$/.exec(n.trim().toUpperCase())
  return m ? { puntoVenta: Number(m[1]), numero: Number(m[2]) } : null
}

/** 'R0110500000322' → '01105-00000322' (como lo imprime la app). */
export function formatoRemito(n: string): string {
  const p = parsearRemito(n)
  return p ? `${String(p.puntoVenta).padStart(5, '0')}-${String(p.numero).padStart(8, '0')}` : n
}

const fechaDe = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number)
  return y && m && d ? new Date(y, m - 1, d) : new Date(0)
}
const fmtFecha = (s: string) => { const d = fechaDe(s); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` }

const TITULO: Record<string, FacturaPdfData['titulo']> = { FAC: 'FACTURA', NC: 'NOTA DE CREDITO', ND: 'NOTA DE DEBITO' }

/**
 * Factura/NC/ND de Tango → datos del PDF histórico (facturaPdf.ts), el mismo
 * formato con que se reimprimen desde Recupero de facturas. Solo si es
 * electrónica (tiene CAE): sin CAE no se puede regenerar un comprobante válido.
 */
export function armarFacturaTangoPdf(d: FacturaTangoDetalle): { ok: true; datos: FacturaPdfData } | { ok: false; motivo: string } {
  if (!d.cae || !d.caeVto) return { ok: false, motivo: `La ${d.tipo === 'FAC' ? 'factura' : 'nota'} ${d.numero} no tiene CAE en Tango: pedila a administración.` }
  if (d.letra !== 'A' && d.letra !== 'B' && d.letra !== 'C') return { ok: false, motivo: `No se puede imprimir un comprobante letra ${d.letra}.` }
  if (d.empresa !== 'redonhielo') return { ok: false, motivo: 'Las facturas de Rolito se imprimen desde la venta de la app.' }
  const c = d.cliente
  return {
    ok: true,
    datos: {
      letra:        d.letra,
      codigoTipo:   String(d.cbteTipo ?? '').padStart(2, '0'),
      titulo:       TITULO[d.tipo] ?? 'FACTURA',
      puntoVenta:   d.puntoVenta,
      numero:       d.nro,
      fechaEmision: fechaDe(d.fecha),
      fechaVencimiento: null,
      emisor:       EMISOR_FACTURA,
      cliente: {
        razonSocial:    c.razonSocial,
        domicilio:      c.domicilio,
        cp:             c.cp,
        localidad:      c.localidad,
        condicionIva:   c.condicionIva,
        cuit:           c.cuit,
        codigo:         c.codigo || d.codigo,
        vendedor:       c.vendedor,
        condicionVenta: c.condicionVenta,
      },
      ...(d.remitos.length ? { remitosOC: `(${d.remitos.map(formatoRemito).join(') (')})` } : {}),
      renglones: d.renglones.map((r) => ({
        descripcion:    r.descripcion,
        um:             'UNI',
        cantidad:       r.cantidad,
        precioUnitario: r.precioUnitario,
        ...(r.dtoPct ? { descuento: r.dtoPct } : {}),
        importe:        r.importe,
      })),
      totales: {
        netoGravado:      d.totales.gravado,
        exento:           d.totales.exento,
        percIibbCaba:     0,
        percIibbCabaAlic: 0,
        iva:              d.totales.iva,
        ivaAlic:          d.totales.ivaAlic,
        // Percepciones y otros tributos vienen sumados (Tango no los desglosa en la cabecera).
        percIibbBa:       d.totales.otros,
        percIibbBaAlic:   0,
        internos:         d.totales.internos,
        total:            d.totales.total,
      },
      cae:    d.cae,
      caeVto: fechaDe(d.caeVto),
      leyendaCopia: 'DUPLICADO — REIMPRESIÓN',
      descargar: false,
    },
  }
}

/**
 * Remito de Tango (cargado por la oficina) → datos del remito de la app
 * (remitoPdf.ts). Sale como COPIA: con el CAI de su talonario si Tango lo
 * tiene, si no con letra X. Sin firma del cliente (no la tenemos).
 */
export function armarRemitoTangoPdf(d: RemitoTangoDetalle, hoy: Date = new Date()): RemitoData {
  const c = d.cliente
  const numero = formatoRemito(d.numero)
  const cai = d.talonario.cai && d.talonario.vencimiento ? { cai: d.talonario.cai, vencimiento: fechaDe(d.talonario.vencimiento) } : null
  const promo = d.empresa === 'rolito'
  const anulado = d.estado === 'A'
  return {
    empresa:      promo ? 'rolito' : 'redonhielo',
    emisor:       promo ? EMISOR_ROLITO : EMISOR_REDONHIELO,
    letra:        cai ? 'R' : 'X',
    numero,
    fechaEmision: fechaDe(d.fecha),
    cliente: {
      razonSocial:    c.razonSocial,
      cuit:           c.cuit,
      domicilio:      c.domicilio,
      localidadCp:    [c.cp, c.localidad].filter(Boolean).join(', '),
      condicionIva:   c.condicionIva,
      codigoCliente:  c.codigo || d.codigo,
      vendedor:       c.vendedor,
      condicionVenta: c.condicionVenta.toUpperCase(),
    },
    entrega:   { chofer: d.usuario || 'Tango' },
    renglones: d.renglones.map((r) => ({ descripcion: r.descripcion, cantidad: r.cantidad, esCambio: false })),
    bultos:    { entregados: d.bultos, cambios: 0 },
    control:   cai ? { tipo: 'cai', cai: cai.cai, vencimiento: cai.vencimiento } : { tipo: 'interno', codigo: numero },
    leyenda:   `${anulado ? 'REMITO ANULADO — ' : ''}COPIA emitida desde la app el ${fmtFecha(iso(hoy))} del remito cargado en Tango${d.facturas.length ? ` (facturado en ${d.facturas.join(', ')})` : ''}.`,
    archivo:   `remito-${numero}.pdf`,
  }
}

// ── Mail del cliente ─────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** Dominios de login sintéticos: no son mails reales del cliente. */
const DOMINIOS_INTERNOS = ['rolito.app', 'rolito.internal', 'staff.rolito.internal', 'produccion.rolito.internal', 'tecnico.rolito.internal']

/**
 * Mail al que se le mandan los comprobantes (decisión de Ariel 2026-09-10: el
 * de la ficha de Tango). Se busca en los índices del cliente (primero el de la
 * sucursal elegida, después cualquiera) y, si Tango no lo tiene, el de la app
 * siempre que sea un mail real y no el de login.
 */
export function emailDelCliente(cliente: Pick<UserProfile, 'email'> | null | undefined, indices: TangoComprobantesDoc[], grupo?: GrupoRecibo | null): string {
  const valido = (e: string | undefined) => !!e && EMAIL_RE.test(e) && !DOMINIOS_INTERNOS.some((d) => e.toLowerCase().endsWith(`@${d}`))
  const ordenados = grupo ? [...indices].sort((a, b) => (mismoGrupo(a, grupo) ? -1 : 0) - (mismoGrupo(b, grupo) ? -1 : 0)) : indices
  for (const i of ordenados) if (valido(i.email)) return i.email!.trim().toLowerCase()
  return valido(cliente?.email) ? cliente!.email.trim().toLowerCase() : ''
}
