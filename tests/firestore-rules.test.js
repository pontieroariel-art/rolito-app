import { readFileSync } from 'node:fs'
import { test, before, after, beforeEach, describe } from 'node:test'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteDoc, arrayUnion, deleteField } from 'firebase/firestore'

// Tests de las reglas de Firestore contra el emulador. Verifican de forma
// automática y repetible los invariantes de seguridad que antes se validaban a
// mano (escalada de privilegios, manipulación de pedidos, poisoning de índices).

let testEnv

// emulators:exec exporta FIRESTORE_EMULATOR_HOST; respetarla permite correr los
// tests en un puerto alternativo cuando el emulador de desarrollo ocupa el 8080.
const [emuHost, emuPort] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':')

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-rolito',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: emuHost,
      port: Number(emuPort),
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

  test('un cliente NO puede modificar creadoPor', async () => {
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente({
      creadoPor: { uid: 'staff1', nombre: 'Staff Uno', rol: 'comercial' },
    })))
    await assertFails(updateDoc(doc(db('cli'), 'users/cli'), {
      creadoPor: { uid: 'cli', nombre: 'Cliente', rol: 'cliente' },
    }))
  })

  test('un cliente NO puede auto-otorgarse el flag de bridge de Tango', async () => {
    // tangoBridge habilita isTangoBridge() → acceso a tango-outbox y config/tango.
    // Solo lo setea el Admin SDK; nadie puede dárselo editando su propio perfil.
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente()))
    await assertFails(updateDoc(doc(db('cli'), 'users/cli'), { tangoBridge: true }))
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

// ── users: edición cruzada de staff por staff (C-2) ───────────────────────────
describe('users — staff no puede editar documentos de otro staff', () => {
  test('comercial NO puede desactivar a un super_admin (lockout)', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' })
      await setDoc(doc(d, 'users/adm'), { rol: 'super_admin', estado: 'activo' })
    })
    await assertFails(updateDoc(doc(db('com'), 'users/adm'), { estado: 'inactivo' }))
  })

  test('logistica NO puede cambiar el email de otro staff', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' })
      await setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo', email: 'com@x.com' })
    })
    await assertFails(updateDoc(doc(db('ops'), 'users/com'), { email: 'hijack@x.com' }))
  })

  test('comercial NO puede editar el cuit de un cliente', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' })
      await setDoc(doc(d, 'users/cli'), cliente())
    })
    await assertFails(updateDoc(doc(db('com'), 'users/cli'), { cuit: '20999999999' }))
  })

  test('comercial SÍ puede editar el codigoCliente de un cliente (gestión compartida con facturación)', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' })
      await setDoc(doc(d, 'users/cli'), cliente())
    })
    await assertSucceeds(updateDoc(doc(db('com'), 'users/cli'), { codigoCliente: 'CLI-9999' }))
  })

  // ── Regresión positiva: los flujos reales de gestión de clientes siguen OK ──
  test('comercial SÍ puede cambiar la lista de precios de un cliente', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' })
      await setDoc(doc(d, 'users/cli'), cliente())
    })
    await assertSucceeds(updateDoc(doc(db('com'), 'users/cli'), {
      listaPreciosId: 'mayoristas', ultimoCambioPrecio: new Date(),
    }))
  })

  test('logistica SÍ puede fijar la condición de venta de un cliente', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' })
      await setDoc(doc(d, 'users/cli'), cliente())
    })
    await assertSucceeds(updateDoc(doc(db('ops'), 'users/cli'), {
      condicionVenta: 'Cuenta corriente',
    }))
  })

  test('gerente_comercial SÍ puede activar un cliente (estado/aprobación)', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/gc'), { rol: 'gerente_comercial', estado: 'activo' })
      await setDoc(doc(d, 'users/cli'), cliente({ estado: 'pendiente' }))
    })
    await assertSucceeds(updateDoc(doc(db('gc'), 'users/cli'), {
      estado: 'activo', fechaAprobacion: new Date(), aprobadoPor: 'gc',
    }))
  })

  test('logistica SÍ puede editar los domicilios de un cliente', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' })
      await setDoc(doc(d, 'users/cli'), cliente())
    })
    await assertSucceeds(updateDoc(doc(db('ops'), 'users/cli'), {
      addresses: [{ id: 'a1', nombre: 'Depósito', address: 'Calle 1', esPrincipal: true }],
    }))
  })

  test('gerente_general NO puede desactivar a un super_admin (lockout)', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/gg'), { rol: 'gerente_general', estado: 'activo' })
      await setDoc(doc(d, 'users/adm'), { rol: 'super_admin', estado: 'activo' })
    })
    await assertFails(updateDoc(doc(db('gg'), 'users/adm'), { estado: 'inactivo' }))
  })
})

// ── orders: creación del cliente ──────────────────────────────────────────────
describe('orders — creación del cliente', () => {
  const seedClienteActivo = () => seed((d) => setDoc(doc(d, 'users/cli'), cliente()))

  test('cliente SÍ puede crear su pedido pendiente', async () => {
    await seedClienteActivo()
    await assertSucceeds(setDoc(doc(db('cli', 'c@x.com'), 'orders/o1'), pedido()))
  })

  test('cliente NO puede autoasignarse chofer (driverId)', async () => {
    await seedClienteActivo()
    await assertFails(setDoc(doc(db('cli', 'c@x.com'), 'orders/o2'), pedido({ driverId: 'chofer@x.com' })))
  })

  test('cliente NO puede fabricar campos de staff (origenPdf)', async () => {
    await seedClienteActivo()
    await assertFails(setDoc(doc(db('cli', 'c@x.com'), 'orders/o3'), pedido({ origenPdf: true })))
  })

  test('cliente NO puede crear pedido para otro clientId', async () => {
    await seedClienteActivo()
    await assertFails(setDoc(doc(db('cli', 'c@x.com'), 'orders/o4'), pedido({ clientId: 'otro' })))
  })

  test('cliente NO ACTIVO (pendiente) no puede crear pedidos', async () => {
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente({ estado: 'pendiente' })))
    await assertFails(setDoc(doc(db('cli', 'c@x.com'), 'orders/o5'), pedido()))
  })

  test('un chofer no puede crear un pedido "propio" (clientId==uid)', async () => {
    await seed((d) => setDoc(doc(d, 'users/ch'), { rol: 'chofer', estado: 'activo', email: 'ch@x.com' }))
    await assertFails(setDoc(doc(db('ch', 'ch@x.com'), 'orders/o6'), pedido({ clientId: 'ch' })))
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

// ── orders: edición por gerente_comercial ─────────────────────────────────────
describe('orders — edición por gerente_comercial', () => {
  const seedPedido = () => seed((d) => setDoc(doc(d, 'orders/o1'), pedido()))

  test('gerente_comercial SÍ puede editar un pedido (kanban de planificación)', async () => {
    await seed((d) => setDoc(doc(d, 'users/gc'), { rol: 'gerente_comercial', estado: 'activo' }))
    await seedPedido()
    await assertSucceeds(updateDoc(doc(db('gc'), 'orders/o1'), {
      products: [{ name: 'Hielo', quantity: 5 }], updatedAt: new Date(),
    }))
  })

  test('gerente_general SÍ puede reprogramar un pedido (campos acotados)', async () => {
    await seed((d) => setDoc(doc(d, 'users/gg'), { rol: 'gerente_general', estado: 'activo' }))
    await seedPedido()
    await assertSucceeds(updateDoc(doc(db('gg'), 'orders/o1'), {
      date: new Date(), reprogramado: true, fechaOriginal: new Date(),
      motivoReprogramacion: 'Camión averiado', choferOriginal: null,
      driverId: null, status: 'pendiente', updatedAt: new Date(),
    }))
  })

  test('gerente_general SÍ puede reasignar chofer', async () => {
    await seed((d) => setDoc(doc(d, 'users/gg'), { rol: 'gerente_general', estado: 'activo' }))
    await seedPedido()
    await assertSucceeds(updateDoc(doc(db('gg'), 'orders/o1'), {
      driverId: 'chofer2@x.com', reasignado: true, choferOriginal: 'chofer1@x.com',
      motivoReasignacion: 'Zona más cercana', updatedAt: new Date(),
    }))
  })

  test('gerente_general NO puede reescribir el pedido (productos)', async () => {
    await seed((d) => setDoc(doc(d, 'users/gg'), { rol: 'gerente_general', estado: 'activo' }))
    await seedPedido()
    await assertFails(updateDoc(doc(db('gg'), 'orders/o1'), {
      products: [{ name: 'Hielo', quantity: 5 }],
    }))
  })

  test('comercial NO puede editar pedidos', async () => {
    await seed((d) => setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' }))
    await seedPedido()
    await assertFails(updateDoc(doc(db('com'), 'orders/o1'), {
      products: [{ name: 'Hielo', quantity: 5 }],
    }))
  })
})

// ── orders: actualización por el chofer asignado (campos acotados) ───────────
describe('orders — actualización por el chofer asignado', () => {
  const seedPedido = (extra = {}) =>
    seed((d) => setDoc(doc(d, 'orders/o1'), pedido({ driverId: 'ch@x.com', ...extra })))
  const seedChofer = (estado = 'activo') =>
    seed((d) => setDoc(doc(d, 'users/ch'), { rol: 'chofer', estado, email: 'ch@x.com' }))

  test('chofer asignado SÍ puede marcar el pedido como entregado', async () => {
    await seedChofer()
    await seedPedido()
    await assertSucceeds(updateDoc(doc(db('ch', 'ch@x.com'), 'orders/o1'), {
      status: 'entregado', productosEntregados: [{ name: 'Hielo', quantity: 1 }],
      entregaParcial: false, notaEntrega: '', updatedAt: new Date(),
    }))
  })

  test('chofer asignado SÍ puede marcar el pedido como entregado dejando registro en historialAcciones', async () => {
    await seedChofer()
    await seedPedido()
    await assertSucceeds(updateDoc(doc(db('ch', 'ch@x.com'), 'orders/o1'), {
      status: 'entregado', productosEntregados: [{ name: 'Hielo', quantity: 1 }],
      entregaParcial: false, notaEntrega: '', updatedAt: new Date(),
      historialAcciones: arrayUnion({
        accion: 'entregado', usuarioId: 'ch', usuarioNombre: 'Chofer Uno',
        timestamp: new Date(), detalle: null,
      }),
    }))
  })

  test('chofer asignado NO puede reescribir products/precio al marcar entregado', async () => {
    await seedChofer()
    await seedPedido()
    await assertFails(updateDoc(doc(db('ch', 'ch@x.com'), 'orders/o1'), {
      status: 'entregado', products: [{ name: 'Hielo', quantity: 999 }], updatedAt: new Date(),
    }))
  })

  test('chofer asignado NO puede reasignarse otro pedido (driverId/clientId)', async () => {
    await seedChofer()
    await seedPedido()
    await assertFails(updateDoc(doc(db('ch', 'ch@x.com'), 'orders/o1'), {
      clientId: 'otro-cliente', updatedAt: new Date(),
    }))
  })

  test('un chofer NO asignado no puede tocar el pedido de otro chofer', async () => {
    await seedChofer()
    await seedPedido()
    await assertFails(updateDoc(doc(db('ch2', 'ch2@x.com'), 'orders/o1'), {
      status: 'entregado', updatedAt: new Date(),
    }))
  })

  test('chofer dado de baja (estado inactivo) NO puede marcar el pedido como entregado', async () => {
    await seedChofer('inactivo')
    await seedPedido()
    await assertFails(updateDoc(doc(db('ch', 'ch@x.com'), 'orders/o1'), {
      status: 'entregado', productosEntregados: [{ name: 'Hielo', quantity: 1 }],
      entregaParcial: false, notaEntrega: '', updatedAt: new Date(),
    }))
  })
})

// ── orders: chofer marca "no entregado" (reprograma a mañana) ────────────────
describe('orders — chofer marca "no entregado"', () => {
  const manana = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const seedPedido = (extra = {}) =>
    seed((d) => setDoc(doc(d, 'orders/o1'), pedido({ driverId: 'ch@x.com', ...extra })))
  const seedChofer = (estado = 'activo') =>
    seed((d) => setDoc(doc(d, 'users/ch'), { rol: 'chofer', estado, email: 'ch@x.com' }))
  const noEntregado = (extra = {}) => ({
    status: 'pendiente', reprogramado: true, fechaOriginal: new Date(),
    motivoReprogramacion: 'Cliente ausente', choferOriginal: 'ch@x.com',
    driverId: null, date: manana, updatedAt: new Date(), ...extra,
  })

  test('chofer asignado SÍ puede marcar el pedido como no entregado', async () => {
    await seedChofer()
    await seedPedido()
    await assertSucceeds(updateDoc(doc(db('ch', 'ch@x.com'), 'orders/o1'), noEntregado()))
  })

  test('un chofer NO asignado no puede marcar como no entregado el pedido de otro', async () => {
    await seedChofer()
    await seed((d) => setDoc(doc(d, 'users/ch2'), { rol: 'chofer', estado: 'activo', email: 'ch2@x.com' }))
    await seedPedido()
    await assertFails(updateDoc(doc(db('ch2', 'ch2@x.com'), 'orders/o1'), noEntregado()))
  })

  test('chofer NO puede dejar el pedido asignado a otro chofer', async () => {
    await seedChofer()
    await seedPedido()
    await assertFails(updateDoc(doc(db('ch', 'ch@x.com'), 'orders/o1'), noEntregado({ driverId: 'ch2@x.com' })))
  })

  test('chofer NO puede marcar como no entregado un pedido ya entregado', async () => {
    await seedChofer()
    await seedPedido({ status: 'entregado' })
    await assertFails(updateDoc(doc(db('ch', 'ch@x.com'), 'orders/o1'), noEntregado()))
  })

  test('chofer dado de baja (estado inactivo) NO puede marcar como no entregado', async () => {
    await seedChofer('inactivo')
    await seedPedido()
    await assertFails(updateDoc(doc(db('ch', 'ch@x.com'), 'orders/o1'), noEntregado()))
  })

  test('chofer NO puede aprovechar esta rama para tocar products', async () => {
    await seedPedido()
    await assertFails(updateDoc(doc(db('ch', 'ch@x.com'), 'orders/o1'), noEntregado({
      products: [{ name: 'Hielo', quantity: 999 }],
    })))
  })
})

// ── orders: actualización por operador (campos acotados) ─────────────────────
describe('orders — actualización por operador', () => {
  const seedPedido = () => seed((d) => setDoc(doc(d, 'orders/o1'), pedido()))

  test('operador (logistica) SÍ puede asignar chofer', async () => {
    await seed((d) => setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' }))
    await seedPedido()
    await assertSucceeds(updateDoc(doc(db('ops'), 'orders/o1'), {
      driverId: 'chofer@x.com', updatedAt: new Date(),
    }))
  })

  test('operador (logistica) NO puede reasignar el pedido a otro cliente', async () => {
    await seed((d) => setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' }))
    await seedPedido()
    await assertFails(updateDoc(doc(db('ops'), 'orders/o1'), {
      clientId: 'otro-cliente', updatedAt: new Date(),
    }))
  })

  test('operador (logistica) SÍ puede asignar el pedido a una 2da vuelta del chofer', async () => {
    await seed((d) => setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' }))
    await seedPedido()
    await assertSucceeds(updateDoc(doc(db('ops'), 'orders/o1'), {
      driverId: 'chofer@x.com', vuelta: 2, updatedAt: new Date(),
    }))
  })
})

// ── orders: lectura por heladeras_encargado (ranking de consumo) ──────────────
describe('orders — lectura por heladeras_encargado', () => {
  test('heladeras_encargado SÍ puede leer pedidos', async () => {
    await seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'heladeras_encargado', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'orders/o1'), pedido()))
    await assertSucceeds(getDoc(doc(db('enc'), 'orders/o1')))
  })

  test('personal de taller (rol heladeras) NO puede leer pedidos', async () => {
    await seed((d) => setDoc(doc(d, 'users/per'), { rol: 'heladeras', estado: 'activo', area: 'refrigeracion' }))
    await seed((d) => setDoc(doc(d, 'orders/o1'), pedido()))
    await assertFails(getDoc(doc(db('per'), 'orders/o1')))
  })
})

// ── users: clientesOcultosMapa (preferencia personal de mapa) ─────────────────
describe('users — clientesOcultosMapa (preferencia personal de mapa)', () => {
  test('logistica SÍ puede ocultar un cliente en su propio mapa', async () => {
    await seed((d) => setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' }))
    await assertSucceeds(updateDoc(doc(db('ops'), 'users/ops'), {
      clientesOcultosMapa: ['cli1'],
    }))
  })

  test('logistica NO puede tocar clientesOcultosMapa de otro miembro del staff', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/ops'),  { rol: 'logistica', estado: 'activo' })
      await setDoc(doc(d, 'users/ops2'), { rol: 'logistica', estado: 'activo' })
    })
    await assertFails(updateDoc(doc(db('ops'), 'users/ops2'), {
      clientesOcultosMapa: ['cli1'],
    }))
  })

  test('ocultar un cliente en el mapa no le cambia el rol ni el estado (no es un lockout disfrazado)', async () => {
    await seed((d) => setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' }))
    await assertFails(updateDoc(doc(db('ops'), 'users/ops'), {
      clientesOcultosMapa: ['cli1'], estado: 'inactivo',
    }))
  })
})

// ── users: código de cliente por facturación ──────────────────────────────────
describe('users — código de cliente por facturación', () => {
  const seedFacturacion = () => seed(async (d) => {
    await setDoc(doc(d, 'users/fac'), { rol: 'facturacion', estado: 'activo' })
    await setDoc(doc(d, 'users/cli'), cliente())
  })

  test('facturacion SÍ puede asignar codigoCliente', async () => {
    await seedFacturacion()
    await assertSucceeds(updateDoc(doc(db('fac'), 'users/cli'), { codigoCliente: 'CLI-0042' }))
  })

  test('facturacion NO puede tocar otros campos del cliente', async () => {
    await seedFacturacion()
    await assertFails(updateDoc(doc(db('fac'), 'users/cli'), {
      codigoCliente: 'CLI-0042', listaPreciosId: 'vip',
    }))
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

  test('cliente NO puede secuestrar un CUIT ya asignado a otro usuario', async () => {
    await seed((d) => setDoc(doc(d, 'cuitIndex/20111111119'), { email: 'victima@x.com' }))
    await assertFails(setDoc(doc(db('atk', 'atk@x.com'), 'cuitIndex/20111111119'), { email: 'atk@x.com' }))
  })

  test('operador SÍ puede corregir un CUIT ya asignado (alta manual/importación)', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' })
      await setDoc(doc(d, 'cuitIndex/20111111119'), { email: 'viejo@x.com' })
    })
    await assertSucceeds(setDoc(doc(db('ops'), 'cuitIndex/20111111119'), { email: 'nuevo@x.com' }))
  })
})

// ── precios: edición del catálogo por comercial ───────────────────────────────
// Las listas de precios propias de la app (listas-precios) se eliminaron el
// 2026-09-03: sin match en las reglas, nadie las lee ni las escribe.
describe('precios — edición por comercial', () => {
  test('comercial SÍ puede editar el catálogo (config/catalogo)', async () => {
    await seed((d) => setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('com'), 'config/catalogo'), { productos: [] }))
  })

  test('listas-precios ya no existe: ni un gerente comercial puede escribir ni leer ahí', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/gc'), { rol: 'gerente_comercial', estado: 'activo' })
      await setDoc(doc(d, 'listas-precios/l1'), { nombre: 'Mayoristas', items: [] })
    })
    await assertFails(setDoc(doc(db('gc'), 'listas-precios/l2'), { nombre: 'X', items: [] }))
    await assertFails(getDoc(doc(db('gc'), 'listas-precios/l1')))
  })
})

// ── despachos ──────────────────────────────────────────────────────────────
describe('despachos', () => {
  const seedDespacho = () => seed((d) => setDoc(doc(d, 'despachos/2026-01-01_ch'), {
    fecha: '2026-01-01', driverId: 'ch@x.com', status: 'borrador', orderIds: [],
  }))

  test('operador (logistica) SÍ puede leer despachos', async () => {
    await seed((d) => setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' }))
    await seedDespacho()
    await assertSucceeds(getDoc(doc(db('ops'), 'despachos/2026-01-01_ch')))
  })

  test('el chofer asignado SÍ puede leer su propio despacho', async () => {
    await seedDespacho()
    await assertSucceeds(getDoc(doc(db('ch', 'ch@x.com'), 'despachos/2026-01-01_ch')))
  })

  test('un chofer NO puede leer el despacho de otro chofer', async () => {
    await seedDespacho()
    await assertFails(getDoc(doc(db('ch2', 'ch2@x.com'), 'despachos/2026-01-01_ch')))
  })

  test('comercial NO puede leer despachos', async () => {
    await seed((d) => setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' }))
    await seedDespacho()
    await assertFails(getDoc(doc(db('com'), 'despachos/2026-01-01_ch')))
  })

  test('gerente_comercial SÍ puede leer despachos', async () => {
    await seed((d) => setDoc(doc(d, 'users/gc'), { rol: 'gerente_comercial', estado: 'activo' }))
    await seedDespacho()
    await assertSucceeds(getDoc(doc(db('gc'), 'despachos/2026-01-01_ch')))
  })

  test('operador SÍ puede escribir un despacho', async () => {
    await seed((d) => setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('ops'), 'despachos/2026-01-02_ch'), {
      fecha: '2026-01-02', driverId: 'ch@x.com', status: 'borrador', orderIds: [],
    }))
  })

  test('gerente_comercial SÍ puede escribir un despacho', async () => {
    await seed((d) => setDoc(doc(d, 'users/gc'), { rol: 'gerente_comercial', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('gc'), 'despachos/2026-01-03_ch'), {
      fecha: '2026-01-03', driverId: 'ch@x.com', status: 'borrador', orderIds: [],
    }))
  })

  test('el chofer NO puede escribir (ni actualizar) su propio despacho', async () => {
    await seedDespacho()
    await assertFails(updateDoc(doc(db('ch', 'ch@x.com'), 'despachos/2026-01-01_ch'), { status: 'confirmado' }))
  })
})

// ── asignacionesDia ────────────────────────────────────────────────────────
describe('asignacionesDia', () => {
  test('operador SÍ puede leer asignacionesDia', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' })
      await setDoc(doc(d, 'asignacionesDia/2026-01-01'), { choferes: {} })
    })
    await assertSucceeds(getDoc(doc(db('ops'), 'asignacionesDia/2026-01-01')))
  })

  test('comercial NO puede leer asignacionesDia', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' })
      await setDoc(doc(d, 'asignacionesDia/2026-01-01'), { choferes: {} })
    })
    await assertFails(getDoc(doc(db('com'), 'asignacionesDia/2026-01-01')))
  })

  test('gerente_comercial SÍ puede leer y escribir asignacionesDia', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/gc'), { rol: 'gerente_comercial', estado: 'activo' })
      await setDoc(doc(d, 'asignacionesDia/2026-01-01'), { choferes: {} })
    })
    await assertSucceeds(getDoc(doc(db('gc'), 'asignacionesDia/2026-01-01')))
    await assertSucceeds(setDoc(doc(db('gc'), 'asignacionesDia/2026-01-04'), { choferes: {} }))
  })

  test('operador SÍ puede escribir asignacionesDia', async () => {
    await seed((d) => setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('ops'), 'asignacionesDia/2026-01-02'), { choferes: {} }))
  })

  test('un chofer NO puede escribir asignacionesDia', async () => {
    await assertFails(setDoc(doc(db('ch', 'ch@x.com'), 'asignacionesDia/2026-01-02'), { choferes: {} }))
  })
})

// ── ubicaciones (GPS del chofer) ───────────────────────────────────────────
describe('ubicaciones', () => {
  test('el chofer SÍ puede escribir su propia ubicación', async () => {
    await assertSucceeds(setDoc(doc(db('ch', 'ch@x.com'), 'ubicaciones/ch@x.com'), { lat: 0, lng: 0 }))
  })

  test('un chofer NO puede escribir la ubicación de otro chofer', async () => {
    await assertFails(setDoc(doc(db('ch', 'ch@x.com'), 'ubicaciones/otro@x.com'), { lat: 0, lng: 0 }))
  })

  test('operador SÍ puede escribir la ubicación de cualquier chofer', async () => {
    await seed((d) => setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('ops'), 'ubicaciones/ch@x.com'), { lat: 0, lng: 0 }))
  })

  test('un cliente NO puede leer ubicaciones (se resuelve server-side)', async () => {
    await seed((d) => setDoc(doc(d, 'ubicaciones/ch@x.com'), { lat: 0, lng: 0 }))
    await assertFails(getDoc(doc(db('cli', 'c@x.com'), 'ubicaciones/ch@x.com')))
  })

  test('operador SÍ puede leer ubicaciones (mapa en vivo)', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' })
      await setDoc(doc(d, 'ubicaciones/ch@x.com'), { lat: 0, lng: 0 })
    })
    await assertSucceeds(getDoc(doc(db('ops'), 'ubicaciones/ch@x.com')))
  })

  test('comercial SÍ puede leer ubicaciones (mapa en vivo)', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' })
      await setDoc(doc(d, 'ubicaciones/ch@x.com'), { lat: 0, lng: 0 })
    })
    await assertSucceeds(getDoc(doc(db('com'), 'ubicaciones/ch@x.com')))
  })

  test('el chofer SÍ puede leer su propia ubicación', async () => {
    await seed((d) => setDoc(doc(d, 'ubicaciones/ch@x.com'), { lat: 0, lng: 0 }))
    await assertSucceeds(getDoc(doc(db('ch', 'ch@x.com'), 'ubicaciones/ch@x.com')))
  })
})

// ── flota ──────────────────────────────────────────────────────────────────
describe('flota', () => {
  test('cualquier usuario autenticado SÍ puede leer flota', async () => {
    await seed((d) => setDoc(doc(d, 'flota/cam1'), { patente: 'AA123BB' }))
    await assertSucceeds(getDoc(doc(db('cli', 'c@x.com'), 'flota/cam1')))
  })

  test('operador SÍ puede escribir flota', async () => {
    await seed((d) => setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('ops'), 'flota/cam2'), { patente: 'BB456CC' }))
  })

  test('comercial NO puede escribir flota', async () => {
    await seed((d) => setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' }))
    await assertFails(setDoc(doc(db('com'), 'flota/cam3'), { patente: 'CC789DD' }))
  })
})

// ── heladeras ──────────────────────────────────────────────────────────────
describe('heladeras', () => {
  // Catálogo de prueba: reacondicionamiento replica el pipeline de 4 pasos
  // de siempre (refrigeración → lijado → pintura → control de calidad, este
  // último con requiereAprobacion); fabricación es la cadena nueva de 2
  // pasos (plástico → terminación, sin control de calidad).
  const seedCatalogoPasos = () => seed((d) => setDoc(doc(d, 'config/pasosTaller'), {
    pasos: {
      p_refri:    { id: 'p_refri',    nombre: 'Refrigeración',      tipoPipeline: 'reacondicionamiento', area: 'refrigeracion', orden: 1, activo: true, siguientePasoId: 'p_lijado' },
      p_lijado:   { id: 'p_lijado',   nombre: 'Lijado',             tipoPipeline: 'reacondicionamiento', area: 'lijado',        orden: 2, activo: true, siguientePasoId: 'p_pintura' },
      p_pintura:  { id: 'p_pintura',  nombre: 'Pintura',            tipoPipeline: 'reacondicionamiento', area: 'pintura',       orden: 3, activo: true, siguientePasoId: 'p_cc' },
      p_cc:       { id: 'p_cc',       nombre: 'Control de calidad', tipoPipeline: 'reacondicionamiento', area: 'refrigeracion', orden: 4, activo: true, requiereAprobacion: true, siguientePasoId: null },
      p_plastico: { id: 'p_plastico', nombre: 'Plástico',           tipoPipeline: 'fabricacion',          area: 'plastico',      orden: 1, activo: true, siguientePasoId: 'p_termina' },
      p_termina:  { id: 'p_termina',  nombre: 'Terminación',        tipoPipeline: 'fabricacion',          area: 'terminacion',   orden: 2, activo: true, siguientePasoId: null },
    },
  }))
  const heladera = (extra = {}) => ({
    numeroSerie: 'HL-001', modelo: 'Slim 300', estado: 'en_taller',
    tipoPipeline: 'reacondicionamiento', pasoActualId: 'p_refri', primerPasoId: 'p_refri',
    motivoIngresoId: 'retiro_heladera', motivoIngresoNombre: 'Retiro de heladera', tipoOperacion: 'RETIRO',
    creadoPor: { uid: 'enc', nombre: 'Encargado' }, fechaIngreso: new Date(), cicloActual: 1,
    enProceso: null, historialAcciones: [], ...extra,
  })
  const seedEncargado = () => seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'heladeras_encargado', estado: 'activo' }))
  const seedPersonal = (uid = 'per', area = 'refrigeracion') => seed((d) => setDoc(doc(d, `users/${uid}`), { rol: 'heladeras', estado: 'activo', area }))
  const seedHeladera = (extra = {}) => seed((d) => setDoc(doc(d, 'heladeras/h1'), heladera(extra)))

  test('heladeras_encargado SÍ puede cargar una heladera nueva', async () => {
    await seedEncargado()
    await assertSucceeds(setDoc(doc(db('enc'), 'heladeras/h1'), heladera()))
  })

  test('personal de sector NO puede cargar una heladera nueva', async () => {
    await seedPersonal()
    await assertFails(setDoc(doc(db('per'), 'heladeras/h1'), heladera()))
  })

  test('personal de refrigeración SÍ puede agarrar una heladera libre en el primer paso', async () => {
    await seedPersonal()
    await seedCatalogoPasos()
    await seedHeladera()
    await assertSucceeds(updateDoc(doc(db('per'), 'heladeras/h1'), {
      enProceso: { uid: 'per', nombre: 'Personal Uno', area: 'refrigeracion', desde: new Date() },
      updatedAt: new Date(),
    }))
  })

  test('personal de sector NO puede editar numeroSerie/modelo', async () => {
    await seedPersonal()
    await seedCatalogoPasos()
    await seedHeladera()
    await assertFails(updateDoc(doc(db('per'), 'heladeras/h1'), { modelo: 'Slim 500' }))
  })

  test('personal de sector NO puede saltear el flujo y poner estado "disponible" directo', async () => {
    await seedPersonal()
    await seedCatalogoPasos()
    await seedHeladera()
    await assertFails(updateDoc(doc(db('per'), 'heladeras/h1'), { estado: 'disponible', pasoActualId: null, updatedAt: new Date() }))
  })

  test('personal de lijado NO puede agarrar directo desde el primer paso (saltear refrigeración)', async () => {
    await seedPersonal('per', 'lijado')
    await seedCatalogoPasos()
    await seedHeladera()
    await assertFails(updateDoc(doc(db('per'), 'heladeras/h1'), {
      enProceso: { uid: 'per', nombre: 'Personal Uno', area: 'lijado', desde: new Date() },
      updatedAt: new Date(),
    }))
  })

  test('personal de sector NO puede darse de baja a sí mismo una heladera', async () => {
    await seedPersonal()
    await seedCatalogoPasos()
    await seedHeladera()
    await assertFails(updateDoc(doc(db('per'), 'heladeras/h1'), { estado: 'baja', updatedAt: new Date() }))
  })

  test('personal de sector NO puede agarrar una heladera que ya está en proceso de otro', async () => {
    await seedPersonal()
    await seedCatalogoPasos()
    await seedHeladera({ enProceso: { uid: 'otro', nombre: 'Otra Persona', area: 'refrigeracion', desde: new Date() } })
    await assertFails(updateDoc(doc(db('per'), 'heladeras/h1'), {
      enProceso: { uid: 'per', nombre: 'Personal Uno', area: 'refrigeracion', desde: new Date() },
      updatedAt: new Date(),
    }))
  })

  test('personal de sector NO puede agarrar con un área distinta a la de su perfil', async () => {
    await seedPersonal('per', 'pintura')
    await seedCatalogoPasos()
    await seedHeladera()
    await assertFails(updateDoc(doc(db('per'), 'heladeras/h1'), {
      enProceso: { uid: 'per', nombre: 'Personal Uno', area: 'pintura', desde: new Date() },
      updatedAt: new Date(),
    }))
  })

  test('personal de refrigeración SÍ puede soltar la heladera que tiene agarrada (avanza al siguiente paso)', async () => {
    await seedPersonal()
    await seedCatalogoPasos()
    await seedHeladera({ enProceso: { uid: 'per', nombre: 'Personal Uno', area: 'refrigeracion', desde: new Date() } })
    await assertSucceeds(updateDoc(doc(db('per'), 'heladeras/h1'), {
      estado: 'en_taller',
      pasoActualId: 'p_lijado',
      enProceso: deleteField(),
      historialAcciones: arrayUnion({ accion: 'paso_completado', usuarioId: 'per', usuarioNombre: 'Personal Uno', timestamp: new Date(), detalle: 'listo' }),
      updatedAt: new Date(),
    }))
  })

  test('personal de sector NO puede soltar una heladera que tiene agarrada otra persona', async () => {
    await seedPersonal()
    await seedCatalogoPasos()
    await seedHeladera({ enProceso: { uid: 'otro', nombre: 'Otra Persona', area: 'refrigeracion', desde: new Date() } })
    await assertFails(updateDoc(doc(db('per'), 'heladeras/h1'), {
      estado: 'en_taller',
      pasoActualId: 'p_lijado',
      enProceso: deleteField(),
      updatedAt: new Date(),
    }))
  })

  test('personal de sector NO puede reescribir/borrar el historial al soltar', async () => {
    await seedPersonal()
    await seedCatalogoPasos()
    await seedHeladera({ enProceso: { uid: 'per', nombre: 'Personal Uno', area: 'refrigeracion', desde: new Date() } })
    await assertFails(updateDoc(doc(db('per'), 'heladeras/h1'), {
      estado: 'en_taller',
      pasoActualId: 'p_lijado',
      enProceso: deleteField(),
      historialAcciones: [],
      updatedAt: new Date(),
    }))
  })

  test('personal de sector NO puede saltear un paso al soltar (mandarla a un pasoActualId que no es el siguiente)', async () => {
    await seedPersonal()
    await seedCatalogoPasos()
    await seedHeladera({ enProceso: { uid: 'per', nombre: 'Personal Uno', area: 'refrigeracion', desde: new Date() } })
    await assertFails(updateDoc(doc(db('per'), 'heladeras/h1'), {
      estado: 'en_taller',
      pasoActualId: 'p_pintura', // saltea lijado
      enProceso: deleteField(),
      historialAcciones: arrayUnion({ accion: 'paso_completado', usuarioId: 'per', usuarioNombre: 'Personal Uno', timestamp: new Date() }),
      updatedAt: new Date(),
    }))
  })

  test('personal de lijado SÍ puede agarrar una heladera en el paso 2', async () => {
    await seedPersonal('per', 'lijado')
    await seedCatalogoPasos()
    await seedHeladera({ pasoActualId: 'p_lijado' })
    await assertSucceeds(updateDoc(doc(db('per'), 'heladeras/h1'), {
      enProceso: { uid: 'per', nombre: 'Personal Uno', area: 'lijado', desde: new Date() },
      updatedAt: new Date(),
    }))
  })

  test('personal de pintura SÍ puede agarrar una heladera en el paso 3', async () => {
    await seedPersonal('per', 'pintura')
    await seedCatalogoPasos()
    await seedHeladera({ pasoActualId: 'p_pintura' })
    await assertSucceeds(updateDoc(doc(db('per'), 'heladeras/h1'), {
      enProceso: { uid: 'per', nombre: 'Personal Uno', area: 'pintura', desde: new Date() },
      updatedAt: new Date(),
    }))
  })

  test('personal de refrigeración SÍ puede agarrar el control de calidad en el paso 4', async () => {
    await seedPersonal()
    await seedCatalogoPasos()
    await seedHeladera({ pasoActualId: 'p_cc' })
    await assertSucceeds(updateDoc(doc(db('per'), 'heladeras/h1'), {
      enProceso: { uid: 'per', nombre: 'Personal Uno', area: 'refrigeracion', desde: new Date() },
      updatedAt: new Date(),
    }))
  })

  test('personal de pintura NO puede agarrar el control de calidad (es de refrigeración)', async () => {
    await seedPersonal('per', 'pintura')
    await seedCatalogoPasos()
    await seedHeladera({ pasoActualId: 'p_cc' })
    await assertFails(updateDoc(doc(db('per'), 'heladeras/h1'), {
      enProceso: { uid: 'per', nombre: 'Personal Uno', area: 'pintura', desde: new Date() },
      updatedAt: new Date(),
    }))
  })

  test('personal de refrigeración SÍ puede aprobar el control de calidad (pasa a disponible)', async () => {
    await seedPersonal()
    await seedCatalogoPasos()
    await seedHeladera({ pasoActualId: 'p_cc', enProceso: { uid: 'per', nombre: 'Personal Uno', area: 'refrigeracion', desde: new Date() } })
    await assertSucceeds(updateDoc(doc(db('per'), 'heladeras/h1'), {
      estado: 'disponible',
      pasoActualId: null,
      enProceso: deleteField(),
      historialAcciones: arrayUnion({ accion: 'paso_aprobado', usuarioId: 'per', usuarioNombre: 'Personal Uno', timestamp: new Date() }),
      updatedAt: new Date(),
    }))
  })

  test('personal de refrigeración SÍ puede rechazar el control de calidad (vuelve al primer paso, sube el ciclo)', async () => {
    await seedPersonal()
    await seedCatalogoPasos()
    await seedHeladera({ pasoActualId: 'p_cc', enProceso: { uid: 'per', nombre: 'Personal Uno', area: 'refrigeracion', desde: new Date() }, cicloActual: 1 })
    await assertSucceeds(updateDoc(doc(db('per'), 'heladeras/h1'), {
      estado: 'en_taller',
      pasoActualId: 'p_refri',
      enProceso: deleteField(),
      cicloActual: 2,
      historialAcciones: arrayUnion({ accion: 'paso_rechazado', usuarioId: 'per', usuarioNombre: 'Personal Uno', timestamp: new Date(), detalle: 'sigue perdiendo gas' }),
      updatedAt: new Date(),
    }))
  })

  test('personal de refrigeración NO puede rechazar saltando el ciclo (subir más de uno)', async () => {
    await seedPersonal()
    await seedCatalogoPasos()
    await seedHeladera({ pasoActualId: 'p_cc', enProceso: { uid: 'per', nombre: 'Personal Uno', area: 'refrigeracion', desde: new Date() }, cicloActual: 1 })
    await assertFails(updateDoc(doc(db('per'), 'heladeras/h1'), {
      estado: 'en_taller',
      pasoActualId: 'p_refri',
      enProceso: deleteField(),
      cicloActual: 5,
      historialAcciones: arrayUnion({ accion: 'paso_rechazado', usuarioId: 'per', usuarioNombre: 'Personal Uno', timestamp: new Date() }),
      updatedAt: new Date(),
    }))
  })

  test('personal de un paso sin requiereAprobacion NO puede "rechazar" (solo soltar tiene una salida)', async () => {
    await seedPersonal()
    await seedCatalogoPasos()
    await seedHeladera({ enProceso: { uid: 'per', nombre: 'Personal Uno', area: 'refrigeracion', desde: new Date() }, cicloActual: 1 })
    await assertFails(updateDoc(doc(db('per'), 'heladeras/h1'), {
      estado: 'en_taller',
      pasoActualId: 'p_refri',
      enProceso: deleteField(),
      cicloActual: 2,
      historialAcciones: arrayUnion({ accion: 'paso_rechazado', usuarioId: 'per', usuarioNombre: 'Personal Uno', timestamp: new Date() }),
      updatedAt: new Date(),
    }))
  })

  test('heladeras_encargado SÍ puede liberar forzado una heladera trabada', async () => {
    await seedEncargado()
    await seedCatalogoPasos()
    await seedHeladera({ pasoActualId: 'p_lijado', enProceso: { uid: 'otro', nombre: 'Se olvidó', area: 'lijado', desde: new Date() } })
    await assertSucceeds(updateDoc(doc(db('enc'), 'heladeras/h1'), {
      enProceso: deleteField(),
      historialAcciones: arrayUnion({ accion: 'liberada_por_encargado', usuarioId: 'enc', usuarioNombre: 'Encargado', timestamp: new Date() }),
      updatedAt: new Date(),
    }))
  })

  // ── Pipeline de fabricación (heladeras nuevas, sin motivo de ingreso) ────
  test('personal de plástico SÍ puede agarrar una heladera de fabricación en el primer paso', async () => {
    await seedPersonal('per', 'plastico')
    await seedCatalogoPasos()
    await seedHeladera({
      tipoPipeline: 'fabricacion', pasoActualId: 'p_plastico', primerPasoId: 'p_plastico',
      motivoIngresoId: null, motivoIngresoNombre: null, tipoOperacion: null,
    })
    await assertSucceeds(updateDoc(doc(db('per'), 'heladeras/h1'), {
      enProceso: { uid: 'per', nombre: 'Personal Uno', area: 'plastico', desde: new Date() },
      updatedAt: new Date(),
    }))
  })

  test('personal de terminación SÍ puede soltar el último paso de fabricación (pasa a disponible, sin control de calidad)', async () => {
    await seedPersonal('per', 'terminacion')
    await seedCatalogoPasos()
    await seedHeladera({
      tipoPipeline: 'fabricacion', pasoActualId: 'p_termina', primerPasoId: 'p_plastico',
      motivoIngresoId: null, motivoIngresoNombre: null, tipoOperacion: null,
      enProceso: { uid: 'per', nombre: 'Personal Uno', area: 'terminacion', desde: new Date() },
    })
    await assertSucceeds(updateDoc(doc(db('per'), 'heladeras/h1'), {
      estado: 'disponible',
      pasoActualId: null,
      enProceso: deleteField(),
      historialAcciones: arrayUnion({ accion: 'paso_completado', usuarioId: 'per', usuarioNombre: 'Personal Uno', timestamp: new Date(), detalle: 'listo' }),
      updatedAt: new Date(),
    }))
  })

  test('un cliente NO puede leer heladeras que no son suyas', async () => {
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente()))
    await seedHeladera()
    await assertFails(getDoc(doc(db('cli', 'c@x.com'), 'heladeras/h1')))
  })

  test('un cliente SÍ puede leer su propia heladera asignada (en comodato)', async () => {
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente()))
    await seedHeladera({ estado: 'en_comodato', pasoActualId: null, clienteAsignadoId: 'cli', clienteAsignadoNombre: 'Cliente de Prueba' })
    await assertSucceeds(getDoc(doc(db('cli', 'c@x.com'), 'heladeras/h1')))
    await assertFails(updateDoc(doc(db('cli', 'c@x.com'), 'heladeras/h1'), { motivoBaja: 'test', updatedAt: new Date() }))
  })

  test('un cliente NO puede leer la heladera asignada a OTRO cliente', async () => {
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente()))
    await seedHeladera({ estado: 'en_comodato', pasoActualId: null, clienteAsignadoId: 'otro-cliente', clienteAsignadoNombre: 'Otro Cliente' })
    await assertFails(getDoc(doc(db('cli', 'c@x.com'), 'heladeras/h1')))
  })

  test('un chofer NO puede leer ni escribir heladeras', async () => {
    await seed((d) => setDoc(doc(d, 'users/ch'), { rol: 'chofer', estado: 'activo', email: 'ch@x.com' }))
    await seedHeladera()
    await assertFails(getDoc(doc(db('ch', 'ch@x.com'), 'heladeras/h1')))
  })

  test('un técnico SÍ puede leer heladeras (escanea el QR de la etiqueta) pero NO escribir', async () => {
    await seed((d) => setDoc(doc(d, 'users/tec'), { rol: 'tecnico', estado: 'activo' }))
    await seedHeladera()
    await assertSucceeds(getDoc(doc(db('tec'), 'heladeras/h1')))
    await assertFails(updateDoc(doc(db('tec'), 'heladeras/h1'), { estado: 'disponible', updatedAt: new Date() }))
  })

  test('nadie puede borrar una heladera (ni el encargado)', async () => {
    await seedEncargado()
    await seedHeladera()
    await assertFails(deleteDoc(doc(db('enc'), 'heladeras/h1')))
  })

  test('gerente_comercial SÍ puede cargar y editar heladeras (mismo nivel que encargado)', async () => {
    await seed((d) => setDoc(doc(d, 'users/gc'), { rol: 'gerente_comercial', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('gc'), 'heladeras/h1'), heladera()))
    await assertSucceeds(updateDoc(doc(db('gc'), 'heladeras/h1'), { estado: 'baja', motivoBaja: 'test', updatedAt: new Date() }))
  })

  test('comercial SÍ puede leer heladeras pero NO puede escribir', async () => {
    await seed((d) => setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' }))
    await seedHeladera()
    await assertSucceeds(getDoc(doc(db('com'), 'heladeras/h1')))
    await assertFails(updateDoc(doc(db('com'), 'heladeras/h1'), { estado: 'disponible', updatedAt: new Date() }))
    await assertFails(setDoc(doc(db('com'), 'heladeras/h2'), heladera()))
  })

  test('gerente_general SÍ puede leer heladeras (panel de directores) pero NO puede escribir', async () => {
    await seed((d) => setDoc(doc(d, 'users/gg'), { rol: 'gerente_general', estado: 'activo' }))
    await seedHeladera()
    await assertSucceeds(getDoc(doc(db('gg'), 'heladeras/h1')))
    await assertFails(updateDoc(doc(db('gg'), 'heladeras/h1'), { estado: 'disponible', updatedAt: new Date() }))
    await assertFails(setDoc(doc(db('gg'), 'heladeras/h2'), heladera()))
  })
})

// ── asignacionesHeladera (remitos + comodatos) ────────────────────────────────
describe('asignacionesHeladera', () => {
  const asignacion = (extra = {}) => ({
    heladeraId: 'h1', heladeraCodigo: 'HL-001', clientId: 'cli', clientName: 'Cliente de Prueba SA',
    tipo: 'asignacion', numero: 1, firmaDataUrl: 'data:image/png;base64,xx', actor: { uid: 'enc', nombre: 'Encargado' },
    fecha: new Date(), ...extra,
  })

  test('heladeras_encargado SÍ puede crear una asignación', async () => {
    await seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'heladeras_encargado', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('enc'), 'asignacionesHeladera/a1'), asignacion()))
  })

  test('comercial SÍ puede leer asignaciones pero NO puede crear', async () => {
    await seed((d) => setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'asignacionesHeladera/a1'), asignacion()))
    await assertSucceeds(getDoc(doc(db('com'), 'asignacionesHeladera/a1')))
    await assertFails(setDoc(doc(db('com'), 'asignacionesHeladera/a2'), asignacion()))
  })

  test('personal de sector (rol heladeras) NO puede leer ni crear asignaciones', async () => {
    await seed((d) => setDoc(doc(d, 'users/per'), { rol: 'heladeras', estado: 'activo', area: 'refrigeracion' }))
    await seed((d) => setDoc(doc(d, 'asignacionesHeladera/a1'), asignacion()))
    await assertFails(getDoc(doc(db('per'), 'asignacionesHeladera/a1')))
    await assertFails(setDoc(doc(db('per'), 'asignacionesHeladera/a2'), asignacion()))
  })

  test('nadie puede editar ni borrar una asignación (ni el encargado) — append-only', async () => {
    await seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'heladeras_encargado', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'asignacionesHeladera/a1'), asignacion()))
    await assertFails(updateDoc(doc(db('enc'), 'asignacionesHeladera/a1'), { clientName: 'Otro' }))
    await assertFails(deleteDoc(doc(db('enc'), 'asignacionesHeladera/a1')))
  })

  test('cliente SÍ puede leer su propio historial de comodatos, pero no el de otro ni crear', async () => {
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente()))
    await seed((d) => setDoc(doc(d, 'asignacionesHeladera/a1'), asignacion()))
    await seed((d) => setDoc(doc(d, 'asignacionesHeladera/a2'), asignacion({ clientId: 'otro-cliente' })))
    await assertSucceeds(getDoc(doc(db('cli', 'c@x.com'), 'asignacionesHeladera/a1')))
    await assertFails(getDoc(doc(db('cli', 'c@x.com'), 'asignacionesHeladera/a2')))
    await assertFails(setDoc(doc(db('cli', 'c@x.com'), 'asignacionesHeladera/a3'), asignacion()))
  })
})

describe('config/movimientoHeladeraCounter', () => {
  test('heladeras_encargado SÍ puede escribir el contador', async () => {
    await seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'heladeras_encargado', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('enc'), 'config/movimientoHeladeraCounter'), { next: 2 }))
  })

  test('comercial NO puede escribir el contador', async () => {
    await seed((d) => setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' }))
    await assertFails(setDoc(doc(db('com'), 'config/movimientoHeladeraCounter'), { next: 2 }))
  })

  test('heladeras_encargado SÍ puede escribir el contador de tickets de service', async () => {
    await seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'heladeras_encargado', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('enc'), 'config/ticketServicioCounter'), { next: 2 }))
  })
})

// ── modelosHeladera ──────────────────────────────────────────────────────────
describe('modelosHeladera', () => {
  const modelo = (extra = {}) => ({
    nombre: 'Slim 300', medidas: { ancho: 60, alto: 150, profundo: 60 },
    capacidadBolsas: 40, activo: true, ...extra,
  })
  const seedEncargado = () => seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'heladeras_encargado', estado: 'activo' }))
  const seedPersonal  = () => seed((d) => setDoc(doc(d, 'users/per'), { rol: 'heladeras', estado: 'activo', area: 'refrigeracion' }))

  test('heladeras_encargado SÍ puede crear un modelo', async () => {
    await seedEncargado()
    await assertSucceeds(setDoc(doc(db('enc'), 'modelosHeladera/m1'), modelo()))
  })

  test('personal de sector NO puede crear un modelo', async () => {
    await seedPersonal()
    await assertFails(setDoc(doc(db('per'), 'modelosHeladera/m1'), modelo()))
  })

  test('personal de sector SÍ puede leer modelos (los necesita para el alta)', async () => {
    await seedPersonal()
    await seed((d) => setDoc(doc(d, 'modelosHeladera/m1'), modelo()))
    await assertSucceeds(getDoc(doc(db('per'), 'modelosHeladera/m1')))
  })

  test('un cliente NO puede leer modelos', async () => {
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente()))
    await seed((d) => setDoc(doc(d, 'modelosHeladera/m1'), modelo()))
    await assertFails(getDoc(doc(db('cli', 'c@x.com'), 'modelosHeladera/m1')))
  })
})

// ── heladeraCodigoIndex (anti-duplicado) ──────────────────────────────────────
describe('heladeraCodigoIndex', () => {
  test('heladeras_encargado SÍ puede crear un código nuevo', async () => {
    await seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'heladeras_encargado', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('enc'), 'heladeraCodigoIndex/HL-001'), { heladeraId: 'h1' }))
  })

  test('heladeras_encargado NO puede sobrescribir un código ya usado', async () => {
    await seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'heladeras_encargado', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'heladeraCodigoIndex/HL-001'), { heladeraId: 'h1' }))
    await assertFails(setDoc(doc(db('enc'), 'heladeraCodigoIndex/HL-001'), { heladeraId: 'h2' }))
  })

  test('personal de sector NO puede crear un código', async () => {
    await seed((d) => setDoc(doc(d, 'users/per'), { rol: 'heladeras', estado: 'activo', area: 'refrigeracion' }))
    await assertFails(setDoc(doc(db('per'), 'heladeraCodigoIndex/HL-001'), { heladeraId: 'h1' }))
  })
})

// ── motivos y tipos de reparación (config/*) ──────────────────────────────────
describe('motivos y tipos de reparación', () => {
  test('heladeras_encargado SÍ puede escribir motivosReparacion y tiposReparacion', async () => {
    await seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'heladeras_encargado', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('enc'), 'config/motivosReparacion'), { items: [] }))
    await assertSucceeds(setDoc(doc(db('enc'), 'config/tiposReparacion'), { items: [] }))
  })

  test('heladeras_encargado SÍ puede escribir motivosIngreso', async () => {
    await seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'heladeras_encargado', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('enc'), 'config/motivosIngreso'), { items: [] }))
  })

  test('heladeras_encargado SÍ puede escribir pasosTaller', async () => {
    await seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'heladeras_encargado', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('enc'), 'config/pasosTaller'), { pasos: {} }))
  })

  test('comercial NO puede escribir motivosReparacion', async () => {
    await seed((d) => setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' }))
    await assertFails(setDoc(doc(db('com'), 'config/motivosReparacion'), { items: [] }))
  })

  test('comercial NO puede escribir motivosIngreso', async () => {
    await seed((d) => setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' }))
    await assertFails(setDoc(doc(db('com'), 'config/motivosIngreso'), { items: [] }))
  })

  test('comercial NO puede escribir pasosTaller', async () => {
    await seed((d) => setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' }))
    await assertFails(setDoc(doc(db('com'), 'config/pasosTaller'), { pasos: {} }))
  })

  test('cualquier staff puede leer motivosReparacion', async () => {
    await seed((d) => setDoc(doc(d, 'users/per'), { rol: 'heladeras', estado: 'activo', area: 'refrigeracion' }))
    await seed((d) => setDoc(doc(d, 'config/motivosReparacion'), { items: [] }))
    await assertSucceeds(getDoc(doc(db('per'), 'config/motivosReparacion')))
  })
})

// ── rol técnico (fase 2) ──────────────────────────────────────────────────────
describe('tecnicoDniIndex', () => {
  test('lectura pública de tecnicoDniIndex sin autenticar', async () => {
    await seed((d) => setDoc(doc(d, 'tecnicoDniIndex/36024287'), { email: 'tec@tecnico.rolito.internal' }))
    await assertSucceeds(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'tecnicoDniIndex/36024287')))
  })

  test('heladeras_encargado SÍ puede escribir tecnicoDniIndex', async () => {
    await seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'heladeras_encargado', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('enc'), 'tecnicoDniIndex/36024287'), { email: 'tec@tecnico.rolito.internal' }))
  })

  test('comercial NO puede escribir tecnicoDniIndex', async () => {
    await seed((d) => setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' }))
    await assertFails(setDoc(doc(db('com'), 'tecnicoDniIndex/36024287'), { email: 'tec@tecnico.rolito.internal' }))
  })
})

describe('users — alta y gestión de técnicos', () => {
  const tecnico = (extra = {}) => ({
    rol: 'tecnico', estado: 'activo', nombre: 'Técnico Uno', dni: '36024287', ...extra,
  })

  test('heladeras_encargado SÍ puede dar de alta un técnico', async () => {
    await seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'heladeras_encargado', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('enc'), 'users/tec1'), tecnico()))
  })

  test('gerente_comercial SÍ puede dar de alta un técnico', async () => {
    await seed((d) => setDoc(doc(d, 'users/gc'), { rol: 'gerente_comercial', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('gc'), 'users/tec1'), tecnico()))
  })

  test('comercial NO puede dar de alta un técnico', async () => {
    await seed((d) => setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' }))
    await assertFails(setDoc(doc(db('com'), 'users/tec1'), tecnico()))
  })

  test('heladeras_encargado SÍ puede leer la ficha de un técnico', async () => {
    await seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'heladeras_encargado', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'users/tec1'), tecnico()))
    await assertSucceeds(getDoc(doc(db('enc'), 'users/tec1')))
  })

  test('heladeras_encargado SÍ puede activar/desactivar un técnico (solo el campo estado)', async () => {
    await seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'heladeras_encargado', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'users/tec1'), tecnico()))
    await assertSucceeds(updateDoc(doc(db('enc'), 'users/tec1'), { estado: 'inactivo' }))
  })

  test('heladeras_encargado NO puede tocar otros campos de un técnico (ej. nombre)', async () => {
    await seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'heladeras_encargado', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'users/tec1'), tecnico()))
    await assertFails(updateDoc(doc(db('enc'), 'users/tec1'), { nombre: 'Otro Nombre' }))
  })

  test('heladeras_encargado NO puede tocar el estado de un usuario que no es técnico', async () => {
    await seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'heladeras_encargado', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'users/ch1'), { rol: 'chofer', estado: 'activo' }))
    await assertFails(updateDoc(doc(db('enc'), 'users/ch1'), { estado: 'inactivo' }))
  })
})

// ── ticketsServicio ────────────────────────────────────────────────────────
describe('ticketsServicio', () => {
  const ticket = (extra = {}) => ({
    numero: 1, heladeraId: 'h1', heladeraCodigo: 'HL-001', clientId: 'cli', clientName: 'Cliente de Prueba SA',
    motivoId: 'm1', motivoNombre: 'No enfría', requiereChofer: false, urgente: false, origen: 'staff',
    estado: 'abierto', asignadoA: null,
    historialAcciones: [], fechaPedido: new Date(), createdAt: new Date(), updatedAt: new Date(), ...extra,
  })
  const seedEncargado = () => seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'heladeras_encargado', estado: 'activo' }))
  const seedTecnico   = (uid = 'tec') => seed((d) => setDoc(doc(d, `users/${uid}`), { rol: 'tecnico', estado: 'activo' }))
  const seedChofer    = (uid = 'ch')  => seed((d) => setDoc(doc(d, `users/${uid}`), { rol: 'chofer', estado: 'activo', email: 'ch@x.com' }))

  test('heladeras_encargado SÍ puede crear un ticket', async () => {
    await seedEncargado()
    await assertSucceeds(setDoc(doc(db('enc'), 'ticketsServicio/t1'), ticket()))
  })

  test('comercial NO puede leer ni crear tickets', async () => {
    await seed((d) => setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'ticketsServicio/t1'), ticket()))
    await assertFails(getDoc(doc(db('com'), 'ticketsServicio/t1')))
    await assertFails(setDoc(doc(db('com'), 'ticketsServicio/t2'), ticket()))
  })

  test('cliente SÍ puede leer su propio ticket, pero no editarlo, y no puede crear uno para una heladera ajena', async () => {
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente()))
    await seed((d) => setDoc(doc(d, 'ticketsServicio/t1'), ticket()))
    await assertSucceeds(getDoc(doc(db('cli', 'c@x.com'), 'ticketsServicio/t1')))
    // No hay heladera 'h1' asignada a 'cli' → falla la verificación de dueño.
    await assertFails(setDoc(doc(db('cli', 'c@x.com'), 'ticketsServicio/t2'), ticket()))
    await assertFails(updateDoc(doc(db('cli', 'c@x.com'), 'ticketsServicio/t1'), { estado: 'cerrado' }))
  })

  test('cliente SÍ puede autogestionar un pedido de service para SU PROPIA heladera', async () => {
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente()))
    await seed((d) => setDoc(doc(d, 'heladeras/h1'), { estado: 'en_comodato', clienteAsignadoId: 'cli', historialAcciones: [] }))
    await assertSucceeds(setDoc(doc(db('cli', 'c@x.com'), 'ticketsServicio/t1'), ticket({ origen: 'cliente' })))
  })

  test('cliente NO puede pedir service para la heladera de OTRO cliente', async () => {
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente()))
    await seed((d) => setDoc(doc(d, 'heladeras/h1'), { estado: 'en_comodato', clienteAsignadoId: 'otro-cliente', historialAcciones: [] }))
    await assertFails(setDoc(doc(db('cli', 'c@x.com'), 'ticketsServicio/t1'), ticket()))
  })

  test('cliente NO puede crear un ticket a nombre de otro clientId', async () => {
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente()))
    await seed((d) => setDoc(doc(d, 'heladeras/h1'), { estado: 'en_comodato', clienteAsignadoId: 'cli', historialAcciones: [] }))
    await assertFails(setDoc(doc(db('cli', 'c@x.com'), 'ticketsServicio/t1'), ticket({ clientId: 'otro-cliente' })))
  })

  test('cliente NO puede crear el ticket ya asignado o cerrado', async () => {
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente()))
    await seed((d) => setDoc(doc(d, 'heladeras/h1'), { estado: 'en_comodato', clienteAsignadoId: 'cli', historialAcciones: [] }))
    await assertFails(setDoc(doc(db('cli', 'c@x.com'), 'ticketsServicio/t1'), ticket({ estado: 'cerrado' })))
    await assertFails(setDoc(doc(db('cli', 'c@x.com'), 'ticketsServicio/t1'), ticket({
      asignadoA: { tipo: 'tecnico', uid: 'tec', nombre: 'Técnico Uno' },
    })))
  })

  test('cliente NO puede leer el ticket de OTRO cliente', async () => {
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente()))
    await seed((d) => setDoc(doc(d, 'ticketsServicio/t1'), ticket({ clientId: 'otro-cliente' })))
    await assertFails(getDoc(doc(db('cli', 'c@x.com'), 'ticketsServicio/t1')))
  })

  test('técnico NO puede leer un ticket que no le asignaron', async () => {
    await seedTecnico()
    await seed((d) => setDoc(doc(d, 'ticketsServicio/t1'), ticket()))
    await assertFails(getDoc(doc(db('tec'), 'ticketsServicio/t1')))
  })

  test('técnico SÍ puede leer y registrar trabajo en su propio ticket asignado', async () => {
    await seedTecnico()
    await seed((d) => setDoc(doc(d, 'ticketsServicio/t1'), ticket({
      estado: 'asignado_tecnico', asignadoA: { tipo: 'tecnico', uid: 'tec', nombre: 'Técnico Uno' },
    })))
    await assertSucceeds(getDoc(doc(db('tec'), 'ticketsServicio/t1')))
    await assertSucceeds(updateDoc(doc(db('tec'), 'ticketsServicio/t1'), {
      tipoReparacionId: 'tr1', tipoReparacionNombre: 'Cambio termostato', trabajoRealizado: 'listo', updatedAt: new Date(),
    }))
  })

  test('técnico SÍ puede registrar trabajo con el checklist (trabajosRealizados)', async () => {
    await seedTecnico()
    await seed((d) => setDoc(doc(d, 'ticketsServicio/t1'), ticket({
      estado: 'asignado_tecnico', asignadoA: { tipo: 'tecnico', uid: 'tec', nombre: 'Técnico Uno' },
    })))
    await assertSucceeds(updateDoc(doc(db('tec'), 'ticketsServicio/t1'), {
      trabajosRealizados: [{ tipoId: 'tr1', tipoNombre: 'Cambio termostato' }],
      trabajoRealizado: 'Cambio termostato', updatedAt: new Date(),
    }))
  })

  test('técnico NO puede cerrar el ticket ni cambiarle el estado', async () => {
    await seedTecnico()
    await seed((d) => setDoc(doc(d, 'ticketsServicio/t1'), ticket({
      estado: 'asignado_tecnico', asignadoA: { tipo: 'tecnico', uid: 'tec', nombre: 'Técnico Uno' },
    })))
    await assertFails(updateDoc(doc(db('tec'), 'ticketsServicio/t1'), { estado: 'cerrado' }))
  })

  test('técnico NO puede registrar trabajo en el ticket de otro técnico', async () => {
    await seedTecnico('tec')
    await seed((d) => setDoc(doc(d, 'ticketsServicio/t1'), ticket({
      estado: 'asignado_tecnico', asignadoA: { tipo: 'tecnico', uid: 'otro-tec', nombre: 'Otro Técnico' },
    })))
    await assertFails(updateDoc(doc(db('tec'), 'ticketsServicio/t1'), { trabajoRealizado: 'listo', updatedAt: new Date() }))
  })

  test('chofer SÍ puede marcar hecho su propio traslado, sin tocar tipoReparacion', async () => {
    await seedChofer()
    await seed((d) => setDoc(doc(d, 'ticketsServicio/t1'), ticket({
      requiereChofer: true, estado: 'asignado_chofer', asignadoA: { tipo: 'chofer', uid: 'ch', nombre: 'Chofer Uno' },
    })))
    await assertSucceeds(updateDoc(doc(db('ch'), 'ticketsServicio/t1'), { trabajoRealizado: 'retirado', updatedAt: new Date() }))
    await assertFails(updateDoc(doc(db('ch'), 'ticketsServicio/t1'), { tipoReparacionId: 'tr1', updatedAt: new Date() }))
  })

  test('heladeras_encargado SÍ puede asignar, cerrar y anular', async () => {
    await seedEncargado()
    await seed((d) => setDoc(doc(d, 'ticketsServicio/t1'), ticket()))
    await assertSucceeds(updateDoc(doc(db('enc'), 'ticketsServicio/t1'), {
      estado: 'asignado_tecnico', asignadoA: { tipo: 'tecnico', uid: 'tec', nombre: 'Técnico Uno' }, updatedAt: new Date(),
    }))
    await assertSucceeds(updateDoc(doc(db('enc'), 'ticketsServicio/t1'), {
      estado: 'cerrado', conformidad: { firmaDataUrl: 'x', nombreQuienConfirma: 'Juan' }, cerradoPor: { uid: 'enc', nombre: 'Encargado' }, updatedAt: new Date(),
    }))
  })

  test('nadie puede borrar un ticket (ni el encargado)', async () => {
    await seedEncargado()
    await seed((d) => setDoc(doc(d, 'ticketsServicio/t1'), ticket()))
    await assertFails(deleteDoc(doc(db('enc'), 'ticketsServicio/t1')))
  })

  test('cliente SÍ puede incrementar en 1 el contador de tickets, pero no resetearlo ni tocar otro campo', async () => {
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente()))
    await seed((d) => setDoc(doc(d, 'config/ticketServicioCounter'), { next: 5 }))
    await assertSucceeds(updateDoc(doc(db('cli', 'c@x.com'), 'config/ticketServicioCounter'), { next: 6 }))
    await assertFails(updateDoc(doc(db('cli', 'c@x.com'), 'config/ticketServicioCounter'), { next: 1 }))
    await assertFails(updateDoc(doc(db('cli', 'c@x.com'), 'config/ticketServicioCounter'), { next: 6, otro: 'x' }))
  })

  test('cliente SÍ puede dejar una línea en el historial de SU heladera al pedir service, pero no tocar otro campo ni la de otro cliente', async () => {
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente()))
    await seed((d) => setDoc(doc(d, 'heladeras/h1'), { estado: 'en_comodato', clienteAsignadoId: 'cli', historialAcciones: [] }))
    await seed((d) => setDoc(doc(d, 'heladeras/h2'), { estado: 'en_comodato', clienteAsignadoId: 'otro-cliente', historialAcciones: [] }))
    await assertSucceeds(updateDoc(doc(db('cli', 'c@x.com'), 'heladeras/h1'), {
      historialAcciones: arrayUnion({ accion: 'service_abierto', usuarioId: 'cli', timestamp: new Date() }), updatedAt: new Date(),
    }))
    await assertFails(updateDoc(doc(db('cli', 'c@x.com'), 'heladeras/h1'), { estado: 'baja' }))
    await assertFails(updateDoc(doc(db('cli', 'c@x.com'), 'heladeras/h2'), {
      historialAcciones: arrayUnion({ accion: 'service_abierto', usuarioId: 'cli', timestamp: new Date() }), updatedAt: new Date(),
    }))
  })
})

// ── preventivos ──────────────────────────────────────────────────────────────
describe('preventivos', () => {
  const preventivo = (extra = {}) => ({
    clientId: 'cli', year: 2026, hecho: true, fecha: new Date(), actor: { uid: 'enc', nombre: 'Encargado' }, ...extra,
  })

  test('heladeras_encargado SÍ puede marcar un preventivo hecho', async () => {
    await seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'heladeras_encargado', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('enc'), 'preventivos/cli_2026'), preventivo()))
  })

  test('gerente_comercial SÍ puede marcar un preventivo hecho', async () => {
    await seed((d) => setDoc(doc(d, 'users/gc'), { rol: 'gerente_comercial', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('gc'), 'preventivos/cli_2026'), preventivo()))
  })

  test('comercial SÍ puede leer preventivos pero NO puede escribir', async () => {
    await seed((d) => setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'preventivos/cli_2026'), preventivo()))
    await assertSucceeds(getDoc(doc(db('com'), 'preventivos/cli_2026')))
    await assertFails(setDoc(doc(db('com'), 'preventivos/cli_2026'), preventivo({ hecho: false })))
  })

  test('personal de sector (rol heladeras) NO puede leer ni escribir preventivos', async () => {
    await seed((d) => setDoc(doc(d, 'users/per'), { rol: 'heladeras', estado: 'activo', area: 'refrigeracion' }))
    await seed((d) => setDoc(doc(d, 'preventivos/cli_2026'), preventivo()))
    await assertFails(getDoc(doc(db('per'), 'preventivos/cli_2026')))
    await assertFails(setDoc(doc(db('per'), 'preventivos/cli_2026'), preventivo()))
  })

  test('heladeras_encargado SÍ puede desmarcar (borrar) un preventivo', async () => {
    await seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'heladeras_encargado', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'preventivos/cli_2026'), preventivo()))
    await assertSucceeds(deleteDoc(doc(db('enc'), 'preventivos/cli_2026')))
  })
})

// ── pañol ──────────────────────────────────────────────────────────────────
describe('panolArticulos', () => {
  const articulo = (extra = {}) => ({
    nombre: 'Termostato', codigoBarras: '7791234567890', unidad: 'unidad',
    stockActual: 5, stockMinimo: 2, stockMaximo: 20, ...extra,
  })

  test('heladeras_encargado SÍ puede crear un artículo', async () => {
    await seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'heladeras_encargado', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('enc'), 'panolArticulos/a1'), articulo()))
  })

  test('técnico SÍ puede leer artículos pero NO puede escribir', async () => {
    await seed((d) => setDoc(doc(d, 'users/tec'), { rol: 'tecnico', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'panolArticulos/a1'), articulo()))
    await assertSucceeds(getDoc(doc(db('tec'), 'panolArticulos/a1')))
    await assertFails(updateDoc(doc(db('tec'), 'panolArticulos/a1'), { stockActual: 999 }))
  })

  test('comercial NO puede leer artículos del pañol', async () => {
    await seed((d) => setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'panolArticulos/a1'), articulo()))
    await assertFails(getDoc(doc(db('com'), 'panolArticulos/a1')))
  })
})

describe('panolMovimientos', () => {
  const movimiento = (extra = {}) => ({
    tipo: 'entrega', articulos: [{ articuloId: 'a1', nombre: 'Termostato', cantidad: 2 }],
    destinatario: { uid: 'tec', nombre: 'Técnico Uno', rol: 'tecnico' },
    confirmado: false, firmaDataUrl: null, confirmadoAt: null,
    actor: { uid: 'enc', nombre: 'Encargado' }, fecha: new Date(), ...extra,
  })

  test('heladeras_encargado SÍ puede registrar una entrega', async () => {
    await seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'heladeras_encargado', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('enc'), 'panolMovimientos/m1'), movimiento()))
  })

  test('técnico SÍ puede leer su propia entrega, pero NO la de otro técnico', async () => {
    await seed((d) => setDoc(doc(d, 'users/tec'), { rol: 'tecnico', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'panolMovimientos/m1'), movimiento()))
    await assertSucceeds(getDoc(doc(db('tec'), 'panolMovimientos/m1')))

    await seed((d) => setDoc(doc(d, 'users/otro-tec'), { rol: 'tecnico', estado: 'activo' }))
    await assertFails(getDoc(doc(db('otro-tec'), 'panolMovimientos/m1')))
  })

  test('técnico SÍ puede firmar para confirmar su propia entrega', async () => {
    await seed((d) => setDoc(doc(d, 'users/tec'), { rol: 'tecnico', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'panolMovimientos/m1'), movimiento()))
    await assertSucceeds(updateDoc(doc(db('tec'), 'panolMovimientos/m1'), {
      confirmado: true, firmaDataUrl: 'data:image/png;base64,xx', confirmadoAt: new Date(),
    }))
  })

  test('técnico NO puede confirmar una entrega ya confirmada', async () => {
    await seed((d) => setDoc(doc(d, 'users/tec'), { rol: 'tecnico', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'panolMovimientos/m1'), movimiento({ confirmado: true })))
    await assertFails(updateDoc(doc(db('tec'), 'panolMovimientos/m1'), { firmaDataUrl: 'x', confirmadoAt: new Date() }))
  })

  test('técnico NO puede tocar otros campos al confirmar', async () => {
    await seed((d) => setDoc(doc(d, 'users/tec'), { rol: 'tecnico', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'panolMovimientos/m1'), movimiento()))
    await assertFails(updateDoc(doc(db('tec'), 'panolMovimientos/m1'), {
      confirmado: true, firmaDataUrl: 'x', confirmadoAt: new Date(), articulos: [],
    }))
  })

  test('nadie puede borrar un movimiento (ni el encargado)', async () => {
    await seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'heladeras_encargado', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'panolMovimientos/m1'), movimiento()))
    await assertFails(deleteDoc(doc(db('enc'), 'panolMovimientos/m1')))
  })
})

// ── pedidos-recurrentes ────────────────────────────────────────────────────
describe('pedidos-recurrentes', () => {
  test('cliente SÍ puede escribir su propio pedido recurrente', async () => {
    await assertSucceeds(setDoc(doc(db('cli', 'c@x.com'), 'pedidos-recurrentes/cli'), { activo: true }))
  })

  test('cliente NO puede escribir el pedido recurrente de otro', async () => {
    await assertFails(setDoc(doc(db('cli', 'c@x.com'), 'pedidos-recurrentes/otro'), { activo: true }))
  })

  test('operador SÍ puede leer/escribir cualquier pedido recurrente', async () => {
    await seed((d) => setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('ops'), 'pedidos-recurrentes/cli'), { activo: true }))
  })
})

// ── historialPrecios: colección eliminada (2026-09-03) ───────────────────────
describe('historialPrecios — eliminado', () => {
  test('ni un gerente comercial puede crear o leer eventos de historial', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/gc'), { rol: 'gerente_comercial', estado: 'activo' })
      await setDoc(doc(d, 'historialPrecios/ev1'), { clientId: 'cli', tipo: 'lista' })
    })
    await assertFails(setDoc(doc(db('gc'), 'historialPrecios/ev2'), { clientId: 'cli', tipo: 'lista' }))
    await assertFails(getDoc(doc(db('gc'), 'historialPrecios/ev1')))
  })
})

// ── historialAdmin — auditoría del Backoffice (Fase 4) ────────────────────────
describe('historialAdmin — auditoría del Backoffice', () => {
  test('staff SÍ puede crear su propio evento', async () => {
    await seed((d) => setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('ops'), 'historialAdmin/ev1'), {
      coleccion: 'flota', docId: 'c1', accion: 'creado', riesgo: 'rutina',
      actor: { uid: 'ops', nombre: 'Ops', rol: 'logistica' },
    }))
  })

  test('staff NO puede crear un evento a nombre de otro actor (spoof)', async () => {
    await seed((d) => setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' }))
    await assertFails(setDoc(doc(db('ops'), 'historialAdmin/ev1'), {
      coleccion: 'flota', docId: 'c1', accion: 'creado', riesgo: 'rutina',
      actor: { uid: 'otro-uid', nombre: 'Ops', rol: 'logistica' },
    }))
  })

  test('cliente NO puede crear un evento', async () => {
    await assertFails(setDoc(doc(db('cli', 'c@x.com'), 'historialAdmin/ev1'), {
      coleccion: 'flota', docId: 'c1', accion: 'creado', riesgo: 'rutina',
      actor: { uid: 'cli', nombre: 'Cliente', rol: 'cliente' },
    }))
  })

  test('super_admin SÍ puede leer historialAdmin', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/adm'), { rol: 'super_admin', estado: 'activo' })
      await setDoc(doc(d, 'historialAdmin/ev1'), {
        coleccion: 'flota', docId: 'c1', accion: 'creado', riesgo: 'rutina',
        actor: { uid: 'ops', nombre: 'Ops', rol: 'logistica' },
      })
    })
    await assertSucceeds(getDoc(doc(db('adm'), 'historialAdmin/ev1')))
  })

  test('logistica (no super_admin) NO puede leer historialAdmin', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' })
      await setDoc(doc(d, 'historialAdmin/ev1'), {
        coleccion: 'flota', docId: 'c1', accion: 'creado', riesgo: 'rutina',
        actor: { uid: 'ops', nombre: 'Ops', rol: 'logistica' },
      })
    })
    await assertFails(getDoc(doc(db('ops'), 'historialAdmin/ev1')))
  })

  test('nadie puede actualizar ni borrar un evento (ni super_admin)', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/adm'), { rol: 'super_admin', estado: 'activo' })
      await setDoc(doc(d, 'historialAdmin/ev1'), {
        coleccion: 'flota', docId: 'c1', accion: 'creado', riesgo: 'rutina',
        actor: { uid: 'ops', nombre: 'Ops', rol: 'logistica' },
      })
    })
    await assertFails(updateDoc(doc(db('adm'), 'historialAdmin/ev1'), { accion: 'modificado' }))
    await assertFails(deleteDoc(doc(db('adm'), 'historialAdmin/ev1')))
  })
})

// ── config / configuracion ─────────────────────────────────────────────────
describe('config y configuracion', () => {
  test('el cliente SÍ puede leer config/catalogo (lo necesita para pedir)', async () => {
    await seed((d) => setDoc(doc(d, 'config/catalogo'), { productos: [] }))
    await assertSucceeds(getDoc(doc(db('cli', 'c@x.com'), 'config/catalogo')))
  })

  test('el cliente NO puede leer config operativo (zonas)', async () => {
    await seed((d) => setDoc(doc(d, 'config/zonasProhibidas'), { zonas: [] }))
    await assertFails(getDoc(doc(db('cli', 'c@x.com'), 'config/zonasProhibidas')))
  })

  test('un operador SÍ puede leer config operativo (zonas)', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' })
      await setDoc(doc(d, 'config/zonasProhibidas'), { zonas: [] })
    })
    await assertSucceeds(getDoc(doc(db('ops'), 'config/zonasProhibidas')))
  })

  test('comercial NO puede escribir config genérico (no-catalogo)', async () => {
    await seed((d) => setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' }))
    await assertFails(setDoc(doc(db('com'), 'config/zonas'), { data: [] }))
  })

  test('operador SÍ puede escribir config genérico', async () => {
    await seed((d) => setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('ops'), 'config/zonas'), { data: [] }))
  })

  test('el cliente NO puede leer configuracion (emails de staff, modoTest)', async () => {
    await seed((d) => setDoc(doc(d, 'configuracion/notificaciones'), { emails: [] }))
    await assertFails(getDoc(doc(db('cli', 'c@x.com'), 'configuracion/notificaciones')))
  })

  test('un operador SÍ puede leer configuracion', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' })
      await setDoc(doc(d, 'configuracion/notificaciones'), { emails: [] })
    })
    await assertSucceeds(getDoc(doc(db('ops'), 'configuracion/notificaciones')))
  })

  test('comercial NO puede escribir configuracion', async () => {
    await seed((d) => setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' }))
    await assertFails(setDoc(doc(db('com'), 'configuracion/emails'), { emails: [] }))
  })
})

// ── programas-visita / visitas-puntuales ──────────────────────────────────
describe('programas-visita y visitas-puntuales', () => {
  test('operador SÍ puede escribir un programa de visita', async () => {
    await seed((d) => setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('ops'), 'programas-visita/p1'), { clientId: 'cli', diasSemana: [1] }))
  })

  test('comercial NO puede escribir un programa de visita', async () => {
    await seed((d) => setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' }))
    await assertFails(setDoc(doc(db('com'), 'programas-visita/p1'), { clientId: 'cli', diasSemana: [1] }))
  })

  const seedVisita = () => seed((d) => setDoc(doc(d, 'visitas-puntuales/v1'), {
    clientId: 'cli', driverId: 'ch@x.com', status: 'pendiente',
  }))

  test('el chofer asignado SÍ puede actualizar status/notas de su visita', async () => {
    await seed((d) => setDoc(doc(d, 'users/ch'), { rol: 'chofer', estado: 'activo', email: 'ch@x.com' }))
    await seedVisita()
    await assertSucceeds(updateDoc(doc(db('ch', 'ch@x.com'), 'visitas-puntuales/v1'), { status: 'visitado', notas: 'ok' }))
  })

  test('el chofer NO puede reasignarse la visita a otro driverId', async () => {
    await seed((d) => setDoc(doc(d, 'users/ch'), { rol: 'chofer', estado: 'activo', email: 'ch@x.com' }))
    await seedVisita()
    await assertFails(updateDoc(doc(db('ch', 'ch@x.com'), 'visitas-puntuales/v1'), { driverId: 'ch2@x.com' }))
  })

  test('un chofer no asignado NO puede actualizar la visita de otro', async () => {
    await seed((d) => setDoc(doc(d, 'users/ch2'), { rol: 'chofer', estado: 'activo', email: 'ch2@x.com' }))
    await seedVisita()
    await assertFails(updateDoc(doc(db('ch2', 'ch2@x.com'), 'visitas-puntuales/v1'), { status: 'visitado' }))
  })
})

// ── índices de login: choferIndex / staffIndex / dniIndex / staffDniIndex ──
describe('índices de login', () => {
  test('lectura pública de choferIndex sin autenticar', async () => {
    await seed((d) => setDoc(doc(d, 'choferIndex/juanchofer'), { email: 'ch@x.com' }))
    await assertSucceeds(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'choferIndex/juanchofer')))
  })

  test('operador SÍ puede escribir choferIndex', async () => {
    await seed((d) => setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('ops'), 'choferIndex/juanchofer'), { email: 'ch@x.com' }))
  })

  test('comercial NO puede escribir choferIndex', async () => {
    await seed((d) => setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' }))
    await assertFails(setDoc(doc(db('com'), 'choferIndex/juanchofer'), { email: 'ch@x.com' }))
  })

  test('operador NO puede escribir staffIndex (requiere super_admin)', async () => {
    await seed((d) => setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' }))
    await assertFails(setDoc(doc(db('ops'), 'staffIndex/juan'), { email: 'staff@x.com' }))
  })

  test('super_admin SÍ puede escribir staffIndex', async () => {
    await seed((d) => setDoc(doc(d, 'users/adm'), { rol: 'super_admin', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('adm'), 'staffIndex/juan'), { email: 'staff@x.com' }))
  })

  test('operador SÍ puede escribir dniIndex', async () => {
    await seed((d) => setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('ops'), 'dniIndex/12345678'), { email: 'ch@x.com' }))
  })

  test('super_admin SÍ puede escribir staffDniIndex', async () => {
    await seed((d) => setDoc(doc(d, 'users/adm'), { rol: 'super_admin', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('adm'), 'staffDniIndex/12345678'), { email: 'staff@x.com' }))
  })
})

// ── produccionPallets: carga de pallets en planta ─────────────────────────────
describe('produccionPallets', () => {
  const seedOperario = (uid = 'op1', planta = 'torcuato') =>
    seed((d) => setDoc(doc(d, `users/${uid}`), { rol: 'produccion_hielo', estado: 'activo', planta }))

  const pallet = (extra = {}) => ({
    codigo: 'DT-000123', numero: 123, plantaId: 'torcuato',
    productoId: 'bolsas_10kg_rolito', unidades: 88,
    operador: { uid: 'op1', nombre: 'Juan' },
    fechaFabricacion: new Date(), createdAt: new Date(), ...extra,
  })

  test('operario puede cargar un pallet de SU planta', async () => {
    await seedOperario()
    await assertSucceeds(setDoc(doc(db('op1'), 'produccionPallets/p1'), pallet()))
  })

  test('operario NO puede cargar un pallet de OTRA planta', async () => {
    await seedOperario('op1', 'torcuato')
    await assertFails(setDoc(doc(db('op1'), 'produccionPallets/p1'), pallet({ plantaId: 'merlo' })))
  })

  test('operario NO puede spoofear el uid del operador', async () => {
    await seedOperario()
    await assertFails(setDoc(doc(db('op1'), 'produccionPallets/p1'), pallet({ operador: { uid: 'otro', nombre: 'Juan' } })))
  })

  test('operario NO puede cargar un producto fuera del catálogo', async () => {
    await seedOperario()
    await assertFails(setDoc(doc(db('op1'), 'produccionPallets/p1'), pallet({ productoId: 'inventado' })))
  })

  test('un pallet cargado no se puede editar ni borrar', async () => {
    await seedOperario()
    await seed((d) => setDoc(doc(d, 'produccionPallets/p1'), pallet()))
    await assertFails(updateDoc(doc(db('op1'), 'produccionPallets/p1'), { unidades: 999 }))
    await assertFails(deleteDoc(doc(db('op1'), 'produccionPallets/p1')))
  })

  test('gerente_general puede leer pallets pero no crearlos', async () => {
    await seed((d) => setDoc(doc(d, 'users/gg'), { rol: 'gerente_general', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'produccionPallets/p1'), pallet()))
    await assertSucceeds(getDoc(doc(db('gg'), 'produccionPallets/p1')))
    await assertFails(setDoc(doc(db('gg'), 'produccionPallets/p2'), pallet()))
  })

  test('cliente NO puede leer pallets', async () => {
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente()))
    await seed((d) => setDoc(doc(d, 'produccionPallets/p1'), pallet()))
    await assertFails(getDoc(doc(db('cli', 'c@x.com'), 'produccionPallets/p1')))
  })
})

// ── partesMaquinas: parte de máquinas del maquinista ──────────────────────────
describe('partesMaquinas', () => {
  const seedMaquinista = (uid = 'maq1', planta = 'torcuato') =>
    seed((d) => setDoc(doc(d, `users/${uid}`), { rol: 'produccion_hielo', subrol: 'maquinista', estado: 'activo', planta }))

  const parte = (extra = {}) => ({
    plantaId: 'torcuato', fecha: '2026-08-28', turno: 'manana',
    maquinista: { uid: 'maq1', nombre: 'Piris' },
    ciclos: [], maquinarias: {}, observaciones: '',
    createdAt: new Date(), updatedAt: new Date(), ...extra,
  })

  test('maquinista puede crear el parte de SU planta', async () => {
    await seedMaquinista()
    await assertSucceeds(setDoc(doc(db('maq1'), 'partesMaquinas/torcuato_2026-08-28_manana'), parte()))
  })

  test('maquinista NO puede crear un parte de OTRA planta', async () => {
    await seedMaquinista('maq1', 'torcuato')
    await assertFails(setDoc(doc(db('maq1'), 'partesMaquinas/merlo_2026-08-28_manana'), parte({ plantaId: 'merlo' })))
  })

  test('maquinista NO puede crear un parte con turno inventado', async () => {
    await seedMaquinista()
    await assertFails(setDoc(doc(db('maq1'), 'partesMaquinas/torcuato_2026-08-28_finde'), parte({ turno: 'finde' })))
  })

  test('maquinista puede estampar ciclos (update) en el parte de su planta', async () => {
    await seedMaquinista()
    await seed((d) => setDoc(doc(d, 'partesMaquinas/torcuato_2026-08-28_manana'), parte()))
    await assertSucceeds(updateDoc(doc(db('maq1'), 'partesMaquinas/torcuato_2026-08-28_manana'), {
      ciclos: [{ rolitera: 1, ciclo: 1, sale: new Date(), entra: null }],
    }))
  })

  test('maquinista NO puede editar un parte de otra planta ni reasignarle la planta', async () => {
    await seedMaquinista('maq1', 'torcuato')
    await seed((d) => setDoc(doc(d, 'partesMaquinas/merlo_2026-08-28_manana'), parte({ plantaId: 'merlo' })))
    await assertFails(updateDoc(doc(db('maq1'), 'partesMaquinas/merlo_2026-08-28_manana'), { observaciones: 'x' }))
    await seed((d) => setDoc(doc(d, 'partesMaquinas/torcuato_2026-08-28_manana'), parte()))
    await assertFails(updateDoc(doc(db('maq1'), 'partesMaquinas/torcuato_2026-08-28_manana'), { plantaId: 'merlo' }))
  })

  test('produccion_encargado puede corregir partes de cualquier planta', async () => {
    await seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'produccion_encargado', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'partesMaquinas/merlo_2026-08-28_tarde'), parte({ plantaId: 'merlo', turno: 'tarde' })))
    await assertSucceeds(updateDoc(doc(db('enc'), 'partesMaquinas/merlo_2026-08-28_tarde'), { observaciones: 'corregido' }))
  })

  test('gerente_general puede leer partes pero no crearlos', async () => {
    await seed((d) => setDoc(doc(d, 'users/gg'), { rol: 'gerente_general', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'partesMaquinas/torcuato_2026-08-28_manana'), parte()))
    await assertSucceeds(getDoc(doc(db('gg'), 'partesMaquinas/torcuato_2026-08-28_manana')))
    await assertFails(setDoc(doc(db('gg'), 'partesMaquinas/torcuato_2026-08-28_tarde'), parte({ turno: 'tarde' })))
  })

  test('nadie puede borrar un parte (ni el encargado)', async () => {
    await seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'produccion_encargado', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'partesMaquinas/torcuato_2026-08-28_manana'), parte()))
    await assertFails(deleteDoc(doc(db('enc'), 'partesMaquinas/torcuato_2026-08-28_manana')))
  })

  test('cliente NO puede leer partes', async () => {
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente()))
    await seed((d) => setDoc(doc(d, 'partesMaquinas/torcuato_2026-08-28_manana'), parte()))
    await assertFails(getDoc(doc(db('cli', 'c@x.com'), 'partesMaquinas/torcuato_2026-08-28_manana')))
  })
})

// ── tango-outbox: cola de salida app → Tango ──────────────────────────────────
describe('tango-outbox', () => {
  const seedBridge = (uid = 'bridge1') =>
    seed((d) => setDoc(doc(d, `users/${uid}`), { tangoBridge: true }))
  const seedOperador = (uid = 'sa') =>
    seed((d) => setDoc(doc(d, `users/${uid}`), { rol: 'super_admin', estado: 'activo' }))

  const item = (extra = {}) => ({
    entidad: 'produccionPallet', origenColeccion: 'produccionPallets', origenId: 'p1',
    payload: { codigo: 'DT-000123' }, estado: 'pendiente', intentos: 0, ultimoError: null,
    creadoEn: new Date(), actualizadoEn: new Date(), ...extra,
  })

  test('nadie puede crear un item vía cliente (solo lo crea el Admin SDK)', async () => {
    await seedBridge()
    await assertFails(setDoc(doc(db('bridge1'), 'tango-outbox/i1'), item()))
  })

  test('el bridge puede leer pendientes', async () => {
    await seedBridge()
    await seed((d) => setDoc(doc(d, 'tango-outbox/i1'), item()))
    await assertSucceeds(getDoc(doc(db('bridge1'), 'tango-outbox/i1')))
  })

  test('el bridge puede actualizar solo los campos de estado', async () => {
    await seedBridge()
    await seed((d) => setDoc(doc(d, 'tango-outbox/i1'), item()))
    await assertSucceeds(updateDoc(doc(db('bridge1'), 'tango-outbox/i1'), {
      estado: 'confirmado', intentos: 1, ultimoError: null, actualizadoEn: new Date(),
    }))
  })

  test('el bridge NO puede tocar el payload ni el origen', async () => {
    await seedBridge()
    await seed((d) => setDoc(doc(d, 'tango-outbox/i1'), item()))
    await assertFails(updateDoc(doc(db('bridge1'), 'tango-outbox/i1'), {
      estado: 'confirmado', payload: { codigo: 'FALSO' },
    }))
    await assertFails(updateDoc(doc(db('bridge1'), 'tango-outbox/i1'), {
      estado: 'confirmado', origenId: 'otro',
    }))
  })

  test('un operador puede leer pero no escribir', async () => {
    await seedOperador()
    await seed((d) => setDoc(doc(d, 'tango-outbox/i1'), item()))
    await assertSucceeds(getDoc(doc(db('sa'), 'tango-outbox/i1')))
    await assertFails(updateDoc(doc(db('sa'), 'tango-outbox/i1'), { estado: 'confirmado' }))
  })

  test('un cliente NO puede leer ni escribir', async () => {
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente()))
    await seed((d) => setDoc(doc(d, 'tango-outbox/i1'), item()))
    await assertFails(getDoc(doc(db('cli', 'c@x.com'), 'tango-outbox/i1')))
  })

  test('un operario de producción NO puede leer ni escribir', async () => {
    await seed((d) => setDoc(doc(d, 'users/op1'), { rol: 'produccion_hielo', estado: 'activo', planta: 'torcuato' }))
    await seed((d) => setDoc(doc(d, 'tango-outbox/i1'), item()))
    await assertFails(getDoc(doc(db('op1'), 'tango-outbox/i1')))
  })

  test('el bridge puede escribir el resultado (nº de remito de vuelta)', async () => {
    await seedBridge()
    await seed((d) => setDoc(doc(d, 'tango-outbox/i1'), item({ entidad: 'remito' })))
    await assertSucceeds(updateDoc(doc(db('bridge1'), 'tango-outbox/i1'), {
      estado: 'confirmado', resultado: { remitoNumero: '0001-00012345' }, actualizadoEn: new Date(),
    }))
  })
})

// ── tango-consultas: cola inversa (refresh on-demand de saldos) ──────────────
describe('tango-consultas', () => {
  const seedBridge = (uid = 'bridge1') =>
    seed((d) => setDoc(doc(d, `users/${uid}`), { tangoBridge: true }))
  const seedSupervisor = (uid = 'sup') =>
    seed((d) => setDoc(doc(d, `users/${uid}`), { rol: 'supervisor', estado: 'activo' }))

  const consulta = (extra = {}) => ({
    tipo: 'saldoCliente', clienteUid: 'cli', idGva14: 1234, empresa: 'redonhielo',
    solicitadoPor: { uid: 'sup', nombre: 'Supervisor' }, estado: 'pendiente',
    creadoEn: new Date(), ...extra,
  })

  test('supervisor crea una consulta bien formada', async () => {
    await seedSupervisor()
    await assertSucceeds(setDoc(doc(db('sup'), 'tango-consultas/c1'), consulta()))
  })

  test('supervisor NO crea a nombre de otro, con otro tipo, ni ya respondida', async () => {
    await seedSupervisor()
    await assertFails(setDoc(doc(db('sup'), 'tango-consultas/c1'), consulta({ solicitadoPor: { uid: 'otro', nombre: 'X' } })))
    await assertFails(setDoc(doc(db('sup'), 'tango-consultas/c2'), consulta({ tipo: 'otraCosa' })))
    await assertFails(setDoc(doc(db('sup'), 'tango-consultas/c3'), consulta({ estado: 'respondida' })))
  })

  test('un chofer NO crea consultas', async () => {
    await seed((d) => setDoc(doc(d, 'users/ch'), { rol: 'chofer', estado: 'activo' }))
    await assertFails(setDoc(doc(db('ch'), 'tango-consultas/c1'), consulta({ solicitadoPor: { uid: 'ch', nombre: 'Chofer' } })))
  })

  test('el bridge responde tocando solo los campos de estado', async () => {
    await seedBridge()
    await seed((d) => setDoc(doc(d, 'tango-consultas/c1'), consulta()))
    await assertSucceeds(updateDoc(doc(db('bridge1'), 'tango-consultas/c1'), {
      estado: 'respondida', resultado: { comprobantes: [], saldoTotal: 0 }, ultimoError: null, actualizadoEn: new Date(),
    }))
  })

  test('el bridge NO puede cambiar qué se preguntó ni por quién', async () => {
    await seedBridge()
    await seed((d) => setDoc(doc(d, 'tango-consultas/c1'), consulta()))
    await assertFails(updateDoc(doc(db('bridge1'), 'tango-consultas/c1'), {
      estado: 'respondida', clienteUid: 'otro',
    }))
    await assertFails(updateDoc(doc(db('bridge1'), 'tango-consultas/c1'), {
      estado: 'respondida', solicitadoPor: { uid: 'bridge1', nombre: 'Bridge' },
    }))
  })

  test('el creador lee su consulta; otro supervisor no', async () => {
    await seedSupervisor()
    await seed(async (d) => {
      await setDoc(doc(d, 'users/sup2'), { rol: 'supervisor', estado: 'activo' })
      await setDoc(doc(d, 'tango-consultas/c1'), consulta())
    })
    await assertSucceeds(getDoc(doc(db('sup'), 'tango-consultas/c1')))
    await assertFails(getDoc(doc(db('sup2'), 'tango-consultas/c1')))
  })
})

// ── ventasCamion: venta desde el camión (reparto a demanda) ───────────────────
describe('ventasCamion', () => {
  const venta = (extra = {}) => ({
    canal: 'contado', camionId: 'cam1', choferId: 'chof1', choferNombre: 'Chofer Uno',
    clienteId: 'cli', clienteNombre: 'Cliente SA',
    items: [{ productoId: 'bolsa_10kg', nombre: 'Hielo 10kg', cantidad: 5, precioUnitario: 100 }],
    total: 500, formaPago: 'contado_efectivo', fecha: new Date(),
    pedidoId: null, tango: { estado: 'pendiente' }, ...extra,
  })
  const seedChofer = (uid = 'chof1') =>
    seed((d) => setDoc(doc(d, `users/${uid}`), { rol: 'chofer', estado: 'activo' }))

  test('un chofer puede crear su propia venta', async () => {
    await seedChofer()
    await assertSucceeds(setDoc(doc(db('chof1'), 'ventasCamion/v1'), venta()))
  })

  test('un chofer NO puede crear una venta a nombre de otro chofer', async () => {
    await seedChofer()
    await assertFails(setDoc(doc(db('chof1'), 'ventasCamion/v1'), venta({ choferId: 'otro' })))
  })

  test('un chofer NO puede crear con forma de pago inválida', async () => {
    await seedChofer()
    await assertFails(setDoc(doc(db('chof1'), 'ventasCamion/v1'), venta({ formaPago: 'cripto' })))
  })

  test('un chofer NO puede crear con canal inválido', async () => {
    await seedChofer()
    await assertFails(setDoc(doc(db('chof1'), 'ventasCamion/v1'), venta({ canal: 'otro' })))
  })

  test('un chofer SÍ puede crear una venta Promo', async () => {
    await seedChofer()
    await assertSucceeds(setDoc(doc(db('chof1'), 'ventasCamion/v1'), venta({ canal: 'promo' })))
  })

  test('una venta puede llevar renglones de cambio', async () => {
    await seedChofer()
    await assertSucceeds(setDoc(doc(db('chof1'), 'ventasCamion/v1'), venta({
      cambios: [{ productoId: 'cambio_bolsa_10kg', nombre: 'Cambio Hielo 10kg', cantidad: 2, precioUnitario: 0 }],
    })))
  })

  test('los cambios tienen que ser una lista', async () => {
    await seedChofer()
    await assertFails(setDoc(doc(db('chof1'), 'ventasCamion/v1'), venta({ cambios: 'dos bolsas' })))
  })

  test('una venta de solo cambios (total 0) se puede registrar', async () => {
    await seedChofer()
    await assertSucceeds(setDoc(doc(db('chof1'), 'ventasCamion/v1'), venta({
      items: [], total: 0,
      cambios: [{ productoId: 'cambio_bolsa_10kg', nombre: 'Cambio Hielo 10kg', cantidad: 1, precioUnitario: 0 }],
    })))
  })

  test('una venta es inmutable tras crearse', async () => {
    await seedChofer()
    await seed((d) => setDoc(doc(d, 'ventasCamion/v1'), venta()))
    await assertFails(updateDoc(doc(db('chof1'), 'ventasCamion/v1'), { total: 999 }))
  })

  test('el chofer puede leer su propia venta pero no la de otro', async () => {
    await seedChofer()
    await seed((d) => setDoc(doc(d, 'ventasCamion/mia'), venta()))
    await seed((d) => setDoc(doc(d, 'ventasCamion/ajena'), venta({ choferId: 'otro' })))
    await assertSucceeds(getDoc(doc(db('chof1'), 'ventasCamion/mia')))
    await assertFails(getDoc(doc(db('chof1'), 'ventasCamion/ajena')))
  })

  test('un operador (super_admin) puede leer cualquier venta', async () => {
    await seed((d) => setDoc(doc(d, 'users/sa'), { rol: 'super_admin', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'ventasCamion/v1'), venta()))
    await assertSucceeds(getDoc(doc(db('sa'), 'ventasCamion/v1')))
  })

  test('un cliente NO puede leer ventas de camión', async () => {
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente()))
    await seed((d) => setDoc(doc(d, 'ventasCamion/v1'), venta()))
    await assertFails(getDoc(doc(db('cli', 'c@x.com'), 'ventasCamion/v1')))
  })

  test('el chofer puede leer un cliente registrado (para venderle desde el camión)', async () => {
    await seedChofer()
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente()))
    await assertSucceeds(getDoc(doc(db('chof1'), 'users/cli')))
  })

  test('el chofer NO puede modificar el doc de un cliente', async () => {
    await seedChofer()
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente()))
    await assertFails(updateDoc(doc(db('chof1'), 'users/cli'), { razonSocial: 'Hackeado' }))
  })
})

// ── config/produccionCounter_*: correlativo por planta ────────────────────────
describe('config/produccionCounter_*', () => {
  const seedSuperAdmin = (uid = 'sa') =>
    seed((d) => setDoc(doc(d, `users/${uid}`), { rol: 'super_admin', estado: 'activo' }))
  const seedOperario = (uid = 'op1', planta = 'torcuato') =>
    seed((d) => setDoc(doc(d, `users/${uid}`), { rol: 'produccion_hielo', estado: 'activo', planta }))

  test('super_admin puede inicializar el contador si no existe', async () => {
    await seedSuperAdmin()
    await assertSucceeds(setDoc(doc(db('sa'), 'config/produccionCounter_torcuato'), { next: 500 }))
  })

  test('operario puede reservar un lote (incrementar next)', async () => {
    await seedOperario()
    await seed((d) => setDoc(doc(d, 'config/produccionCounter_torcuato'), { next: 500 }))
    await assertSucceeds(updateDoc(doc(db('op1'), 'config/produccionCounter_torcuato'), { next: 530 }))
  })

  test('operario NO puede retroceder el contador', async () => {
    await seedOperario()
    await seed((d) => setDoc(doc(d, 'config/produccionCounter_torcuato'), { next: 500 }))
    await assertFails(updateDoc(doc(db('op1'), 'config/produccionCounter_torcuato'), { next: 499 }))
  })

  test('operario NO puede tocar otro campo del contador', async () => {
    await seedOperario()
    await seed((d) => setDoc(doc(d, 'config/produccionCounter_torcuato'), { next: 500 }))
    await assertFails(updateDoc(doc(db('op1'), 'config/produccionCounter_torcuato'), { next: 530, otro: 'x' }))
  })

  test('comercial NO puede inicializar el contador', async () => {
    await seed((d) => setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' }))
    await assertFails(setDoc(doc(db('com'), 'config/produccionCounter_merlo'), { next: 1 }))
  })
})

// ── users: alta de produccion_hielo ────────────────────────────────────────────
describe('users: alta de produccion_hielo', () => {
  test('super_admin puede dar de alta un operario', async () => {
    await seed((d) => setDoc(doc(d, 'users/sa'), { rol: 'super_admin', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('sa'), 'users/op1'), { rol: 'produccion_hielo', estado: 'activo', planta: 'torcuato' }))
  })

  test('un operario de producción NO puede darse de alta a sí mismo', async () => {
    await assertFails(setDoc(doc(db('op1'), 'users/op1'), { rol: 'produccion_hielo', estado: 'activo', planta: 'torcuato' }))
  })

  test('produccion_encargado SÍ puede dar de alta un operario', async () => {
    await seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'produccion_encargado', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('enc'), 'users/op2'), { rol: 'produccion_hielo', estado: 'activo', planta: 'merlo' }))
  })

  test('produccion_encargado SÍ puede activar/desactivar un operario (solo el campo estado)', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/enc'), { rol: 'produccion_encargado', estado: 'activo' })
      await setDoc(doc(d, 'users/op3'), { rol: 'produccion_hielo', estado: 'activo', planta: 'torcuato' })
    })
    await assertSucceeds(updateDoc(doc(db('enc'), 'users/op3'), { estado: 'inactivo' }))
  })

  test('produccion_encargado NO puede tocar otros campos de un operario (ej. nombre)', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/enc'), { rol: 'produccion_encargado', estado: 'activo' })
      await setDoc(doc(d, 'users/op4'), { rol: 'produccion_hielo', estado: 'activo', planta: 'torcuato', nombre: 'Uno' })
    })
    await assertFails(updateDoc(doc(db('enc'), 'users/op4'), { nombre: 'Otro' }))
  })

  test('produccion_encargado NO puede tocar el estado de un usuario que no es operario', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/enc'), { rol: 'produccion_encargado', estado: 'activo' })
      await setDoc(doc(d, 'users/log'), { rol: 'logistica', estado: 'activo' })
    })
    await assertFails(updateDoc(doc(db('enc'), 'users/log'), { estado: 'inactivo' }))
  })
})

// ── produccion_encargado: pallets y contador ──────────────────────────────────
describe('produccion_encargado — pallets y contador', () => {
  test('produccion_encargado SÍ puede leer produccionPallets', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/enc'), { rol: 'produccion_encargado', estado: 'activo' })
      await setDoc(doc(d, 'produccionPallets/p1'), { plantaId: 'torcuato', numero: 1 })
    })
    await assertSucceeds(getDoc(doc(db('enc'), 'produccionPallets/p1')))
  })

  test('produccion_encargado SÍ puede inicializar un contador de planta', async () => {
    await seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'produccion_encargado', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('enc'), 'config/produccionCounter_merlo'), { next: 1 }))
  })

  test('produccion_encargado SÍ puede escribir produccionLegajoIndex (alta de operario)', async () => {
    await seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'produccion_encargado', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('enc'), 'produccionLegajoIndex/1234'), { email: 'op@planta.rolito.internal' }))
  })

  test('logistica NO puede escribir produccionLegajoIndex', async () => {
    await seed((d) => setDoc(doc(d, 'users/log'), { rol: 'logistica', estado: 'activo' }))
    await assertFails(setDoc(doc(db('log'), 'produccionLegajoIndex/1234'), { email: 'op@planta.rolito.internal' }))
  })
})

// ── remitosCarga: remito de carga del camión (módulo expedición) ──────────────
describe('remitosCarga', () => {
  const remito = (extra = {}) => ({
    numero: 1, codigo: 'RC-DT-000001', plantaId: 'torcuato',
    camionId: 'cam1', camionLabel: 'AB123CD · Iveco', choferId: 'chof1', choferNombre: 'Chofer Uno',
    items: [{ productoId: 'bolsa_10kg', nombre: 'Hielo 10kg', cantidad: 100, pallets: 2 }],
    palletsCarga: 2,
    estado: 'emitido', creadoPor: { uid: 'caja1', nombre: 'Caja Uno' },
    fecha: new Date(), tango: { estado: 'pendiente' }, ...extra,
  })
  const seedCaja = (uid = 'caja1', planta = 'torcuato') =>
    seed((d) => setDoc(doc(d, `users/${uid}`), { rol: 'caja', estado: 'activo', planta }))

  test('caja puede emitir un remito de su planta', async () => {
    await seedCaja()
    await assertSucceeds(setDoc(doc(db('caja1'), 'remitosCarga/r1'), remito()))
  })

  test('caja NO puede emitir un remito de OTRA planta', async () => {
    await seedCaja()
    await assertFails(setDoc(doc(db('caja1'), 'remitosCarga/r1'), remito({ plantaId: 'merlo' })))
  })

  test('caja NO puede emitir a nombre de otro usuario', async () => {
    await seedCaja()
    await assertFails(setDoc(doc(db('caja1'), 'remitosCarga/r1'), remito({ creadoPor: { uid: 'otro', nombre: 'Otro' } })))
  })

  test('caja NO puede emitir sin items', async () => {
    await seedCaja()
    await assertFails(setDoc(doc(db('caja1'), 'remitosCarga/r1'), remito({ items: [] })))
  })

  test('caja NO puede emitir en estado distinto de emitido', async () => {
    await seedCaja()
    await assertFails(setDoc(doc(db('caja1'), 'remitosCarga/r1'), remito({ estado: 'entregado' })))
  })

  test('un remito es inmutable tras emitirse (también para caja)', async () => {
    await seedCaja()
    await seed((d) => setDoc(doc(d, 'remitosCarga/r1'), remito()))
    await assertFails(updateDoc(doc(db('caja1'), 'remitosCarga/r1'), { estado: 'entregado' }))
  })

  test('un chofer NO puede crear remitos de carga', async () => {
    await seed((d) => setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' }))
    await assertFails(setDoc(doc(db('chof1'), 'remitosCarga/r1'), remito()))
  })

  test('el chofer puede leer su propio remito pero no el de otro', async () => {
    await seed((d) => setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'remitosCarga/mio'), remito()))
    await seed((d) => setDoc(doc(d, 'remitosCarga/ajeno'), remito({ choferId: 'otro' })))
    await assertSucceeds(getDoc(doc(db('chof1'), 'remitosCarga/mio')))
    await assertFails(getDoc(doc(db('chof1'), 'remitosCarga/ajeno')))
  })

  test('caja puede leer remitos; un cliente NO', async () => {
    await seedCaja()
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente()))
    await seed((d) => setDoc(doc(d, 'remitosCarga/r1'), remito()))
    await assertSucceeds(getDoc(doc(db('caja1'), 'remitosCarga/r1')))
    await assertFails(getDoc(doc(db('cli', 'c@x.com'), 'remitosCarga/r1')))
  })

  test('caja puede leer el doc de un chofer (para elegirlo en el remito)', async () => {
    await seedCaja()
    await seed((d) => setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' }))
    await assertSucceeds(getDoc(doc(db('caja1'), 'users/chof1')))
  })
})

// ── config/cargaCounter_*: correlativo de remitos de carga por planta ─────────
describe('config/cargaCounter_*', () => {
  const seedCaja = (uid = 'caja1', planta = 'torcuato') =>
    seed((d) => setDoc(doc(d, `users/${uid}`), { rol: 'caja', estado: 'activo', planta }))

  test('caja crea el contador de SU planta en el primer uso (next 2 = emitió el 1)', async () => {
    await seedCaja()
    await assertSucceeds(setDoc(doc(db('caja1'), 'config/cargaCounter_torcuato'), { next: 2 }))
  })

  test('caja NO puede crear el contador de otra planta', async () => {
    await seedCaja()
    await assertFails(setDoc(doc(db('caja1'), 'config/cargaCounter_merlo'), { next: 2 }))
  })

  test('caja avanza el contador de su planta, nunca lo retrocede', async () => {
    await seedCaja()
    await seed((d) => setDoc(doc(d, 'config/cargaCounter_torcuato'), { next: 10 }))
    await assertSucceeds(setDoc(doc(db('caja1'), 'config/cargaCounter_torcuato'), { next: 11 }))
    await assertFails(setDoc(doc(db('caja1'), 'config/cargaCounter_torcuato'), { next: 9 }))
  })

  test('un chofer NO puede tocar el contador de carga', async () => {
    await seed((d) => setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' }))
    await assertFails(setDoc(doc(db('chof1'), 'config/cargaCounter_torcuato'), { next: 2 }))
  })
})

// ── Expedición Fase 2: muelle, cambios, descargas y liquidaciones ─────────────
describe('expedicion: muelle / cambios / descargas / liquidaciones', () => {
  const seedCaja   = (uid = 'caja1',   planta = 'torcuato') =>
    seed((d) => setDoc(doc(d, `users/${uid}`), { rol: 'caja', estado: 'activo', planta }))
  const seedMuelle = (uid = 'mue1',    planta = 'torcuato') =>
    seed((d) => setDoc(doc(d, `users/${uid}`), { rol: 'muelle', estado: 'activo', planta }))
  const seedChofer = (uid = 'chof1') =>
    seed((d) => setDoc(doc(d, `users/${uid}`), { rol: 'chofer', estado: 'activo' }))

  const remito = (extra = {}) => ({
    numero: 1, codigo: 'RC-DT-000001', plantaId: 'torcuato',
    camionId: 'cam1', camionLabel: 'AB123CD', choferId: 'chof1', choferNombre: 'Chofer Uno',
    items: [{ productoId: 'bolsa_10kg', nombre: 'Hielo 10kg', cantidad: 100, pallets: 1 }],
    palletsCarga: 1, estado: 'emitido', creadoPor: { uid: 'caja1', nombre: 'Caja' },
    fecha: new Date(), ...extra,
  })
  const cambio = (extra = {}) => ({
    camionId: 'cam1', choferId: 'chof1', choferNombre: 'Chofer Uno',
    clienteId: 'cli', clienteNombre: 'Cliente SA',
    productoId: 'bolsa_10kg', nombre: 'Hielo 10kg', cantidad: 2, fecha: new Date(), ...extra,
  })
  const descarga = (extra = {}) => ({
    plantaId: 'torcuato', camionId: 'cam1', camionLabel: 'AB123CD',
    choferId: 'chof1', choferNombre: 'Chofer Uno',
    items: [{ productoId: 'bolsa_10kg', nombre: 'Hielo 10kg', cantidad: 20 }],
    bolsasRotas: [], palletsCompletos: 0, palletsParciales: 1, palletsVacios: 0,
    registradoPor: { uid: 'mue1', nombre: 'Muelle' }, fecha: new Date(), ...extra,
  })
  const liquidacion = (extra = {}) => ({
    fecha: '2026-08-29', plantaId: 'torcuato', choferId: 'chof1', choferNombre: 'Chofer Uno',
    productos: [], pallets: { salidos: 1, completos: 0, parciales: 1, vacios: 0, diferencia: 0 },
    cambios: { registrados: 2, rotasRecibidas: 2 },
    importes: { contadoEfectivo: 1000, contadoTransferencia: 0, cuentaCorriente: 0, total: 1000 },
    efectivoARendir: 1000, efectivoRecibido: 1000, diferenciaEfectivo: 0,
    cerradaPor: { uid: 'caja1', nombre: 'Caja' }, createdAt: new Date(), ...extra,
  })

  // ── remito: transición de entrega por muelle ──
  test('muelle confirma la entrega de un remito emitido de su planta', async () => {
    await seedMuelle()
    await seed((d) => setDoc(doc(d, 'remitosCarga/r1'), remito()))
    await assertSucceeds(updateDoc(doc(db('mue1'), 'remitosCarga/r1'), {
      estado: 'entregado', entregadoPor: { uid: 'mue1', nombre: 'Muelle', hora: new Date() },
    }))
  })

  test('muelle NO confirma entrega en OTRA planta', async () => {
    await seedMuelle('mue1', 'merlo')
    await seed((d) => setDoc(doc(d, 'remitosCarga/r1'), remito()))
    await assertFails(updateDoc(doc(db('mue1'), 'remitosCarga/r1'), {
      estado: 'entregado', entregadoPor: { uid: 'mue1', nombre: 'Muelle', hora: new Date() },
    }))
  })

  test('muelle NO puede tocar los items del remito al confirmar', async () => {
    await seedMuelle()
    await seed((d) => setDoc(doc(d, 'remitosCarga/r1'), remito()))
    await assertFails(updateDoc(doc(db('mue1'), 'remitosCarga/r1'), {
      estado: 'entregado', entregadoPor: { uid: 'mue1', nombre: 'Muelle', hora: new Date() },
      items: [],
    }))
  })

  test('muelle NO re-entrega un remito ya entregado', async () => {
    await seedMuelle()
    await seed((d) => setDoc(doc(d, 'remitosCarga/r1'), remito({ estado: 'entregado' })))
    await assertFails(updateDoc(doc(db('mue1'), 'remitosCarga/r1'), {
      estado: 'entregado', entregadoPor: { uid: 'mue1', nombre: 'Muelle', hora: new Date() },
    }))
  })

  test('caja NO puede confirmar entregas (eso es de muelle)', async () => {
    await seedCaja()
    await seed((d) => setDoc(doc(d, 'remitosCarga/r1'), remito()))
    await assertFails(updateDoc(doc(db('caja1'), 'remitosCarga/r1'), {
      estado: 'entregado', entregadoPor: { uid: 'caja1', nombre: 'Caja', hora: new Date() },
    }))
  })

  // ── cambiosCamion (histórico: hoy el cambio es un renglón de la venta) ──
  test('el chofer lee sus cambios viejos', async () => {
    await seedChofer()
    await seed((d) => setDoc(doc(d, 'cambiosCamion/c1'), cambio()))
    await assertSucceeds(getDoc(doc(db('chof1'), 'cambiosCamion/c1')))
  })

  test('el chofer NO lee cambios de otro chofer', async () => {
    await seedChofer()
    await seed((d) => setDoc(doc(d, 'cambiosCamion/c1'), cambio({ choferId: 'otro' })))
    await assertFails(getDoc(doc(db('chof1'), 'cambiosCamion/c1')))
  })

  test('ya nadie escribe en cambiosCamion: hoy el cambio es un renglón de la venta', async () => {
    await seedChofer()
    await assertFails(setDoc(doc(db('chof1'), 'cambiosCamion/c1'), cambio()))
  })

  test('un cambio viejo es inmutable', async () => {
    await seedChofer()
    await seed((d) => setDoc(doc(d, 'cambiosCamion/c1'), cambio()))
    await assertFails(updateDoc(doc(db('chof1'), 'cambiosCamion/c1'), { cantidad: 99 }))
  })

  // ── descargasCamion ──
  test('muelle registra la descarga en su planta', async () => {
    await seedMuelle()
    await assertSucceeds(setDoc(doc(db('mue1'), 'descargasCamion/d1'), descarga()))
  })

  test('muelle NO registra descargas de otra planta', async () => {
    await seedMuelle('mue1', 'merlo')
    await assertFails(setDoc(doc(db('mue1'), 'descargasCamion/d1'), descarga()))
  })

  test('el chofer NO puede registrar descargas', async () => {
    await seedChofer()
    await assertFails(setDoc(doc(db('chof1'), 'descargasCamion/d1'), descarga({ registradoPor: { uid: 'chof1', nombre: 'X' } })))
  })

  test('una descarga es inmutable', async () => {
    await seedMuelle()
    await seed((d) => setDoc(doc(d, 'descargasCamion/d1'), descarga()))
    await assertFails(updateDoc(doc(db('mue1'), 'descargasCamion/d1'), { palletsVacios: 5 }))
  })

  // ── liquidaciones ──
  test('caja cierra la liquidación del día con id determinístico', async () => {
    await seedCaja()
    await assertSucceeds(setDoc(doc(db('caja1'), 'liquidaciones/2026-08-29_chof1'), liquidacion()))
  })

  test('caja NO puede cerrar con id que no matchea fecha_chofer', async () => {
    await seedCaja()
    await assertFails(setDoc(doc(db('caja1'), 'liquidaciones/otro-id'), liquidacion()))
  })

  test('una liquidación cerrada NO se puede pisar (create-only)', async () => {
    await seedCaja()
    await seed((d) => setDoc(doc(d, 'liquidaciones/2026-08-29_chof1'), liquidacion()))
    await assertFails(setDoc(doc(db('caja1'), 'liquidaciones/2026-08-29_chof1'), liquidacion({ efectivoRecibido: 0 })))
  })

  test('muelle NO puede cerrar liquidaciones', async () => {
    await seedMuelle()
    await assertFails(setDoc(doc(db('mue1'), 'liquidaciones/2026-08-29_chof1'), liquidacion({ cerradaPor: { uid: 'mue1', nombre: 'M' } })))
  })

  test('el chofer lee su liquidación pero no la de otro', async () => {
    await seedChofer()
    await seed((d) => setDoc(doc(d, 'liquidaciones/2026-08-29_chof1'), liquidacion()))
    await seed((d) => setDoc(doc(d, 'liquidaciones/2026-08-29_otro'), liquidacion({ choferId: 'otro' })))
    await assertSucceeds(getDoc(doc(db('chof1'), 'liquidaciones/2026-08-29_chof1')))
    await assertFails(getDoc(doc(db('chof1'), 'liquidaciones/2026-08-29_otro')))
  })
})

// Caja lee ventas de camión (las necesita la liquidación del repartidor).
describe('ventasCamion: lectura de caja', () => {
  test('caja puede leer una venta; muelle NO', async () => {
    await seed((d) => setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' }))
    await seed((d) => setDoc(doc(d, 'users/mue1'), { rol: 'muelle', estado: 'activo', planta: 'torcuato' }))
    await seed((d) => setDoc(doc(d, 'ventasCamion/v1'), {
      canal: 'promo', camionId: 'cam1', choferId: 'chof1', choferNombre: 'Chofer',
      clienteId: 'cli', clienteNombre: 'Cliente SA', items: [], total: 100,
      formaPago: 'contado_efectivo', fecha: new Date(), tango: { estado: 'pendiente' },
    }))
    await assertSucceeds(getDoc(doc(db('caja1'), 'ventasCamion/v1')))
    await assertFails(getDoc(doc(db('mue1'), 'ventasCamion/v1')))
  })
})

// ── Expedición Fase 3: ventanilla y cobranzas ─────────────────────────────────
describe('expedicion: ventanilla y cobranzas', () => {
  const seedCaja   = (uid = 'caja1', planta = 'torcuato') =>
    seed((d) => setDoc(doc(d, `users/${uid}`), { rol: 'caja', estado: 'activo', planta }))
  const seedMuelle = (uid = 'mue1', planta = 'torcuato') =>
    seed((d) => setDoc(doc(d, `users/${uid}`), { rol: 'muelle', estado: 'activo', planta }))

  const venta = (extra = {}) => ({
    plantaId: 'torcuato', canal: 'contado', cajaId: 'caja1', cajaNombre: 'Caja',
    clienteNombre: 'Cliente SA',
    items: [{ productoId: 'bolsa_10kg', nombre: 'Hielo 10kg', cantidad: 5, precioUnitario: 4000 }],
    total: 20000, formaPago: 'contado_efectivo', estado: 'pendiente_entrega',
    turno: 1, turnoEstado: 'en_espera',
    fecha: new Date(), tango: { estado: 'pendiente' }, ...extra,
  })
  const cobranza = (extra = {}) => ({
    origen: 'caja', plantaId: 'torcuato', registradoPor: { uid: 'caja1', nombre: 'Caja' },
    clienteId: 'cli', clienteNombre: 'Cliente SA', importe: 50000,
    formaPago: 'contado_efectivo', fecha: new Date(), ...extra,
  })

  test('caja crea una venta de ventanilla en su planta', async () => {
    await seedCaja()
    await assertSucceeds(setDoc(doc(db('caja1'), 'ventasVentanilla/v1'), venta()))
  })

  test('caja NO crea ventas de otra planta ni a nombre de otro', async () => {
    await seedCaja()
    await assertFails(setDoc(doc(db('caja1'), 'ventasVentanilla/v1'), venta({ plantaId: 'merlo' })))
    await assertFails(setDoc(doc(db('caja1'), 'ventasVentanilla/v2'), venta({ cajaId: 'otro' })))
  })

  test('caja NO crea la venta ya entregada', async () => {
    await seedCaja()
    await assertFails(setDoc(doc(db('caja1'), 'ventasVentanilla/v1'), venta({ estado: 'entregado' })))
  })

  test('muelle entrega una ventanilla pendiente de su planta', async () => {
    await seedMuelle()
    await seed((d) => setDoc(doc(d, 'ventasVentanilla/v1'), venta()))
    await assertSucceeds(updateDoc(doc(db('mue1'), 'ventasVentanilla/v1'), {
      estado: 'entregado', entregadoPor: { uid: 'mue1', nombre: 'Muelle', hora: new Date() },
    }))
  })

  test('muelle NO puede tocar el total al entregar', async () => {
    await seedMuelle()
    await seed((d) => setDoc(doc(d, 'ventasVentanilla/v1'), venta()))
    await assertFails(updateDoc(doc(db('mue1'), 'ventasVentanilla/v1'), {
      estado: 'entregado', entregadoPor: { uid: 'mue1', nombre: 'Muelle', hora: new Date() },
      total: 1,
    }))
  })

  test('caja NO puede entregar (eso es de muelle)', async () => {
    await seedCaja()
    await seed((d) => setDoc(doc(d, 'ventasVentanilla/v1'), venta()))
    await assertFails(updateDoc(doc(db('caja1'), 'ventasVentanilla/v1'), {
      estado: 'entregado', entregadoPor: { uid: 'caja1', nombre: 'Caja', hora: new Date() },
    }))
  })

  test('caja registra una cobranza de mostrador', async () => {
    await seedCaja()
    await assertSucceeds(setDoc(doc(db('caja1'), 'cobranzas/c1'), cobranza()))
  })

  test('caja NO registra cobranzas con origen cobrador ni importe cero', async () => {
    await seedCaja()
    await assertFails(setDoc(doc(db('caja1'), 'cobranzas/c1'), cobranza({ origen: 'cobrador' })))
    await assertFails(setDoc(doc(db('caja1'), 'cobranzas/c2'), cobranza({ importe: 0 })))
  })

  test('una cobranza es inmutable; muelle no las crea', async () => {
    await seedCaja()
    await seedMuelle()
    await seed((d) => setDoc(doc(d, 'cobranzas/c1'), cobranza()))
    await assertFails(updateDoc(doc(db('caja1'), 'cobranzas/c1'), { importe: 1 }))
    await assertFails(setDoc(doc(db('mue1'), 'cobranzas/c2'), cobranza({ registradoPor: { uid: 'mue1', nombre: 'M' } })))
  })

  test('un cliente NO lee ventanilla ni cobranzas', async () => {
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente()))
    await seed((d) => setDoc(doc(d, 'ventasVentanilla/v1'), venta()))
    await seed((d) => setDoc(doc(d, 'cobranzas/c1'), cobranza()))
    await assertFails(getDoc(doc(db('cli', 'c@x.com'), 'ventasVentanilla/v1')))
    await assertFails(getDoc(doc(db('cli', 'c@x.com'), 'cobranzas/c1')))
  })
})

// ── Expedición Fase 4: seguridad en el portón ─────────────────────────────────
describe('expedicion: seguridad (control de salidas)', () => {
  const seedSeguridad = (uid = 'seg1', planta = 'torcuato') =>
    seed((d) => setDoc(doc(d, `users/${uid}`), { rol: 'seguridad', estado: 'activo', planta }))

  const remito = (extra = {}) => ({
    numero: 1, codigo: 'RC-DT-000001', plantaId: 'torcuato',
    camionId: 'cam1', camionLabel: 'AB123CD', choferId: 'chof1', choferNombre: 'Chofer Uno',
    items: [{ productoId: 'bolsa_10kg', nombre: 'Hielo 10kg', cantidad: 100, pallets: 1 }],
    palletsCarga: 1, estado: 'entregado', creadoPor: { uid: 'caja1', nombre: 'Caja' },
    fecha: new Date(), ...extra,
  })
  const ventanilla = (extra = {}) => ({
    plantaId: 'torcuato', canal: 'contado', cajaId: 'caja1', cajaNombre: 'Caja',
    clienteNombre: 'Cliente SA',
    items: [{ productoId: 'bolsa_10kg', nombre: 'Hielo 10kg', cantidad: 5, precioUnitario: 4000 }],
    total: 20000, formaPago: 'contado_efectivo', estado: 'entregado',
    fecha: new Date(), ...extra,
  })

  test('seguridad libera un camión entregado de su planta', async () => {
    await seedSeguridad()
    await seed((d) => setDoc(doc(d, 'remitosCarga/r1'), remito()))
    await assertSucceeds(updateDoc(doc(db('seg1'), 'remitosCarga/r1'), {
      estado: 'salido', salida: { uid: 'seg1', nombre: 'Seguridad', hora: new Date() },
    }))
  })

  test('seguridad NO libera un camión todavía no entregado por muelle', async () => {
    await seedSeguridad()
    await seed((d) => setDoc(doc(d, 'remitosCarga/r1'), remito({ estado: 'emitido' })))
    await assertFails(updateDoc(doc(db('seg1'), 'remitosCarga/r1'), {
      estado: 'salido', salida: { uid: 'seg1', nombre: 'Seguridad', hora: new Date() },
    }))
  })

  test('seguridad NO libera camiones de otra planta ni toca items', async () => {
    await seedSeguridad('seg1', 'merlo')
    await seed((d) => setDoc(doc(d, 'remitosCarga/r1'), remito()))
    await assertFails(updateDoc(doc(db('seg1'), 'remitosCarga/r1'), {
      estado: 'salido', salida: { uid: 'seg1', nombre: 'Seguridad', hora: new Date() },
    }))
    await seedSeguridad('seg2', 'torcuato')
    await assertFails(updateDoc(doc(db('seg2'), 'remitosCarga/r1'), {
      estado: 'salido', salida: { uid: 'seg2', nombre: 'Seguridad', hora: new Date() },
      items: [],
    }))
  })

  test('muelle NO puede liberar salidas (eso es de seguridad)', async () => {
    await seed((d) => setDoc(doc(d, 'users/mue1'), { rol: 'muelle', estado: 'activo', planta: 'torcuato' }))
    await seed((d) => setDoc(doc(d, 'remitosCarga/r1'), remito()))
    await assertFails(updateDoc(doc(db('mue1'), 'remitosCarga/r1'), {
      estado: 'salido', salida: { uid: 'mue1', nombre: 'Muelle', hora: new Date() },
    }))
  })

  test('seguridad estampa la salida de un retiro de ventanilla entregado', async () => {
    await seedSeguridad()
    await seed((d) => setDoc(doc(d, 'ventasVentanilla/v1'), ventanilla()))
    await assertSucceeds(updateDoc(doc(db('seg1'), 'ventasVentanilla/v1'), {
      salida: { uid: 'seg1', nombre: 'Seguridad', hora: new Date() },
    }))
  })

  test('seguridad NO estampa salida dos veces ni sobre pendientes', async () => {
    await seedSeguridad()
    await seed((d) => setDoc(doc(d, 'ventasVentanilla/v1'), ventanilla({
      salida: { uid: 'otro', nombre: 'Otro', hora: new Date() },
    })))
    await assertFails(updateDoc(doc(db('seg1'), 'ventasVentanilla/v1'), {
      salida: { uid: 'seg1', nombre: 'Seguridad', hora: new Date() },
    }))
    await seed((d) => setDoc(doc(d, 'ventasVentanilla/v2'), ventanilla({ estado: 'pendiente_entrega' })))
    await assertFails(updateDoc(doc(db('seg1'), 'ventasVentanilla/v2'), {
      salida: { uid: 'seg1', nombre: 'Seguridad', hora: new Date() },
    }))
  })

  test('seguridad lee remitos y ventanillas pero NO crea nada', async () => {
    await seedSeguridad()
    await seed((d) => setDoc(doc(d, 'remitosCarga/r1'), remito()))
    await seed((d) => setDoc(doc(d, 'ventasVentanilla/v1'), ventanilla()))
    await assertSucceeds(getDoc(doc(db('seg1'), 'remitosCarga/r1')))
    await assertSucceeds(getDoc(doc(db('seg1'), 'ventasVentanilla/v1')))
    await assertFails(setDoc(doc(db('seg1'), 'remitosCarga/r2'), remito({ estado: 'emitido', creadoPor: { uid: 'seg1', nombre: 'S' } })))
    await assertFails(setDoc(doc(db('seg1'), 'cobranzas/c1'), {
      origen: 'caja', plantaId: 'torcuato', registradoPor: { uid: 'seg1', nombre: 'S' },
      clienteId: 'cli', clienteNombre: 'X', importe: 1, formaPago: 'contado_efectivo', fecha: new Date(),
    }))
  })
})

// ── Expedición Fase 5: cobranzas en la calle (cobradores = choferes) ──────────
describe('expedicion: cobranzas de calle', () => {
  const seedChofer = (uid = 'chof1') =>
    seed((d) => setDoc(doc(d, `users/${uid}`), { rol: 'chofer', estado: 'activo' }))

  const cobranzaCalle = (extra = {}) => ({
    origen: 'cobrador', registradoPor: { uid: 'chof1', nombre: 'Cobrador Uno' },
    clienteId: 'cli', clienteNombre: 'Cliente SA', importe: 30000,
    formaPago: 'contado_efectivo', fecha: new Date(), ...extra,
  })

  test('el chofer/cobrador registra su propia cobranza en la calle', async () => {
    await seedChofer()
    await assertSucceeds(setDoc(doc(db('chof1'), 'cobranzas/c1'), cobranzaCalle()))
  })

  test('el chofer NO registra con origen caja ni a nombre de otro', async () => {
    await seedChofer()
    await assertFails(setDoc(doc(db('chof1'), 'cobranzas/c1'), cobranzaCalle({ origen: 'caja', plantaId: 'torcuato' })))
    await assertFails(setDoc(doc(db('chof1'), 'cobranzas/c2'), cobranzaCalle({ registradoPor: { uid: 'otro', nombre: 'Otro' } })))
  })

  test('el chofer NO registra importe cero ni cuenta corriente como forma de pago', async () => {
    await seedChofer()
    await assertFails(setDoc(doc(db('chof1'), 'cobranzas/c1'), cobranzaCalle({ importe: 0 })))
    await assertFails(setDoc(doc(db('chof1'), 'cobranzas/c2'), cobranzaCalle({ formaPago: 'cuenta_corriente' })))
  })

  test('el chofer lee su cobranza pero no la de otro; sigue inmutable', async () => {
    await seedChofer()
    await seed((d) => setDoc(doc(d, 'cobranzas/mia'), cobranzaCalle()))
    await seed((d) => setDoc(doc(d, 'cobranzas/ajena'), cobranzaCalle({ registradoPor: { uid: 'otro', nombre: 'Otro' } })))
    await assertSucceeds(getDoc(doc(db('chof1'), 'cobranzas/mia')))
    await assertFails(getDoc(doc(db('chof1'), 'cobranzas/ajena')))
    await assertFails(updateDoc(doc(db('chof1'), 'cobranzas/mia'), { importe: 1 }))
  })
})

// ── Cobranzas de supervisor: recibo multi-medio con imputación de facturas ────
describe('cobranzas de supervisor', () => {
  const seedSupervisor = (uid = 'sup') =>
    seed((d) => setDoc(doc(d, `users/${uid}`), { rol: 'supervisor', estado: 'activo' }))

  const cobranzaSup = (extra = {}) => ({
    origen: 'supervisor', registradoPor: { uid: 'sup', nombre: 'Supervisor Uno' },
    clienteId: 'cli', clienteNombre: 'Cliente SA', importe: 45000.5,
    formaPago: 'mixto', fecha: new Date(),
    numeroRecibo: 'RS-000123', empresa: 'redonhielo',
    imputaciones: [{ comprobanteTipo: 'FAC', comprobanteNumero: 'A-0001-00000001', saldoAlMomento: 60000, importeImputado: 45000.5 }],
    medios: {
      efectivo: 10000, transferencia: 0,
      cheques: [{ numero: '123', bancoCodigo: '011', bancoNombre: 'Banco Nación', fechaEmision: '2026-08-31', fechaAcreditacion: '2026-09-30', dias: 30, importe: 30000 }],
      retenciones: [{ tipo: 'iibb_pba', nroCertificado: 'C-1', importe: 5000.5 }],
    },
    ...extra,
  })

  test('el supervisor crea una cobranza mixta válida', async () => {
    await seedSupervisor()
    await assertSucceeds(setDoc(doc(db('sup'), 'cobranzas/c1'), cobranzaSup()))
  })

  test('el supervisor crea SIN numeroRecibo (numeración opcional hasta conectar Tango)', async () => {
    await seedSupervisor()
    const { numeroRecibo: _omitido, ...sinNumero } = cobranzaSup()
    await assertSucceeds(setDoc(doc(db('sup'), 'cobranzas/c1'), sinNumero))
  })

  test('el supervisor NO crea con otro origen, otra formaPago, recibo no-string ni sin imputaciones', async () => {
    await seedSupervisor()
    await assertFails(setDoc(doc(db('sup'), 'cobranzas/c1'), cobranzaSup({ origen: 'caja', plantaId: 'torcuato' })))
    await assertFails(setDoc(doc(db('sup'), 'cobranzas/c2'), cobranzaSup({ origen: 'cobrador' })))
    await assertFails(setDoc(doc(db('sup'), 'cobranzas/c3'), cobranzaSup({ formaPago: 'contado_efectivo' })))
    await assertFails(setDoc(doc(db('sup'), 'cobranzas/c4'), cobranzaSup({ numeroRecibo: 123 })))
    await assertFails(setDoc(doc(db('sup'), 'cobranzas/c5'), cobranzaSup({ imputaciones: [] })))
  })

  test('el supervisor NO crea a nombre de otro ni con empresa inventada', async () => {
    await seedSupervisor()
    await assertFails(setDoc(doc(db('sup'), 'cobranzas/c1'), cobranzaSup({ registradoPor: { uid: 'otro', nombre: 'Otro' } })))
    await assertFails(setDoc(doc(db('sup'), 'cobranzas/c2'), cobranzaSup({ empresa: 'acme' })))
  })

  test('caja y chofer NO crean cobranzas de supervisor', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
      await setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' })
    })
    await assertFails(setDoc(doc(db('caja1'), 'cobranzas/c1'), cobranzaSup({ registradoPor: { uid: 'caja1', nombre: 'Caja' } })))
    await assertFails(setDoc(doc(db('chof1'), 'cobranzas/c2'), cobranzaSup({ registradoPor: { uid: 'chof1', nombre: 'Chofer' } })))
  })

  test('el supervisor NO crea la cobranza simple de calle (origen cobrador)', async () => {
    await seedSupervisor()
    await assertFails(setDoc(doc(db('sup'), 'cobranzas/c1'), {
      origen: 'cobrador', registradoPor: { uid: 'sup', nombre: 'Supervisor Uno' },
      clienteId: 'cli', clienteNombre: 'Cliente SA', importe: 1000,
      formaPago: 'contado_efectivo', fecha: new Date(),
    }))
  })

  test('el supervisor lee su cobranza pero no la de otro; sigue inmutable', async () => {
    await seedSupervisor()
    await seed(async (d) => {
      await setDoc(doc(d, 'cobranzas/mia'), cobranzaSup())
      await setDoc(doc(d, 'cobranzas/ajena'), cobranzaSup({ registradoPor: { uid: 'otro', nombre: 'Otro' } }))
    })
    await assertSucceeds(getDoc(doc(db('sup'), 'cobranzas/mia')))
    await assertFails(getDoc(doc(db('sup'), 'cobranzas/ajena')))
    await assertFails(updateDoc(doc(db('sup'), 'cobranzas/mia'), { importe: 1 }))
    await assertFails(deleteDoc(doc(db('sup'), 'cobranzas/mia')))
  })

  test('contador de recibos: el supervisor solo avanza next; no lo crea ni retrocede', async () => {
    await seedSupervisor()
    await seed((d) => setDoc(doc(d, 'config/reciboSupervisorCounter'), { next: 100 }))
    await assertSucceeds(updateDoc(doc(db('sup'), 'config/reciboSupervisorCounter'), { next: 120 }))
    await assertFails(updateDoc(doc(db('sup'), 'config/reciboSupervisorCounter'), { next: 50 }))
    await assertFails(setDoc(doc(db('sup'), 'config/otroCounter'), { next: 1 }))
  })

  test('contador de recibos: super_admin lo inicializa', async () => {
    await seed((d) => setDoc(doc(d, 'users/adm'), { rol: 'super_admin', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('adm'), 'config/reciboSupervisorCounter'), { next: 1000 }))
  })
})

// Numeración de los comprobantes internos de la venta del camión (remito y
// factura X): el chofer reserva lotes avanzando next; nada más.
describe('numeracion interna de comprobantes del camion', () => {
  test('el chofer solo avanza next; no retrocede, no toca puntoVenta, no crea', async () => {
    await seed((d) => setDoc(doc(d, 'users/cho'), { rol: 'chofer', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'config/numeracionInterna_remito'), { next: 100, puntoVenta: 2 }))
    await assertSucceeds(updateDoc(doc(db('cho'), 'config/numeracionInterna_remito'), { next: 120 }))
    await assertFails(updateDoc(doc(db('cho'), 'config/numeracionInterna_remito'), { next: 50 }))
    await assertFails(updateDoc(doc(db('cho'), 'config/numeracionInterna_remito'), { next: 140, puntoVenta: 9 }))
    await assertFails(setDoc(doc(db('cho'), 'config/numeracionInterna_facturaX'), { next: 1, puntoVenta: 2 }))
  })

  test('super_admin lo inicializa; un cliente no lo toca', async () => {
    await seed((d) => setDoc(doc(d, 'users/adm'), { rol: 'super_admin', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'users/cli'), { rol: 'cliente', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('adm'), 'config/numeracionInterna_facturaX'), { next: 1, puntoVenta: 2 }))
    await assertFails(updateDoc(doc(db('cli'), 'config/numeracionInterna_facturaX'), { next: 5 }))
  })
})

// Muelle asigna la dársena de carga (tablero de TV).
describe('remitosCarga: asignacion de darsena', () => {
  const remito = (extra = {}) => ({
    numero: 1, codigo: 'RC-DT-000001', plantaId: 'torcuato',
    camionId: 'cam1', camionLabel: 'AB123CD', choferId: 'chof1', choferNombre: 'Chofer Uno',
    items: [{ productoId: 'bolsa_10kg', nombre: 'Hielo 10kg', cantidad: 100 }],
    palletsCarga: 1, estado: 'emitido', creadoPor: { uid: 'caja1', nombre: 'Caja' },
    fecha: new Date(), ...extra,
  })

  test('muelle asigna y cambia la darsena de un remito emitido de su planta', async () => {
    await seed((d) => setDoc(doc(d, 'users/mue1'), { rol: 'muelle', estado: 'activo', planta: 'torcuato' }))
    await seed((d) => setDoc(doc(d, 'remitosCarga/r1'), remito()))
    await assertSucceeds(updateDoc(doc(db('mue1'), 'remitosCarga/r1'), { darsena: 3 }))
    await assertSucceeds(updateDoc(doc(db('mue1'), 'remitosCarga/r1'), { darsena: 5 }))
  })

  test('muelle NO asigna darsena a un remito ya entregado, ni fuera de rango, ni de otra planta', async () => {
    await seed((d) => setDoc(doc(d, 'users/mue1'), { rol: 'muelle', estado: 'activo', planta: 'torcuato' }))
    await seed((d) => setDoc(doc(d, 'users/mue2'), { rol: 'muelle', estado: 'activo', planta: 'merlo' }))
    await seed((d) => setDoc(doc(d, 'remitosCarga/entregado'), remito({ estado: 'entregado' })))
    await seed((d) => setDoc(doc(d, 'remitosCarga/r1'), remito()))
    await assertFails(updateDoc(doc(db('mue1'), 'remitosCarga/entregado'), { darsena: 1 }))
    await assertFails(updateDoc(doc(db('mue1'), 'remitosCarga/r1'), { darsena: 0 }))
    await assertFails(updateDoc(doc(db('mue2'), 'remitosCarga/r1'), { darsena: 1 }))
  })

  test('caja y chofer NO asignan darsena', async () => {
    await seed((d) => setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' }))
    await seed((d) => setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'remitosCarga/r1'), remito()))
    await assertFails(updateDoc(doc(db('caja1'), 'remitosCarga/r1'), { darsena: 1 }))
    await assertFails(updateDoc(doc(db('chof1'), 'remitosCarga/r1'), { darsena: 1 }))
  })
})

// ── Expedición: sistema de turnos de ventanilla ───────────────────────────────
describe('expedicion: turnos de ventanilla', () => {
  const seedCaja   = (uid = 'caja1', planta = 'torcuato') =>
    seed((d) => setDoc(doc(d, `users/${uid}`), { rol: 'caja', estado: 'activo', planta }))
  const seedMuelle = (uid = 'mue1', planta = 'torcuato') =>
    seed((d) => setDoc(doc(d, `users/${uid}`), { rol: 'muelle', estado: 'activo', planta }))

  const venta = (extra = {}) => ({
    plantaId: 'torcuato', canal: 'contado', cajaId: 'caja1', cajaNombre: 'Caja',
    clienteNombre: 'Cliente SA',
    items: [{ productoId: 'bolsa_10kg', nombre: 'Hielo 10kg', cantidad: 5, precioUnitario: 4000 }],
    total: 20000, formaPago: 'contado_efectivo', estado: 'pendiente_entrega',
    turno: 7, turnoEstado: 'en_espera', fecha: new Date(), ...extra,
  })

  test('caja NO crea una venta sin turno ni con turnoEstado distinto de en_espera', async () => {
    await seedCaja()
    const { turno, ...sinTurno } = venta()
    await assertFails(setDoc(doc(db('caja1'), 'ventasVentanilla/v1'), sinTurno))
    await assertFails(setDoc(doc(db('caja1'), 'ventasVentanilla/v2'), venta({ turnoEstado: 'llamado' })))
  })

  test('caja crea/avanza el contador de turnos de SU planta; muelle no', async () => {
    await seedCaja()
    await seedMuelle()
    await assertSucceeds(setDoc(doc(db('caja1'), 'config/turnoVentanilla_torcuato'), { fecha: '2026-08-29', next: 2 }))
    await assertSucceeds(setDoc(doc(db('caja1'), 'config/turnoVentanilla_torcuato'), { fecha: '2026-08-30', next: 2 }))
    await assertFails(setDoc(doc(db('caja1'), 'config/turnoVentanilla_merlo'), { fecha: '2026-08-29', next: 2 }))
    await assertFails(setDoc(doc(db('mue1'), 'config/turnoVentanilla_torcuato'), { fecha: '2026-08-29', next: 2 }))
  })

  test('muelle maneja la cola: preparado, llamado con darsena, ausente', async () => {
    await seedMuelle()
    await seed((d) => setDoc(doc(d, 'ventasVentanilla/v1'), venta()))
    await assertSucceeds(updateDoc(doc(db('mue1'), 'ventasVentanilla/v1'), { turnoEstado: 'preparado' }))
    await assertSucceeds(updateDoc(doc(db('mue1'), 'ventasVentanilla/v1'), { turnoEstado: 'llamado', darsena: 4, llamadoAt: new Date() }))
    await assertSucceeds(updateDoc(doc(db('mue1'), 'ventasVentanilla/v1'), { turnoEstado: 'ausente' }))
  })

  test('muelle NO toca items/total/turno al manejar la cola, ni de otra planta', async () => {
    await seedMuelle()
    await seedMuelle('mue2', 'merlo')
    await seed((d) => setDoc(doc(d, 'ventasVentanilla/v1'), venta()))
    await assertFails(updateDoc(doc(db('mue1'), 'ventasVentanilla/v1'), { turnoEstado: 'preparado', total: 1 }))
    await assertFails(updateDoc(doc(db('mue1'), 'ventasVentanilla/v1'), { turnoEstado: 'preparado', turno: 99 }))
    await assertFails(updateDoc(doc(db('mue2'), 'ventasVentanilla/v1'), { turnoEstado: 'preparado' }))
  })

  test('muelle NO maneja la cola de una venta ya entregada', async () => {
    await seedMuelle()
    await seed((d) => setDoc(doc(d, 'ventasVentanilla/v1'), venta({ estado: 'entregado' })))
    await assertFails(updateDoc(doc(db('mue1'), 'ventasVentanilla/v1'), { turnoEstado: 'llamado', darsena: 4, llamadoAt: new Date() }))
  })

  test('turnosPublicos: lo lee cualquier autenticado (anonimo incluido) y nadie lo escribe', async () => {
    await seed((d) => setDoc(doc(d, 'turnosPublicos/torcuato'), { fecha: '2026-08-29', turnos: [{ n: 7, estado: 'en_espera' }] }))
    const anon = testEnv.authenticatedContext('anon-123').firestore()
    await assertSucceeds(getDoc(doc(anon, 'turnosPublicos/torcuato')))
    await assertFails(setDoc(doc(anon, 'turnosPublicos/torcuato'), { fecha: 'x', turnos: [] }))
    await seed((d) => setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' }))
    await assertFails(setDoc(doc(db('caja1'), 'turnosPublicos/torcuato'), { fecha: 'x', turnos: [] }))
    const sinAuth = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(sinAuth, 'turnosPublicos/torcuato')))
  })
})

// ── Anonymous auth: la sesión anónima (QR de turnos) solo ve turnosPublicos ────
// Al habilitar el proveedor Anonymous, `request.auth != null` deja de significar
// "usuario real" — cualquiera crea una sesión anónima. esNoAnonimo() mantiene
// cerradas las colecciones que abrían a "cualquier autenticado".
describe('Anonymous auth — sesion anonima acotada a turnosPublicos', () => {
  // Token con provider 'anonymous' (signInAnonymously). El resto de los
  // contextos de estos tests usan el default ('custom'), que cuenta como real.
  const anonDb = () =>
    testEnv
      .authenticatedContext('anon-1', { firebase: { sign_in_provider: 'anonymous', identities: {} } })
      .firestore()

  test('una sesion anonima SI lee turnosPublicos (la pagina del QR)', async () => {
    await seed((d) => setDoc(doc(d, 'turnosPublicos/torcuato'), { fecha: '2026-08-30', turnos: [] }))
    await assertSucceeds(getDoc(doc(anonDb(), 'turnosPublicos/torcuato')))
  })

  test('una sesion anonima NO lee catalogo, visitas, flota ni config', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'catalogo/p1'),           { nombre: 'Hielo 10kg' })
      await setDoc(doc(d, 'programas-visita/pv1'),  { clienteId: 'c1' })
      await setDoc(doc(d, 'visitas-puntuales/vp1'), { clienteId: 'c1' })
      await setDoc(doc(d, 'flota/f1'),              { patente: 'AA123BB' })
      await setDoc(doc(d, 'config/catalogo'),       { productos: [] })
    })
    const anon = anonDb()
    await assertFails(getDoc(doc(anon, 'catalogo/p1')))
    await assertFails(getDoc(doc(anon, 'programas-visita/pv1')))
    await assertFails(getDoc(doc(anon, 'visitas-puntuales/vp1')))
    await assertFails(getDoc(doc(anon, 'flota/f1')))
    await assertFails(getDoc(doc(anon, 'config/catalogo')))
  })

  test('un usuario REAL (no anonimo) SI sigue leyendo catalogo, flota y config', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/cli'),       cliente())
      await setDoc(doc(d, 'catalogo/p1'),     { nombre: 'Hielo 10kg' })
      await setDoc(doc(d, 'flota/f1'),        { patente: 'AA123BB' })
      await setDoc(doc(d, 'config/catalogo'), { productos: [] })
    })
    await assertSucceeds(getDoc(doc(db('cli', 'c@x.com'), 'catalogo/p1')))
    await assertSucceeds(getDoc(doc(db('cli', 'c@x.com'), 'flota/f1')))
    await assertSucceeds(getDoc(doc(db('cli', 'c@x.com'), 'config/catalogo')))
  })
})

// ── H2: scraping del padrón bloqueado en los índices de login (get sí, list no) ─
describe('H2 — indices de login: get puntual sí, enumeracion no', () => {
  test('el login puede resolver UN cuit por get, sin autenticar', async () => {
    await seed((d) => setDoc(doc(d, 'cuitIndex/20111111119'), { email: 'c@x.com' }))
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(getDoc(doc(anon, 'cuitIndex/20111111119')))
  })

  test('un anonimo NO puede ENUMERAR cuitIndex (scraping del padron)', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'cuitIndex/20111111119'), { email: 'a@x.com' })
      await setDoc(doc(d, 'cuitIndex/20222222229'), { email: 'b@x.com' })
    })
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDocs(collection(anon, 'cuitIndex')))
  })

  test('un cliente autenticado tampoco puede enumerar cuitIndex', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/cli'), cliente())
      await setDoc(doc(d, 'cuitIndex/20111111119'), { email: 'a@x.com' })
    })
    await assertFails(getDocs(collection(db('cli'), 'cuitIndex')))
  })

  test('un staff (logistica) SÍ puede enumerar cuitIndex (gestion/reparacion)', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' })
      await setDoc(doc(d, 'cuitIndex/20111111119'), { email: 'a@x.com' })
    })
    await assertSucceeds(getDocs(collection(db('ops'), 'cuitIndex')))
  })

  test('mismo criterio para dniIndex: login por get sí, enumerar no', async () => {
    await seed((d) => setDoc(doc(d, 'dniIndex/12345678'), { email: 'ch@x.com' }))
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(getDoc(doc(anon, 'dniIndex/12345678')))
    await assertFails(getDocs(collection(anon, 'dniIndex')))
  })
})

// ── H11: lectura acotada de users (chofer/caja) y listas-precios ──────────────
describe('H11 — lectura acotada', () => {
  test('un chofer NO puede leer a otro miembro del staff (comercial)', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/ch'), { rol: 'chofer', estado: 'activo' })
      await setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' })
    })
    await assertFails(getDoc(doc(db('ch'), 'users/com')))
  })

  test('caja puede leer un cliente y un chofer, pero no a gerencia', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
      await setDoc(doc(d, 'users/cli'), cliente())
      await setDoc(doc(d, 'users/ch'), { rol: 'chofer', estado: 'activo' })
      await setDoc(doc(d, 'users/gg'), { rol: 'gerente_general', estado: 'activo' })
    })
    await assertSucceeds(getDoc(doc(db('caja1'), 'users/cli')))
    await assertSucceeds(getDoc(doc(db('caja1'), 'users/ch')))
    await assertFails(getDoc(doc(db('caja1'), 'users/gg')))
  })

  test('supervisor lee un cliente, pero no choferes ni otro staff', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/sup'), { rol: 'supervisor', estado: 'activo' })
      await setDoc(doc(d, 'users/cli'), cliente())
      await setDoc(doc(d, 'users/ch'), { rol: 'chofer', estado: 'activo' })
      await setDoc(doc(d, 'users/gg'), { rol: 'gerente_general', estado: 'activo' })
    })
    await assertSucceeds(getDoc(doc(db('sup'), 'users/cli')))
    await assertFails(getDoc(doc(db('sup'), 'users/ch')))
    await assertFails(getDoc(doc(db('sup'), 'users/gg')))
  })
})

// ── preciosTango: precios y listas sincronizados desde Tango ─────────────────
describe('preciosTango — precios de Tango (fuente maestra)', () => {
  const precios = {
    company: 1, productos: { bolsa_10kg: 'PTHIBOLROLI0010' },
    listas: { 301: { nombre: 'HABITUALES', incluyeIva: false, precios: { bolsa_10kg: 2000 } } },
    especiales: { FC_280: { bolsa_10kg: 1800 } },
  }

  test('chofer, caja, comercial y facturación leen los precios', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/ch'),  { rol: 'chofer', estado: 'activo' })
      await setDoc(doc(d, 'users/caj'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
      await setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' })
      await setDoc(doc(d, 'users/fac'), { rol: 'facturacion', estado: 'activo' })
      await setDoc(doc(d, 'preciosTango/redonhielo'), precios)
    })
    for (const uid of ['ch', 'caj', 'com', 'fac']) {
      await assertSucceeds(getDoc(doc(db(uid), 'preciosTango/redonhielo')))
    }
  })

  test('un cliente NO lee las listas (vería los precios de todos los demás)', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/cli'), cliente())
      await setDoc(doc(d, 'preciosTango/redonhielo'), precios)
    })
    await assertFails(getDoc(doc(db('cli'), 'preciosTango/redonhielo')))
  })

  test('nadie escribe por reglas (solo la Cloud Function con Admin SDK)', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/adm'), { rol: 'super_admin', estado: 'activo' })
      await setDoc(doc(d, 'preciosTango/redonhielo'), precios)
    })
    await assertFails(setDoc(doc(db('adm'), 'preciosTango/rolito'), precios))
    await assertFails(updateDoc(doc(db('adm'), 'preciosTango/redonhielo'), { company: 9 }))
    await assertFails(deleteDoc(doc(db('adm'), 'preciosTango/redonhielo')))
  })
})

// ── saldosTango: cache de composición de saldos (cobranzas de supervisor) ─────
describe('saldosTango — cache de saldos de Tango', () => {
  const saldo = {
    idGva14: 1234, codigoTango: '092435', empresa: 'redonhielo',
    razonSocial: 'Cliente SA', saldoTotal: 15000.5,
    comprobantes: [{ tipo: 'FAC', numero: 'A-0001-00000001', fechaEmision: '2026-08-01', importeOriginal: 20000, saldoPendiente: 15000.5 }],
    origen: 'sync',
  }

  test('supervisor y facturación leen el saldo de un cliente', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/sup'), { rol: 'supervisor', estado: 'activo' })
      await setDoc(doc(d, 'users/fac'), { rol: 'facturacion', estado: 'activo' })
      await setDoc(doc(d, 'saldosTango/cli'), saldo)
    })
    await assertSucceeds(getDoc(doc(db('sup'), 'saldosTango/cli')))
    await assertSucceeds(getDoc(doc(db('fac'), 'saldosTango/cli')))
  })

  test('un cliente NO lee su propio saldo (por ahora) ni un chofer el de nadie', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/cli'), cliente())
      await setDoc(doc(d, 'users/ch'), { rol: 'chofer', estado: 'activo' })
      await setDoc(doc(d, 'saldosTango/cli'), saldo)
    })
    await assertFails(getDoc(doc(db('cli'), 'saldosTango/cli')))
    await assertFails(getDoc(doc(db('ch'), 'saldosTango/cli')))
  })

  test('nadie escribe el cache por reglas (solo Admin SDK)', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/sup'), { rol: 'supervisor', estado: 'activo' })
      await setDoc(doc(d, 'saldosTango/cli'), saldo)
    })
    await assertFails(setDoc(doc(db('sup'), 'saldosTango/otro'), saldo))
    await assertFails(updateDoc(doc(db('sup'), 'saldosTango/cli'), { saldoTotal: 0 }))
    await assertFails(deleteDoc(doc(db('sup'), 'saldosTango/cli')))
  })
})

// ── rollupsPedidos: agregados de solo lectura para staff ──────────────────────
describe('rollupsPedidos', () => {
  const rollup = { fecha: '2026-08-30', total: 5, bolsas: 20, porEstado: {}, porCliente: {} }

  test('un staff (gerente_general) puede leer un rollup', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/gg'), { rol: 'gerente_general', estado: 'activo' })
      await setDoc(doc(d, 'rollupsPedidos/2026-08-30'), rollup)
    })
    await assertSucceeds(getDoc(doc(db('gg'), 'rollupsPedidos/2026-08-30')))
  })

  test('un cliente NO puede leer un rollup (dato de gestión)', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/cli'), cliente())
      await setDoc(doc(d, 'rollupsPedidos/2026-08-30'), rollup)
    })
    await assertFails(getDoc(doc(db('cli'), 'rollupsPedidos/2026-08-30')))
  })

  test('ni siquiera un staff puede escribir un rollup (solo el trigger, vía Admin SDK)', async () => {
    await seed((d) => setDoc(doc(d, 'users/gg'), { rol: 'gerente_general', estado: 'activo' }))
    await assertFails(setDoc(doc(db('gg'), 'rollupsPedidos/2026-08-30'), rollup))
  })
})

// ── Facturación electrónica ARCA ──────────────────────────────────────────────
// Lo que se protege acá no es "datos internos": el Ticket de Acceso es una
// credencial que permite EMITIR COMPROBANTES en nombre de la empresa, y los
// contadores correlativos, si se editan a mano, hacen que ARCA rechace todo lo
// que venga después. Ver docs/arca/FACTURACION_ELECTRONICA.md.
describe('ARCA — ticket de acceso (credencial)', () => {
  test('ni siquiera super_admin puede leer el ticket de acceso', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/adm'), { rol: 'super_admin', estado: 'activo' })
      await setDoc(doc(d, 'arcaTickets/produccion_wsfe_30697668973'), {
        token: 'TK', sign: 'SG', expiracionMs: Date.now() + 3600_000,
      })
    })
    await assertFails(getDoc(doc(db('adm'), 'arcaTickets/produccion_wsfe_30697668973')))
  })

  test('nadie puede escribir un ticket de acceso', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/adm'), { rol: 'super_admin', estado: 'activo' })
    })
    await assertFails(
      setDoc(doc(db('adm'), 'arcaTickets/produccion_wsfe_30697668973'), { token: 'robado' }),
    )
  })
})

describe('ARCA — contadores de numeración', () => {
  test('un operador NO puede tocar el contador correlativo', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/op'), { rol: 'logistica', estado: 'activo' })
      await setDoc(doc(d, 'config/arcaNumeracion_1104_1'), { ultimoAsignado: 100, librados: [] })
    })
    // Adelantar el contador a mano deja un hueco y ARCA rechaza por no correlativo.
    await assertFails(
      updateDoc(doc(db('op'), 'config/arcaNumeracion_1104_1'), { ultimoAsignado: 500 }),
    )
  })

  test('un super_admin tampoco', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/adm'), { rol: 'super_admin', estado: 'activo' })
      await setDoc(doc(d, 'config/arcaNumeracion_1104_1'), { ultimoAsignado: 100, librados: [] })
    })
    await assertFails(
      updateDoc(doc(db('adm'), 'config/arcaNumeracion_1104_1'), { ultimoAsignado: 500 }),
    )
  })

  test('leerlo sí se puede: es diagnóstico, no un secreto', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/op'), { rol: 'logistica', estado: 'activo' })
      await setDoc(doc(d, 'config/arcaNumeracion_1104_1'), { ultimoAsignado: 100, librados: [] })
    })
    await assertSucceeds(getDoc(doc(db('op'), 'config/arcaNumeracion_1104_1')))
  })

  test('el resto de config sigue siendo editable por un operador', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/op'), { rol: 'logistica', estado: 'activo' })
      await setDoc(doc(d, 'config/zonas'), { prohibidas: [] })
    })
    await assertSucceeds(updateDoc(doc(db('op'), 'config/zonas'), { prohibidas: ['x'] }))
  })
})

describe('ARCA — configuración de facturación', () => {
  test('un operador NO puede cambiar config/arca', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/op'), { rol: 'logistica', estado: 'activo' })
      await setDoc(doc(d, 'config/arca'), {
        ambiente: 'produccion', cuit: '30697668973', puntoVenta: 1104,
        preciosIncluyenIva: false, tributoIdPercepcionIIBB: 7, habilitado: true,
      })
    })
    // Tocar preciosIncluyenIva cambiaría el total facturado un 21%.
    await assertFails(
      updateDoc(doc(db('op'), 'config/arca'), { preciosIncluyenIva: true }),
    )
  })

  test('el staff sí puede leerla', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/op'), { rol: 'logistica', estado: 'activo' })
      await setDoc(doc(d, 'config/arca'), { ambiente: 'produccion', habilitado: false })
    })
    await assertSucceeds(getDoc(doc(db('op'), 'config/arca')))
  })

  test('un operador NO puede tocar la vigencia del padrón de IIBB', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/op'), { rol: 'logistica', estado: 'activo' })
      await setDoc(doc(d, 'config/arcaPadronIIBB'), {
        vigenciaDesde: '2026-09-01', vigenciaHasta: '2026-09-30', clientesConPercepcion: 347,
      })
    })
    // Estirar la vigencia haría facturar con alícuotas vencidas sin que nada avise.
    await assertFails(
      updateDoc(doc(db('op'), 'config/arcaPadronIIBB'), { vigenciaHasta: '2027-12-31' }),
    )
    await assertSucceeds(getDoc(doc(db('op'), 'config/arcaPadronIIBB')))
  })
})

describe('ARCA — estado de facturas', () => {
  test('el staff puede consultar el estado de una factura', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/op'), { rol: 'logistica', estado: 'activo' })
      await setDoc(doc(d, 'facturasArca/venta1'), {
        estado: 'emitida', numero: 1, cae: '75123456789012',
      })
    })
    await assertSucceeds(getDoc(doc(db('op'), 'facturasArca/venta1')))
  })

  test('un cliente NO puede leer facturas', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/cli'), cliente())
      await setDoc(doc(d, 'facturasArca/venta1'), { estado: 'emitida', numero: 1 })
    })
    await assertFails(getDoc(doc(db('cli'), 'facturasArca/venta1')))
  })

  test('nadie puede escribir el CAE a mano', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/adm'), { rol: 'super_admin', estado: 'activo' })
      await setDoc(doc(d, 'facturasArca/venta1'), { estado: 'incierta', numero: 1 })
    })
    await assertFails(
      updateDoc(doc(db('adm'), 'facturasArca/venta1'), { estado: 'emitida', cae: 'inventado' }),
    )
  })
})
