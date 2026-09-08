// Cache de composición de saldos por cliente, con las DOS empresas de Tango en
// el mismo doc (saldosTango/{uid}, uid del cliente). Lógica pura, sin Firestore,
// para poder testearla: la escritura la hacen tangoSaldos.ts (sync completa),
// tangoConsultas.ts (refresh on-demand de UNA empresa) y tangoOutbox.ts
// (descuento optimista al registrar una cobranza).
//
// Forma del doc (2026-09-06, decisión de Ariel: "dos bloques separados, cada
// cobranza impacta en la empresa a la que pertenece"):
//
//   { idGva14, codigoTango, razonSocial,           // legacy: principal de Redonhielo
//     comprobantes: [ {…, empresa, codigoTango} ], // UNIÓN de las dos empresas
//     saldoTotal,                                  // Σ de las dos (la lista de deudores ordena por esto)
//     porEmpresa: { redonhielo: { saldoTotal, runId, origen, actualizadoEn }, rolito: {…} },
//     cobranzasAplicadas: [ids], actualizadoEn, origen, runId }
//
// Cada empresa se reemplaza por separado: la corrida de Rolito no pisa lo de
// Redonhielo y viceversa. `runId` es por empresa: al terminar la corrida
// completa de una empresa, los docs cuya rama no fue tocada se vacían solo en
// esa rama (el cliente dejó de deber ahí).

import { EMPRESAS, esEmpresa, type Empresa } from './empresas'

export interface ComprobanteSaldo {
  tipo:               string
  numero:             string
  fechaEmision:       string
  fechaVencimiento?:  string
  importeOriginal:    number
  saldoPendiente:     number
  idComprobanteTango?: number
  diasAtraso?:        number
  empresa:            Empresa
  codigoTango:        string
}

export interface ComprobanteCrudo {
  tipo?:               unknown
  numero?:             unknown
  fechaEmision?:       unknown
  fechaVencimiento?:   unknown
  importeOriginal?:    unknown
  saldoPendiente?:     unknown
  idComprobanteTango?: unknown
  diasAtraso?:         unknown
  empresa?:            unknown
  codigoTango?:        unknown
}

export interface RamaEmpresa {
  saldoTotal:     number
  comprobantes:   number
  runId:          string | null
  origen:         'sync' | 'consulta'
  actualizadoEn?: unknown
}

export interface SaldoDoc {
  idGva14:             number
  codigoTango:         string
  razonSocial:         string
  comprobantes:        ComprobanteSaldo[]
  saldoTotal:          number
  porEmpresa:          Partial<Record<Empresa, RamaEmpresa>>
  cobranzasAplicadas:  string[]
  origen:              'sync' | 'consulta'
  runId?:              string
  // Legacy: la empresa "principal" del doc; hoy siempre redonhielo. Se conserva
  // para que la app vieja (hasta el deploy del hosting) siga leyendo el doc.
  empresa:             Empresa
}

export const redondear2 = (n: number): number => Math.round(n * 100) / 100

export const claveComprobante = (empresa: string, tipo: string, numero: string) => `${empresa}|${tipo}|${numero}`

export function normalizarComprobante(c: ComprobanteCrudo, empresa: Empresa, codigoTango: string): ComprobanteSaldo {
  const venc = c.fechaVencimiento
  const idc = c.idComprobanteTango
  const dias = c.diasAtraso
  return {
    tipo:            String(c.tipo ?? ''),
    numero:          String(c.numero ?? ''),
    fechaEmision:    String(c.fechaEmision ?? ''),
    ...(venc ? { fechaVencimiento: String(venc) } : {}),
    importeOriginal: redondear2(Number(c.importeOriginal ?? c.saldoPendiente ?? 0)),
    saldoPendiente:  redondear2(Number(c.saldoPendiente ?? 0)),
    ...(typeof idc === 'number' ? { idComprobanteTango: idc } : {}),
    ...(typeof dias === 'number' && dias > 0 ? { diasAtraso: dias } : {}),
    empresa,
    codigoTango: String(c.codigoTango ?? codigoTango ?? ''),
  }
}

/** Comprobantes de un doc existente (tolera docs viejos sin `empresa` en cada fila: eran de Redonhielo). */
export function comprobantesDe(doc: Partial<SaldoDoc> | undefined | null): ComprobanteSaldo[] {
  const lista = Array.isArray(doc?.comprobantes) ? doc!.comprobantes : []
  return lista.map((c) => normalizarComprobante(c as ComprobanteCrudo, esEmpresa((c as ComprobanteCrudo).empresa) ? (c as ComprobanteCrudo).empresa as Empresa : 'redonhielo', String((c as ComprobanteCrudo).codigoTango ?? doc?.codigoTango ?? '')))
}

export const sumaSaldo = (comprobantes: ComprobanteSaldo[]): number => redondear2(comprobantes.reduce((s, c) => s + c.saldoPendiente, 0))

// ── Descuento optimista de cobranzas que Tango todavía no vio ────────────────
// Cobranzas completas (con imputaciones) cuyo recibo aún no está confirmado en
// Tango (tango.estado != 'confirmado'): sus imputaciones se restan del
// snapshot — si no, cada sync "resucitaría" deuda que ya se cobró en la calle.
// Acotado a 90 días por quien las lee (tangoSaldos.ts). La clave lleva la
// EMPRESA: una factura de Rolito y otra de Redonhielo pueden compartir tipo y
// número.

export interface CobranzaParaDescuento {
  id:            string
  clienteId:     string
  empresa?:      unknown
  imputaciones?: unknown
  tango?:        { estado?: unknown } | null
  /** Pago a cuenta (2026-09-08): parte de los valores sin factura. Mientras Tango no lo
   *  confirme, aparece en la composición como un recibo con saldo NEGATIVO (a favor). */
  aCuenta?:      unknown
  numeroRecibo?: unknown
  codigoTango?:  unknown
  fecha?:        unknown
}

export interface DescuentoCliente {
  porComprobante: Map<string, number>   // claveComprobante → Σ importeImputado (centavos)
  cobranzaIds:    string[]
  /** Recibos a cuenta todavía no confirmados por Tango, como comprobantes con saldo negativo. */
  aCuenta:        ComprobanteSaldo[]
}

/** Timestamp de Firestore / Date / string → 'yyyy-MM-dd' (vacío si no se puede). */
function fechaIso(f: unknown): string {
  let d: Date | null = null
  if (f instanceof Date) d = f
  else if (f && typeof f === 'object') {
    const o = f as { toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof o.toDate === 'function') d = o.toDate()
    else if (typeof (o.seconds ?? o._seconds) === 'number') d = new Date(Number(o.seconds ?? o._seconds) * 1000)
  } else if (typeof f === 'string' && /^\d{4}-\d{2}-\d{2}/.test(f)) return f.slice(0, 10)
  if (!d || isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** El recibo a cuenta de una cobranza, como comprobante de saldo negativo (tipo 'REC', nº interno de la app). */
export function comprobanteACuenta(c: CobranzaParaDescuento, empresa: Empresa): ComprobanteSaldo | null {
  const aCuenta = redondear2(Number(c.aCuenta ?? 0))
  if (!(aCuenta > 0)) return null
  return {
    tipo: 'REC', numero: typeof c.numeroRecibo === 'string' && c.numeroRecibo ? c.numeroRecibo : c.id,
    fechaEmision: fechaIso(c.fecha), importeOriginal: -aCuenta, saldoPendiente: -aCuenta,
    empresa, codigoTango: typeof c.codigoTango === 'string' ? c.codigoTango : '',
  }
}

export function descuentosDeCobranzas(cobranzas: CobranzaParaDescuento[]): Map<string, DescuentoCliente> {
  const porCliente = new Map<string, DescuentoCliente>()
  for (const c of cobranzas) {
    if (c.tango?.estado === 'confirmado') continue
    const imputaciones = Array.isArray(c.imputaciones) ? c.imputaciones : []
    const empresa: Empresa = esEmpresa(c.empresa) ? c.empresa : 'redonhielo'
    const aCuenta = comprobanteACuenta(c, empresa)
    if (imputaciones.length === 0 && !aCuenta) continue
    if (!porCliente.has(c.clienteId)) porCliente.set(c.clienteId, { porComprobante: new Map(), cobranzaIds: [], aCuenta: [] })
    const d = porCliente.get(c.clienteId)!
    d.cobranzaIds.push(c.id)
    for (const imp of imputaciones as Array<{ comprobanteTipo?: unknown; comprobanteNumero?: unknown; importeImputado?: unknown }>) {
      const clave = claveComprobante(empresa, String(imp.comprobanteTipo ?? ''), String(imp.comprobanteNumero ?? ''))
      const cent = Math.round(Number(imp.importeImputado ?? 0) * 100)
      d.porComprobante.set(clave, (d.porComprobante.get(clave) ?? 0) + cent)
    }
    if (aCuenta) d.aCuenta.push(aCuenta)
  }
  return porCliente
}

/** Resta los descuentos a los comprobantes (por empresa+tipo+número), descarta los que quedan en 0
 *  y agrega los recibos a cuenta pendientes (saldo negativo). Los comprobantes que ya vienen de
 *  Tango con saldo negativo (recibos a cuenta confirmados) se conservan tal cual. */
export function aplicarDescuentos(comprobantes: ComprobanteSaldo[], descuento: DescuentoCliente | undefined): ComprobanteSaldo[] {
  if (!descuento || (descuento.porComprobante.size === 0 && descuento.aCuenta.length === 0)) return comprobantes
  const restados = comprobantes
    .map((c) => {
      const cent = descuento.porComprobante.get(claveComprobante(c.empresa, c.tipo, c.numero))
      if (!cent) return c
      return { ...c, saldoPendiente: Math.max(0, Math.round(c.saldoPendiente * 100) - cent) / 100 }
    })
    .filter((c) => c.saldoPendiente !== 0)
  const yaEstan = new Set(restados.map((c) => claveComprobante(c.empresa, c.tipo, c.numero)))
  return [...restados, ...descuento.aCuenta.filter((a) => !yaEstan.has(claveComprobante(a.empresa, a.tipo, a.numero)))]
}

// ── Armado del doc: reemplazar la rama de UNA empresa ────────────────────────

export interface MetaRama {
  runId:   string | null
  origen:  'sync' | 'consulta'
  /** Marca de tiempo a guardar en la rama (FieldValue.serverTimestamp() desde los triggers). */
  ahora?:  unknown
}

export interface IdentidadDoc {
  idGva14:     number
  codigoTango: string
  razonSocial: string
}

/**
 * Doc nuevo con los comprobantes de `empresa` reemplazados por `nuevos` y las
 * otras empresas intactas. `cobranzasAplicadas` se reemplaza por lo que se
 * descontó en esta pasada más lo que ya estaba aplicado de OTRAS empresas.
 */
export function fusionarRamaEmpresa(
  actual: Partial<SaldoDoc> | undefined | null,
  empresa: Empresa,
  nuevos: ComprobanteSaldo[],
  meta: MetaRama,
  identidad: Partial<IdentidadDoc> = {},
  cobranzasAplicadasEmpresa: string[] = [],
): SaldoDoc {
  const otras = comprobantesDe(actual).filter((c) => c.empresa !== empresa)
  const propios = nuevos.map((c) => ({ ...c, empresa }))
  const comprobantes = [...otras, ...propios]
  const porEmpresa: Partial<Record<Empresa, RamaEmpresa>> = { ...(actual?.porEmpresa ?? {}) }
  porEmpresa[empresa] = {
    saldoTotal:   sumaSaldo(propios),
    comprobantes: propios.length,
    runId:        meta.runId,
    origen:       meta.origen,
    ...(meta.ahora !== undefined ? { actualizadoEn: meta.ahora } : {}),
  }
  // Las cobranzas aplicadas de otras empresas se conservan: no se sabe cuáles
  // eran de cuál, así que se conservan todas las que no vinieron en esta pasada
  // (la lista solo sirve para no descontar dos veces la misma cobranza).
  const previas = Array.isArray(actual?.cobranzasAplicadas) ? actual!.cobranzasAplicadas : []
  const cobranzasAplicadas = [...new Set([...previas, ...cobranzasAplicadasEmpresa])]
  return {
    idGva14:     identidad.idGva14 ?? actual?.idGva14 ?? 0,
    codigoTango: identidad.codigoTango ?? actual?.codigoTango ?? '',
    razonSocial: identidad.razonSocial ?? actual?.razonSocial ?? '',
    empresa:     'redonhielo',
    comprobantes,
    saldoTotal:  sumaSaldo(comprobantes),
    porEmpresa,
    cobranzasAplicadas,
    origen:      meta.origen,
    ...(meta.runId ? { runId: meta.runId } : {}),
  }
}

/** Vacía la rama de una empresa (el cliente ya no debe nada ahí) conservando las otras. */
export function vaciarRamaEmpresa(actual: Partial<SaldoDoc>, empresa: Empresa, runId: string, ahora?: unknown): SaldoDoc {
  return fusionarRamaEmpresa(actual, empresa, [], { runId, origen: 'sync', ahora })
}

/** Descuento optimista de UNA cobranza sobre el doc (misma empresa y tipo|número). */
export function descontarCobranza(
  actual: Partial<SaldoDoc>,
  cobranza: {
    id: string; empresa: Empresa
    imputaciones: Array<{ comprobanteTipo: string; comprobanteNumero: string; importeImputado: number }>
    aCuenta?: number; numeroRecibo?: string; codigoTango?: string; fecha?: unknown
  },
): { comprobantes: ComprobanteSaldo[]; saldoTotal: number; porEmpresa: Partial<Record<Empresa, RamaEmpresa>> } | null {
  const yaAplicadas = Array.isArray(actual.cobranzasAplicadas) ? actual.cobranzasAplicadas : []
  if (yaAplicadas.includes(cobranza.id)) return null
  const descuento = descuentosDeCobranzas([{ clienteId: '-', ...cobranza }]).get('-')
  const comprobantes = aplicarDescuentos(comprobantesDe(actual), descuento)
  const porEmpresa: Partial<Record<Empresa, RamaEmpresa>> = { ...(actual.porEmpresa ?? {}) }
  for (const e of EMPRESAS) {
    const propios = comprobantes.filter((c) => c.empresa === e)
    if (porEmpresa[e] || propios.length) porEmpresa[e] = { runId: null, origen: 'sync', ...(porEmpresa[e] ?? {}), saldoTotal: sumaSaldo(propios), comprobantes: propios.length }
  }
  return { comprobantes, saldoTotal: sumaSaldo(comprobantes), porEmpresa }
}
