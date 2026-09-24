import type { MailSaliente } from '@/types'
import type { TonoBadge } from '@/components/common/Badge'

// Lógica pura de la pantalla "Mails enviados" (2026-09-24): cómo se lee cada
// estado, el resumen del mes y los filtros. Sin Firebase; testeado en
// mailsSalientes.test.ts.

export type EstadoMailSaliente = MailSaliente['estado']

export const ETIQUETA_ESTADO: Record<EstadoMailSaliente, string> = {
  aceptado:  'Aceptado',
  entregado: 'Entregado',
  rebotado:  'Rebotó',
  queja:     'Marcado como spam',
  demorado:  'Demorado',
}

export const TONO_ESTADO: Record<EstadoMailSaliente, TonoBadge> = {
  aceptado:  'neutro',
  entregado: 'entregado',
  rebotado:  'cancelado',
  queja:     'cancelado',
  demorado:  'pendiente',
}

/** Qué quiere decir cada estado, para el tooltip: "aceptado" no es "llegó". */
export const EXPLICACION_ESTADO: Record<EstadoMailSaliente, string> = {
  aceptado:  'El proveedor lo tomó. Por SMTP no hay más noticias; por Resend, si no cambia a Entregado en unos minutos algo pasó.',
  entregado: 'El servidor del destinatario lo recibió.',
  rebotado:  'El servidor del destinatario lo rechazó: casilla inexistente, llena o bloqueada. Revisar el mail del cliente en Tango y reenviar.',
  queja:     'El destinatario lo marcó como correo no deseado. Conviene avisarle antes de mandarle otro.',
  demorado:  'El servidor del destinatario todavía no lo aceptó; el proveedor reintenta unas horas.',
}

export type FiltroEstado = 'todos' | 'problemas' | EstadoMailSaliente

export const OPCIONES_FILTRO_ESTADO: Array<{ value: FiltroEstado; label: string }> = [
  { value: 'todos',     label: 'Todos los estados' },
  { value: 'problemas', label: 'Rebotados y spam' },
  { value: 'entregado', label: 'Entregados' },
  { value: 'aceptado',  label: 'Aceptados sin confirmación' },
  { value: 'demorado',  label: 'Demorados' },
]

export const pasaFiltroEstado = (m: MailSaliente, filtro: FiltroEstado): boolean => {
  if (filtro === 'todos') return true
  if (filtro === 'problemas') return m.estado === 'rebotado' || m.estado === 'queja'
  return m.estado === filtro
}

export interface ResumenMails {
  total:      number
  entregados: number
  rebotados:  number
  quejas:     number
  demorados:  number
  aceptados:  number
  /** Salieron por el respaldo: el proveedor principal estaba caído. */
  porRespaldo: number
}

export function resumenMails(mails: MailSaliente[]): ResumenMails {
  const r: ResumenMails = { total: 0, entregados: 0, rebotados: 0, quejas: 0, demorados: 0, aceptados: 0, porRespaldo: 0 }
  for (const m of mails) {
    r.total++
    if (m.estado === 'entregado') r.entregados++
    else if (m.estado === 'rebotado') r.rebotados++
    else if (m.estado === 'queja') r.quejas++
    else if (m.estado === 'demorado') r.demorados++
    else r.aceptados++
    if (m.respaldo) r.porRespaldo++
  }
  return r
}

/** Un mail rebotado o marcado como spam que todavía no se corrigió (para el tile y la franja). */
export const esProblema = (m: Pick<MailSaliente, 'estado'>): boolean => m.estado === 'rebotado' || m.estado === 'queja'
