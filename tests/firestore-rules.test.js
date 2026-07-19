import { readFileSync } from 'node:fs'
import { test, before, after, beforeEach, describe } from 'node:test'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'

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

  test('comercial NO puede editar el codigoCliente de un cliente (campo de facturación)', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/com'), { rol: 'comercial', estado: 'activo' })
      await setDoc(doc(d, 'users/cli'), cliente())
    })
    await assertFails(updateDoc(doc(db('com'), 'users/cli'), { codigoCliente: 'CLI-9999' }))
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

  test('chofer asignado SÍ puede marcar el pedido como entregado', async () => {
    await seedPedido()
    await assertSucceeds(updateDoc(doc(db('ch', 'ch@x.com'), 'orders/o1'), {
      status: 'entregado', productosEntregados: [{ name: 'Hielo', quantity: 1 }],
      entregaParcial: false, notaEntrega: '', updatedAt: new Date(),
    }))
  })

  test('chofer asignado NO puede reescribir products/precio al marcar entregado', async () => {
    await seedPedido()
    await assertFails(updateDoc(doc(db('ch', 'ch@x.com'), 'orders/o1'), {
      status: 'entregado', products: [{ name: 'Hielo', quantity: 999 }], updatedAt: new Date(),
    }))
  })

  test('chofer asignado NO puede reasignarse otro pedido (driverId/clientId)', async () => {
    await seedPedido()
    await assertFails(updateDoc(doc(db('ch', 'ch@x.com'), 'orders/o1'), {
      clientId: 'otro-cliente', updatedAt: new Date(),
    }))
  })

  test('un chofer NO asignado no puede tocar el pedido de otro chofer', async () => {
    await seedPedido()
    await assertFails(updateDoc(doc(db('ch2', 'ch2@x.com'), 'orders/o1'), {
      status: 'entregado', updatedAt: new Date(),
    }))
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

  test('gerente_comercial SÍ puede editar una lista de precios', async () => {
    await seed((d) => setDoc(doc(d, 'users/gc'), { rol: 'gerente_comercial', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('gc'), 'listas-precios/l1'), { nombre: 'Mayoristas', items: [] }))
  })

  test('un cliente NO puede editar listas de precios', async () => {
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente()))
    await assertFails(setDoc(doc(db('cli'), 'listas-precios/l1'), { nombre: 'X', items: [] }))
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

  test('operador SÍ puede escribir un despacho', async () => {
    await seed((d) => setDoc(doc(d, 'users/ops'), { rol: 'logistica', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('ops'), 'despachos/2026-01-02_ch'), {
      fecha: '2026-01-02', driverId: 'ch@x.com', status: 'borrador', orderIds: [],
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

// ── historialPrecios: inmutabilidad ───────────────────────────────────────
describe('historialPrecios — inmutabilidad', () => {
  test('manager SÍ puede crear un evento de historial', async () => {
    await seed((d) => setDoc(doc(d, 'users/gc'), { rol: 'gerente_comercial', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('gc'), 'historialPrecios/ev1'), { clientId: 'cli', tipo: 'lista' }))
  })

  test('nadie puede actualizar un evento de historial (ni super_admin)', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/adm'), { rol: 'super_admin', estado: 'activo' })
      await setDoc(doc(d, 'historialPrecios/ev1'), { clientId: 'cli', tipo: 'lista' })
    })
    await assertFails(updateDoc(doc(db('adm'), 'historialPrecios/ev1'), { tipo: 'custom' }))
  })

  test('nadie puede borrar un evento de historial (ni super_admin)', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/adm'), { rol: 'super_admin', estado: 'activo' })
      await setDoc(doc(d, 'historialPrecios/ev1'), { clientId: 'cli', tipo: 'lista' })
    })
    await assertFails(deleteDoc(doc(db('adm'), 'historialPrecios/ev1')))
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
