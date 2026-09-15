import { describe, expect, it } from 'vitest'
import {
  avisoAnularEnTango, avisoSolicitudRecibo, marcaAnulada, reciboAnuladoEnIndice, transicionRecibo, urlDelCobrador, urlReemitirRecibo,
} from './anulacionCobranza'

const base = {
  origen: 'supervisor', numeroRecibo: 'RS-000168', reciboTango: 'X0110600000168', clienteNombre: 'COMBUSTIBLES SAN MARTIN S.R.L.',
  importe: 200000, motivo: 'cheque_equivocado', nota: 'el número era 00005747',
  solicitadoPor: { uid: 'sup', nombre: 'Matías Vinjoy' }, resueltaPor: { uid: 'aut', nombre: 'Facturación' }, fechaCobranza: '2026-09-15',
}

describe('transicionRecibo', () => {
  it('pendiente → aprobada anula; error → aprobada reintenta', () => {
    expect(transicionRecibo({ estado: 'pendiente' }, { estado: 'aprobada' })).toBe('anular')
    expect(transicionRecibo({ estado: 'error' }, { estado: 'aprobada' })).toBe('anular')
  })
  it('rechazo y nueva solicitud; el resto no hace nada', () => {
    expect(transicionRecibo({ estado: 'pendiente' }, { estado: 'rechazada' })).toBe('rechazar')
    expect(transicionRecibo({ estado: 'rechazada' }, { estado: 'pendiente' })).toBe('resolicitar')
    expect(transicionRecibo({ estado: 'aprobada' }, { estado: 'aprobada' })).toBeNull()
    expect(transicionRecibo({ estado: 'aprobada' }, { estado: 'rechazada' })).toBeNull()
    expect(transicionRecibo(undefined, { estado: 'pendiente' })).toBeNull()
  })
})

describe('avisos y rutas', () => {
  it('la push a los autorizantes dice recibo, cliente, importe, motivo y quién pidió', () => {
    const { titulo, cuerpo } = avisoSolicitudRecibo(base)
    expect(titulo).toBe('Anulación de recibo por autorizar')
    expect(cuerpo).toContain('RS-000168')
    expect(cuerpo).toContain('COMBUSTIBLES SAN MARTIN')
    expect(cuerpo).toContain('$200.000,00')
    expect(cuerpo).toContain('datos del cheque equivocados')
    expect(cuerpo).toContain('pidió Matías Vinjoy')
  })
  it('cada origen vuelve a su pantalla y reemite desde su cobro', () => {
    expect(urlDelCobrador({ origen: 'supervisor' })).toBe('/supervisor')
    expect(urlDelCobrador({ origen: 'cobrador' })).toBe('/chofer/cobrar')
    expect(urlDelCobrador({ origen: 'caja' })).toBe('/caja/cobranzas')
    expect(urlReemitirRecibo({ origen: 'supervisor' }, 'c1')).toBe('/supervisor/cobrar?reemitir=c1')
    expect(urlReemitirRecibo({ origen: 'cobrador' }, 'c1')).toBe('/chofer/cobrar?reemitir=c1')
  })
  it('la push a facturación nombra el recibo de Tango y quién autorizó', () => {
    const { cuerpo } = avisoAnularEnTango(base)
    expect(cuerpo).toContain('X0110600000168')
    expect(cuerpo).toContain('Facturación')
  })
})

describe('marcaAnulada', () => {
  it('deja motivo, quién autorizó y Tango pendiente de la oficina cuando el recibo ya estaba allá', () => {
    const m = marcaAnulada(base, 'c1', 'AHORA')
    expect(m).toMatchObject({ estado: 'anulada', solicitudId: 'c1', motivo: 'cheque_equivocado', anuladaPor: { uid: 'aut', nombre: 'Facturación' }, anuladaEn: 'AHORA', fechaCobranza: '2026-09-15', tango: { estado: 'pendiente_oficina' } })
  })
  it('sin recibo en Tango no hay nada que anular allá', () => {
    expect(marcaAnulada({ ...base, reciboTango: undefined }, 'c1', 0).tango).toEqual({ estado: 'no_aplica' })
  })
})

describe('reciboAnuladoEnIndice', () => {
  it('lee facturas[REC_<numero>].estado del índice del lector', () => {
    const idx = { facturas: { REC_X0110600000168: { estado: 'ANU' }, REC_X0110600000167: { estado: 'IMP' } } }
    expect(reciboAnuladoEnIndice(idx, 'X0110600000168')).toBe(true)
    expect(reciboAnuladoEnIndice(idx, 'x0110600000167')).toBe(false)
    expect(reciboAnuladoEnIndice(undefined, 'X0110600000168')).toBe(false)
  })
})
