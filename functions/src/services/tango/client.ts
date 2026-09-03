// Cliente HTTP de la API de Tango (Plataforma/Ventas) vía Tango Connect.
//
// Confirmado 2026-09-03 contra el Tango real: la API está expuesta a internet
// en `https://{llave}.connect.axoft.com` (llave 001174/003 → `001174-003`),
// misma superficie que `http://rhielotg:17000` en la red interna: headers
// `ApiAuthorization` (token de desarrollador) + `Company` (1 = Redonhielo,
// 3 = Rolito), endpoints `Api/Get`, `Api/GetByFilter`, `Api/GetById`,
// `Api/Create`, y el Facturador en `Api/FacturadorVenta/registrar`.
//
// Formas de respuesta (verificadas):
//   Get         → { resultData: { list, totalCount, totalPages }, succeeded }
//   GetByFilter → { list: [...] }   (sin succeeded; filtroSql DEBE empezar con "WHERE ")
//   GetById     → { value: {...}, succeeded }
//   Create      → { Succeeded, SavedId, Message, ExceptionInfo }
//   Facturador  → { Message, Comprobantes: [{ numeroComprobante, estado, mensaje }], Succeeded }

import { prop, idDeFila } from './pedido'

export interface TangoClientConfig {
  baseUrl: string
  token: string
  timeoutMs?: number
}

export const PROCESOS = { pedidos: 19845, articulos: 87, depositos: 2941, monedas: 1660, clientes: 2117 } as const

export const FILTROS = {
  articulo:  (cod: string) => `WHERE AXV_ARTICULO.COD_STA11 = '${sql(cod)}'`,
  deposito:  (cod: string) => `WHERE STA22.COD_STA22 = '${sql(cod)}'`,
  moneda:    (cod: string) => `WHERE MONEDA.COD_MONEDA = '${sql(cod)}'`,
  pedidoRef: (ref: string) => `WHERE AXV_PEDIDO.LEYENDA_1 = '${sql(ref)}'`,
}
const sql = (s: string) => String(s).replace(/'/g, "''")

export class TangoClient {
  private cacheIds = new Map<string, unknown>()

  constructor(private cfg: TangoClientConfig) {}

  async request(company: number | string, metodo: 'GET' | 'POST', accion: string, params?: Record<string, string | number>, body?: unknown): Promise<Record<string, unknown>> {
    const qs = Object.entries(params ?? {}).map(([k, v]) => `${k}=${encodeURIComponent(String(v ?? ''))}`).join('&')
    const uri = `${this.cfg.baseUrl.replace(/\/+$/, '')}/Api/${accion}${qs ? '?' + qs : ''}`
    const resp = await fetch(uri, {
      method: metodo,
      headers: { ApiAuthorization: this.cfg.token, Company: String(company), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 30_000),
    })
    const texto = await resp.text()
    let data: Record<string, unknown>
    try { data = texto ? JSON.parse(texto) : {} } catch { throw new Error(`Tango respondió ${resp.status} con cuerpo no JSON en ${accion}: ${texto.slice(0, 200)}`) }
    if (!resp.ok && !(data.Comprobantes || data.comprobantes)) {
      throw new Error(`Tango respondió ${resp.status} en ${accion}: ${(prop(data, 'message') as string) ?? texto.slice(0, 200)}`)
    }
    if (prop(data, 'succeeded') === false) {
      const info = prop(data, 'exceptionInfo') as Record<string, unknown> | undefined
      const msgs = info?.messages
      throw new Error(`Tango succeeded=false en ${accion}: ${(Array.isArray(msgs) ? msgs.join('; ') : null) ?? (prop(data, 'message') as string) ?? JSON.stringify(data).slice(0, 300)}`)
    }
    return data
  }

  static filas(data: Record<string, unknown>): Record<string, unknown>[] {
    const rd = prop(data, 'resultData')
    const lista = prop(rd, 'list') ?? (Array.isArray(rd) ? rd : null) ?? prop(data, 'list')
    return Array.isArray(lista) ? (lista as Record<string, unknown>[]) : []
  }

  async getByFilter(company: number | string, proceso: number, filtroSql: string): Promise<Record<string, unknown>[]> {
    return TangoClient.filas(await this.request(company, 'GET', 'GetByFilter', { process: proceso, view: '', filtroSql }))
  }

  /** ID interno de un maestro por código, cacheado por empresa (artículos, depósitos, moneda). */
  async resolverId(company: number | string, clave: string, proceso: number, filtroSql: string, campoId: string): Promise<unknown> {
    const k = `${company}|${clave}`
    if (this.cacheIds.has(k)) return this.cacheIds.get(k)
    const filas = await this.getByFilter(company, proceso, filtroSql)
    if (filas.length === 0) return null
    const id = idDeFila(filas[0], campoId)
    if (id === undefined) return null
    this.cacheIds.set(k, id)
    return id
  }

  async getById(company: number | string, proceso: number, id: unknown): Promise<Record<string, unknown> | undefined> {
    const det = await this.request(company, 'GET', 'GetById', { process: proceso, view: '', id: String(id) })
    return (prop(det, 'value') ?? prop(det, 'resultData') ?? det) as Record<string, unknown> | undefined
  }

  async create(company: number | string, proceso: number, body: unknown): Promise<Record<string, unknown>> {
    return this.request(company, 'POST', 'Create', { process: proceso }, body)
  }

  async registrarComprobantes(company: number | string, comprobantes: unknown[]): Promise<Record<string, unknown>> {
    return this.request(company, 'POST', 'FacturadorVenta/registrar', undefined, comprobantes)
  }
}
