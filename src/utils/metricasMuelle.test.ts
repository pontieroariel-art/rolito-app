import { describe, it, expect } from 'vitest'
import {
  atencionDeVentanilla, duracion, esperaDeDescarga, esperaDeVentanilla,
  ocupacionDeDarsena, porDarsena, porFranjaHoraria, porGrupo, resumir, RESUMEN_VACIO,
} from './metricasMuelle'
import type { DescargaCamion, RemitoCarga, VentaVentanilla } from '../types'

const ts = (iso: string) => ({ toDate: () => new Date(iso), toMillis: () => new Date(iso).getTime() })
const m = (minutos: number, desde = '2026-09-13T10:00:00-03:00', grupo = 'Chofer', darsena?: number) =>
  ({ minutos, desde: new Date(desde), etiqueta: 'x', grupo, ...(darsena !== undefined ? { darsena } : {}) })

const remito = (extra: Record<string, unknown> = {}) => ({
  id: 'r1', codigo: 'RC-DT-000001', camionLabel: 'AB123CD', choferId: 'chof1', choferNombre: 'Chofer Uno',
  ...extra,
}) as unknown as RemitoCarga

const descarga = (extra: Record<string, unknown> = {}) => ({
  id: 'd1', choferId: 'chof1', choferNombre: 'Chofer Uno', fecha: ts('2026-09-13T18:30:00-03:00'),
  items: [], bolsasRotas: [], ...extra,
}) as unknown as DescargaCamion

const turno = (extra: Record<string, unknown> = {}) => ({
  id: 'v1', turno: 7, clienteNombre: 'Cliente SA', cajaNombre: 'Caja', fecha: ts('2026-09-13T09:00:00-03:00'),
  ...extra,
}) as unknown as VentaVentanilla

describe('resumir', () => {
  it('sin muestras devuelve el vacío, no NaN', () => {
    expect(resumir([])).toEqual(RESUMEN_VACIO)
  })

  it('da promedio, mediana, p90 y máximo: un colgado no tapa el día normal', () => {
    // Nueve descargas de ~10 min y una de 300: el promedio se va a 39, pero la
    // mediana sigue diciendo que el día fue normal.
    const muestras = [10, 10, 10, 10, 10, 10, 10, 10, 10, 300].map((x) => m(x))
    const r = resumir(muestras)
    expect(r.cantidad).toBe(10)
    expect(r.promedio).toBe(39)
    expect(r.mediana).toBe(10)
    expect(r.p90).toBe(10)
    expect(r.maximo).toBe(300)
  })
})

describe('espera de descarga', () => {
  it('mide desde que el camión volvió hasta que lo contaron', () => {
    const r = remito({ regreso: { uid: 'seg', nombre: 'Seguridad', hora: ts('2026-09-13T18:00:00-03:00') } })
    const [x] = esperaDeDescarga([r], [descarga({ remitoId: 'r1' })])
    expect(x.minutos).toBe(30)
    expect(x.etiqueta).toContain('RC-DT-000001')
    expect(x.grupo).toBe('Chofer Uno')
  })

  it('sin remitoId (descargas viejas) toma el último regreso de ese chofer anterior al conteo', () => {
    const manana = remito({ id: 'r1', regreso: { hora: ts('2026-09-13T11:00:00-03:00') } })
    const tarde  = remito({ id: 'r2', codigo: 'RC-DT-000002', regreso: { hora: ts('2026-09-13T18:00:00-03:00') } })
    const [x] = esperaDeDescarga([manana, tarde], [descarga()])
    expect(x.minutos).toBe(30)
    expect(x.etiqueta).toContain('RC-DT-000002')
  })

  it('sin regreso marcado no inventa una muestra', () => {
    expect(esperaDeDescarga([remito()], [descarga({ remitoId: 'r1' })])).toEqual([])
  })

  it('un conteo rectificado no cuenta dos veces', () => {
    const r = remito({ regreso: { hora: ts('2026-09-13T18:00:00-03:00') } })
    const ds = [
      descarga({ id: 'd1', remitoId: 'r1' }),
      descarga({ id: 'd2', remitoId: 'r1', rectificaA: 'd1', fecha: ts('2026-09-13T19:00:00-03:00') }),
    ]
    const r2 = esperaDeDescarga([r], ds)
    expect(r2).toHaveLength(1)
    expect(r2[0].minutos).toBe(60)
  })

  it('descarta lo imposible: conteo anterior al regreso, o más de un día', () => {
    const alReves = remito({ regreso: { hora: ts('2026-09-13T19:00:00-03:00') } })
    expect(esperaDeDescarga([alReves], [descarga({ remitoId: 'r1' })])).toEqual([])
    const viejisimo = remito({ regreso: { hora: ts('2026-09-10T10:00:00-03:00') } })
    expect(esperaDeDescarga([viejisimo], [descarga({ remitoId: 'r1' })])).toEqual([])
  })
})

describe('ocupación de dársena', () => {
  it('cuenta desde que se asignó la dársena', () => {
    const r = remito({
      darsena: 2,
      darsenaAsignadaEn: ts('2026-09-13T07:00:00-03:00'),
      entregadoPor: { hora: ts('2026-09-13T07:40:00-03:00') },
      salida: { hora: ts('2026-09-13T08:00:00-03:00') },
    })
    const [x] = ocupacionDeDarsena([r])
    expect(x.minutos).toBe(60)
    expect(x.darsena).toBe(2)
  })

  it('en los remitos viejos, sin hora de dársena, arranca en la entrega', () => {
    const r = remito({
      entregadoPor: { hora: ts('2026-09-13T07:40:00-03:00') },
      salida: { hora: ts('2026-09-13T08:00:00-03:00') },
    })
    expect(ocupacionDeDarsena([r])[0].minutos).toBe(20)
  })

  it('el camión que todavía no salió no entra', () => {
    expect(ocupacionDeDarsena([remito({ entregadoPor: { hora: ts('2026-09-13T07:40:00-03:00') } })])).toEqual([])
  })
})

describe('ventanilla', () => {
  it('separa la espera del turno de la atención del muelle', () => {
    const v = turno({
      llamadoAt: ts('2026-09-13T09:25:00-03:00'),
      entregadoPor: { hora: ts('2026-09-13T09:33:00-03:00') },
      darsena: 4,
    })
    expect(esperaDeVentanilla([v])[0].minutos).toBe(25)
    expect(atencionDeVentanilla([v])[0].minutos).toBe(8)
    expect(atencionDeVentanilla([v])[0].darsena).toBe(4)
  })

  it('el turno que se fue sin que lo llamen no genera atención', () => {
    expect(atencionDeVentanilla([turno()])).toEqual([])
    expect(esperaDeVentanilla([turno()])).toEqual([])
  })
})

describe('agrupaciones', () => {
  it('por franja horaria, ordenadas y solo las horas con datos', () => {
    const r = porFranjaHoraria([
      m(10, '2026-09-13T07:10:00-03:00'),
      m(30, '2026-09-13T07:50:00-03:00'),
      m(5,  '2026-09-13T15:00:00-03:00'),
    ])
    expect(r.map((x) => x.hora)).toEqual([7, 15])
    expect(r[0].resumen.cantidad).toBe(2)
    expect(r[0].resumen.promedio).toBe(20)
  })

  it('por grupo, del más lento al más rápido (es el orden en que se mira)', () => {
    const r = porGrupo([m(10, undefined, 'Rápido'), m(90, undefined, 'Lento'), m(80, undefined, 'Lento')])
    expect(r.map((x) => x.grupo)).toEqual(['Lento', 'Rápido'])
    expect(r[0].resumen.cantidad).toBe(2)
  })

  it('por dársena, ignorando las muestras sin boca', () => {
    const r = porDarsena([m(10, undefined, 'a', 2), m(20, undefined, 'b', 1), m(5, undefined, 'c')])
    expect(r.map((x) => x.darsena)).toEqual([1, 2])
  })
})

describe('duracion', () => {
  it('los minutos de tres cifras se leen en horas', () => {
    expect(duracion(18)).toBe('18 min')
    expect(duracion(60)).toBe('1 h')
    expect(duracion(85)).toBe('1 h 25 min')
    expect(duracion(0)).toBe('0 min')
  })
})
