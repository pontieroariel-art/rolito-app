import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FILTROS, TangoClient } from './client'

/**
 * El cliente HTTP de Tango Connect: cómo arma cada pedido, cómo interpreta
 * las respuestas verificadas (Get / GetByFilter / GetById / Create /
 * Facturador) y qué convierte en error. `fetch` es un doble global.
 */

type Respuesta = { status?: number; body?: unknown; texto?: string }
const llamadas: { uri: string; init: RequestInit }[] = []
let respuestas: Respuesta[] = []

beforeEach(() => {
  llamadas.length = 0; respuestas = []
  vi.stubGlobal('fetch', vi.fn(async (uri: string, init: RequestInit) => {
    llamadas.push({ uri, init })
    const r = respuestas.shift() ?? { body: {} }
    return new Response(r.texto ?? JSON.stringify(r.body), { status: r.status ?? 200 })
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

const cliente = () => new TangoClient({ baseUrl: 'https://001174-003.connect.axoft.com/', token: 'TOKEN' })

describe('FILTROS', () => {
  it('cada filtro empieza con WHERE (GetByFilter lo exige) y escapa las comillas del valor', () => {
    expect(FILTROS.articulo("PT'HI")).toBe("WHERE AXV_ARTICULO.COD_STA11 = 'PT''HI'")
    expect(FILTROS.deposito('03')).toBe("WHERE STA22.COD_STA22 = '03'")
    expect(FILTROS.moneda('PES')).toBe("WHERE MONEDA.COD_MONEDA = 'PES'")
    expect(FILTROS.pedidoRef('ROLITO:VC:v1')).toBe("WHERE AXV_PEDIDO.LEYENDA_1 = 'ROLITO:VC:v1'")
    // Sin tabla calificada: "GVA14.COD_GVA14" rebotó el 2026-09-17.
    expect(FILTROS.cliente('FC.280')).toBe("WHERE COD_GVA14 = 'FC.280'")
  })
})

describe('TangoClient.filas: las tres formas de lista que devuelve la API', () => {
  it('Get → resultData.list; GetByFilter → list; resultData como array; cualquier otra cosa → vacío', () => {
    expect(TangoClient.filas({ resultData: { list: [{ a: 1 }] } })).toEqual([{ a: 1 }])
    expect(TangoClient.filas({ list: [{ b: 2 }] })).toEqual([{ b: 2 }])
    expect(TangoClient.filas({ resultData: [{ c: 3 }] })).toEqual([{ c: 3 }])
    expect(TangoClient.filas({ resultData: { list: 'no' } })).toEqual([])
    expect(TangoClient.filas({})).toEqual([])
  })
})

describe('request', () => {
  it('arma la URL sin barra doble, manda token y empresa en los headers y el body solo en POST', async () => {
    respuestas = [{ body: { ok: 1 } }, { body: { ok: 2 } }]
    const c = cliente()
    await c.request(3, 'GET', 'Get', { process: 87, pageSize: 10, view: '' })
    await c.request('1', 'POST', 'Create', { process: 19845 }, { FECHA: 'x' })
    expect(llamadas[0]!.uri).toBe('https://001174-003.connect.axoft.com/Api/Get?process=87&pageSize=10&view=')
    expect(llamadas[0]!.init).toMatchObject({ method: 'GET', headers: { ApiAuthorization: 'TOKEN', Company: '3', 'Content-Type': 'application/json' } })
    expect(llamadas[0]!.init.body).toBeUndefined()
    expect(llamadas[1]!.uri).toBe('https://001174-003.connect.axoft.com/Api/Create?process=19845')
    expect(llamadas[1]!.init).toMatchObject({ method: 'POST', headers: { Company: '1' }, body: '{"FECHA":"x"}' })
  })

  it('un cuerpo que no es JSON es error (con el status y el principio del texto)', async () => {
    respuestas = [{ status: 502, texto: '<html>Bad gateway</html>' }]
    await expect(cliente().request(1, 'GET', 'Get')).rejects.toThrow('Tango respondió 502 con cuerpo no JSON en Get: <html>Bad gateway</html>')
  })

  it('un status de error usa el message de la API; succeeded=false junta los mensajes de exceptionInfo', async () => {
    respuestas = [{ status: 401, body: { message: 'token vencido' } }]
    await expect(cliente().request(1, 'GET', 'Get')).rejects.toThrow('Tango respondió 401 en Get: token vencido')
    respuestas = [{ body: { succeeded: false, exceptionInfo: { messages: ['multi-part identifier', 'could not be bound'] } } }]
    await expect(cliente().request(1, 'GET', 'GetByFilter')).rejects.toThrow('Tango succeeded=false en GetByFilter: multi-part identifier; could not be bound')
    respuestas = [{ body: { Succeeded: false, Message: 'sin permisos' } }]
    await expect(cliente().request(1, 'POST', 'Create')).rejects.toThrow('Tango succeeded=false en Create: sin permisos')
  })

  it('el Facturador devuelve succeeded=false con el detalle POR comprobante: eso NO se tira, lo interpreta el writer', async () => {
    const body = { Succeeded: false, Message: 'Hubo errores en la registración', Comprobantes: [{ numeroComprobante: 'A1', estado: 'Error', mensaje: '(51016) duplicado' }] }
    respuestas = [{ body }, { status: 400, body: { comprobantes: [] } }]
    expect(await cliente().registrarComprobantes(1, [{ x: 1 }])).toEqual(body)
    expect(await cliente().request(1, 'POST', 'FacturadorVenta/registrar')).toEqual({ comprobantes: [] })
    expect(llamadas[0]!.uri).toBe('https://001174-003.connect.axoft.com/Api/FacturadorVenta/registrar')
    expect(llamadas[0]!.init.body).toBe('[{"x":1}]')
  })
})

describe('getAll y live: paginan hasta totalPages', () => {
  it('Get: recorre las páginas y concatena; con una sola página, una llamada', async () => {
    respuestas = [
      { body: { resultData: { list: [{ id: 1 }, { id: 2 }], totalPages: 3 }, succeeded: true } },
      { body: { resultData: { list: [{ id: 3 }], totalPages: 3 } } },
      { body: { resultData: { list: [{ id: 4 }], totalPages: 3 } } },
    ]
    expect(await cliente().getAll(1, 87, 2)).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }])
    expect(llamadas.map((l) => new URL(l.uri).searchParams.get('pageIndex'))).toEqual(['0', '1', '2'])
    llamadas.length = 0
    respuestas = [{ body: { resultData: { list: [{ id: 9 }] } } }]
    expect(await cliente().getAll(1, 87)).toEqual([{ id: 9 }])
    expect(llamadas).toHaveLength(1)
    expect(new URL(llamadas[0]!.uri).searchParams.get('pageSize')).toBe('500')
  })

  it('live: customQuery=0 y las fechas tal cual (dd/MM/yyyy), paginando igual', async () => {
    respuestas = [{ body: { resultData: { list: [{ a: 1 }], totalPages: 2 } } }, { body: { resultData: { list: [{ a: 2 }], totalPages: 2 } } }]
    expect(await cliente().live(1, 1234, '01/09/2026', '30/09/2026')).toEqual([{ a: 1 }, { a: 2 }])
    const params = new URL(llamadas[0]!.uri).searchParams
    expect(llamadas[0]!.uri).toContain('/Api/GetApiLiveQueryData?')
    expect([params.get('process'), params.get('customQuery'), params.get('fromDate'), params.get('toDate')]).toEqual(['1234', '0', '01/09/2026', '30/09/2026'])
  })
})

describe('getByFilter, resolverId, getById, create', () => {
  it('resolverId toma el campo pedido de la primera fila y lo cachea por EMPRESA; sin filas devuelve null y no cachea', async () => {
    respuestas = [{ body: { list: [{ ID_STA22: 22, COD_STA22: '03' }] } }, { body: { list: [{ ID_STA22: 44 }] } }, { body: { list: [] } }, { body: { list: [{ ID_STA22: 45 }] } }]
    const c = cliente()
    expect(await c.resolverId(1, 'deposito:03', 2941, FILTROS.deposito('03'), 'ID_STA22')).toBe(22)
    expect(await c.resolverId(1, 'deposito:03', 2941, FILTROS.deposito('03'), 'ID_STA22')).toBe(22)   // caché: sin fetch
    expect(await c.resolverId(3, 'deposito:03', 2941, FILTROS.deposito('03'), 'ID_STA22')).toBe(44)   // otra empresa, otro id
    expect(await c.resolverId(1, 'deposito:99', 2941, FILTROS.deposito('99'), 'ID_STA22')).toBeNull()
    expect(await c.resolverId(1, 'deposito:99', 2941, FILTROS.deposito('99'), 'ID_STA22')).toBe(45)   // el null no quedó cacheado
    expect(llamadas).toHaveLength(4)
    expect(new URL(llamadas[0]!.uri).searchParams.get('filtroSql')).toBe("WHERE STA22.COD_STA22 = '03'")
  })

  it('resolverId cae al primer campo ID_* si el preferido no está; getById lee value (o resultData, o el doc entero)', async () => {
    respuestas = [{ body: { list: [{ COD: 'x', ID_MONEDA: 7 }] } }, { body: { value: { NRO_PEDIDO: 'P1' }, succeeded: true } }, { body: { resultData: { a: 1 } } }, { body: { b: 2 } }]
    const c = cliente()
    expect(await c.resolverId(1, 'moneda:PES', 1660, FILTROS.moneda('PES'), 'ID_QUE_NO_VIENE')).toBe(7)
    expect(await c.getById(1, 19845, 555)).toEqual({ NRO_PEDIDO: 'P1' })
    expect(await c.getById(1, 19845, 556)).toEqual({ a: 1 })
    expect(await c.getById(1, 19845, 557)).toEqual({ b: 2 })
    expect(new URL(llamadas[1]!.uri).searchParams.get('id')).toBe('555')
  })

  it('create es POST Api/Create?process=… con el body como JSON', async () => {
    respuestas = [{ body: { Succeeded: true, SavedId: 555 } }]
    expect(await cliente().create(1, 19845, { ID_GVA14: 5 })).toEqual({ Succeeded: true, SavedId: 555 })
    expect(llamadas[0]!.uri).toBe('https://001174-003.connect.axoft.com/Api/Create?process=19845')
    expect(llamadas[0]!.init).toMatchObject({ method: 'POST', body: '{"ID_GVA14":5}' })
  })
})
