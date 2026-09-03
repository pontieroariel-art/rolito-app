// Writers hacia Tango para los items de tango-outbox: remito (→ pedido) y
// factura (→ Facturador). Port de scripts/tango/bridge-listener.mjs al worker
// en Cloud Functions; misma lógica, misma config en `config/tango`.

import { TangoClient, PROCESOS, FILTROS } from './client'
import { armarPedido, renglonesDeVenta, referenciaPedido, prop, idDeFila, type PayloadVenta, type ItemOutbox } from './pedido'
import { armarComprobanteFacturador, interpretarRespuestaFacturador, type ConfigFacturadorEmpresa } from './factura'

export interface ConfigTango {
  companies?: Record<string, number>
  articulos?: Record<string, string>
  depositos?: Record<string, string>
  camiones?: Record<string, string>
  /** choferId → COD_GVA23 (vendedor de Tango): la factura lleva al chofer logueado como vendedor. */
  vendedores?: Record<string, string>
  pedido?: {
    talonarioId?: number | null
    vendedorId?: number | null
    condicionVentaId?: number | null
    listaPreciosId?: Record<string, number> | null
    estado?: number
    comprometeStock?: boolean
    monedaCodigo?: string
  }
  facturador?: Record<string, ConfigFacturadorEmpresa>
  [k: string]: unknown
}

export type ResultadoWriter =
  | { ok: true; resultado: Record<string, unknown> }
  | { ok: false; error: string }

export interface ContextoWriter {
  tango: TangoClient
  cfg: ConfigTango
  company: number
  item: ItemOutbox & { conCaePropio?: boolean }
  log: (msg: string) => void
}

/** Depósito del REPARTIDOR (en Tango los choferes son depósitos); cae al camión. */
function codigoDeposito(cfg: ConfigTango, payload: PayloadVenta): string | null {
  const dep = cfg.depositos ?? {}
  return (payload.choferId && dep[payload.choferId]) || (payload.camionId && dep[payload.camionId]) || null
}

/** Venta que NO factura ARCA → pedido en Tango (INTEGRACION.md §14). */
export async function enviarRemito(payload: PayloadVenta, ctx: ContextoWriter): Promise<ResultadoWriter> {
  const { tango, cfg, company, item, log } = ctx
  const articulos = cfg.articulos ?? {}
  const pedidoCfg = cfg.pedido ?? {}

  const idGva14 = Number(payload.clienteIdGva14Tango)
  if (!Number.isInteger(idGva14) || idGva14 <= 0) {
    return { ok: false, error: `La venta no trae clienteIdGva14Tango (cliente ${payload.clienteId} sin vincular a Tango — corré el cruce por CUIT)` }
  }
  const { renglones, faltantes } = renglonesDeVenta(payload, (id) => articulos[id] ?? null)
  if (faltantes.length) return { ok: false, error: `Falta el código de artículo Tango en config/tango.articulos para: ${faltantes.join(', ')}` }
  if (renglones.length === 0) return { ok: false, error: 'La venta no tiene renglones con cantidad > 0' }

  const codDeposito = codigoDeposito(cfg, payload)
  if (!codDeposito) {
    return { ok: false, error: `Falta el depósito Tango del chofer ${payload.choferNombre ?? payload.choferId} (config/tango.depositos.${payload.choferId}) — los depósitos de Tango son por repartidor` }
  }

  try {
    const monedaCod = pedidoCfg.monedaCodigo ?? 'PES'
    const idMoneda = await tango.resolverId(company, `moneda:${monedaCod}`, PROCESOS.monedas, FILTROS.moneda(monedaCod), 'ID_MONEDA')
    if (idMoneda == null) return { ok: false, error: `Tango no devolvió la moneda ${monedaCod}` }
    const idDeposito = await tango.resolverId(company, `deposito:${codDeposito}`, PROCESOS.depositos, FILTROS.deposito(codDeposito), 'ID_STA22')
    if (idDeposito == null) return { ok: false, error: `Tango no tiene el depósito ${codDeposito} (chofer ${payload.choferNombre ?? ''}) en la empresa ${company}` }
    const idsArticulos: Record<string, number | string> = {}
    for (const cod of new Set(renglones.map((r) => r.codigoArticulo))) {
      const id = await tango.resolverId(company, `articulo:${cod}`, PROCESOS.articulos, FILTROS.articulo(cod), 'ID_STA11')
      if (id == null) return { ok: false, error: `Tango no tiene el artículo ${cod} en la empresa ${company}` }
      idsArticulos[cod] = id as number | string
    }

    // Idempotencia: ¿ya existe un pedido con esta referencia?
    const ref = referenciaPedido(item.origenColeccion, item.origenId)
    try {
      const previo = await tango.getByFilter(company, PROCESOS.pedidos, FILTROS.pedidoRef(ref))
      if (previo.length > 0) {
        const savedId = idDeFila(previo[0], 'ID_GVA21')
        const nro = prop(previo[0], 'NRO_PEDIDO', 'N_PEDIDO', 'NUMERO')
        log(`${ref}: ya existía en Tango como pedido ${String(nro ?? savedId).trim()} — no se duplica`)
        return { ok: true, resultado: { savedId, pedidoNumero: nro ?? null, remitoNumero: String(nro ?? savedId).trim(), yaExistia: true } }
      }
    } catch (e) {
      log(`aviso: no se pudo verificar duplicado (${(e as Error).message}); se crea igual`)
    }

    const pedido = armarPedido(payload, item, {
      idGva14, idMoneda: idMoneda as number, idDeposito: idDeposito as number, articulos: idsArticulos,
      talonarioId: pedidoCfg.talonarioId ?? null,
      vendedorId: pedidoCfg.vendedorId ?? null,
      condicionVentaId: pedidoCfg.condicionVentaId ?? null,
      listaPreciosId: pedidoCfg.listaPreciosId?.[payload.canal ?? ''] ?? null,
    }, renglones, {
      estadoPedido: pedidoCfg.estado ?? 2,
      comprometeStock: pedidoCfg.comprometeStock ?? true,
      etiquetaCamion: `${codDeposito} ${cfg.camiones?.[payload.choferId ?? ''] ?? cfg.camiones?.[payload.camionId ?? ''] ?? ''}`.trim(),
    })
    const creado = await tango.create(company, PROCESOS.pedidos, pedido)
    const savedId = prop(creado, 'savedId')
    if (savedId == null) return { ok: false, error: `Tango no devolvió SavedId al crear el pedido: ${JSON.stringify(creado).slice(0, 300)}` }

    let pedidoNumero: string | null = null
    try {
      const fila = await tango.getById(company, PROCESOS.pedidos, savedId)
      const n = prop(fila, 'NRO_PEDIDO', 'N_PEDIDO', 'NUMERO')
      pedidoNumero = n == null ? null : String(n).trim()
    } catch (e) {
      log(`aviso: no se pudo leer el número del pedido ${savedId} (${(e as Error).message})`)
    }
    log(`${ref}: pedido creado en Tango (Company ${company}) id=${savedId} nro=${pedidoNumero ?? '?'}`)
    return { ok: true, resultado: { savedId, pedidoNumero, remitoNumero: pedidoNumero ?? String(savedId) } }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** Factura de la app → Facturador de Tango (INTEGRACION.md §15). */
export async function enviarFactura(payload: PayloadVenta, ctx: ContextoWriter): Promise<ResultadoWriter> {
  const { tango, cfg, company, item, log } = ctx
  const empresa = item.empresa ?? '?'
  const cfgEmpresa = cfg.facturador?.[empresa]
  if (!cfgEmpresa) return { ok: false, error: `Falta config/tango.facturador.${empresa} (talonarios, condicionVenta, listaPrecio, contracuenta, vendedor, codigoTasaIva21, cuentas, codigoAlicuotaPercepcionIIBB)` }

  const articulos = cfg.articulos ?? {}
  const codDeposito = codigoDeposito(cfg, payload) ?? (!payload.camionId ? cfgEmpresa.depositoVentanilla ?? null : null)
  if (!codDeposito) {
    return { ok: false, error: payload.camionId ? `Falta el depósito Tango del chofer ${payload.choferNombre ?? payload.choferId} (config/tango.depositos.${payload.choferId})` : `Falta config/tango.facturador.${empresa}.depositoVentanilla` }
  }

  // Vendedor = el chofer logueado (decisión de Ariel 2026-09-03): mapeo
  // chofer → COD_GVA23 en config/tango.vendedores (lo arma
  // sincronizar-choferes-tango.mjs); cae al vendedor fijo de la empresa si hay.
  const vendedor = cfg.vendedores?.[payload.choferId ?? ''] ?? cfgEmpresa.vendedor
  if (vendedor === undefined || vendedor === null || vendedor === '') {
    return { ok: false, error: `El chofer ${payload.choferNombre ?? payload.choferId} no tiene vendedor de Tango (config/tango.vendedores.${payload.choferId}) — hay que darlo de alta como vendedor en Tango y sincronizar` }
  }

  // Condición de venta: contado = la configurada (default 1 CONTADO); cuenta
  // corriente = la que el CLIENTE tiene pactada en Tango (COND_VTA de su ficha),
  // no un valor fijo para todos.
  const condCfg = cfgEmpresa.condicionVenta
  const condContado = (typeof condCfg === 'object' && condCfg !== null ? condCfg.contado : condCfg) ?? 1
  let condCtaCte: number | string | undefined = typeof condCfg === 'object' && condCfg !== null ? condCfg.cuenta_corriente : undefined
  if (payload.formaPago === 'cuenta_corriente') {
    const idGva14 = Number(payload.clienteIdGva14Tango)
    if (!Number.isInteger(idGva14) || idGva14 <= 0) return { ok: false, error: `La venta no trae clienteIdGva14Tango (cliente ${payload.clienteId} sin vincular a Tango)` }
    try {
      const ficha = await tango.getById(company, PROCESOS.clientes, idGva14)
      const cond = prop(ficha, 'COND_VTA')
      if (cond !== undefined && cond !== null && cond !== '') condCtaCte = cond as number | string
    } catch (e) {
      log(`aviso: no se pudo leer la condición de venta del cliente ${idGva14} (${(e as Error).message})`)
    }
    if (condCtaCte === undefined) return { ok: false, error: `El cliente ${payload.clienteNombre ?? idGva14} no tiene condición de venta en Tango y no hay config/tango.facturador.${empresa}.condicionVenta.cuenta_corriente` }
  }

  const armado = armarComprobanteFacturador(payload, item, {
    ...cfgEmpresa,
    vendedor,
    condicionVenta: { contado: condContado, ...(condCtaCte !== undefined ? { cuenta_corriente: condCtaCte } : {}) },
  }, {
    codigoArticulo: (id) => articulos[id] ?? null,
    codigoDeposito: codDeposito,
    etiquetaCamion: `${codDeposito} ${cfg.camiones?.[payload.choferId ?? ''] ?? ''}`.trim(),
  })
  if (armado.error !== undefined) return { ok: false, error: armado.error }
  if (item.conCaePropio === true && !armado.comprobante.cAE) {
    return { ok: false, error: 'El item dice conCaePropio pero la venta no trae factura.cae — no se registra sin CAE' }
  }

  try {
    const data = await tango.registrarComprobantes(company, [armado.comprobante])
    const numero = armado.comprobante.numeroComprobante as string
    const r = interpretarRespuestaFacturador(data, numero)
    if (!r.ok) return { ok: false, error: `Facturador rechazó ${numero}: ${r.mensaje || JSON.stringify(data).slice(0, 300)}` }
    log(`${armado.referencia}: factura ${numero} ${r.yaExistia ? 'ya estaba registrada' : 'registrada'} en Tango (Company ${company})${armado.comprobante.cAE ? ' con CAE' : ' sin CAE'}`)
    return { ok: true, resultado: { facturaNumero: numero, comprobanteNumero: r.numeroComprobante ?? numero, yaExistia: r.yaExistia, fiscal: armado.fiscal } }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
