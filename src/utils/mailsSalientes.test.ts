import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import type { MailSaliente } from '@/types'
import { esProblema, pasaFiltroEstado, resumenMails } from './mailsSalientes'

const mail = (estado: MailSaliente['estado'], extra: Partial<MailSaliente> = {}): MailSaliente => ({
  id: `resend_${estado}`, proveedor: 'resend', para: ['a@b.com'], asunto: 'Factura', tipo: 'comprobante', adjuntos: 1,
  estado, fecha: Timestamp.fromDate(new Date('2026-09-24T12:00:00Z')), ...extra,
})

describe('mailsSalientes', () => {
  it('resume el mes por estado y cuenta los que salieron por el respaldo', () => {
    const r = resumenMails([
      mail('entregado'), mail('entregado'), mail('rebotado'), mail('queja'), mail('demorado'),
      mail('aceptado', { proveedor: 'smtp', respaldo: 'smtp', errorPrimero: 'resend: 429' }),
    ])
    expect(r).toEqual({ total: 6, entregados: 2, rebotados: 1, quejas: 1, demorados: 1, aceptados: 1, porRespaldo: 1 })
  })

  it('el filtro "problemas" junta rebotados y spam; los demás son exactos', () => {
    expect(pasaFiltroEstado(mail('rebotado'), 'problemas')).toBe(true)
    expect(pasaFiltroEstado(mail('queja'), 'problemas')).toBe(true)
    expect(pasaFiltroEstado(mail('entregado'), 'problemas')).toBe(false)
    expect(pasaFiltroEstado(mail('aceptado'), 'aceptado')).toBe(true)
    expect(pasaFiltroEstado(mail('aceptado'), 'entregado')).toBe(false)
    expect(pasaFiltroEstado(mail('demorado'), 'todos')).toBe(true)
  })

  it('un problema es rebote o queja; aceptado, entregado y demorado no', () => {
    expect(esProblema({ estado: 'rebotado' })).toBe(true)
    expect(esProblema({ estado: 'queja' })).toBe(true)
    expect(esProblema({ estado: 'aceptado' })).toBe(false)
    expect(esProblema({ estado: 'demorado' })).toBe(false)
  })
})
