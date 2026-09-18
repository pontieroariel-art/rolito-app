import { describe, it, expect } from 'vitest'
import { armarBuzon, buscarSobre } from './buzon'
import type { CierreMercaderia, Liquidacion } from '../types'

const ts = (iso: string) => {
  const d = new Date(iso)
  return { toDate: () => d, toMillis: () => d.getTime() }
}

const cierre = (remitoId: string, horasAtras: number, extra: Partial<CierreMercaderia> = {}): CierreMercaderia => ({
  id: remitoId,
  remitoId,
  remitoCodigo: `RC-DT-${remitoId}`,
  plantaId: 'torcuato',
  choferId: 'dep:21',
  choferNombre: 'Armando Mira',
  diaReparto: '2026-09-18',
  productos: [],
  envases: {} as CierreMercaderia['envases'],
  faltante: { bolsasFaltantes: 0, bolsasSobrantes: 0, productos: [], grave: false, umbral: 10 },
  descargaIds: ['d1'],
  descargaCodigos: [`DC-DT-00${remitoId}`],
  contadaPor: { uid: 'muelle1', nombre: 'Jorge' },
  contadaEn: ts(new Date(Date.parse('2026-09-19T08:00:00Z') - horasAtras * 3_600_000).toISOString()) as CierreMercaderia['contadaEn'],
  ...extra,
})

const ahora = new Date('2026-09-19T08:00:00Z')
const liquidacion = {} as Liquidacion

describe('armarBuzon', () => {
  it('un viaje contado anoche y sin liquidar es un sobre esperado', () => {
    const b = armarBuzon([cierre('a', 12)], new Map(), ahora)
    expect(b.esperados).toHaveLength(1)
    expect(b.sinAparecer).toHaveLength(0)
    expect(b.recibidos).toHaveLength(0)
    expect(b.esperados[0].descargaCodigo).toBe('DC-DT-00a')
  })

  it('pasadas las horas de gracia, el sobre pasa a faltar', () => {
    const b = armarBuzon([cierre('a', 30)], new Map(), ahora)
    expect(b.sinAparecer).toHaveLength(1)
    expect(b.esperados).toHaveLength(0)
  })

  it('un viaje ya liquidado cuenta como recibido y no se reclama', () => {
    const b = armarBuzon([cierre('a', 30)], new Map([['a', liquidacion]]), ahora)
    expect(b.recibidos).toHaveLength(1)
    expect(b.sinAparecer).toHaveLength(0)
  })

  it('lo que falta se ordena por antigüedad: primero el que hay que ir a buscar', () => {
    const b = armarBuzon([cierre('nuevo', 20), cierre('viejo', 72)], new Map(), ahora)
    expect(b.sinAparecer.map((f) => f.remitoId)).toEqual(['viejo', 'nuevo'])
  })

  it('un chofer con dos sobres sin liquidar queda avisado; con uno no', () => {
    const unSolo = armarBuzon([cierre('a', 12)], new Map(), ahora)
    expect(unSolo.conArrastre).toHaveLength(0)

    const arrastre = armarBuzon([cierre('a', 12), cierre('b', 36)], new Map(), ahora)
    expect(arrastre.conArrastre).toEqual([{ choferId: 'dep:21', choferNombre: 'Armando Mira', pendientes: 2 }])
  })

  it('el aviso es por chofer, no por planta: dos choferes con uno cada uno no avisan', () => {
    const b = armarBuzon(
      [cierre('a', 12), cierre('b', 12, { choferId: 'dep:22', choferNombre: 'Otro' })],
      new Map(),
      ahora,
    )
    expect(b.conArrastre).toHaveLength(0)
  })

  it('un sobre liquidado no cuenta para el arrastre', () => {
    const b = armarBuzon([cierre('a', 12), cierre('b', 36)], new Map([['b', liquidacion]]), ahora)
    expect(b.conArrastre).toHaveLength(0)
  })
})

describe('buscarSobre', () => {
  const filas = armarBuzon([cierre('a', 12), cierre('b', 12, { choferNombre: 'Cristian Petti' })], new Map(), ahora).esperados

  it('encuentra por el código de la descarga aunque lo hayan escrito sin guiones', () => {
    expect(buscarSobre(filas, 'dcdt00a')).toHaveLength(1)
    expect(buscarSobre(filas, 'DC-DT-00a')).toHaveLength(1)
  })

  it('encuentra por el código del remito y por el nombre del chofer', () => {
    expect(buscarSobre(filas, 'RC-DT-b')).toHaveLength(1)
    expect(buscarSobre(filas, 'petti')).toHaveLength(1)
  })

  it('sin texto devuelve todo', () => {
    expect(buscarSobre(filas, '   ')).toHaveLength(2)
  })
})
