// Writers hacia Tango para los items de tango-outbox: remito (→ pedido) y
// factura (→ Facturador). Port de scripts/tango/bridge-listener.mjs al worker
// en Cloud Functions; misma lógica, misma config en `config/tango`.

import { TangoClient, PROCESOS, FILTROS } from './client'
import { armarPedido, renglonesDeVenta, referenciaPedido, prop, idDeFila, type PayloadVenta, type ItemOutbox } from './pedido'
import { armarComprobanteFacturador, armarNotaCreditoFacturador, interpretarRespuestaFacturador, type ConfigFacturadorEmpresa } from './factura'

export interface ConfigTango {
  companies?: Record<string, number>
  articulos?: Record<string, string>
  depositos?: Record<string, string>
  /** Depósito de Tango por planta (ventanilla vende desde la cámara): { torcuato: '01', merlo: '02' }. */
  depositosPlanta?: Record<string, string>
  camiones?: Record<string, string>
  /** choferId → COD_GVA23. Desde 2026-09-09 la factura NO lo usa (el vendedor es el supervisor
   *  del cliente, COD_VENDED de su ficha); queda para otros usos/scripts. */
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
  /** Persiste el ID_GVA14 resuelto de la cuenta CONSUMIDOR FINAL en config/tango (lo da el worker de la nube). */
  guardarIdConsumidorFinal?: (empresa: string, idGva14: number) => Promise<void>
  log: (msg: string) => void
}

/**
 * Depósito de Tango de la venta: el del REPARTIDOR (en Tango los choferes son depósitos; cae al
 * camión) o, en ventanilla, el de la PLANTA donde se vendió (no hay depósito en tránsito: la
 * mercadería sale de la cámara — decisión de Ariel 2026-09-04, STOCK_REPARTO.md).
 */
function codigoDeposito(cfg: ConfigTango, payload: PayloadVenta): string | null {
  // El depósito explícito del doc (expedición por depósito, 2026-09-06) manda;
  // el mapa uid/camión → código queda como respaldo para docs anteriores.
  if (typeof payload.depositoTango === 'string' && payload.depositoTango.trim()) return payload.depositoTango.trim()
  const dep = cfg.depositos ?? {}
  const porPlanta = cfg.depositosPlanta ?? {}
  return (payload.choferId && dep[payload.choferId]) || (payload.camionId && dep[payload.camionId])
    || (payload.plantaId && porPlanta[payload.plantaId]) || null
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
export const enviarFactura = (payload: PayloadVenta, ctx: ContextoWriter): Promise<ResultadoWriter> =>
  registrarEnFacturador(payload, ctx, 'factura')

/**
 * Nota de crédito que anula una factura de ventanilla (INTEGRACION.md §33):
 * mismo camino que la factura (ficha del cliente, depósito, armado) con el
 * comprobante 'CDE' referenciando a la factura.
 */
export const enviarNotaCredito = (payload: PayloadVenta, ctx: ContextoWriter): Promise<ResultadoWriter> =>
  registrarEnFacturador(payload, ctx, 'notaCredito')

/**
 * Venta de ventanilla a un consumidor final sin ficha (2026-09-17): el
 * Facturador exige un cliente, así que va sobre la cuenta genérica de la
 * empresa (`clienteConsumidorFinal`). El id se resuelve por API con el código
 * la primera vez y queda en memoria. Con ficha, el payload vuelve intacto.
 */
export async function resolverClienteOcasional(payload: PayloadVenta, ctx: Pick<ContextoWriter, 'tango' | 'cfg' | 'company' | 'item' | 'log' | 'guardarIdConsumidorFinal'>): Promise<{ payload: PayloadVenta } | { error: string }> {
  const idGva14 = Number(payload.clienteIdGva14Tango)
  if (Number.isInteger(idGva14) && idGva14 > 0) return { payload }
  if (!payload.clienteOcasional) return { payload }
  const empresa = ctx.item.empresa ?? '?'
  const generico = ctx.cfg.facturador?.[empresa]?.clienteConsumidorFinal
  const codigo = String(generico?.codigo ?? '').trim()
  if (!codigo) return { error: `Venta a consumidor final sin ficha: falta config/tango.facturador.${empresa}.clienteConsumidorFinal.codigo (COD_CLIENT de la cuenta CONSUMIDOR FINAL en Tango)` }
  let id = Number(generico?.idGva14)
  if (!Number.isInteger(id) || id <= 0) {
    // 1) GetByFilter con caché, como artículos/depósitos/monedas. 2) Si el
    // filtro rebota o no encuentra, se recorre el padrón (Api/Get paginado,
    // como la sync de clientes) y se busca el código a mano. En cualquier caso
    // el id se guarda en config/tango para no volver a buscarlo.
    let motivo = ''
    try {
      id = Number(await ctx.tango.resolverId(ctx.company, `cliente:${codigo}`, PROCESOS.clientes, FILTROS.cliente(codigo), 'ID_GVA14'))
    } catch (e) {
      motivo = (e as Error).message
      id = 0
    }
    if (!Number.isInteger(id) || id <= 0) {
      ctx.log(`consumidor final: GetByFilter no resolvió "${codigo}"${motivo ? ` (${motivo})` : ''}; se recorre el padrón`)
      try {
        const filas = await ctx.tango.getAll(ctx.company, PROCESOS.clientes, 200)
        const fila = filas.find((f) => String(prop(f, 'COD_GVA14') ?? '').trim() === codigo)
        id = Number(prop(fila ?? {}, 'ID_GVA14'))
      } catch (e) {
        return { error: `No se pudo buscar la cuenta CONSUMIDOR FINAL "${codigo}" en Tango: ${(e as Error).message}` }
      }
    }
    if (!Number.isInteger(id) || id <= 0) return { error: `La cuenta CONSUMIDOR FINAL "${codigo}" no existe en Tango (Company ${ctx.company}); revisá config/tango.facturador.${empresa}.clienteConsumidorFinal.codigo` }
    ctx.log(`consumidor final: cuenta ${codigo} → ID_GVA14 ${id}`)
    if (ctx.guardarIdConsumidorFinal) await ctx.guardarIdConsumidorFinal(empresa, id).catch((e) => ctx.log(`aviso: no se pudo guardar el id en config/tango (${(e as Error).message})`))
  }
  return { payload: { ...payload, clienteIdGva14Tango: id, clienteCodigoTango: codigo, clienteNombre: payload.clienteNombre?.trim() && payload.clienteNombre.trim() !== '.' ? payload.clienteNombre : 'CONSUMIDOR FINAL' } }
}

async function registrarEnFacturador(payloadOriginal: PayloadVenta, ctx: ContextoWriter, tipo: 'factura' | 'notaCredito'): Promise<ResultadoWriter> {
  const { tango, cfg, company, item, log } = ctx
  const empresa = item.empresa ?? '?'
  const cfgEmpresa = cfg.facturador?.[empresa]
  if (!cfgEmpresa) return { ok: false, error: `Falta config/tango.facturador.${empresa} (talonarios, condicionVenta, listaPrecio, contracuenta, vendedor, codigoTasaIva21, cuentas, codigoAlicuotaPercepcionIIBB)` }
  const ocasional = await resolverClienteOcasional(payloadOriginal, ctx)
  if ('error' in ocasional) return { ok: false, error: ocasional.error }
  const payload = ocasional.payload

  const articulos = cfg.articulos ?? {}
  const codDeposito = codigoDeposito(cfg, payload) ?? (!payload.camionId ? cfgEmpresa.depositoVentanilla ?? null : null)
  // El Facturador exige el depósito aunque la factura no descargue stock
  // (Rolito, descargaStock: false — probado 2026-09-06).
  if (!codDeposito) {
    return { ok: false, error: payload.camionId ? `Falta el depósito Tango del chofer ${payload.choferNombre ?? payload.choferId} (config/tango.depositos.${payload.choferId})` : `Falta el depósito Tango de la planta ${payload.plantaId ?? '?'} (config/tango.depositosPlanta)` }
  }

  // Vendedor del comprobante = el SUPERVISOR del cliente (COD_VENDED de su
  // ficha en Tango: la oficina filtra ventas por supervisor; decisión de Ariel
  // 2026-09-09, antes iba el chofer y pisaba ese filtro). Quién vendió
  // físicamente (chofer o cajero) va en la leyenda 3. Sin vendedor en la ficha
  // (ocasionales, clientes nuevos) cae al genérico de la empresa ('AP').
  let vendedor: number | string | undefined = cfgEmpresa.vendedor
  if (vendedor === undefined || vendedor === null || vendedor === '') {
    return { ok: false, error: `Falta config/tango.facturador.${empresa}.vendedor (vendedor genérico para clientes sin vendedor en su ficha)` }
  }

  // Condición de venta: contado = la configurada (default 1 CONTADO); cuenta
  // corriente = la que el CLIENTE tiene pactada en Tango (COND_VTA de su ficha),
  // no un valor fijo para todos.
  const condCfg = cfgEmpresa.condicionVenta
  const condContado = (typeof condCfg === 'object' && condCfg !== null ? condCfg.contado : condCfg) ?? 1
  let condCtaCte: number | string | undefined = typeof condCfg === 'object' && condCfg !== null ? condCfg.cuenta_corriente : undefined
  const esPromo = !(payload.factura && payload.factura.estado === 'emitida')
  let letraNoFiscal: 'A' | 'B' | undefined
  let listaPrecio: number | string | undefined

  // Ficha del cliente en Tango: la condición de venta pactada (cta. cte.), la
  // lista de precios asignada (las listas de Tango son por cliente; la app manda
  // los precios explícitos, la lista es referencia) y la categoría de IVA
  // (promo → letra A si es Responsable Inscripto, B si no).
  {
    const idGva14 = Number(payload.clienteIdGva14Tango)
    if (!Number.isInteger(idGva14) || idGva14 <= 0) return { ok: false, error: `La venta no trae clienteIdGva14Tango (cliente ${payload.clienteId} sin vincular a Tango)` }
    try {
      const ficha = await tango.getById(company, PROCESOS.clientes, idGva14)
      const cond = prop(ficha, 'COND_VTA')
      if (cond !== undefined && cond !== null && cond !== '') condCtaCte = cond as number | string
      const vend = prop(ficha, 'COD_VENDED')
      if (typeof vend === 'string' && vend.trim() !== '') vendedor = vend.trim()
      const lista = prop(ficha, 'NRO_LISTA')
      if (lista !== undefined && lista !== null && lista !== '' && Number(lista) > 0) listaPrecio = lista as number | string
      const catIva = Number(prop(ficha, 'ID_CATEGORIA_IVA'))
      if (Number.isInteger(catIva) && catIva > 0) letraNoFiscal = catIva === 1 ? 'A' : 'B'   // 1 = Responsable Inscripto
    } catch (e) {
      log(`aviso: no se pudo leer la ficha del cliente ${idGva14} en Tango (${(e as Error).message})`)
    }
    if (payload.formaPago === 'cuenta_corriente' && condCtaCte === undefined) {
      return { ok: false, error: `El cliente ${payload.clienteNombre ?? idGva14} no tiene condición de venta en Tango y no hay config/tango.facturador.${empresa}.condicionVenta.cuenta_corriente` }
    }
    if (esPromo && !letraNoFiscal) return { ok: false, error: `No se pudo leer la categoría de IVA del cliente ${payload.clienteNombre ?? idGva14} en Tango (define si la factura X entra como A o B)` }
  }

  const armar = tipo === 'notaCredito' ? armarNotaCreditoFacturador : armarComprobanteFacturador
  const armado = armar(payload, item, {
    ...cfgEmpresa,
    vendedor,
    condicionVenta: { contado: condContado, ...(condCtaCte !== undefined ? { cuenta_corriente: condCtaCte } : {}) },
    ...(listaPrecio !== undefined ? { listaPrecio } : {}),
  }, {
    codigoArticulo: (id) => articulos[id] ?? null,
    codigoDeposito: codDeposito,
    etiquetaCamion: `${codDeposito ?? ''} ${cfg.camiones?.[payload.choferId ?? ''] ?? ''}`.trim(),
    letraNoFiscal,
  })
  if (armado.error !== undefined) return { ok: false, error: armado.error }
  if (item.conCaePropio === true && !armado.comprobante.cAE) {
    return { ok: false, error: `El item dice conCaePropio pero ${tipo === 'notaCredito' ? 'la nota de crédito' : 'la venta'} no trae CAE — no se registra sin CAE` }
  }

  try {
    const data = await tango.registrarComprobantes(company, [armado.comprobante])
    const numero = armado.comprobante.numeroComprobante as string
    const r = interpretarRespuestaFacturador(data, numero)
    if (!r.ok) return { ok: false, error: `Facturador rechazó ${numero}: ${r.mensaje || JSON.stringify(data).slice(0, 300)}` }
    const que = tipo === 'notaCredito' ? 'nota de crédito' : 'factura'
    log(`${armado.referencia}: ${que} ${numero} ${r.yaExistia ? 'ya estaba registrada' : 'registrada'} en Tango (Company ${company})${armado.comprobante.cAE ? ' con CAE' : ' sin CAE'}`)
    return tipo === 'notaCredito'
      ? { ok: true, resultado: { notaCreditoNumero: numero, comprobanteNumero: r.numeroComprobante ?? numero, yaExistia: r.yaExistia, fiscal: true } }
      : { ok: true, resultado: { facturaNumero: numero, comprobanteNumero: r.numeroComprobante ?? numero, yaExistia: r.yaExistia, fiscal: armado.fiscal } }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
