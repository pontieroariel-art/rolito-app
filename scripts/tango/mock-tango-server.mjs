/**
 * mock-tango-server.mjs — Tango de mentira para probar el bridge punta a punta
 * sin licencia ni VM: imita la superficie de la API de Plataforma/Ventas que
 * usa bridge-listener.mjs (GetByFilter, Create, GetById) con la misma forma de
 * respuesta ({ succeeded, resultData: { list } } / { Succeeded, SavedId }).
 *
 * Valida lo que un Tango real validaría a grandes rasgos: headers
 * ApiAuthorization + Company, process conocido, ID_GVA14/ID_MONEDA/renglones
 * presentes. Guarda los pedidos en memoria y los devuelve por LEYENDA_1 para
 * ejercitar la idempotencia.
 *
 * Uso:  node scripts/tango/mock-tango-server.mjs [puerto=17000]
 * Luego apuntar bridge-listener.config.json → tangoVentas.baseUrl a
 * http://localhost:<puerto> con cualquier token.
 */
import http from 'http'

const PORT = Number(process.argv[2] ?? 17000)

const ARTICULOS = [
  { ID_STA11: 101, COD_STA11: 'HB02',  DESCRIPCIO: 'HIELO BOLSA 2 KG' },
  { ID_STA11: 102, COD_STA11: 'HB03',  DESCRIPCIO: 'HIELO BOLSA 3 KG' },
  { ID_STA11: 103, COD_STA11: 'HB10',  DESCRIPCIO: 'HIELO BOLSA 10 KG' },
  { ID_STA11: 104, COD_STA11: 'HP10',  DESCRIPCIO: 'HIELO PICADO 10 KG' },
  { ID_STA11: 105, COD_STA11: 'HE10',  DESCRIPCIO: 'HIELO ESCAMAS 10 KG' },
  { ID_STA11: 106, COD_STA11: 'BARRA', DESCRIPCIO: 'BARRA DE HIELO' },
]
const DEPOSITOS = [
  { ID_STA22: 1,  COD_STA22: '01', NOMBRE_DEP: 'PLANTA DON TORCUATO' },
  { ID_STA22: 5,  COD_STA22: '05', NOMBRE_DEP: 'CAMION AF313WU' },
  { ID_STA22: 6,  COD_STA22: '06', NOMBRE_DEP: 'CAMION AG016KD' },
]
const MONEDAS = [{ ID_MONEDA: 1, COD_MONEDA: 'PES', DESCRIPCIO: 'PESOS' }]
const pedidos = []   // { ID_GVA21, NRO_PEDIDO, ...body }
const facturas = []  // comprobantes registrados por el Facturador
let proximoId = 1000

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}
function leerBody(req) {
  return new Promise((resolve) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => resolve(s)) })
}
// filtroSql: "TABLA.CAMPO = 'valor'" o "CAMPO = 'valor'" → { campo, valor }
// Como el Tango real (2026-09-03): el filtroSql tiene que empezar con WHERE.
function parseFiltro(f) {
  const s = (f ?? '').trim()
  if (!/^WHERE\s/i.test(s)) throw new Error(`filtroSql sin WHERE: "${s}" (Tango real: Incorrect syntax near '=')`)
  const m = /^WHERE\s+(?:\w+\.)?(\w+)\s*=\s*'?([^']*)'?$/i.exec(s)
  return m ? { campo: m[1], valor: m[2] } : null
}
function filtrar(lista, filtroSql) {
  const f = parseFiltro(filtroSql)
  if (!f) throw new Error(`filtroSql no soportado por el mock: ${filtroSql}`)
  return lista.filter((r) => String(r[f.campo] ?? '') === f.valor)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const accion = url.pathname.replace(/^\/Api\//i, '')
  const process_ = Number(url.searchParams.get('process'))
  const company = req.headers.company
  if (!req.headers.apiauthorization) return json(res, 401, { succeeded: false, message: 'Falta ApiAuthorization' })
  if (!company) return json(res, 400, { succeeded: false, message: 'Falta header Company' })
  console.log(`[mock-tango] ${req.method} ${accion} process=${process_} Company=${company} ${url.searchParams.get('filtroSql') ?? ''}`)

  try {
    if (accion === 'GetByFilter' && req.method === 'GET') {
      const filtro = url.searchParams.get('filtroSql')
      const tabla = { 87: ARTICULOS, 2941: DEPOSITOS, 1660: MONEDAS, 19845: pedidos }[process_]
      if (!tabla) return json(res, 400, { succeeded: false, exceptionInfo: { messages: [`process ${process_} desconocido`] } })
      // El Tango real responde { list: [...] } pelado (sin succeeded/resultData).
      const list = filtrar(tabla, filtro)
      return json(res, 200, { list })
    }
    if (accion === 'GetById' && req.method === 'GET') {
      const id = Number(url.searchParams.get('id'))
      const p = pedidos.find((x) => x.ID_GVA21 === id)
      if (!p) return json(res, 200, { succeeded: false, exceptionInfo: { messages: ['pedido inexistente'] } })
      // El Tango real responde { value: {...} } (confirmado 2026-09-03).
      return json(res, 200, { value: p, message: null, exceptionInfo: null, succeeded: true })
    }
    if (accion === 'Create' && req.method === 'POST') {
      if (process_ !== 19845) return json(res, 400, { Succeeded: false, Message: `Create no soportado para process ${process_}` })
      const body = JSON.parse(await leerBody(req))
      const faltan = ['ID_GVA14', 'ID_MONEDA', 'PORCENTAJE_DESCUENTO_GENERAL'].filter((k) => body[k] === undefined)
      if (faltan.length) return json(res, 200, { Succeeded: false, Message: `Faltan campos obligatorios: ${faltan.join(', ')}` })
      if (!Array.isArray(body.RENGLON_DTO) || body.RENGLON_DTO.length === 0) return json(res, 200, { Succeeded: false, Message: 'Sin renglones' })
      for (const r of body.RENGLON_DTO) if (!ARTICULOS.some((a) => a.ID_STA11 === r.ID_STA11)) return json(res, 200, { Succeeded: false, Message: `ID_STA11 ${r.ID_STA11} inexistente` })
      if (process.env.MOCK_TANGO_FALLAR_CREATE === '1') return json(res, 500, { Succeeded: false, Message: 'Fallo simulado' })
      const id = proximoId++
      const pedido = { ID_GVA21: id, NRO_PEDIDO: String(id - 1000 + 1).padStart(8, '0'), COMPANY: company, ...body }
      pedidos.push(pedido)
      console.log(`[mock-tango]   → pedido ${pedido.NRO_PEDIDO} (id ${id}) cliente ${body.ID_GVA14} depósito ${body.ID_STA22 ?? '-'} renglones ${body.RENGLON_DTO.length} ref ${body.LEYENDA_1}`)
      return json(res, 200, { Succeeded: true, SavedId: id, Message: 'OK' })
    }
    // Facturador: POST /FacturadorVenta/registrar (body = array de comprobantes).
    // Valida lo básico y rechaza números repetidos con el (51016) real.
    if (/FacturadorVenta\/registrar$/i.test(url.pathname) && req.method === 'POST') {
      const lista = JSON.parse(await leerBody(req))
      if (!Array.isArray(lista) || lista.length === 0) return json(res, 200, { Message: 'Hubo errores en la registración, verifique el resultado.', Comprobantes: [{ numeroComprobante: null, estado: 'Error', exceptionMessage: '(78000) El JSON debe ser un array con al menos un comprobante', mensaje: null }], Succeeded: false })
      const resultados = []
      for (const c of lista) {
        const nro = `${c.codigoTipoComprobante} ${c.numeroComprobante}`
        const falta = ['codigoTipoComprobante', 'numeroComprobante', 'codigoTalonario', 'codigoCliente', 'codigoCondicionDeVenta', 'fechaComprobante', 'codigoListaPrecio', 'codigoContracuenta', 'codigoDeposito', 'codigoVendedor', 'total', 'totalSinImpuestos', 'totalIva', 'subtotal', 'subtotalSinImpuestos'].filter((k) => c[k] === undefined || c[k] === '')
        if (falta.length) { resultados.push({ numeroComprobante: nro, estado: 'Error', exceptionMessage: '', mensaje: `(10001) Faltan datos requeridos: ${falta.join(', ')}` }); continue }
        if (!Array.isArray(c.items) || !c.items.length) { resultados.push({ numeroComprobante: nro, estado: 'Error', exceptionMessage: '', mensaje: '(10002) El comprobante no tiene ítems' }); continue }
        const art = c.items.find((i) => !ARTICULOS.some((a) => a.COD_STA11 === i.codigo))
        if (art) { resultados.push({ numeroComprobante: nro, estado: 'Error', exceptionMessage: '', mensaje: `(10003) Artículo inexistente: ${art.codigo}` }); continue }
        if (!c.pagos && !c.cuotasCuentaCorriente) { resultados.push({ numeroComprobante: nro, estado: 'Error', exceptionMessage: '', mensaje: '(10004) Falta la sección pagos o cuotasCuentaCorriente' }); continue }
        const suma = c.items.reduce((s, i) => s + Number(i.importe ?? 0), 0) + c.items.reduce((s, i) => s + (i.percepciones ?? []).reduce((t, p) => t + Number(p.importe), 0), 0)
        if (Math.abs(suma - Number(c.total)) > 0.011) { resultados.push({ numeroComprobante: nro, estado: 'Error', exceptionMessage: '', mensaje: `(10005) El total ${c.total} no coincide con los ítems (${suma.toFixed(2)})` }); continue }
        if (facturas.some((f) => f.numeroComprobante === c.numeroComprobante && f.COMPANY === company)) {
          resultados.push({ numeroComprobante: nro, estado: 'Error', exceptionMessage: '', mensaje: `(51016) Ya existe el número de comprobante ${c.numeroComprobante.slice(0, 1)} ${c.numeroComprobante.slice(1, 6)}-${c.numeroComprobante.slice(6)}. Verifique el talonario utilizado.` }); continue
        }
        facturas.push({ COMPANY: company, ...c })
        console.log(`[mock-tango]   → factura ${nro} cliente ${c.codigoCliente} CAE ${c.cAE ?? '-'} total ${c.total} items ${c.items.length} ref ${c.leyenda1}`)
        resultados.push({ numeroComprobante: nro, estado: 'Ok', exceptionMessage: '', mensaje: '' })
      }
      const ok = resultados.every((r) => r.estado === 'Ok')
      return json(res, 200, { Message: ok ? 'Los comprobantes se han registrado correctamente' : 'Hubo errores en la registración, verifique el resultado.', Comprobantes: resultados, Succeeded: ok })
    }
    if (accion === 'facturas' && req.method === 'GET') return json(res, 200, facturas)  // inspección
    if (accion === 'pedidos' && req.method === 'GET') return json(res, 200, pedidos)   // inspección
    return json(res, 404, { succeeded: false, message: `acción ${accion} no soportada por el mock` })
  } catch (e) {
    return json(res, 500, { succeeded: false, message: e.message })
  }
})

server.listen(PORT, () => console.log(`[mock-tango] escuchando en http://localhost:${PORT} (artículos: ${ARTICULOS.map((a) => a.COD_STA11).join(', ')}; depósitos: ${DEPOSITOS.map((d) => d.COD_STA22).join(', ')})`))
