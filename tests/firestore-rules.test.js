import { readFileSync } from 'node:fs'
import { test, before, after, beforeEach, describe } from 'node:test'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'

// Tests de las reglas de Firestore contra el emulador. Verifican de forma
// automática y repetible los invariantes de seguridad que antes se validaban a
// mano (escalada de privilegios, manipulación de pedidos, poisoning de índices).

let testEnv

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-rolito',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })
})

after(async () => { if (testEnv) await testEnv.cleanup() })
beforeEach(async () => { await testEnv.clearFirestore() })

// Contexto autenticado (el email va en el token: varias reglas usan token.email).
const db = (uid, email) =>
  testEnv.authenticatedContext(uid, email ? { email } : {}).firestore()

// Siembra documentos salteando las reglas.
const seed = (fn) =>
  testEnv.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()))

const cliente = (extra = {}) => ({
  rol: 'cliente', estado: 'activo', email: 'c@x.com',
  cuit: '20111111119', nombre: 'Cliente', ...extra,
})

const pedido = (extra = {}) => ({
  clientId: 'cli', status: 'pendiente', driverId: null,
  products: [{ name: 'Hielo', quantity: 1 }],
  createdAt: new Date(), date: new Date(), ...extra,
})

// ── users: escalada de privilegios ────────────────────────────────────────────
describe('users — escalada de privilegios', () => {
  test('un cliente NO puede cambiar su propio rol', async () => {
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente()))
    await assertFails(updateDoc(doc(db('cli', 'c@x.com'), 'users/cli'), { rol: 'super_admin' }))
  })

  test('un cliente NO puede autoactivarse (estado)', async () => {
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente({ estado: 'pendiente' })))
    await assertFails(updateDoc(doc(db('cli'), 'users/cli'), { estado: 'activo' }))
  })

  test('un cliente NO puede cambiar su cuit', async () => {
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente()))
    await assertFails(updateDoc(doc(db('cli'), 'users/cli'), { cuit: '20999999999' }))
  })

  test('un cliente SÍ puede editar un campo benigno (telefono)', async () => {
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente()))
    await assertSucceeds(updateDoc(doc(db('cli'), 'users/cli'), { telefono: '1122334455' }))
  })

  test('nadie puede crearse con rol != cliente', async () => {
    await assertFails(setDoc(doc(db('atk', 'a@x.com'), 'users/atk'), cliente({ rol: 'super_admin' })))
  })

  test('un usuario SÍ puede crearse como cliente', async () => {
    await assertSucceeds(setDoc(doc(db('new', 'n@x.com'), 'users/new'), cliente()))
  })

  test('super_admin SÍ puede cambiar el rol de otro', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/adm'), { rol: 'super_admin', estado: 'activo' })
      await setDoc(doc(d, 'users/cli'), cliente())
    })
    await assertSucceeds(updateDoc(doc(db('adm'), 'users/cli'), { rol: 'logistica' }))
  })
})

// ── orders: creación del cliente ──────────────────────────────────────────────
describe('orders — creación del cliente', () => {
  test('cliente SÍ puede crear su pedido pendiente', async () => {
    await assertSucceeds(setDoc(doc(db('cli', 'c@x.com'), 'orders/o1'), pedido()))
  })

  test('cliente NO puede autoasignarse chofer (driverId)', async () => {
    await assertFails(setDoc(doc(db('cli', 'c@x.com'), 'orders/o2'), pedido({ driverId: 'chofer@x.com' })))
  })

  test('cliente NO puede fabricar campos de staff (origenPdf)', async () => {
    await assertFails(setDoc(doc(db('cli', 'c@x.com'), 'orders/o3'), pedido({ origenPdf: true })))
  })

  test('cliente NO puede crear pedido para otro clientId', async () => {
    await assertFails(setDoc(doc(db('cli', 'c@x.com'), 'orders/o4'), pedido({ clientId: 'otro' })))
  })
})

// ── orders: cancelación y borrado ─────────────────────────────────────────────
describe('orders — cancelación y borrado', () => {
  const seedPedido = () => seed((d) => setDoc(doc(d, 'orders/o1'), pedido()))

  test('cliente SÍ puede cancelar su pedido pendiente (solo status/motivo)', async () => {
    await seedPedido()
    await assertSucceeds(updateDoc(doc(db('cli', 'c@x.com'), 'orders/o1'), {
      status: 'cancelado', motivoCancelacion: 'cambié de idea', updatedAt: new Date(),
    }))
  })

  test('cliente NO puede reescribir el pedido al cancelar (hasOnly)', async () => {
    await seedPedido()
    await assertFails(updateDoc(doc(db('cli', 'c@x.com'), 'orders/o1'), {
      status: 'cancelado', products: [{ name: 'Hielo', quantity: 999 }],
    }))
  })

  test('cliente NO puede borrar un pedido', async () => {
    await seedPedido()
    await assertFails(deleteDoc(doc(db('cli', 'c@x.com'), 'orders/o1')))
  })

  test('operador (logistica) SÍ puede borrar', async () => {
    await seed((d) => setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' }))
    await seedPedido()
    await assertSucceeds(deleteDoc(doc(db('ops'), 'orders/o1')))
  })
})

// ── cuitIndex: anti-poisoning ─────────────────────────────────────────────────
describe('cuitIndex — anti-poisoning', () => {
  test('cliente SÍ puede apuntar un CUIT a SU propio email', async () => {
    await assertSucceeds(setDoc(doc(db('cli', 'c@x.com'), 'cuitIndex/20111111119'), { email: 'c@x.com' }))
  })

  test('cliente NO puede apuntar un CUIT a otro email', async () => {
    await assertFails(setDoc(doc(db('cli', 'c@x.com'), 'cuitIndex/20111111119'), { email: 'victima@x.com' }))
  })
})

// ── precios: edición de catálogo y listas por comercial / logística ───────────
describe('precios — edición por comercial', () => {
  test('comercial SÍ puede editar una lista de precios', async () => {
    await seed((d) => setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('com'), 'listas-precios/l1'), { nombre: 'Mayoristas', items: [] }))
  })

  test('comercial SÍ puede editar el catálogo (config/catalogo)', async () => {
    await seed((d) => setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('com'), 'config/catalogo'), { productos: [] }))
  })

  test('un cliente NO puede editar listas de precios', async () => {
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente()))
    await assertFails(setDoc(doc(db('cli'), 'listas-precios/l1'), { nombre: 'X', items: [] }))
  })
})
