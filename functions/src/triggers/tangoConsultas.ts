import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

// Cuando el bridge responde una consulta on-demand de saldo (tango-consultas,
// estado → 'respondida'), copia el resultado al cache saldosTango/{clienteUid}.
// El bridge NUNCA escribe saldosTango directo (sus reglas solo lo dejan tocar
// los campos de estado de la consulta) — esta Function es el único camino,
// igual que onOutboxConfirmado con los write-backs del outbox.

function redondear2(n: number): number {
  return Math.round(n * 100) / 100
}

interface ComprobanteConsulta {
  tipo?: string
  numero?: string
  fechaEmision?: string
  fechaVencimiento?: string
  importeOriginal?: number
  saldoPendiente?: number
  idComprobanteTango?: number
  diasAtraso?: number
}

export const onConsultaRespondida = onDocumentUpdated('tango-consultas/{consultaId}', async (event) => {
  const before = event.data?.before.data()
  const after = event.data?.after.data()
  if (!before || !after) return
  if (after.estado !== 'respondida' || before.estado === 'respondida') return
  if (after.tipo !== 'saldoCliente') return
  if (typeof after.clienteUid !== 'string' || !after.clienteUid) return

  const db = getFirestore()
  const userSnap = await db.collection('users').doc(after.clienteUid).get()
  const user = userSnap.data()
  if (!user || user.rol !== 'cliente') {
    console.warn(`[onConsultaRespondida] ${event.params.consultaId}: clienteUid ${after.clienteUid} no es un cliente — se ignora`)
    return
  }

  const crudos = Array.isArray(after.resultado?.comprobantes) ? (after.resultado.comprobantes as ComprobanteConsulta[]) : []
  let comprobantes = crudos.map((c) => ({
    tipo:            String(c.tipo ?? ''),
    numero:          String(c.numero ?? ''),
    fechaEmision:    String(c.fechaEmision ?? ''),
    ...(c.fechaVencimiento ? { fechaVencimiento: String(c.fechaVencimiento) } : {}),
    importeOriginal: redondear2(Number(c.importeOriginal ?? c.saldoPendiente ?? 0)),
    saldoPendiente:  redondear2(Number(c.saldoPendiente ?? 0)),
    ...(typeof c.idComprobanteTango === 'number' ? { idComprobanteTango: c.idComprobanteTango } : {}),
    ...(typeof c.diasAtraso === 'number' && c.diasAtraso > 0 ? { diasAtraso: c.diasAtraso } : {}),
  }))

  // Igual que el sync periódico (tangoSaldos.ts): re-aplicar los descuentos de
  // cobranzas de supervisor que Tango todavía no vio (tango.estado !=
  // 'confirmado') — si no, el refresh "resucitaría" deuda ya cobrada en la
  // calle mientras el writer de recibos no esté habilitado.
  const desde = new Date()
  desde.setDate(desde.getDate() - 90)
  const cobranzasSnap = await db.collection('cobranzas')
    .where('origen', '==', 'supervisor')
    .where('clienteId', '==', after.clienteUid)
    .where('fecha', '>=', desde)
    .get()
  const cobranzasAplicadas: string[] = []
  const descuentoPorComp = new Map<string, number>()
  cobranzasSnap.forEach((docSnap) => {
    const c = docSnap.data()
    if (c.tango?.estado === 'confirmado' || !Array.isArray(c.imputaciones)) return
    cobranzasAplicadas.push(docSnap.id)
    for (const imp of c.imputaciones) {
      const clave = `${imp.comprobanteTipo}|${imp.comprobanteNumero}`
      const cent = Math.round(Number(imp.importeImputado ?? 0) * 100)
      descuentoPorComp.set(clave, (descuentoPorComp.get(clave) ?? 0) + cent)
    }
  })
  if (descuentoPorComp.size > 0) {
    comprobantes = comprobantes
      .map((c) => {
        const cent = descuentoPorComp.get(`${c.tipo}|${c.numero}`)
        if (!cent) return c
        return { ...c, saldoPendiente: Math.max(0, Math.round(c.saldoPendiente * 100) - cent) / 100 }
      })
      .filter((c) => c.saldoPendiente > 0)
  }

  const saldoTotal = redondear2(comprobantes.reduce((s, c) => s + c.saldoPendiente, 0))

  // runId 'consulta': el sync periódico vacía los docs cuyo runId no es el de
  // su corrida — si este cliente sigue con deuda, el próximo sync lo re-escribe
  // con el runId nuevo; si no aparece en el snapshot completo, es que ya no
  // debe nada y el vaciado es correcto.
  await db.collection('saldosTango').doc(after.clienteUid).set({
    idGva14:       typeof after.idGva14 === 'number' ? after.idGva14 : (user.idGva14Tango ?? 0),
    codigoTango:   user.codigoTango ?? '',
    empresa:       after.empresa === 'rolito' ? 'rolito' : 'redonhielo',
    razonSocial:   user.razonSocial ?? user.nombre ?? '',
    comprobantes,
    saldoTotal,
    cobranzasAplicadas,
    actualizadoEn: FieldValue.serverTimestamp(),
    origen:        'consulta',
    runId:         'consulta',
  })
})
