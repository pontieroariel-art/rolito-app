import type { Cobranza, EmpresaTango, Liquidacion, Sobre, VentaVentanilla } from '@/types'
import { chequesDe, efectivoDe, retencionesDe, textoCheque, transferenciaDe } from './medios'
import { empresaDeCobranza, empresaDeVenta } from './liquidacion'
import { importeCobrado } from './importeCobrado'
import { nombreClienteVenta } from './nombreClienteVenta'
import { numeroComprobanteVenta } from './numeroComprobanteVenta'
import { empresaDeAnticipo } from './sobres'
import { horaCorta } from './turnoCaja'

// El acta del sobre IGUAL a la pantalla de Liquidación de caja (2026-09-24,
// pedido de Ariel): los mismos bloques, en el mismo orden, con las mismas
// tres columnas (Redonhielo · Rolito · Total). Lógica pura: arma las filas,
// el PDF solo las dibuja. Testeado en actaComoPantalla.test.ts.

export interface FilaActa {
  texto:     string
  redonhielo: number | null
  rolito:     number | null
  /** Solo las liquidaciones traen total propio (plata de las dos empresas). */
  total?:     number
  /** Anticipos: restan y van en rojo. */
  resta?:     boolean
  tachado?:   boolean
}

export interface BloqueActa {
  titulo:    string
  cantidad:  number
  filas:     FilaActa[]
  redonhielo: number
  rolito:     number
  total:      number
  resta?:     boolean
  vacio:      string
}

export interface SeccionActa { titulo: string; bloques: BloqueActa[] }

interface Fuentes {
  sobre:         Sobre
  ventas:        VentaVentanilla[]
  cobranzas:     Cobranza[]
  liquidaciones: Liquidacion[]
  anticipos:     Sobre[]
}

const porFecha = <T extends { fecha: { toMillis(): number } }>(xs: T[]) => xs.slice().sort((a, b) => a.fecha.toMillis() - b.fecha.toMillis())
const vigente = (x: { anulacion?: { estado?: string } }) => x.anulacion?.estado !== 'anulada'

function bloque(titulo: string, filas: FilaActa[], vacio: string, resta = false): BloqueActa {
  const suma = (k: 'redonhielo' | 'rolito') => filas.filter((f) => !f.tachado).reduce((s, f) => s + (f[k] ?? 0), 0)
  const redonhielo = suma('redonhielo'), rolito = suma('rolito')
  return { titulo, cantidad: filas.filter((f) => !f.tachado).length, filas, redonhielo, rolito, total: redonhielo + rolito, resta, vacio }
}

const fila = (texto: string, empresa: EmpresaTango, importe: number, extra: Partial<FilaActa> = {}): FilaActa =>
  ({ texto, redonhielo: empresa === 'redonhielo' ? importe : null, rolito: empresa === 'rolito' ? importe : null, ...extra })

const textoVenta = (v: VentaVentanilla) => `${horaCorta(v.fecha)}  ${nombreClienteVenta(v)} · ${v.canal === 'promo' ? 'promo' : 'contado'}${numeroComprobanteVenta(v) ? ` · ${numeroComprobanteVenta(v)}` : ''}${vigente(v) ? '' : ' · ANULADA'}`
const claveCob = (c: Cobranza) => c.numeroRecibo ?? horaCorta(c.fecha)
const codigoLiq = (l: Liquidacion) => (l.codigo ? l.codigo.replace(/^LQ-/, 'LQ ').replace(/-0+/, '-') : l.id)

/** Las dos secciones de la pantalla, con sus bloques y filas, listas para dibujar. */
export function seccionesDelActa(f: Fuentes): SeccionActa[] {
  const ventas = porFecha(f.ventas)
  const cobranzas = porFecha(f.cobranzas)
  const liqs = f.liquidaciones.slice().sort((a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0))

  const ventasEf = bloque('Ventas de ventanilla en efectivo',
    ventas.filter((v) => v.formaPago === 'contado_efectivo').map((v) => fila(textoVenta(v), empresaDeVenta(v), importeCobrado(v), { tachado: !vigente(v) })),
    'Sin ventas en efectivo en este turno.')

  const cobEf = bloque('Cobranzas de mostrador en efectivo',
    cobranzas.filter((c) => !vigente(c) || efectivoDe(c) > 0).map((c) => fila(`${claveCob(c)}  ${c.clienteNombre}${vigente(c) ? '' : ' · ANULADO'}`, empresaDeCobranza(c), efectivoDe(c), { tachado: !vigente(c) })),
    'Sin cobranzas en efectivo en este turno.')

  const cobCh = bloque('Cobranzas de mostrador en cheques',
    cobranzas.flatMap((c) => chequesDe(c).map((ch) => fila(`${claveCob(c)}  ${c.clienteNombre} · ${textoCheque(ch)}${vigente(c) ? '' : ' · ANULADO'}`, empresaDeCobranza(c), ch.importe, { tachado: !vigente(c) }))),
    'Sin cheques de mostrador en este turno.')

  const liqEf = bloque('Liquidaciones de choferes y cobradores en efectivo',
    liqs.map((l) => ({
      texto: `${codigoLiq(l)}  ${l.choferNombre}${l.createdAt ? ` · ${horaCorta(l.createdAt)}` : ''}${l.diferenciaEfectivo ? ` · diferencia ${l.diferenciaEfectivo > 0 ? '+' : ''}${l.diferenciaEfectivo}` : ''}`,
      redonhielo: l.conteoBilletes ? l.conteoBilletes.redonhielo.total : l.efectivoRecibido,
      rolito:     l.conteoBilletes ? l.conteoBilletes.rolito.total : null,
      total:      l.efectivoRecibido,
    })),
    'Ninguna liquidación recibida en este turno.')

  const liqCh = bloque('Liquidaciones de choferes y cobradores en cheques',
    liqs.flatMap((l) => (l.cheques ?? []).filter((ch) => ch.recibido !== false).map((ch) => fila(`${ch.numeroRecibo ?? codigoLiq(l)}  ${ch.clienteNombre} · ${textoCheque(ch)} · cobró ${l.choferNombre}`, ch.empresa ?? 'redonhielo', ch.importe))),
    'Ningún cheque recibido con las liquidaciones de este turno.')

  const anticipos = bloque('Anticipos a tesorería',
    f.anticipos.map((a) => fila(`${a.codigo}  recibió ${a.entrega?.recibio.nombre ?? a.custodia.nombre} · ${horaCorta(a.cerradaEn)}${a.recepcion ? ' · ya contado por tesorería' : ''}`, empresaDeAnticipo(a), a.sistema.efectivo, { resta: true })),
    'Ningún anticipo en este turno.', true)

  const ventasCC = bloque('Ventas en cuenta corriente',
    ventas.filter((v) => v.formaPago === 'cuenta_corriente' && vigente(v)).map((v) => fila(textoVenta(v), empresaDeVenta(v), importeCobrado(v))),
    'Sin ventas en cuenta corriente en este turno.')

  const transferencias = bloque('Transferencias',
    [
      ...ventas.filter((v) => v.formaPago === 'contado_transferencia' && vigente(v)).map((v) => ({ fecha: v.fecha, f: fila(`${textoVenta(v)} · venta`, empresaDeVenta(v), importeCobrado(v)) })),
      ...cobranzas.filter((c) => vigente(c) && transferenciaDe(c) > 0).map((c) => ({ fecha: c.fecha, f: fila(`${claveCob(c)}  ${c.clienteNombre} · cobranza de mostrador`, empresaDeCobranza(c), transferenciaDe(c)) })),
    ].sort((a, b) => a.fecha.toMillis() - b.fecha.toMillis()).map((x) => x.f),
    'Sin transferencias en este turno.')

  const retenciones = bloque('Retenciones',
    [
      ...cobranzas.filter(vigente).flatMap((c) => retencionesDe(c).map((re) => fila(`${claveCob(c)}  ${c.clienteNombre} · retención ${re.tipo.toUpperCase().replace('_', ' ')} · certificado ${re.nroCertificado}`, empresaDeCobranza(c), re.importe))),
      ...liqs.flatMap((l) => (l.retenciones ?? []).filter((re) => re.recibido !== false).map((re) => fila(`${re.numeroRecibo ?? codigoLiq(l)}  ${re.clienteNombre} · retención ${re.tipo.toUpperCase().replace('_', ' ')} · certificado ${re.nroCertificado} · cobró ${l.choferNombre}`, re.empresa ?? 'redonhielo', re.importe))),
    ],
    'Sin retenciones en este turno.')

  return [
    { titulo: 'LO LÍQUIDO · EFECTIVO Y CHEQUES', bloques: [ventasEf, cobEf, cobCh, liqEf, liqCh, anticipos] },
    { titulo: 'NO ENTRA A LA CAJA · SE REGISTRA, NO SE RINDE', bloques: [ventasCC, transferencias, retenciones] },
  ]
}

/** Las tres celdas del cajón por empresa (Efectivo · Cheques · Total), como las tarjetas de la pantalla. */
export function cajonPorEmpresa(s: Sobre): Record<EmpresaTango, { efectivo: number; cheques: number; nCheques: number; total: number }> | null {
  const pe = s.sistema.porEmpresa
  if (!pe) return null
  const de = (e: EmpresaTango) => {
    const cheques = s.sistema.cheques.filter((c) => (c.empresa ?? 'redonhielo') === e)
    const ch = cheques.reduce((x, c) => x + c.importe, 0)
    return { efectivo: pe[e].efectivo, cheques: ch, nCheques: cheques.length, total: pe[e].efectivo + ch }
  }
  return { redonhielo: de('redonhielo'), rolito: de('rolito') }
}
