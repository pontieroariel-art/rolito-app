import { describe, it, expect, beforeAll } from 'vitest'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { procesarLoteSaldos, type IndiceClientesTango } from './tangoSaldos'

// Regresión del 26/09/2026: la sync de saldos se caía entera con
// "Value for argument documentRef is not a valid DocumentReference" cuando un
// cliente tenía SOLO saldo a favor en Tango (tangoComprobantes.aCuenta) y no
// venía en la Live de deudas: los refs se armaban antes de sumarlo. Corre
// contra el emulador de Firestore (FIRESTORE_EMULATOR_HOST); sin emulador se saltea.
const conEmulador = !!process.env.FIRESTORE_EMULATOR_HOST

describe.skipIf(!conEmulador)('procesarLoteSaldos (emulador)', () => {
  const db = () => getFirestore()
  const debe = 'test-saldos-debe'
  const aFavor = 'test-saldos-a-favor'

  beforeAll(async () => {
    if (!getApps().length) initializeApp({ projectId: 'demo-rolito' })
    await db().doc(`saldosTango/${debe}`).delete()
    await db().doc(`saldosTango/${aFavor}`).delete()
    await db().doc('tangoComprobantes/redonhielo_TST002').set({
      empresa: 'redonhielo', codigo: 'TST002',
      aCuenta: { total: 1500, items: [{ tipo: 'REC', numero: 'X 0001-00000077', fecha: '2026-09-20', importe: 1500, pendiente: 1500 }] },
    })
  })

  it('un cliente que solo tiene saldo a favor no tira la corrida y queda guardado', async () => {
    const indice: IndiceClientesTango = {
      redonhielo: new Map([
        [9001, { uid: debe, codigo: 'TST001', razonSocial: 'Debe SA' }],
        [9002, { uid: aFavor, codigo: 'TST002', razonSocial: 'A Favor SA' }],
      ]),
      rolito: new Map(),
    }
    const r = await procesarLoteSaldos(db(), [{
      idGva14: 9001, codGva14: 'TST001', empresa: 'redonhielo',
      comprobantes: [{ tipo: 'FAC', numero: 'A 0001-00000010', fechaEmision: '2026-09-01', importeOriginal: 5000, saldoPendiente: 5000 }],
    }] as Parameters<typeof procesarLoteSaldos>[1], { dryRun: false, runId: 'test', esUltimoLote: false, empresa: 'redonhielo', indice, descuentos: new Map() })

    expect(r.succeeded).toBe(true)
    const [d1, d2] = await Promise.all([db().doc(`saldosTango/${debe}`).get(), db().doc(`saldosTango/${aFavor}`).get()])
    expect(d1.exists).toBe(true)
    expect(d2.exists).toBe(true)
    expect(d2.data()?.porEmpresa?.redonhielo?.saldoTotal).toBe(-1500)
  })
})
