import { describe, it, expect, vi } from 'vitest'
import {
  feDummy,
  feCompUltimoAutorizado,
  feCompConsultar,
  feCaeSolicitar,
  parsearErrores,
  parsearObservaciones,
  ArcaError,
  WSFEV1_URL,
} from './wsfev1'
import type { ConfigWsfev1 } from './wsfev1'
import type { FECAEDetRequest } from './comprobante'

/** Arma un config con un transporte falso que devuelve el XML dado. */
function configCon(xml: string, ok = true, status = 200) {
  const fetchImpl = vi.fn(async () => ({ ok, status, text: async () => xml }))

  const cfg: ConfigWsfev1 = {
    ambiente: 'homologacion',
    credenciales: { token: 'TK', sign: 'SG', cuit: '30697668973' },
    fetchImpl,
  }
  return { cfg, fetchImpl }
}

const detalle: FECAEDetRequest = {
  Concepto: 1,
  DocTipo: 80,
  DocNro: 30697668973,
  CbteDesde: 42,
  CbteHasta: 42,
  CbteFch: '20260910',
  ImpTotal: 12100,
  ImpTotConc: 0,
  ImpNeto: 10000,
  ImpOpEx: 0,
  ImpTrib: 0,
  ImpIVA: 2100,
  MonId: 'PES',
  MonCotiz: 1,
  CondicionIVAReceptorId: 1,
  Iva: [{ Id: 5, BaseImp: 10000, Importe: 2100 }],
}

describe('parseo de errores y observaciones', () => {
  it('extrae varios errores', () => {
    const xml = `<Errors><Err><Code>600</Code><Msg>No se corresponden token y firma</Msg></Err>
                 <Err><Code>601</Code><Msg>CUIT no incluida</Msg></Err></Errors>`
    expect(parsearErrores(xml)).toEqual([
      { code: 600, msg: 'No se corresponden token y firma' },
      { code: 601, msg: 'CUIT no incluida' },
    ])
  })

  it('sin bloque de errores devuelve lista vacía', () => {
    expect(parsearErrores('<algo/>')).toEqual([])
  })

  it('extrae observaciones (comprobante aprobado pero con reparos)', () => {
    const xml = `<Observaciones><Obs><Code>10063</Code><Msg>In cuit</Msg></Obs></Observaciones>`
    expect(parsearObservaciones(xml)).toEqual([{ code: 10063, msg: 'In cuit' }])
  })
})

describe('feDummy', () => {
  it('lee el estado de los tres servidores', async () => {
    const { cfg } = configCon(
      `<FEDummyResult><AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer></FEDummyResult>`,
    )
    expect(await feDummy(cfg)).toEqual({ appServer: 'OK', dbServer: 'OK', authServer: 'OK' })
  })
})

describe('feCompUltimoAutorizado', () => {
  it('devuelve el último número emitido', async () => {
    const { cfg, fetchImpl } = configCon('<FECompUltimoAutorizadoResult><CbteNro>1234</CbteNro></FECompUltimoAutorizadoResult>')
    expect(await feCompUltimoAutorizado(cfg, 5, 1)).toBe(1234)

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(WSFEV1_URL.homologacion)
    expect((init as RequestInit).body).toContain('<ar:PtoVta>5</ar:PtoVta>')
    expect((init as RequestInit).body).toContain('<ar:Token>TK</ar:Token>')
  })

  it('un punto de venta sin comprobantes devuelve 0 (el primero será el 1)', async () => {
    const { cfg } = configCon('<FECompUltimoAutorizadoResult><CbteNro>0</CbteNro></FECompUltimoAutorizadoResult>')
    expect(await feCompUltimoAutorizado(cfg, 9, 1)).toBe(0)
  })
})

describe('feCompConsultar (idempotencia)', () => {
  it('reconoce un comprobante ya emitido', async () => {
    const { cfg } = configCon(`<ResultGet>
      <CodAutorizacion>75123456789012</CodAutorizacion>
      <FchVto>20260920</FchVto><CbteFch>20260910</CbteFch><ImpTotal>12100</ImpTotal>
    </ResultGet>`)
    const r = await feCompConsultar(cfg, 5, 1, 42)
    expect(r.existe).toBe(true)
    expect(r.cae).toBe('75123456789012')
    expect(r.impTotal).toBe(12100)
  })

  it('el vencimiento del CAE no se contamina con los tags vecinos', async () => {
    // Recorte de la respuesta REAL de producción al consultar la primera
    // factura (1104-00000001, 2026-09-02). `FchVtoPago` viene ANTES que
    // `FchVto` y empieza igual: buscar `FchVto` sin exigir el espacio de los
    // atributos enganchaba la de pago y devolvía medio comprobante como si
    // fuera la fecha. Después eso se guardaba en la factura y el PDF del
    // chofer se negaba a armarse.
    const { cfg } = configCon(`<ResultGet>
      <CbteFch>20260902</CbteFch><FchVtoPago></FchVtoPago><ImpTotal>1.27</ImpTotal>
      <MonId>PES</MonId><MonCotiz>1</MonCotiz>
      <Tributos><Tributo><Id>7</Id><Desc>Percepción IIBB CABA</Desc><Importe>0.06</Importe></Tributo></Tributos>
      <Resultado>A</Resultado>
      <CodAutorizacion>86351147350772</CodAutorizacion><EmisionTipo>CAE</EmisionTipo><FchVto>20260912</FchVto>
    </ResultGet>`)

    const r = await feCompConsultar(cfg, 1104, 1, 1)
    expect(r.cae).toBe('86351147350772')
    expect(r.caeFchVto).toBe('20260912')
    expect(r.cbteFch).toBe('20260902')
    expect(r.impTotal).toBe(1.27)
  })

  it('el error 602 significa "no existe", no una falla', async () => {
    const { cfg } = configCon('<Errors><Err><Code>602</Code><Msg>No existen datos en nuestros registros</Msg></Err></Errors>')
    expect(await feCompConsultar(cfg, 5, 1, 999)).toEqual({ existe: false })
  })

  it('otros errores sí se propagan', async () => {
    const { cfg } = configCon('<Errors><Err><Code>600</Code><Msg>Token invalido</Msg></Err></Errors>')
    await expect(feCompConsultar(cfg, 5, 1, 42)).rejects.toThrow(ArcaError)
  })
})

describe('feCaeSolicitar', () => {
  it('devuelve el CAE cuando ARCA aprueba', async () => {
    const { cfg, fetchImpl } = configCon(`<FECAESolicitarResult>
      <FeCabResp><Resultado>A</Resultado></FeCabResp>
      <FeDetResp><FECAEDetResponse>
        <CbteDesde>42</CbteDesde><Resultado>A</Resultado>
        <CAE>75123456789012</CAE><CAEFchVto>20260920</CAEFchVto>
      </FECAEDetResponse></FeDetResp>
    </FECAESolicitarResult>`)

    const r = await feCaeSolicitar(cfg, 5, 1, detalle)
    expect(r.resultado).toBe('A')
    expect(r.cae).toBe('75123456789012')
    expect(r.caeFchVto).toBe('20260920')
    expect(r.cbteDesde).toBe(42)

    const body = (fetchImpl.mock.calls[0][1] as RequestInit).body as string
    expect(body).toContain('<ar:CantReg>1</ar:CantReg>')
    expect(body).toContain('<ar:CondicionIVAReceptorId>1</ar:CondicionIVAReceptorId>')
    expect(body).toContain('<ar:AlicIva><ar:Id>5</ar:Id><ar:BaseImp>10000</ar:BaseImp><ar:Importe>2100</ar:Importe></ar:AlicIva>')
  })

  it('conserva las observaciones de un comprobante aprobado con reparos', async () => {
    const { cfg } = configCon(`<FECAESolicitarResult><FeDetResp><FECAEDetResponse>
      <Resultado>A</Resultado><CAE>75123456789012</CAE><CAEFchVto>20260920</CAEFchVto>
      <Observaciones><Obs><Code>10063</Code><Msg>Revisar domicilio</Msg></Obs></Observaciones>
    </FECAEDetResponse></FeDetResp></FECAESolicitarResult>`)

    const r = await feCaeSolicitar(cfg, 5, 1, detalle)
    expect(r.cae).toBe('75123456789012')
    expect(r.observaciones).toEqual([{ code: 10063, msg: 'Revisar domicilio' }])
  })

  it('falla cuando ARCA rechaza, explicando el motivo', async () => {
    const { cfg } = configCon(`<FECAESolicitarResult><FeDetResp><FECAEDetResponse>
      <Resultado>R</Resultado><CAE></CAE>
      <Observaciones><Obs><Code>10016</Code><Msg>El numero de comprobante no es correlativo</Msg></Obs></Observaciones>
    </FECAEDetResponse></FeDetResp></FECAESolicitarResult>`)

    await expect(feCaeSolicitar(cfg, 5, 1, detalle)).rejects.toThrow(/no es correlativo/)
  })

  it('convierte un SOAP Fault en ArcaError', async () => {
    const { cfg } = configCon('<soapenv:Fault><faultstring>Server was unable to process</faultstring></soapenv:Fault>', false, 500)
    await expect(feCaeSolicitar(cfg, 5, 1, detalle)).rejects.toThrow(/unable to process/)
  })

  it('escapa el XML de las credenciales en vez de romper el sobre', async () => {
    const { cfg, fetchImpl } = configCon('<FEDummyResult><AppServer>OK</AppServer></FEDummyResult>')
    cfg.credenciales.token = 'a<b&c"d'
    await feDummy({ ...cfg, credenciales: cfg.credenciales })
    // FEDummy no manda Auth; se verifica con el que sí lo hace.
    const { cfg: cfg2, fetchImpl: f2 } = configCon('<FECompUltimoAutorizadoResult><CbteNro>1</CbteNro></FECompUltimoAutorizadoResult>')
    cfg2.credenciales.token = 'a<b&c"d'
    await feCompUltimoAutorizado(cfg2, 1, 1)
    const body = (f2.mock.calls[0][1] as RequestInit).body as string
    expect(body).toContain('a&lt;b&amp;c&quot;d')
    expect(fetchImpl).toHaveBeenCalled()
  })
})
