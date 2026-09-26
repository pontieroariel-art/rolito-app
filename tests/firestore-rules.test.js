import { readFileSync } from 'node:fs'
import { test, before, after, beforeEach, describe } from 'node:test'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, getDocs, collection, query, where, setDoc, updateDoc, deleteDoc, arrayUnion, deleteField, writeBatch, runTransaction, serverTimestamp } from 'firebase/firestore'

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

// Turno de caja ABIERTO del cajero (rendición de fondos, 2026-09-14): desde
// entonces toda venta de ventanilla y cobranza de mostrador lleva cajaSesionId
// y las reglas exigen que sea un turno abierto del mismo uid. Devuelve el id.
const sembrarSesionAbierta = async (uid, planta = 'torcuato', fecha = '2026-09-09', n = 1) => {
  const id = fecha + '_' + uid + '_' + n
  await seed((d) => setDoc(doc(d, 'cajaSesiones/' + id), {
    plantaId: planta, cajero: { uid, nombre: uid }, fecha, numero: n, estado: 'abierta',
    abiertaEn: new Date(), fondoInicial: 0, fondoInicialDe: null,
  }))
  return id
}

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

  test('un usuario SÍ puede crearse como cliente PENDIENTE', async () => {
    await assertSucceeds(setDoc(doc(db('new', 'n@x.com'), 'users/new'), cliente({ estado: 'pendiente' })))
  })

  // Auditoría 2026-09-22: el alta propia aceptaba cualquier campo. Con
  // rolesExtra:['facturacion'] el registro entraba activo y con permisos reales.
  test('el registro público NO puede nacer activo', async () => {
    await assertFails(setDoc(doc(db('new', 'n@x.com'), 'users/new'), cliente()))   // la fixture trae estado 'activo'
  })

  test('el registro público NO puede traer roles adicionales ni permisos', async () => {
    const pendiente = (extra) => cliente({ estado: 'pendiente', ...extra })
    await assertFails(setDoc(doc(db('new', 'n@x.com'), 'users/new'), pendiente({ rolesExtra: ['facturacion'] })))
    await assertFails(setDoc(doc(db('new', 'n@x.com'), 'users/new'), pendiente({ rolesExtra: [] })))
    await assertFails(setDoc(doc(db('new', 'n@x.com'), 'users/new'), pendiente({ autorizaAnulaciones: true })))
    await assertFails(setDoc(doc(db('new', 'n@x.com'), 'users/new'), pendiente({ tangoBridge: true })))
    await assertFails(setDoc(doc(db('new', 'n@x.com'), 'users/new'), pendiente({ planta: 'torcuato' })))
    await assertFails(setDoc(doc(db('new', 'n@x.com'), 'users/new'), pendiente({ preciosTango: { redonhielo: { bolsa_10kg: 1 } } })))
    await assertFails(setDoc(doc(db('new', 'n@x.com'), 'users/new'), pendiente({ codigoTango: 'FC.001' })))
    await assertFails(setDoc(doc(db('new', 'n@x.com'), 'users/new'), pendiente({ creadoPor: { uid: 'x', nombre: 'X', rol: 'comercial' } })))
  })

  test('un cliente NO puede cambiar sus precios ni sus códigos de Tango', async () => {
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente({ preciosTango: { redonhielo: { bolsa_10kg: 5000 } }, codigoTango: 'FC.001' })))
    await assertFails(updateDoc(doc(db('cli'), 'users/cli'), { preciosTango: { redonhielo: { bolsa_10kg: 1 } } }))
    await assertFails(updateDoc(doc(db('cli'), 'users/cli'), { listaTango: { redonhielo: 300 } }))
    await assertFails(updateDoc(doc(db('cli'), 'users/cli'), { codigoTango: 'FC.999' }))
    await assertFails(updateDoc(doc(db('cli'), 'users/cli'), { idGva14Tango: 12 }))
  })

  test('facturacion asigna codigoCliente a un cliente, no a otro staff', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/fac'), { rol: 'facturacion', estado: 'activo' })
      await setDoc(doc(d, 'users/adm'), { rol: 'super_admin', estado: 'activo' })
      await setDoc(doc(d, 'users/cli'), cliente())
    })
    await assertSucceeds(updateDoc(doc(db('fac'), 'users/cli'), { codigoCliente: 'C-0001' }))
    await assertFails(updateDoc(doc(db('fac'), 'users/adm'), { codigoCliente: 'C-0002' }))
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

// ── orders: entrega con remito de fábrica (Coto/Carrefour, 2026-09-23) ───────
describe('orders — entrega con remito de fábrica', () => {
  // El viaje rem1 es del chofer: desde el 2026-09-26 la regla exige que la
  // entrega de fábrica vaya a un viaje propio (auditoría del chofer, C4).
  const seedChofer = () => seed(async (d) => {
    await setDoc(doc(d, 'users/ch'), { rol: 'chofer', estado: 'activo', email: 'ch@x.com' })
    await setDoc(doc(d, 'remitosCarga/rem1'), { choferId: 'ch', camionId: 'cam1', estado: 'salido', fecha: new Date() })
  })
  const seedPedido = (extra = {}) => seed((d) => setDoc(doc(d, 'orders/o1'), pedido({ driverId: 'ch@x.com', ...extra })))
  const entrega = (choferId = 'ch') => ({
    choferId, choferNombre: 'Chofer Uno', remitoId: 'rem1', remitoCodigo: 'RC-DT-000001', camionId: 'cam1',
    dia: '2026-09-23', en: new Date(), productos: [{ productoId: 'bolsa_2kg', nombre: 'Hielo bolsa 2kg', cantidad: 460 }],
  })
  const marcar = (choferId) => updateDoc(doc(db('ch', 'ch@x.com'), 'orders/o1'), {
    status: 'entregado', productosEntregados: [{ name: 'Hielo bolsa 2kg', quantity: 460, productoId: 'bolsa_2kg' }],
    entregaParcial: false, notaEntrega: '', updatedAt: new Date(), entregaFabrica: entrega(choferId),
  })

  test('el chofer registra la entrega sin comprobante de SU pedido sellado por el server', async () => {
    await seedChofer()
    await seedPedido({ entregaSinComprobante: true })
    await assertSucceeds(marcar('ch'))
  })

  test('sin el sello del server no hay entrega de fábrica: el pedido va por ENTREGAR (venta)', async () => {
    await seedChofer()
    await seedPedido()
    await assertFails(marcar('ch'))
  })

  test('el chofer no puede sellar el pedido él mismo ni firmar la entrega a nombre de otro', async () => {
    await seedChofer()
    await seedPedido()
    await assertFails(updateDoc(doc(db('ch', 'ch@x.com'), 'orders/o1'), { entregaSinComprobante: true, updatedAt: new Date() }))
    await seedPedido({ entregaSinComprobante: true })
    await assertFails(marcar('otro'))
  })

  test('caja y tesorería leen pedidos (la liquidación suma las entregas de fábrica); el cliente ajeno no', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
      await setDoc(doc(d, 'users/tes1'), { rol: 'tesoreria', estado: 'activo' })
      await setDoc(doc(d, 'users/otro'), cliente())
    })
    await seedPedido({ entregaSinComprobante: true })
    await assertSucceeds(getDoc(doc(db('caja1'), 'orders/o1')))
    await assertSucceeds(getDoc(doc(db('tes1'), 'orders/o1')))
    await assertFails(getDoc(doc(db('otro'), 'orders/o1')))
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

  // Entrega con remito de fábrica (Coto/Carrefour, 2026-09-23): la prende
  // facturación (y super_admin); el cliente no se la puede poner solo.
  test('facturacion SÍ puede prender la entrega con remito de fábrica', async () => {
    await seedFacturacion()
    await assertSucceeds(updateDoc(doc(db('fac'), 'users/cli'), { entregaConRemitoDeFabrica: true }))
  })

  test('el cliente NO puede prenderse la entrega con remito de fábrica, ni al registrarse ni después', async () => {
    await seedFacturacion()
    await assertFails(updateDoc(doc(db('cli'), 'users/cli'), { entregaConRemitoDeFabrica: true }))
    await assertFails(setDoc(doc(db('nuevo'), 'users/nuevo'), { ...cliente(), estado: 'pendiente', entregaConRemitoDeFabrica: true }))
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

  // Auditoría del chofer C1 (2026-09-26): el ayudante solo acompaña y ve su turno.
  describe('ayudante (C1)', () => {
    const seedConAyudante = () => seed((d) => setDoc(doc(d, 'despachos/2026-01-01_ch'), {
      fecha: '2026-01-01', driverId: 'ch@x.com', ayudanteEmail: 'ay@x.com', status: 'confirmado', orderIds: ['o1'],
    }))

    test('SÍ lee el despacho donde figura como ayudante, también por consulta', async () => {
      await seedConAyudante()
      await assertSucceeds(getDoc(doc(db('ay', 'ay@x.com'), 'despachos/2026-01-01_ch')))
      await assertSucceeds(getDocs(query(collection(db('ay', 'ay@x.com'), 'despachos'),
        where('fecha', '==', '2026-01-01'), where('ayudanteEmail', '==', 'ay@x.com'))))
    })

    test('NO lee un despacho donde no es el ayudante', async () => {
      await seedConAyudante()
      await assertFails(getDoc(doc(db('ay2', 'ay2@x.com'), 'despachos/2026-01-01_ch')))
      await seedDespacho() // sin ayudanteEmail
      await assertFails(getDoc(doc(db('ay', 'ay@x.com'), 'despachos/2026-01-01_ch')))
    })

    test('NO escribe el despacho', async () => {
      await seedConAyudante()
      await assertFails(updateDoc(doc(db('ay', 'ay@x.com'), 'despachos/2026-01-01_ch'), { status: 'borrador' }))
    })

    test('NO lee los pedidos del chofer al que acompaña', async () => {
      await seed((d) => setDoc(doc(d, 'orders/o1'), { clientId: 'cli', driverId: 'ch@x.com', status: 'confirmado' }))
      await assertFails(getDoc(doc(db('ay', 'ay@x.com'), 'orders/o1')))
    })
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

  const anulacion = (extra = {}) => ({
    anulacion: { motivo: 'Producto equivocado', por: { uid: 'enc', nombre: 'Osvaldo' }, en: serverTimestamp(), ...extra },
  })
  const seedEncargado = () =>
    seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'produccion_encargado', estado: 'activo' }))

  test('el encargado puede anular un pallet con motivo', async () => {
    await seedEncargado()
    await seed((d) => setDoc(doc(d, 'produccionPallets/p1'), pallet()))
    await assertSucceeds(updateDoc(doc(db('enc'), 'produccionPallets/p1'), anulacion()))
  })

  test('el operario NO puede anular un pallet, ni el suyo', async () => {
    await seedOperario()
    await seed((d) => setDoc(doc(d, 'produccionPallets/p1'), pallet()))
    await assertFails(updateDoc(doc(db('op1'), 'produccionPallets/p1'), anulacion({ por: { uid: 'op1', nombre: 'Juan' } })))
  })

  test('un pallet anulado no se puede volver a anular', async () => {
    await seedEncargado()
    await seed((d) => setDoc(doc(d, 'produccionPallets/p1'), { ...pallet(), anulacion: { motivo: 'Otro', por: { uid: 'enc', nombre: 'O' }, en: new Date() } }))
    await assertFails(updateDoc(doc(db('enc'), 'produccionPallets/p1'), anulacion()))
  })

  test('la anulación exige motivo, firma propia y no toca otros campos', async () => {
    await seedEncargado()
    await seed((d) => setDoc(doc(d, 'produccionPallets/p1'), pallet()))
    await assertFails(updateDoc(doc(db('enc'), 'produccionPallets/p1'), anulacion({ motivo: '' })))
    await assertFails(updateDoc(doc(db('enc'), 'produccionPallets/p1'), anulacion({ por: { uid: 'otro', nombre: 'X' } })))
    await assertFails(updateDoc(doc(db('enc'), 'produccionPallets/p1'), { ...anulacion(), unidades: 1 }))
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

// ── Panel del encargado de producción (2026-09-25) ────────────────────────────
describe('panel de producción: tablet, turnos y ventas por producto', () => {
  const seedOperario = (uid = 'op1', planta = 'torcuato') =>
    seed((d) => setDoc(doc(d, `users/${uid}`), { rol: 'produccion_hielo', estado: 'activo', planta }))
  const seedEncargado = () =>
    seed((d) => setDoc(doc(d, 'users/enc'), { rol: 'produccion_encargado', estado: 'activo' }))
  const estado = (extra = {}) => ({
    operario: { uid: 'op1', nombre: 'Juan' }, impresora: { estado: 'conectada', nombre: 'ZD421' },
    enCola: 0, ultimaActividad: serverTimestamp(), ...extra,
  })

  test('la tablet publica su estado en SU planta', async () => {
    await seedOperario()
    await assertSucceeds(setDoc(doc(db('op1'), 'produccionTablets/torcuato'), estado()))
  })
  test('la tablet no publica en otra planta, a nombre de otro ni con campos de más', async () => {
    await seedOperario()
    await assertFails(setDoc(doc(db('op1'), 'produccionTablets/merlo'), estado()))
    await assertFails(setDoc(doc(db('op1'), 'produccionTablets/torcuato'), estado({ operario: { uid: 'otro', nombre: 'X' } })))
    await assertFails(setDoc(doc(db('op1'), 'produccionTablets/torcuato'), estado({ extra: 1 })))
  })
  test('el encargado lee el estado de la tablet y no lo escribe', async () => {
    await seedEncargado()
    await seed((d) => setDoc(doc(d, 'produccionTablets/torcuato'), { enCola: 0 }))
    await assertSucceeds(getDoc(doc(db('enc'), 'produccionTablets/torcuato')))
    await assertFails(setDoc(doc(db('enc'), 'produccionTablets/torcuato'), estado({ operario: { uid: 'enc', nombre: 'O' } })))
  })
  test('el encargado edita los turnos; el operario no', async () => {
    await seedEncargado(); await seedOperario()
    const turnos = { turnos: [{ nombre: 'Mañana', desde: '06:00', hasta: '14:00' }], actualizadoPor: 'enc', actualizadoEn: new Date() }
    await assertSucceeds(setDoc(doc(db('enc'), 'config/produccionTurnos_torcuato'), turnos))
    await assertFails(setDoc(doc(db('op1'), 'config/produccionTurnos_torcuato'), turnos))
    await assertFails(setDoc(doc(db('enc'), 'config/produccionTurnos_torcuato'), { ...turnos, otro: 1 }))
    await assertFails(setDoc(doc(db('enc'), 'config/otraCosa'), turnos))
  })
  test('el resumen de ventas por producto lo lee el encargado, no el operario, y nadie lo escribe', async () => {
    await seedEncargado(); await seedOperario()
    await seed((d) => setDoc(doc(d, 'rollupsVentasProducto/2026-09-28'), { fecha: '2026-09-28', porPlanta: {} }))
    await assertSucceeds(getDoc(doc(db('enc'), 'rollupsVentasProducto/2026-09-28')))
    await assertFails(getDoc(doc(db('op1'), 'rollupsVentasProducto/2026-09-28')))
    await assertFails(setDoc(doc(db('enc'), 'rollupsVentasProducto/2026-09-28'), { fecha: 'x' }))
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
// ── depositosTango: catálogo de depósitos de Tango (expedición por depósito) ──
describe('depositosTango', () => {
  const dep = { codigo: '21', nombre: 'CRISTIAN PRIMITERRA', idSta22: 94, inhabilitado: false, tipo: 'repartidor', activo: true, uid: null, usuarioNombre: null, usuarioRol: null }

  test('todo el staff lo lee (caja, muelle, chofer, supervisor); un cliente no', async () => {
    await seed((d) => setDoc(doc(d, 'depositosTango/21'), dep))
    for (const [uid, rol] of [['caja1', 'caja'], ['mue1', 'muelle'], ['chof1', 'chofer'], ['sup1', 'supervisor']]) {
      await seed((d) => setDoc(doc(d, `users/${uid}`), { rol, estado: 'activo', planta: 'torcuato' }))
      await assertSucceeds(getDoc(doc(db(uid), 'depositosTango/21')))
    }
    await seed((d) => setDoc(doc(d, 'users/cli9'), { rol: 'cliente', estado: 'activo' }))
    await assertFails(getDoc(doc(db('cli9'), 'depositosTango/21')))
  })

  test('super_admin edita tipo/activo/usuario; nadie crea, borra ni toca lo que viene de Tango', async () => {
    await seed((d) => setDoc(doc(d, 'depositosTango/21'), dep))
    await seed((d) => setDoc(doc(d, 'users/sa'), { rol: 'super_admin', estado: 'activo' }))
    await assertSucceeds(updateDoc(doc(db('sa'), 'depositosTango/21'), { uid: 'chof1', usuarioNombre: 'Primiterra', usuarioRol: 'chofer', activo: true, tipo: 'repartidor', editadoEn: new Date() }))
    await assertFails(updateDoc(doc(db('sa'), 'depositosTango/21'), { nombre: 'OTRO' }))
    await assertFails(updateDoc(doc(db('sa'), 'depositosTango/21'), { tipo: 'camion', activo: true }))
    await assertFails(setDoc(doc(db('sa'), 'depositosTango/99'), dep))
    await assertFails(deleteDoc(doc(db('sa'), 'depositosTango/21')))
    await seed((d) => setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' }))
    await assertFails(updateDoc(doc(db('caja1'), 'depositosTango/21'), { activo: false, tipo: 'repartidor' }))
  })
})

// ── tango-altas: cola de altas automáticas de clientes desde Tango ──────────
describe('tango-altas', () => {
  const alta = { cuit: '30526047792', estado: 'pendiente', filas: [], creadoEn: new Date() }

  test('staff que gestiona clientes lee la cola; el bridge y un cliente no', async () => {
    await seed((d) => setDoc(doc(d, 'tango-altas/30526047792'), alta))
    await seed((d) => setDoc(doc(d, 'users/sa'), { rol: 'super_admin', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'users/fac'), { rol: 'facturacion', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'users/bridge1'), { tangoBridge: true }))
    await seed((d) => setDoc(doc(d, 'users/cli9'), { rol: 'cliente', estado: 'activo' }))
    await assertSucceeds(getDoc(doc(db('sa'), 'tango-altas/30526047792')))
    await assertSucceeds(getDoc(doc(db('fac'), 'tango-altas/30526047792')))
    await assertFails(getDoc(doc(db('bridge1'), 'tango-altas/30526047792')))
    await assertFails(getDoc(doc(db('cli9'), 'tango-altas/30526047792')))
  })

  test('nadie escribe la cola desde el cliente (solo el Admin SDK)', async () => {
    await seed((d) => setDoc(doc(d, 'users/sa'), { rol: 'super_admin', estado: 'activo' }))
    await assertFails(setDoc(doc(db('sa'), 'tango-altas/20104334955'), alta))
    await seed((d) => setDoc(doc(d, 'tango-altas/30526047792'), alta))
    await assertFails(updateDoc(doc(db('sa'), 'tango-altas/30526047792'), { estado: 'creada' }))
    await assertFails(deleteDoc(doc(db('sa'), 'tango-altas/30526047792')))
  })
})

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

  test('sincronizarComprobantes (2026-09-10): supervisor y tesorería piden con códigos; sin códigos, de más de 50 o a nombre de otro no; el bridge responde', async () => {
    await seedSupervisor()
    await seedBridge()
    await seed((d) => setDoc(doc(d, 'users/tes'), { rol: 'tesoreria', estado: 'activo' }))
    const pedido = (extra = {}) => ({ tipo: 'sincronizarComprobantes', empresa: 'redonhielo', codigos: ['PA.003'], clienteUid: 'cli', solicitadoPor: { uid: 'sup', nombre: 'Supervisor' }, estado: 'pendiente', creadoEn: new Date(), ...extra })
    await assertSucceeds(setDoc(doc(db('sup'), 'tango-consultas/s1'), pedido()))
    await assertSucceeds(setDoc(doc(db('tes'), 'tango-consultas/s2'), pedido({ solicitadoPor: { uid: 'tes', nombre: 'T' }, empresa: 'rolito' })))
    await assertFails(setDoc(doc(db('sup'), 'tango-consultas/s3'), pedido({ codigos: [] })))
    await assertFails(setDoc(doc(db('sup'), 'tango-consultas/s4'), pedido({ codigos: Array.from({ length: 51 }, (_, i) => `C${i}`) })))
    await assertFails(setDoc(doc(db('sup'), 'tango-consultas/s5'), pedido({ solicitadoPor: { uid: 'otro', nombre: 'X' } })))
    await assertFails(setDoc(doc(db('sup'), 'tango-consultas/s6'), pedido({ empresa: 'otra' })))
    await assertSucceeds(updateDoc(doc(db('bridge1'), 'tango-consultas/s1'), { estado: 'respondida', resultado: { empresas: {} }, ultimoError: null, actualizadoEn: new Date() }))
  })

  test('el bridge graba comprobantesSync en config/tango, nada más', async () => {
    await seedBridge()
    await seed((d) => setDoc(doc(d, 'config/tango'), { bridgeListenerLastSeen: new Date() }))
    await assertSucceeds(updateDoc(doc(db('bridge1'), 'config/tango'), { comprobantesSync: { ok: true, motivo: 'periodica' } }))
    await assertFails(updateDoc(doc(db('bridge1'), 'config/tango'), { remitosSqlEnabled: true }))
  })

  test('la consulta es de una empresa válida; idsGva14 (varios códigos por CUIT) es opcional y lista', async () => {
    await seedSupervisor()
    await assertSucceeds(setDoc(doc(db('sup'), 'tango-consultas/r1'), consulta({ empresa: 'rolito' })))
    await assertSucceeds(setDoc(doc(db('sup'), 'tango-consultas/r2'), consulta({ empresa: 'rolito', idsGva14: [1234, 5678] })))
    await assertFails(setDoc(doc(db('sup'), 'tango-consultas/r3'), consulta({ empresa: 'otra' })))
    const sinEmpresa = consulta()
    delete sinEmpresa.empresa
    await assertFails(setDoc(doc(db('sup'), 'tango-consultas/r4'), sinEmpresa))
    await assertFails(setDoc(doc(db('sup'), 'tango-consultas/r5'), consulta({ idsGva14: 'x' })))
  })

  test('un chofer SÍ crea consultas (cobra en la calle con la cobranza completa, 2026-09-05); un cliente no', async () => {
    await seed((d) => setDoc(doc(d, 'users/ch'), { rol: 'chofer', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('ch'), 'tango-consultas/c1'), consulta({ solicitadoPor: { uid: 'ch', nombre: 'Chofer' } })))
    await seed((d) => setDoc(doc(d, 'users/cli9'), { rol: 'cliente', estado: 'activo' }))
    await assertFails(setDoc(doc(db('cli9'), 'tango-consultas/c2'), consulta({ solicitadoPor: { uid: 'cli9', nombre: 'Cliente' } })))
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

  test('un supervisor puede vender con su propio uid (entrega como depósito de Tango, 2026-09-06); caja no', async () => {
    await seed((d) => setDoc(doc(d, 'users/sup1'), { rol: 'supervisor', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('sup1'), 'ventasCamion/v2'), venta({ choferId: 'sup1', depositoTango: '24', depositoTangoNombre: 'MATIAS VINJOY' })))
    await assertFails(setDoc(doc(db('sup1'), 'ventasCamion/v3'), venta({ choferId: 'chof1' })))
    await seed((d) => setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' }))
    await assertFails(setDoc(doc(db('caja1'), 'ventasCamion/v4'), venta({ choferId: 'caja1' })))
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

  // Auditoría 2026-09-22: lo que escribe el server no nace con la venta.
  test('la venta NO nace facturada, anulada, con mail enviado ni con Tango confirmado', async () => {
    await seedChofer()
    await assertFails(setDoc(doc(db('chof1'), 'ventasCamion/v1'), venta({ factura: { estado: 'emitida', importes: { total: 1 } } })))
    await assertFails(setDoc(doc(db('chof1'), 'ventasCamion/v1'), venta({ anulacion: { estado: 'anulada', tipo: 'remito' } })))
    await assertFails(setDoc(doc(db('chof1'), 'ventasCamion/v1'), venta({ envioMail: { estado: 'enviado' } })))
    await assertFails(setDoc(doc(db('chof1'), 'ventasCamion/v1'), venta({ tango: { estado: 'confirmado', remitoNumero: 'R0001' } })))
    await assertFails(setDoc(doc(db('chof1'), 'ventasCamion/v1'), venta({ total: -1 })))
    // Sin `tango` también vale (docs viejos / acompañante).
    const { tango: _t, ...sinTango } = venta()
    await assertSucceeds(setDoc(doc(db('chof1'), 'ventasCamion/v2'), sinTango))
  })

  test('la venta NO se fecha en el futuro ni en un viaje de hace más de una semana', async () => {
    await seedChofer()
    const dia = 24 * 3600 * 1000
    await assertFails(setDoc(doc(db('chof1'), 'ventasCamion/v1'), venta({ fecha: new Date(Date.now() + 2 * 3600 * 1000) })))
    await assertFails(setDoc(doc(db('chof1'), 'ventasCamion/v1'), venta({ fecha: new Date(Date.now() - 8 * dia) })))
    await assertFails(setDoc(doc(db('chof1'), 'ventasCamion/v1'), venta({ fecha: '2026-09-21' })))
    // Offline-first: una venta encolada hace tres días entra igual.
    await assertSucceeds(setDoc(doc(db('chof1'), 'ventasCamion/v2'), venta({ fecha: new Date(Date.now() - 3 * dia) })))
  })

  // La lectura la corta Auth (la baja deshabilita la cuenta y revoca el token,
  // claims.ts); las reglas cortan la escritura de plata con el token todavía vivo.
  test('un chofer dado de baja (estado inactivo) NO vende', async () => {
    await seed((d) => setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'inactivo' }))
    await assertFails(setDoc(doc(db('chof1'), 'ventasCamion/v1'), venta()))
    await seed((d) => setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'pendiente' }))
    await assertFails(setDoc(doc(db('chof1'), 'ventasCamion/v1'), venta()))
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

  test('facturación puede leer ventas de camión (regenera la factura para mandársela al cliente) pero no crearlas', async () => {
    await seed((d) => setDoc(doc(d, 'users/fac'), { rol: 'facturacion', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'ventasCamion/v1'), venta()))
    await assertSucceeds(getDoc(doc(db('fac'), 'ventasCamion/v1')))
    await assertFails(setDoc(doc(db('fac'), 'ventasCamion/v2'), venta({ choferId: 'fac' })))
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

  test('operario NO puede adelantar el contador más de 30', async () => {
    await seedOperario()
    await seed((d) => setDoc(doc(d, 'config/produccionCounter_torcuato'), { next: 500 }))
    await assertFails(updateDoc(doc(db('op1'), 'config/produccionCounter_torcuato'), { next: 531 }))
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
// Reescrito el 2026-09-18 (viaje en dos partes): el remito ya NO lo emite caja
// horas antes. Caja arma un borrador y MUELLE lo acepta al entregar el camión;
// ahí nace el remito, ya 'entregado', con su número, su remito R y el COT con
// la hora real de la salida.
describe('remitosCarga', () => {
  const remito = (extra = {}) => ({
    numero: 1, codigo: 'RC-DT-000001', plantaId: 'torcuato', borradorId: 'bo1',
    camionId: 'cam1', camionLabel: 'AB123CD · Iveco', choferId: 'chof1', choferNombre: 'Chofer Uno',
    items: [{ productoId: 'bolsa_10kg', nombre: 'Hielo 10kg', cantidad: 100, pallets: 2 }],
    palletsCarga: 2, envases: { tarimasMadera: 1, palletsMetal: 1, racks: [12, 15] },
    estado: 'emitido', creadoPor: { uid: 'caja1', nombre: 'Caja Uno' },
    emitidoPor: { uid: 'mue1', nombre: 'Muelle Uno' },
    fecha: new Date(), tango: { estado: 'pendiente' }, ...extra,
  })
  // El borrador del que nace el remito: muelle lo acepta en la misma transacción.
  const borradorDeCarga = (extra = {}) => ({
    plantaId: 'torcuato', paraFecha: '2026-09-18',
    camionId: 'cam1', camionLabel: 'AB123CD · Iveco', choferId: 'chof1', choferNombre: 'Chofer Uno',
    items: [{ productoId: 'bolsa_10kg', nombre: 'Hielo 10kg', cantidad: 100, pallets: 2 }],
    cotDestino: {
      destino: { tipo: 'planta', plantaId: 'merlo' },
      respaldo: { codigoComprobante: '091', prefijo: 25, importe: 0 },
      patente: 'AB123CD', recorrido: { tipo: 'M', localidad: 'MERLO', ruta: 'RUTA 205' },
    },
    estado: 'pendiente', creadoPor: { uid: 'caja1', nombre: 'Caja Uno' },
    fecha: new Date(), venceEn: new Date('2026-09-20T23:59:59-03:00'),
    ...extra,
  })
  const seedMuelle = (uid = 'mue1', planta = 'torcuato') =>
    seed((d) => setDoc(doc(d, 'users/' + uid), { rol: 'muelle', estado: 'activo', planta }))
  const seedCaja = (uid = 'caja1', planta = 'torcuato') =>
    seed((d) => setDoc(doc(d, 'users/' + uid), { rol: 'caja', estado: 'activo', planta }))

  test('muelle confecciona el remito de su planta desde el borrador (nace emitido)', async () => {
    await seedMuelle()
    await assertSucceeds(setDoc(doc(db('mue1'), 'remitosCarga/r1'), remito()))
  })


  // Confeccionar un remito escribe CUATRO documentos en una sola transacción:
  // los dos contadores, el remito y el borrador que se acepta. Los cuatro
  // comparten el presupuesto de 1000 expresiones que Firestore da por request,
  // y el 18/09 eso rebotó en la cara del muellero con permission-denied. El
  // test emite la transacción entera, como la hace la app.
  test('la transacción completa de confeccionar el remito entra (no se pasa del tope de expresiones)', async () => {
    await seedMuelle()
    await seed(async (d) => {
      await setDoc(doc(d, 'borradoresCarga/bo1'), borradorDeCarga())
      await setDoc(doc(d, 'config/cargaCounter_torcuato'), { next: 4 })
      await setDoc(doc(d, 'config/remitoCargaCounter'), { next: 58681, ultimo: 59000 })
    })
    const dbm = db('mue1')
    await assertSucceeds(runTransaction(dbm, async (tx) => {
      await tx.get(doc(dbm, 'borradoresCarga/bo1'))
      await tx.get(doc(dbm, 'config/cargaCounter_torcuato'))
      await tx.get(doc(dbm, 'config/remitoCargaCounter'))
      tx.update(doc(dbm, 'config/remitoCargaCounter'), { next: 58682 })
      tx.set(doc(dbm, 'config/cargaCounter_torcuato'), { next: 5 })
      tx.set(doc(dbm, 'remitosCarga/r1'), remito({
        numero: 4, codigo: 'RC-DT-000004', darsena: 3, darsenaAsignadaEn: new Date(), kg: 900,
        cotSolicitud: {
          destino: { tipo: 'planta', plantaId: 'merlo' },
          respaldo: { codigoComprobante: '091', prefijo: 25, numero: 58681, importe: 0 },
          patente: 'AB123CD', recorrido: { tipo: 'M', localidad: 'MERLO', ruta: 'RUTA 205' },
          fechaSalida: '2026-09-18', horaSalida: '18:00',
        },
        remitoR: { puntoVenta: 25, numero: 58681, cai: '26091234567890', vencimiento: '2027-12-31' },
      }))
      tx.update(doc(dbm, 'borradoresCarga/bo1'), { estado: 'aceptado', remitoId: 'r1' })
    }))
  })

  test('caja YA NO emite remitos: eso es de muelle desde el 2026-09-18', async () => {
    await seedCaja()
    await assertFails(setDoc(doc(db('caja1'), 'remitosCarga/r1'), remito({
      emitidoPor: { uid: 'caja1', nombre: 'Caja Uno' },
      entregadoPor: { uid: 'caja1', nombre: 'Caja Uno', hora: new Date() },
    })))
  })

  test('sin borrador no hay remito: muelle no arma cargas desde cero', async () => {
    await seedMuelle()
    const { borradorId: _b, ...sinBorrador } = remito()
    await assertFails(setDoc(doc(db('mue1'), 'remitosCarga/r1'), sinBorrador))
    await assertFails(setDoc(doc(db('mue1'), 'remitosCarga/r2'), remito({ borradorId: 7 })))
  })

  test('el remito nace emitido, a nombre de quien lo confecciona; no en otro estado ni a nombre de otro', async () => {
    await seedMuelle()
    await assertFails(setDoc(doc(db('mue1'), 'remitosCarga/r1'), remito({ estado: 'entregado' })))
    await assertFails(setDoc(doc(db('mue1'), 'remitosCarga/r2'), remito({ estado: 'salido' })))
    await assertFails(setDoc(doc(db('mue1'), 'remitosCarga/r3'), remito({ emitidoPor: { uid: 'otro', nombre: 'Otro' } })))
  })

  // ── un camión no recibe carga nueva con un viaje sin descargar (2026-09-18) ──
  test('un camión con una descarga pendiente NO recibe un remito nuevo; sin viaje abierto sí', async () => {
    await seedMuelle()
    // camionesEnViaje/{camionId} lo escribe el trigger cuando el camión sale y
    // lo borra cuando se cuenta la descarga.
    await seed((d) => setDoc(doc(d, 'camionesEnViaje/cam1'), {
      camionId: 'cam1', remitoId: 'r0', choferId: 'chof1', plantaId: 'torcuato', desde: new Date(),
    }))
    await assertFails(setDoc(doc(db('mue1'), 'remitosCarga/r1'), remito()))
    // Otro camión, libre: entra.
    await assertSucceeds(setDoc(doc(db('mue1'), 'remitosCarga/r2'), remito({ camionId: 'cam2' })))
    // Y el mismo camión, una vez contada la descarga (el trigger borró la marca).
    await seed((d) => deleteDoc(doc(d, 'camionesEnViaje/cam1')))
    await assertSucceeds(setDoc(doc(db('mue1'), 'remitosCarga/r3'), remito()))
  })

  // ── COT de ARBA (2026-09-10) ──
  test('el remito nace con kilos y solicitud de COT, pero nunca con el resultado `cot` (lo escribe el server)', async () => {
    await seedMuelle()
    const solicitud = { destino: { tipo: 'planta', plantaId: 'merlo' }, respaldo: { codigoComprobante: '091', prefijo: 25, numero: 58680, importe: 0 }, patente: 'AG028YN', recorrido: { tipo: 'M', localidad: 'MERLO', ruta: 'RUTA 205' }, fechaSalida: '2026-09-10', horaSalida: '07:30' }
    await assertSucceeds(setDoc(doc(db('mue1'), 'remitosCarga/r1'), remito({ kg: 9060, cotSolicitud: solicitud })))
    await assertFails(setDoc(doc(db('mue1'), 'remitosCarga/r2'), remito({ kg: 'mucho' })))
    await assertFails(setDoc(doc(db('mue1'), 'remitosCarga/r3'), remito({ cotSolicitud: { patente: 'AG028YN' } })))
    await assertFails(setDoc(doc(db('mue1'), 'remitosCarga/r4'), remito({ cot: { estado: 'presentado', numero: '3163824478' } })))
  })

  test('remito R oficial de la carga: nace con puntoVenta/numero/cai y MUELLE avanza el contador global solo hacia adelante', async () => {
    await seedMuelle()
    await seedCaja()
    await assertSucceeds(setDoc(doc(db('mue1'), 'remitosCarga/r1'), remito({ remitoR: { puntoVenta: 25, numero: 67891, cai: '12345678901234', vencimiento: '2026-12-31' } })))
    await assertFails(setDoc(doc(db('mue1'), 'remitosCarga/r2'), remito({ remitoR: { puntoVenta: 25, numero: 0, cai: '12345678901234', vencimiento: '2026-12-31' } })))
    await seed((d) => setDoc(doc(d, 'config/remitoCargaCounter'), { next: 67891 }))
    await assertSucceeds(updateDoc(doc(db('mue1'), 'config/remitoCargaCounter'), { next: 67892 }))
    await assertFails(updateDoc(doc(db('mue1'), 'config/remitoCargaCounter'), { next: 67891 }))
    await assertFails(updateDoc(doc(db('mue1'), 'config/remitoCargaCounter'), { next: 67893, cai: 'x' }))
    // Caja ya no consume el talonario: lo consume quien emite.
    await assertFails(updateDoc(doc(db('caja1'), 'config/remitoCargaCounter'), { next: 67899 }))
  })

  // ── envases retornables (2026-09-07) ──
  test('el remito NO nace sin envases: los cuenta muelle al entregar el camión', async () => {
    await seedMuelle()
    const { envases: _e, ...sinEnvases } = remito()
    await assertFails(setDoc(doc(db('mue1'), 'remitosCarga/r1'), sinEnvases))
    await assertFails(setDoc(doc(db('mue1'), 'remitosCarga/r2'), { ...sinEnvases, palletsCarga: 'dos' }))
  })

  test('no se emite si palletsCarga no cierra con madera + metal', async () => {
    await seedMuelle()
    await assertFails(setDoc(doc(db('mue1'), 'remitosCarga/r1'), remito({ palletsCarga: 3 })))
  })

  test('no se emite con envases inválidos (negativo, racks repetidos, campo extra, racks no lista)', async () => {
    await seedMuelle()
    await assertFails(setDoc(doc(db('mue1'), 'remitosCarga/r1'), remito({ palletsCarga: 0, envases: { tarimasMadera: -1, palletsMetal: 1, racks: [] } })))
    await assertFails(setDoc(doc(db('mue1'), 'remitosCarga/r2'), remito({ envases: { tarimasMadera: 1, palletsMetal: 1, racks: [12, 12] } })))
    await assertFails(setDoc(doc(db('mue1'), 'remitosCarga/r3'), remito({ envases: { tarimasMadera: 1, palletsMetal: 1, racks: [], puntales: 8 } })))
    await assertFails(setDoc(doc(db('mue1'), 'remitosCarga/r4'), remito({ envases: { tarimasMadera: 1, palletsMetal: 1, racks: '12' } })))
    // Pallets simples (2026-09-21): parte del total, nunca más que el total.
    await assertSucceeds(setDoc(doc(db('mue1'), 'remitosCarga/r5'), remito({ palletsCarga: 3, envases: { tarimasMadera: 2, palletsMetal: 1, tarimasMaderaSimples: 1, palletsMetalSimples: 1, racks: [] } })))
    await assertFails(setDoc(doc(db('mue1'), 'remitosCarga/r6'), remito({ palletsCarga: 3, envases: { tarimasMadera: 2, palletsMetal: 1, tarimasMaderaSimples: 3, racks: [] } })))
    await assertFails(setDoc(doc(db('mue1'), 'remitosCarga/r7'), remito({ palletsCarga: 3, envases: { tarimasMadera: 2, palletsMetal: 1, palletsMetalSimples: -1, racks: [] } })))
  })

  test('super_admin (sin planta) puede emitir un remito y avanzar el contador de cualquier planta', async () => {
    await seed((d) => setDoc(doc(d, 'users/adm'), { rol: 'super_admin', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('adm'), 'config/cargaCounter_torcuato'), { next: 2 }))
    const deAdm = { emitidoPor: { uid: 'adm', nombre: 'Ariel' } }
    await assertSucceeds(setDoc(doc(db('adm'), 'remitosCarga/r1'), remito(deAdm)))
    await assertSucceeds(setDoc(doc(db('adm'), 'remitosCarga/r2'), remito({ plantaId: 'merlo', camionId: 'cam2', ...deAdm })))
  })

  test('muelle NO puede tocar el contador de OTRA planta', async () => {
    await seedMuelle()
    await assertSucceeds(setDoc(doc(db('mue1'), 'config/cargaCounter_torcuato'), { next: 2 }))
    await assertFails(setDoc(doc(db('mue1'), 'config/cargaCounter_merlo'), { next: 2 }))
  })

  test('muelle NO puede emitir un remito de OTRA planta', async () => {
    await seedMuelle()
    await assertFails(setDoc(doc(db('mue1'), 'remitosCarga/r1'), remito({ plantaId: 'merlo' })))
  })

  test('no se emite sin items', async () => {
    await seedMuelle()
    await assertFails(setDoc(doc(db('mue1'), 'remitosCarga/r1'), remito({ items: [] })))
  })

  test('un remito es inmutable tras emitirse (también para muelle y para caja)', async () => {
    await seedMuelle()
    await seedCaja()
    await seed((d) => setDoc(doc(d, 'remitosCarga/r1'), remito()))
    await assertFails(updateDoc(doc(db('mue1'), 'remitosCarga/r1'), { items: [] }))
    await assertFails(updateDoc(doc(db('caja1'), 'remitosCarga/r1'), { estado: 'salido' }))
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

  test('caja puede leer el doc de un chofer (para elegirlo en el borrador)', async () => {
    await seedCaja()
    await seed((d) => setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' }))
    await assertSucceeds(getDoc(doc(db('caja1'), 'users/chof1')))
  })
})

// ── borradoresCarga: la hoja de trabajo que caja arma y muelle acepta ─────────
describe('borradoresCarga (viaje en dos partes, 2026-09-18)', () => {
  const borrador = (extra = {}) => ({
    plantaId: 'torcuato', paraFecha: '2026-09-19',
    camionId: 'cam1', camionLabel: 'AB123CD · Iveco', choferId: 'chof1', choferNombre: 'Chofer Uno',
    depositoTango: '21',
    items: [{ productoId: 'bolsa_10kg', nombre: 'Hielo 10kg', cantidad: 100, pallets: 2 }],
    kg: 9060,
    cotDestino: {
      destino: { tipo: 'planta', plantaId: 'merlo' },
      respaldo: { codigoComprobante: '091', prefijo: 25, importe: 0 },
      patente: 'AG028YN',
      recorrido: { tipo: 'M', localidad: 'MERLO', ruta: 'RUTA 205' },
    },
    estado: 'pendiente', creadoPor: { uid: 'caja1', nombre: 'Caja Uno' },
    fecha: new Date(), venceEn: new Date('2026-09-20T23:59:59-03:00'),
    ...extra,
  })
  const seedTodos = () => seed(async (d) => {
    await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/cajam'), { rol: 'caja', estado: 'activo', planta: 'merlo' })
    await setDoc(doc(d, 'users/mue1'),  { rol: 'muelle', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/mue2'),  { rol: 'muelle', estado: 'activo', planta: 'merlo' })
    await setDoc(doc(d, 'users/seg1'),  { rol: 'seguridad', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/log'),   { rol: 'logistica', estado: 'activo' })
    await setDoc(doc(d, 'users/gg'),    { rol: 'gerente_general', estado: 'activo' })
    await setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' })
    await setDoc(doc(d, 'users/cli'),   cliente())
  })

  test('caja de la planta arma el borrador, pendiente, a su nombre y sin remito', async () => {
    await seedTodos()
    await assertSucceeds(setDoc(doc(db('caja1'), 'borradoresCarga/b1'), borrador()))
  })

  test('el borrador mal formado no entra', async () => {
    await seedTodos()
    await assertFails(setDoc(doc(db('caja1'), 'borradoresCarga/b1'), borrador({ items: [] })))
    await assertFails(setDoc(doc(db('caja1'), 'borradoresCarga/b1'), borrador({ paraFecha: 20260919 })))
    // Los envases NO van en el borrador: los cuenta muelle al entregar el camión.
    await assertFails(setDoc(doc(db('caja1'), 'borradoresCarga/b1'), borrador({ envases: { tarimasMadera: 1, palletsMetal: 1, racks: [12, 15] } })))
    // El destino del COT se pide SIEMPRE, aunque la carga no llegue al umbral.
    const { cotDestino: _c, ...sinCot } = borrador()
    await assertFails(setDoc(doc(db('caja1'), 'borradoresCarga/b1'), sinCot))
    await assertFails(setDoc(doc(db('caja1'), 'borradoresCarga/b1'), borrador({ cotDestino: { destino: {}, respaldo: {}, recorrido: {} } })))
    // Nace pendiente, sin remito, a su nombre, y con vencimiento.
    await assertFails(setDoc(doc(db('caja1'), 'borradoresCarga/b1'), borrador({ estado: 'aceptado' })))
    await assertFails(setDoc(doc(db('caja1'), 'borradoresCarga/b1'), borrador({ remitoId: 'r1' })))
    await assertFails(setDoc(doc(db('caja1'), 'borradoresCarga/b1'), borrador({ creadoPor: { uid: 'otro', nombre: 'Otro' } })))
    await assertFails(setDoc(doc(db('caja1'), 'borradoresCarga/b1'), borrador({ venceEn: '2026-09-20' })))
  })

  test('nadie más lo arma: ni muelle, ni caja de otra planta, ni el chofer', async () => {
    await seedTodos()
    await assertFails(setDoc(doc(db('mue1'), 'borradoresCarga/b1'), borrador({ creadoPor: { uid: 'mue1', nombre: 'M' } })))
    await assertFails(setDoc(doc(db('cajam'), 'borradoresCarga/b1'), borrador({ creadoPor: { uid: 'cajam', nombre: 'CM' } })))
    await assertFails(setDoc(doc(db('chof1'), 'borradoresCarga/b1'), borrador({ creadoPor: { uid: 'chof1', nombre: 'C' } })))
  })

  test('caja corrige su borrador mientras esté pendiente, y lo borra si el camión no salió', async () => {
    await seedTodos()
    await seed((d) => setDoc(doc(d, 'borradoresCarga/b1'), borrador()))
    await assertSucceeds(setDoc(doc(db('caja1'), 'borradoresCarga/b1'), borrador({ camionId: 'cam9' })))
    await assertSucceeds(deleteDoc(doc(db('caja1'), 'borradoresCarga/b1')))
  })

  test('un borrador ya aceptado no se corrige ni se borra: es la traza del remito que nació de él', async () => {
    await seedTodos()
    await seed((d) => setDoc(doc(d, 'borradoresCarga/b1'), borrador({ estado: 'aceptado', remitoId: 'r1' })))
    await assertFails(setDoc(doc(db('caja1'), 'borradoresCarga/b1'), borrador({ camionId: 'cam9' })))
    await assertFails(deleteDoc(doc(db('caja1'), 'borradoresCarga/b1')))
    await assertFails(deleteDoc(doc(db('mue1'), 'borradoresCarga/b1')))
  })

  test('muelle lo acepta: solo estado + remitoId, solo pendiente → aceptado', async () => {
    await seedTodos()
    await seed(async (d) => {
      await setDoc(doc(d, 'borradoresCarga/b1'), borrador())
      await setDoc(doc(d, 'borradoresCarga/b2'), borrador())
      await setDoc(doc(d, 'borradoresCarga/b3'), borrador())
      await setDoc(doc(d, 'borradoresCarga/ya'), borrador({ estado: 'aceptado', remitoId: 'r0' }))
    })
    // Sin remito, con un campo de más, o desde un borrador ya aceptado: no.
    await assertFails(updateDoc(doc(db('mue1'), 'borradoresCarga/b1'), { estado: 'aceptado' }))
    await assertFails(updateDoc(doc(db('mue1'), 'borradoresCarga/b2'), { estado: 'aceptado', remitoId: 'r1', items: [] }))
    await assertFails(updateDoc(doc(db('mue1'), 'borradoresCarga/ya'), { estado: 'aceptado', remitoId: 'r2' }))
    // Muelle de la otra planta tampoco.
    await assertFails(updateDoc(doc(db('mue2'), 'borradoresCarga/b3'), { estado: 'aceptado', remitoId: 'r3' }))
    // POSITIVO.
    await assertSucceeds(updateDoc(doc(db('mue1'), 'borradoresCarga/b1'), { estado: 'aceptado', remitoId: 'r1' }))
  })

  test('caja no se auto-acepta el borrador (aceptar es entregar el camión, y eso lo hace muelle)', async () => {
    await seedTodos()
    await seed((d) => setDoc(doc(d, 'borradoresCarga/b1'), borrador()))
    await assertFails(updateDoc(doc(db('caja1'), 'borradoresCarga/b1'), { estado: 'aceptado', remitoId: 'r1' }))
  })

  test('lo leen caja, muelle, seguridad y gerencia; no el chofer ni el cliente', async () => {
    await seedTodos()
    await seed((d) => setDoc(doc(d, 'borradoresCarga/b1'), borrador()))
    for (const u of ['caja1', 'mue1', 'seg1', 'log', 'gg']) await assertSucceeds(getDoc(doc(db(u), 'borradoresCarga/b1')))
    await assertFails(getDoc(doc(db('chof1'), 'borradoresCarga/b1')))
    await assertFails(getDoc(doc(db('cli', 'c@x.com'), 'borradoresCarga/b1')))
  })
})

// ── cierresMercaderia: la mitad de MERCADERÍA del viaje (la escribe el server) ──
describe('cierresMercaderia (viaje en dos partes, 2026-09-18)', () => {
  const cierre = (extra = {}) => ({
    remitoId: 'r1', remitoCodigo: 'RC-DT-000001', plantaId: 'torcuato',
    choferId: 'chof1', choferNombre: 'Chofer Uno', diaReparto: '2026-09-18',
    productos: [], envases: { salieron: {}, volvieron: {}, diferencia: {}, racksFaltantes: [] },
    faltante: { bolsasFaltantes: 0, bolsasSobrantes: 0, productos: [], grave: false, umbral: 10 },
    descargaIds: ['d1'], descargaCodigos: ['DC-DT-000001'],
    contadaPor: { uid: 'mue1', nombre: 'Muelle' }, contadaEn: new Date(), ...extra,
  })
  const seedTodos = () => seed(async (d) => {
    await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/mue1'),  { rol: 'muelle', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/tes1'),  { rol: 'tesoreria', estado: 'activo' })
    await setDoc(doc(d, 'users/sup1'),  { rol: 'supervisor', estado: 'activo' })
    await setDoc(doc(d, 'users/gg'),    { rol: 'gerente_general', estado: 'activo' })
    await setDoc(doc(d, 'users/log'),   { rol: 'logistica', estado: 'activo' })
    await setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' })
    await setDoc(doc(d, 'users/chof2'), { rol: 'chofer', estado: 'activo' })
    await setDoc(doc(d, 'users/cli'),   cliente())
    await setDoc(doc(d, 'cierresMercaderia/r1'), cierre())
  })

  // El conteo del muelle es 100 % ciego: este doc tiene el teórico, así que
  // mostrárselo destruiría el control (igual que no puede leer ventasCamion).
  test('MUELLE no puede leer el cierre de mercadería: el conteo es ciego', async () => {
    await seedTodos()
    await assertFails(getDoc(doc(db('mue1'), 'cierresMercaderia/r1')))
  })

  test('lo leen caja, tesorería, supervisor y gerencia; el chofer solo el suyo; el cliente no', async () => {
    await seedTodos()
    for (const u of ['caja1', 'tes1', 'sup1', 'gg', 'log']) await assertSucceeds(getDoc(doc(db(u), 'cierresMercaderia/r1')))
    await assertSucceeds(getDoc(doc(db('chof1'), 'cierresMercaderia/r1')))
    await assertFails(getDoc(doc(db('chof2'), 'cierresMercaderia/r1')))
    await assertFails(getDoc(doc(db('cli', 'c@x.com'), 'cierresMercaderia/r1')))
  })

  test('nadie lo escribe desde un cliente: lo escribe SOLO el servidor', async () => {
    await seedTodos()
    for (const u of ['caja1', 'mue1', 'tes1', 'log', 'chof1']) {
      await assertFails(setDoc(doc(db(u), 'cierresMercaderia/r2'), cierre({ remitoId: 'r2' })))
      await assertFails(updateDoc(doc(db(u), 'cierresMercaderia/r1'), { descargaIds: [] }))
      await assertFails(deleteDoc(doc(db(u), 'cierresMercaderia/r1')))
    }
  })
})

// ── camionesEnViaje: la marca que impide cargar dos veces el mismo camión ─────
describe('camionesEnViaje (2026-09-18)', () => {
  const marca = { camionId: 'cam1', remitoId: 'r1', choferId: 'chof1', plantaId: 'torcuato', desde: new Date() }
  const seedTodos = () => seed(async (d) => {
    await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/mue1'),  { rol: 'muelle', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/seg1'),  { rol: 'seguridad', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/gg'),    { rol: 'gerente_general', estado: 'activo' })
    await setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' })
    await setDoc(doc(d, 'users/cli'),   cliente())
    await setDoc(doc(d, 'camionesEnViaje/cam1'), marca)
  })

  test('la leen caja, muelle, seguridad y gerencia; no el chofer ni el cliente', async () => {
    await seedTodos()
    for (const u of ['caja1', 'mue1', 'seg1', 'gg']) await assertSucceeds(getDoc(doc(db(u), 'camionesEnViaje/cam1')))
    await assertFails(getDoc(doc(db('chof1'), 'camionesEnViaje/cam1')))
    await assertFails(getDoc(doc(db('cli', 'c@x.com'), 'camionesEnViaje/cam1')))
  })

  test('nadie la escribe ni la borra desde un cliente: son los triggers', async () => {
    await seedTodos()
    for (const u of ['caja1', 'mue1', 'seg1', 'chof1']) {
      await assertFails(setDoc(doc(db(u), 'camionesEnViaje/cam2'), { ...marca, camionId: 'cam2' }))
      await assertFails(deleteDoc(doc(db(u), 'camionesEnViaje/cam1')))
    }
  })
})

// ── config/cargaCounter_*: correlativo de remitos de carga por planta ─────────
// Desde el 2026-09-18 lo mueve MUELLE, que es quien emite el remito.
describe('config/cargaCounter_*', () => {
  const seedMuelle = (uid = 'mue1', planta = 'torcuato') =>
    seed((d) => setDoc(doc(d, 'users/' + uid), { rol: 'muelle', estado: 'activo', planta }))

  test('muelle crea el contador de SU planta en el primer uso (next 2 = emitió el 1)', async () => {
    await seedMuelle()
    await assertSucceeds(setDoc(doc(db('mue1'), 'config/cargaCounter_torcuato'), { next: 2 }))
  })

  test('muelle NO puede crear el contador de otra planta', async () => {
    await seedMuelle()
    await assertFails(setDoc(doc(db('mue1'), 'config/cargaCounter_merlo'), { next: 2 }))
  })

  test('muelle avanza el contador de su planta, nunca lo retrocede', async () => {
    await seedMuelle()
    await seed((d) => setDoc(doc(d, 'config/cargaCounter_torcuato'), { next: 10 }))
    await assertSucceeds(setDoc(doc(db('mue1'), 'config/cargaCounter_torcuato'), { next: 11 }))
    await assertFails(setDoc(doc(db('mue1'), 'config/cargaCounter_torcuato'), { next: 9 }))
  })

  test('caja y chofer YA NO tocan el contador de carga', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
      await setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' })
    })
    await assertFails(setDoc(doc(db('caja1'), 'config/cargaCounter_torcuato'), { next: 2 }))
    await assertFails(setDoc(doc(db('chof1'), 'config/cargaCounter_torcuato'), { next: 2 }))
  })
})

// ── config/descargaCounter_*: correlativo de descargas, lo numera el servidor ─
describe('config/descargaCounter_* (2026-09-18)', () => {
  test('ningún cliente lo toca: el número de la descarga lo pone el Admin SDK', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/mue1'),  { rol: 'muelle', estado: 'activo', planta: 'torcuato' })
      await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
      await setDoc(doc(d, 'users/tes1'),  { rol: 'tesoreria', estado: 'activo' })
      await setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' })
      await setDoc(doc(d, 'config/descargaCounter_torcuato'), { next: 10 })
    })
    for (const u of ['mue1', 'caja1', 'tes1', 'chof1']) {
      await assertFails(setDoc(doc(db(u), 'config/descargaCounter_merlo'), { next: 2 }))
      await assertFails(updateDoc(doc(db(u), 'config/descargaCounter_torcuato'), { next: 11 }))
    }
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
    palletsCarga: 2, envases: { tarimasMadera: 1, palletsMetal: 1, racks: [12, 15] },
    estado: 'emitido', creadoPor: { uid: 'caja1', nombre: 'Caja' },
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
    bolsasRotas: [], envases: { tarimasMadera: 1, palletsMetal: 0, puntales: 4, aros: 1, racks: [12] },
    registradoPor: { uid: 'mue1', nombre: 'Muelle' }, fecha: new Date(), ...extra,
  })
  const conteo = (tarimasMadera, palletsMetal, puntales, aros) => ({ tarimasMadera, palletsMetal, puntales, aros })
  const liquidacion = (extra = {}) => ({
    fecha: '2026-08-29', plantaId: 'torcuato', choferId: 'chof1', choferNombre: 'Chofer Uno',
    productos: [],
    envases: { salieron: { ...conteo(1, 1, 8, 2), racks: [12, 15] }, volvieron: { ...conteo(1, 0, 4, 1), racks: [12] }, diferencia: conteo(0, -1, -4, -1), racksFaltantes: [15], racksSobrantes: [] },
    cambios: { registrados: 2, rotasRecibidas: 2 },
    importes: { contadoEfectivo: 1000, contadoTransferencia: 0, cuentaCorriente: 0, total: 1000 },
    efectivoARendir: 1000, efectivoRecibido: 1000, diferenciaEfectivo: 0,
    // Desde 2026-09-09: número por persona, dos firmas, valores tildados, sin entrega.
    numero: 1, codigo: 'LQ-21-000001',
    firmaRepartidor: 'data:image/png;base64,AAAA', firmanteRepartidor: 'Chofer Uno',
    firmaRecibe: 'data:image/png;base64,BBBB', firmanteRecibe: 'Caja',
    cheques: [], retenciones: [], valoresFaltantes: { cantidad: 0, total: 0 }, entregaId: null,
    // Rendición por sobres, etapa 1 (2026-09-16): conteo de billetes por empresa, suma = efectivoRecibido.
    conteoBilletes: { redonhielo: desglose({ '1000': 1 }), rolito: desglose({}, true) },
    cerradaPor: { uid: 'caja1', nombre: 'Caja' }, createdAt: new Date(), ...extra,
  })
  function desglose(billetes = {}, sinEfectivo = false) {
    const b = { '20000': 0, '10000': 0, '2000': 0, '1000': 0, '500': 0, ...billetes }
    const total = sinEfectivo ? 0 : b['20000'] * 20000 + b['10000'] * 10000 + b['2000'] * 2000 + b['1000'] * 1000 + b['500'] * 500
    return { billetes: b, cambioChico: 0, sinEfectivo, total }
  }

  // ── conteo de billetes por empresa (rendición por sobres, etapa 1, 2026-09-16) ──
  test('el cierre exige el conteo de billetes de las dos empresas y que sume lo recibido', async () => {
    await seedCaja()
    const ref = doc(db('caja1'), 'liquidaciones/2026-08-29_chof1')
    const { conteoBilletes: _c, ...sinConteo } = liquidacion()
    await assertFails(setDoc(ref, sinConteo))
    // Falta una empresa.
    await assertFails(setDoc(ref, liquidacion({ conteoBilletes: { redonhielo: desglose({ '1000': 1 }) } })))
    // El total no cierra con los billetes.
    await assertFails(setDoc(ref, liquidacion({ conteoBilletes: { redonhielo: { ...desglose({ '1000': 1 }), total: 900 }, rolito: desglose({}, true) } })))
    // La suma de los dos conteos no es lo recibido.
    await assertFails(setDoc(ref, liquidacion({ efectivoRecibido: 1500, diferenciaEfectivo: 500 })))
    // Cantidad negativa o con decimales.
    await assertFails(setDoc(ref, liquidacion({ conteoBilletes: { redonhielo: { ...desglose({ '1000': 1 }), billetes: { ...desglose().billetes, '500': -1 } }, rolito: desglose({}, true) } })))
    await assertFails(setDoc(ref, liquidacion({ conteoBilletes: { redonhielo: { ...desglose({ '1000': 1 }), billetes: { ...desglose().billetes, '1000': 1.5 } }, rolito: desglose({}, true) } })))
    // "Sin efectivo" con total distinto de cero.
    await assertFails(setDoc(ref, liquidacion({ conteoBilletes: { redonhielo: desglose({ '1000': 1 }), rolito: { ...desglose({}, true), total: 5 } } })))
    // Bien: dos empresas con plata y cambio chico.
    const rh = { ...desglose({ '500': 1 }), cambioChico: 200, total: 700 }
    const ro = desglose({ '500': 0 }); ro.cambioChico = 300; ro.total = 300
    await assertSucceeds(setDoc(ref, liquidacion({ conteoBilletes: { redonhielo: rh, rolito: ro }, efectivoRecibido: 1000, diferenciaEfectivo: 0 })))
  })

  // ── liquidación numerada por persona, doble firma, valores y entrega (2026-09-09) ──
  test('el cierre exige número, las dos firmas, las listas de valores y nacer sin entrega', async () => {
    await seedCaja()
    const { numero: _n, ...sinNumero } = liquidacion()
    await assertFails(setDoc(doc(db('caja1'), 'liquidaciones/2026-08-29_chof1'), sinNumero))
    await assertFails(setDoc(doc(db('caja1'), 'liquidaciones/2026-08-29_chof1'), liquidacion({ firmaRecibe: '' })))
    await assertFails(setDoc(doc(db('caja1'), 'liquidaciones/2026-08-29_chof1'), liquidacion({ firmaRepartidor: '' })))
    await assertFails(setDoc(doc(db('caja1'), 'liquidaciones/2026-08-29_chof1'), liquidacion({ cheques: 'no' })))
    await assertFails(setDoc(doc(db('caja1'), 'liquidaciones/2026-08-29_chof1'), liquidacion({ entregaId: 'ET-1' })))
    await assertSucceeds(setDoc(doc(db('caja1'), 'liquidaciones/2026-08-29_chof1'), liquidacion({ cheques: [{ numero: '1', bancoNombre: 'G', importe: 100, cobranzaId: 'c1', clienteNombre: 'K', recibido: false, motivoNoEntregado: 'lo trae mañana' }], valoresFaltantes: { cantidad: 1, total: 100 } })))
  })

  test('contador de liquidaciones por persona: cualquier caja lo avanza; solo hacia adelante; nadie más', async () => {
    await seedCaja()
    await seedCaja('cajam', 'merlo')
    await seedMuelle()
    await seedChofer()
    await seed((d) => setDoc(doc(d, 'users/tes1'), { rol: 'tesoreria', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('caja1'), 'config/liquidacionCounter_dep21'), { next: 2 }))
    await assertSucceeds(updateDoc(doc(db('cajam'), 'config/liquidacionCounter_dep21'), { next: 3 }))
    await assertFails(updateDoc(doc(db('cajam'), 'config/liquidacionCounter_dep21'), { next: 2 }))
    await assertFails(updateDoc(doc(db('caja1'), 'config/liquidacionCounter_dep21'), { next: 4, otro: 1 }))
    await assertFails(setDoc(doc(db('mue1'), 'config/liquidacionCounter_dep22'), { next: 2 }))
    await assertFails(setDoc(doc(db('chof1'), 'config/liquidacionCounter_dep22'), { next: 2 }))
    await assertFails(setDoc(doc(db('tes1'), 'config/liquidacionCounter_dep22'), { next: 2 }))
    await assertSucceeds(setDoc(doc(db('caja1'), 'config/liquidacionCounter_dep-33'), { next: 2 }))
  })

  test('el chofer se suscribe a su liquidación del día aunque no exista todavía, y no a la de otro', async () => {
    await seedChofer()
    await assertSucceeds(getDoc(doc(db('chof1'), 'liquidaciones/2026-08-29_chof1')))
    await assertFails(getDoc(doc(db('chof1'), 'liquidaciones/2026-08-29_otro')))
  })

  test('la entrega a tesorería la marca caja de la planta una vez (null → id); otra planta, tesorería y segundo intento fallan', async () => {
    await seedCaja()
    await seedCaja('cajam', 'merlo')
    await seed(async (d) => {
      await setDoc(doc(d, 'users/tes1'), { rol: 'tesoreria', estado: 'activo' })
      await setDoc(doc(d, 'liquidaciones/2026-08-29_chof1'), liquidacion())
    })
    await assertFails(updateDoc(doc(db('cajam'), 'liquidaciones/2026-08-29_chof1'), { entregaId: 'ET-1' }))
    await assertFails(updateDoc(doc(db('tes1'), 'liquidaciones/2026-08-29_chof1'), { entregaId: 'ET-1' }))
    await assertFails(updateDoc(doc(db('caja1'), 'liquidaciones/2026-08-29_chof1'), { entregaId: 'ET-1', efectivoRecibido: 5 }))
    await assertSucceeds(updateDoc(doc(db('caja1'), 'liquidaciones/2026-08-29_chof1'), { entregaId: 'ET-1' }))
    await assertFails(updateDoc(doc(db('caja1'), 'liquidaciones/2026-08-29_chof1'), { entregaId: 'ET-2' }))
  })

  // ── remito: la entrega ya no es una transición (2026-09-18) ──
  // Emitir el remito y entregar el camión son el mismo acto desde que muelle
  // acepta el borrador, así que la rama emitido → entregado desapareció: un
  // remito no se toca después de nacer. Ver el describe de remitosCarga.
  test('muelle marca la entrega cuando la mercadería está arriba; puede corregir envases y nadie más lo hace', async () => {
    await seedMuelle()
    await seedCaja()
    await seed((d) => setDoc(doc(d, 'remitosCarga/r1'), remito()))
    const entrega = { estado: 'entregado', entregadoPor: { uid: 'mue1', nombre: 'Muelle', hora: new Date() } }
    // Caja no entrega, y nadie firma la entrega a nombre de otro.
    await assertFails(updateDoc(doc(db('caja1'), 'remitosCarga/r1'), entrega))
    await assertFails(updateDoc(doc(db('mue1'), 'remitosCarga/r1'), { ...entrega, entregadoPor: { uid: 'otro', nombre: 'Otro', hora: new Date() } }))
    // Los items del remito no se tocan al entregar.
    await assertFails(updateDoc(doc(db('mue1'), 'remitosCarga/r1'), { ...entrega, items: [] }))
    // Los envases sí, si terminó usando otros pallets; tienen que cerrar con palletsCarga.
    await assertFails(updateDoc(doc(db('mue1'), 'remitosCarga/r1'), { ...entrega, envases: { tarimasMadera: 0, palletsMetal: 3, racks: [12] } }))
    await assertSucceeds(updateDoc(doc(db('mue1'), 'remitosCarga/r1'), { ...entrega, envases: { tarimasMadera: 0, palletsMetal: 3, racks: [12] }, palletsCarga: 3 }))
    // Y una vez entregado no se vuelve a entregar.
    await assertFails(updateDoc(doc(db('mue1'), 'remitosCarga/r1'), entrega))
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
  // Auditoría 2026-09-22: número, código y faltante son del server; el viaje
  // al que se imputa el conteo tiene que ser del mismo repartidor.
  test('la descarga NO nace numerada, con revisión, con Tango confirmado ni imputada al viaje de otro', async () => {
    await seedMuelle()
    await assertFails(setDoc(doc(db('mue1'), 'descargasCamion/d1'), descarga({ numero: 12, codigo: 'DC-DT-000012' })))
    await assertFails(setDoc(doc(db('mue1'), 'descargasCamion/d1'), descarga({ revision: { requiere: false, bolsasFaltantes: 0 } })))
    await assertFails(setDoc(doc(db('mue1'), 'descargasCamion/d1'), descarga({ tango: { estado: 'confirmado' } })))
    await seed(async (d) => {
      await setDoc(doc(d, 'remitosCarga/rAjeno'), remito({ choferId: 'chof2' }))
      await setDoc(doc(d, 'remitosCarga/rPropio'), remito({ choferId: 'chof1' }))
    })
    await assertFails(setDoc(doc(db('mue1'), 'descargasCamion/d1'), descarga({ remitoId: 'rAjeno', remitoCodigo: 'RC-DT-000001' })))
    await assertFails(setDoc(doc(db('mue1'), 'descargasCamion/d1'), descarga({ remitoId: 'noExiste' })))
    await assertSucceeds(setDoc(doc(db('mue1'), 'descargasCamion/d2'), descarga({ remitoId: 'rPropio', remitoCodigo: 'RC-DT-000002', tango: { estado: 'pendiente' } })))
  })

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
    await assertFails(updateDoc(doc(db('mue1'), 'descargasCamion/d1'), { 'envases.aros': 5 }))
  })

  test('muelle todavía puede registrar la descarga con el formato viejo de pallets (PWA anterior)', async () => {
    await seedMuelle()
    const { envases: _e, ...vieja } = descarga()
    await assertSucceeds(setDoc(doc(db('mue1'), 'descargasCamion/d1'), { ...vieja, palletsCompletos: 0, palletsParciales: 1, palletsVacios: 0 }))
  })

  test('muelle NO registra una descarga con envases inválidos, sin ningún formato, o mezclando los dos', async () => {
    await seedMuelle()
    await assertFails(setDoc(doc(db('mue1'), 'descargasCamion/d1'), descarga({ envases: { tarimasMadera: 1, palletsMetal: 0, puntales: -1, aros: 1, racks: [] } })))
    await assertFails(setDoc(doc(db('mue1'), 'descargasCamion/d2'), descarga({ envases: { tarimasMadera: 1, palletsMetal: 0, puntales: 4, aros: 1, racks: [3, 3] } })))
    await assertFails(setDoc(doc(db('mue1'), 'descargasCamion/d3'), descarga({ envases: { tarimasMadera: 1, palletsMetal: 0, puntales: 4, aros: 1, racks: [], extra: 1 } })))
    // Sombreros (2026-09-12): opcional, entero >= 0.
    await assertSucceeds(setDoc(doc(db('mue1'), 'descargasCamion/d6'), descarga({ envases: { tarimasMadera: 1, palletsMetal: 0, puntales: 4, aros: 1, sombreros: 1, racks: [] } })))
    await assertFails(setDoc(doc(db('mue1'), 'descargasCamion/d7'), descarga({ envases: { tarimasMadera: 1, palletsMetal: 0, puntales: 4, aros: 1, sombreros: -1, racks: [] } })))
    const { envases: _e, ...sinNada } = descarga()
    await assertFails(setDoc(doc(db('mue1'), 'descargasCamion/d4'), sinNada))
    await assertFails(setDoc(doc(db('mue1'), 'descargasCamion/d5'), descarga({ envases: { tarimasMadera: 'uno', palletsMetal: 0, puntales: 4, aros: 1, racks: [] }, palletsCompletos: 0, palletsParciales: 1, palletsVacios: 0 })))
  })

  // ── desvío de mercadería observado al cerrar (2026-09-13, control de fugas) ──
  test('el cierre con desvío exige motivo y el nombre de quien lo observa', async () => {
    await seedCaja()
    const desvio = (extra = {}) => ({
      bolsasFaltantes: 42, umbral: 10,
      productos: [{ productoId: 'bolsa_10kg', nombre: 'Hielo 10kg', faltan: 42 }],
      motivo: 'a_investigar', nota: 'lo ve gerencia mañana',
      observadoPor: { uid: 'caja1', nombre: 'Caja' }, ...extra,
    })
    // POSITIVO: caja cierra igual con el desvío escrito a su nombre (un tema de
    // stock no traba el turno de caja).
    await assertSucceeds(setDoc(doc(db('caja1'), 'liquidaciones/2026-08-29_chof1'), liquidacion({ desvio: desvio() })))
    // NEGATIVOS: sin motivo, con motivo vacío, sin el faltante, o a nombre de otro.
    await assertFails(setDoc(doc(db('caja1'), 'liquidaciones/2026-09-01_chof1'), liquidacion({ fecha: '2026-09-01', desvio: desvio({ motivo: '' }) })))
    await assertFails(setDoc(doc(db('caja1'), 'liquidaciones/2026-09-02_chof1'), liquidacion({ fecha: '2026-09-02', desvio: desvio({ bolsasFaltantes: 'muchas' }) })))
    await assertFails(setDoc(doc(db('caja1'), 'liquidaciones/2026-09-03_chof1'), liquidacion({ fecha: '2026-09-03', desvio: desvio({ observadoPor: { uid: 'caja2', nombre: 'Otro' } }) })))
    await assertFails(setDoc(doc(db('caja1'), 'liquidaciones/2026-09-04_chof1'), liquidacion({ fecha: '2026-09-04', desvio: 'falta mucho' })))
    // Y el cierre sin desvío sigue entrando igual (la descarga cuadró).
    await assertSucceeds(setDoc(doc(db('caja1'), 'liquidaciones/2026-09-05_chof1'), liquidacion({ fecha: '2026-09-05' })))
  })

  // ── rectificar un conteo mal cargado (2026-09-13) ──
  test('muelle corrige un conteo creando otra descarga que apunta a la vieja, con motivo', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/mue1'), { rol: 'muelle', estado: 'activo', planta: 'torcuato' })
      await setDoc(doc(d, 'users/mue2'), { rol: 'muelle', estado: 'activo', planta: 'merlo' })
      await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
      await setDoc(doc(d, 'descargasCamion/d1'), descarga({ registradoPor: { uid: 'mue1', nombre: 'Muelle' } }))
      // De otro repartidor: no se puede "corregir" el conteo ajeno.
      await setDoc(doc(d, 'descargasCamion/otro'), descarga({ choferId: 'chof2', registradoPor: { uid: 'mue1', nombre: 'Muelle' } }))
    })
    const correccion = (extra = {}) => descarga({
      registradoPor: { uid: 'mue1', nombre: 'Muelle' },
      rectificaA: 'd1', motivoRectificacion: 'se tipeó 6 en vez de 60', ...extra,
    })
    // POSITIVO.
    await assertSucceeds(setDoc(doc(db('mue1'), 'descargasCamion/r1'), correccion()))
    // Sin motivo, o vacío.
    const { motivoRectificacion: _m, ...sinMotivo } = correccion()
    await assertFails(setDoc(doc(db('mue1'), 'descargasCamion/r2'), sinMotivo))
    await assertFails(setDoc(doc(db('mue1'), 'descargasCamion/r3'), correccion({ motivoRectificacion: '' })))
    // Apuntando a una descarga que no existe, o al conteo de OTRO repartidor.
    await assertFails(setDoc(doc(db('mue1'), 'descargasCamion/r4'), correccion({ rectificaA: 'no-existe' })))
    await assertFails(setDoc(doc(db('mue1'), 'descargasCamion/r5'), correccion({ rectificaA: 'otro' })))
    // Muelle de la otra planta no corrige acá.
    await assertFails(setDoc(doc(db('mue2'), 'descargasCamion/r6'), correccion({ registradoPor: { uid: 'mue2', nombre: 'Merlo' } })))
    // Y la original sigue siendo inmutable: corregir NO es editar.
    await assertFails(updateDoc(doc(db('mue1'), 'descargasCamion/d1'), { items: [] }))
    await assertFails(deleteDoc(doc(db('mue1'), 'descargasCamion/d1')))
  })

  test('caja cierra con el cuadre de envases; NO con un cuadre mal formado', async () => {
    await seed((d) => setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' }))
    await assertSucceeds(setDoc(doc(db('caja1'), 'liquidaciones/2026-08-29_chof1'), liquidacion({ cerradaPor: { uid: 'caja1', nombre: 'Caja' } })))
    await assertFails(setDoc(doc(db('caja1'), 'liquidaciones/2026-08-30_chof1'), liquidacion({ fecha: '2026-08-30', cerradaPor: { uid: 'caja1', nombre: 'Caja' }, envases: 'x' })))
    await assertFails(setDoc(doc(db('caja1'), 'liquidaciones/2026-08-31_chof1'), liquidacion({ fecha: '2026-08-31', cerradaPor: { uid: 'caja1', nombre: 'Caja' }, envases: { salieron: {}, volvieron: {}, diferencia: {}, racksFaltantes: 'no' } })))
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

  test('el supervisor lee liquidaciones (Reparto en vivo muestra "cerrada", 2026-09-06) pero no cierra; el cierre admite firma, motivo y referencias', async () => {
    await seedCaja()
    await seed((d) => setDoc(doc(d, 'users/sup1'), { rol: 'supervisor', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'liquidaciones/2026-08-29_chof1'), liquidacion()))
    await assertSucceeds(getDoc(doc(db('sup1'), 'liquidaciones/2026-08-29_chof1')))
    await assertFails(setDoc(doc(db('sup1'), 'liquidaciones/2026-08-30_chof1'), liquidacion({ fecha: '2026-08-30', cerradaPor: { uid: 'sup1', nombre: 'S' } })))
    await assertSucceeds(setDoc(doc(db('caja1'), 'liquidaciones/2026-08-30_chof1'), liquidacion({
      fecha: '2026-08-30', depositoTango: '21', depositoTangoNombre: 'CRISTIAN PRIMITERRA',
      diferencia: { motivo: 'faltante_repartidor', nota: 'faltaron $500' }, firmaRepartidor: 'data:image/png;base64,AAAA', firmanteRepartidor: 'Primiterra',
      confirmoSinPendientes: true, ventasIds: ['v1'], cobranzasIds: [], remitosCargaIds: ['r1'], descargasIds: [], cantidadVentas: 1, cantidadCobranzas: 0, clientesVisitados: 1,
    })))
  })

  test('el chofer lee su liquidación pero no la de otro', async () => {
    await seedChofer()
    await seed((d) => setDoc(doc(d, 'liquidaciones/2026-08-29_chof1'), liquidacion()))
    await seed((d) => setDoc(doc(d, 'liquidaciones/2026-08-29_otro'), liquidacion({ choferId: 'otro' })))
    await assertSucceeds(getDoc(doc(db('chof1'), 'liquidaciones/2026-08-29_chof1')))
    await assertFails(getDoc(doc(db('chof1'), 'liquidaciones/2026-08-29_otro')))
  })
})

// Tesorería (2026-09-09): tablero en vivo — lee ventas, cobranzas, remitos y liquidaciones de todos; no escribe.
describe('tesoreria: lectura del tablero en vivo', () => {
  test('tesorería lee ventasCamion, ventasVentanilla, cobranzas, remitosCarga y liquidaciones; no crea ni edita', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/tes1'), { rol: 'tesoreria', estado: 'activo' })
      await setDoc(doc(d, 'ventasCamion/v1'), { canal: 'promo', camionId: 'cam1', choferId: 'chof1', choferNombre: 'Chofer', clienteId: 'cli', clienteNombre: 'C', items: [], total: 100, formaPago: 'contado_efectivo', fecha: new Date(), tango: { estado: 'pendiente' } })
      await setDoc(doc(d, 'ventasVentanilla/w1'), { plantaId: 'torcuato', canal: 'contado', cajaId: 'caja1', cajaNombre: 'Caja', clienteNombre: 'C', items: [], total: 100, formaPago: 'contado_efectivo', estado: 'pendiente_entrega', turno: 1, turnoEstado: 'en_espera', fecha: new Date(), tango: { estado: 'pendiente' } })
      await setDoc(doc(d, 'cobranzas/c1'), { origen: 'supervisor', registradoPor: { uid: 'sup1', nombre: 'S' }, clienteId: 'cli', clienteNombre: 'C', importe: 100, formaPago: 'contado_efectivo', fecha: new Date() })
      await setDoc(doc(d, 'remitosCarga/r1'), { numero: 1, codigo: 'RC-DT-000001', plantaId: 'torcuato', camionId: 'cam1', camionLabel: 'AA', choferId: 'chof1', choferNombre: 'Chofer', items: [], palletsCarga: 0, estado: 'emitido', creadoPor: { uid: 'caja1', nombre: 'Caja' }, fecha: new Date() })
      await setDoc(doc(d, 'liquidaciones/2026-09-09_chof1'), { fecha: '2026-09-09', plantaId: 'torcuato', choferId: 'chof1', choferNombre: 'Chofer', productos: [], cambios: { registrados: 0, rotasRecibidas: 0 }, importes: { contadoEfectivo: 0, contadoTransferencia: 0, cuentaCorriente: 0, total: 0 }, efectivoARendir: 0, efectivoRecibido: 0, diferenciaEfectivo: 0, cerradaPor: { uid: 'caja1', nombre: 'Caja' }, createdAt: new Date() })
    })
    for (const p of ['ventasCamion/v1', 'ventasVentanilla/w1', 'cobranzas/c1', 'remitosCarga/r1', 'liquidaciones/2026-09-09_chof1']) await assertSucceeds(getDoc(doc(db('tes1'), p)))
    await assertFails(setDoc(doc(db('tes1'), 'ventasVentanilla/w2'), { plantaId: 'torcuato', canal: 'contado', cajaId: 'tes1', cajaNombre: 'T', clienteNombre: 'C', items: [], total: 1, formaPago: 'contado_efectivo', estado: 'pendiente_entrega', turno: 2, turnoEstado: 'en_espera', fecha: new Date(), tango: { estado: 'pendiente' } }))
    await assertFails(updateDoc(doc(db('tes1'), 'liquidaciones/2026-09-09_chof1'), { efectivoRecibido: 5 }))
  })
})

// Rendiciones: cierre de caja por persona y día (2026-09-09).
// ── Cierres de caja VIEJOS (tipo 'mostrador', del 09 al 13/09) ──────────────
// Desde el 2026-09-14 el cierre de ventanilla es el SOBRE (ver más abajo). Los
// docs viejos se siguen leyendo, ya no se crean ni se validan; solo se les
// fija entregaId para regularizar lo que quedó pendiente con la entrega manual.
describe('rendiciones: cierres viejos tipo mostrador (solo lectura + entregaId)', () => {
  const seedTodos = () => seed(async (d) => {
    await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/caja2'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/cajam'), { rol: 'caja', estado: 'activo', planta: 'merlo' })
    await setDoc(doc(d, 'users/mue1'),  { rol: 'muelle', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/tes1'),  { rol: 'tesoreria', estado: 'activo' })
    await setDoc(doc(d, 'users/fac1'),  { rol: 'facturacion', estado: 'activo' })
    await setDoc(doc(d, 'users/gg'),    { rol: 'gerente_general', estado: 'activo' })
    await setDoc(doc(d, 'users/log'),   { rol: 'logistica', estado: 'activo' })
    await setDoc(doc(d, 'users/sa'),    { rol: 'super_admin', estado: 'activo' })
    await setDoc(doc(d, 'users/cli'),   { rol: 'cliente', estado: 'activo' })
    await setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' })
  })
  const rendicion = (extra = {}) => ({
    numero: 1, codigo: 'RD-DT-000001', tipo: 'mostrador', fecha: '2026-09-09', plantaId: 'torcuato',
    sujetoId: 'caja1', sujetoNombre: 'Nicolas Diaz',
    ventas: { cantidad: 2, contadoEfectivo: 1000, contadoTransferencia: 0, cuentaCorriente: 0, promoEfectivo: 0, promoTransferencia: 0, promoCuentaCorriente: 0, total: 1000 },
    cobranzas: { cantidad: 0, efectivo: 0, transferencia: 0, cheques: { cantidad: 0, total: 0 }, retenciones: { cantidad: 0, total: 0 }, total: 0 },
    recibido: { liquidaciones: [], efectivo: 0 }, bultos: [], cheques: [], retenciones: [],
    efectivoARendir: 1000, efectivoContado: 1000, diferenciaEfectivo: 0,
    firma: 'data:image/png;base64,AAAA', firmante: 'Nicolas Diaz', confirmoSinPendientes: true,
    ventasIds: ['v1', 'v2'], cobranzasIds: [], liquidacionesIds: [], cantidadVentas: 2, cantidadCobranzas: 0,
    desde: new Date('2026-09-09T03:00:00Z'), hasta: new Date('2026-09-09T20:00:00Z'),
    cerradaPor: { uid: 'caja1', nombre: 'Nicolas Diaz' }, createdAt: new Date(),
    validacion: null, entregaId: null,
    ...extra,
  })
  const ID = 'rendiciones/2026-09-09_caja1'

  test('ya NO se crea un cierre tipo mostrador (lo reemplazó el sobre de ventanilla, 2026-09-14)', async () => {
    await seedTodos()
    await assertFails(setDoc(doc(db('caja1'), ID), rendicion()))
    await assertFails(setDoc(doc(db('cajam'), 'rendiciones/2026-09-09_cajam'), rendicion({ plantaId: 'merlo', codigo: 'RD-ML-000001', sujetoId: 'cajam', cerradaPor: { uid: 'cajam', nombre: 'M' } })))
    await assertFails(setDoc(doc(db('sa'), 'rendiciones/2026-09-09_sa'), rendicion({ sujetoId: 'sa', cerradaPor: { uid: 'sa', nombre: 'SA' } })))
  })

  test('lectura como siempre: caja, tesorería, gerencia, logística y supervisor leen; facturación y cliente no; el chofer solo la suya', async () => {
    await seedTodos()
    await seed(async (d) => {
      await setDoc(doc(d, 'users/sup1'), { rol: 'supervisor', estado: 'activo' })
      await setDoc(doc(d, ID), rendicion())
      await setDoc(doc(d, 'rendiciones/2026-09-09_chof1'), rendicion({ sujetoId: 'chof1', tipo: 'repartidor' }))
    })
    for (const u of ['caja2', 'tes1', 'gg', 'log', 'sup1']) await assertSucceeds(getDoc(doc(db(u), ID)))
    await assertFails(getDoc(doc(db('fac1'), ID)))
    await assertFails(getDoc(doc(db('cli'), ID)))
    await assertFails(getDoc(doc(db('chof1'), ID)))
    await assertSucceeds(getDoc(doc(db('chof1'), 'rendiciones/2026-09-09_chof1')))
  })

  test('ya NO se valida un cierre viejo (ni tesorería ni super_admin); nadie lo edita ni lo borra', async () => {
    await seedTodos()
    await seed((d) => setDoc(doc(d, ID), rendicion()))
    await assertFails(updateDoc(doc(db('tes1'), ID), { validacion: { uid: 'tes1', nombre: 'T', fecha: new Date(), nota: 'ok' } }))
    await assertFails(updateDoc(doc(db('sa'), ID), { validacion: { uid: 'sa', nombre: 'SA', fecha: new Date() } }))
    await assertFails(updateDoc(doc(db('caja1'), ID), { validacion: { uid: 'caja1', nombre: 'Nico', fecha: new Date() } }))
    await assertFails(updateDoc(doc(db('tes1'), ID), { efectivoContado: 5 }))
    await assertFails(updateDoc(doc(db('tes1'), ID), { estado: 'recibida' }))
    await assertFails(deleteDoc(doc(db('tes1'), ID)))
    await assertFails(deleteDoc(doc(db('caja1'), ID)))
  })

  test('la entrega a tesorería de un cierre viejo la fija caja de la planta o el operador (null → id), una vez; tesorería y gerencia no', async () => {
    await seedTodos()
    await seed(async (d) => {
      await setDoc(doc(d, ID), rendicion())
      await setDoc(doc(d, 'rendiciones/2026-09-09_caja2'), rendicion({ sujetoId: 'caja2', cerradaPor: { uid: 'caja2', nombre: 'Otro' } }))
    })
    await assertFails(updateDoc(doc(db('log'), ID), { entregaId: 'ET-1', efectivoContado: 1 }))
    await assertFails(updateDoc(doc(db('tes1'), ID), { entregaId: 'ET-1' }))
    await assertFails(updateDoc(doc(db('gg'), ID), { entregaId: 'ET-1' }))
    await assertFails(updateDoc(doc(db('cajam'), ID), { entregaId: 'ET-1' }))
    await assertSucceeds(updateDoc(doc(db('log'), ID), { entregaId: 'ET-1' }))
    await assertFails(updateDoc(doc(db('log'), ID), { entregaId: 'ET-2' }))
    await assertSucceeds(updateDoc(doc(db('caja1'), 'rendiciones/2026-09-09_caja2'), { entregaId: 'ET-1' }))
  })

  test('contador rendicionCounter_{planta}: solo caja de esa planta, y solo avanza', async () => {
    await seedTodos()
    await assertSucceeds(setDoc(doc(db('caja1'), 'config/rendicionCounter_torcuato'), { next: 2 }))
    await assertFails(setDoc(doc(db('cajam'), 'config/rendicionCounter_torcuato'), { next: 3 }))
    await assertSucceeds(updateDoc(doc(db('caja2'), 'config/rendicionCounter_torcuato'), { next: 3 }))
    await assertFails(updateDoc(doc(db('caja2'), 'config/rendicionCounter_torcuato'), { next: 2 }))
    await assertFails(updateDoc(doc(db('caja2'), 'config/rendicionCounter_torcuato'), { next: 4, otro: 1 }))
    await assertFails(setDoc(doc(db('tes1'), 'config/rendicionCounter_merlo'), { next: 2 }))
  })
})

// ── Rendición de fondos (2026-09-14): turno de caja + sobre de ventanilla ────
// El cajero abre SU turno (cajaSesiones), vende y cobra contra ese turno, y lo
// cierra con arqueo ciego creando el SOBRE (rendiciones tipo 'ventanilla') en
// la misma transacción; tesorería lo recibe una sola vez con doble firma.
describe('cajaSesiones (turno de caja, rendición de fondos 2026-09-14)', () => {
  const FECHA = '2026-09-09'
  const seedTodos = () => seed(async (d) => {
    await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/caja2'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/cajam'), { rol: 'caja', estado: 'activo', planta: 'merlo' })
    await setDoc(doc(d, 'users/mue1'),  { rol: 'muelle', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/tes1'),  { rol: 'tesoreria', estado: 'activo' })
    await setDoc(doc(d, 'users/fac1'),  { rol: 'facturacion', estado: 'activo' })
    await setDoc(doc(d, 'users/gg'),    { rol: 'gerente_general', estado: 'activo' })
    await setDoc(doc(d, 'users/log'),   { rol: 'logistica', estado: 'activo' })
    await setDoc(doc(d, 'users/sa'),    { rol: 'super_admin', estado: 'activo' })
    await setDoc(doc(d, 'users/cli'),   { rol: 'cliente', estado: 'activo' })
    await setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' })
  })
  const sesion = (uid = 'caja1', extra = {}) => ({
    plantaId: 'torcuato', cajero: { uid, nombre: 'Nico' }, fecha: FECHA, numero: 1, estado: 'abierta',
    abiertaEn: new Date(), fondoInicial: 0, fondoInicialDe: null, ...extra,
  })
  const ID1 = `cajaSesiones/${FECHA}_caja1_1`
  const ID2 = `cajaSesiones/${FECHA}_caja1_2`

  test('caja abre SU turno: id determinístico, abierta, fondo 0 sin quién lo cargó, sin cierre; no a nombre de otro ni con id inventado', async () => {
    await seedTodos()
    await assertFails(setDoc(doc(db('caja1'), ID1), sesion('caja2')))
    await assertFails(setDoc(doc(db('caja1'), 'cajaSesiones/otro'), sesion()))
    await assertFails(setDoc(doc(db('caja1'), ID1), sesion('caja1', { numero: 0 })))
    await assertFails(setDoc(doc(db('caja1'), ID1), sesion('caja1', { estado: 'cerrada' })))
    await assertFails(setDoc(doc(db('caja1'), ID1), sesion('caja1', { rendicionId: `${FECHA}_caja1_1` })))
    await assertFails(setDoc(doc(db('caja1'), ID1), sesion('caja1', { cerradaEn: new Date() })))
    await assertFails(setDoc(doc(db('caja1'), ID1), sesion('caja1', { fondoInicial: 5000 })))
    await assertFails(setDoc(doc(db('caja1'), ID1), sesion('caja1', { fondoInicialDe: { uid: 'caja1', nombre: 'Nico' } })))
    await assertFails(setDoc(doc(db('caja1'), ID1), sesion('caja1', { plantaId: 'merlo' })))
    await assertSucceeds(setDoc(doc(db('caja1'), ID1), sesion()))
    await assertFails(setDoc(doc(db('caja1'), ID1), sesion('caja1', { abiertaEn: new Date() })))   // no se pisa
  })

  test('un solo turno abierto por cajero: la sesión 2 solo cuando la 1 está cerrada', async () => {
    await seedTodos()
    await seed((d) => setDoc(doc(d, ID1), sesion()))
    await assertFails(setDoc(doc(db('caja1'), ID2), sesion('caja1', { numero: 2 })))
    await assertFails(setDoc(doc(db('caja1'), `cajaSesiones/${FECHA}_caja1_3`), sesion('caja1', { numero: 3 })))   // la 2 no existe
    await seed((d) => updateDoc(doc(d, ID1), { estado: 'cerrada', cerradaEn: new Date(), rendicionId: `${FECHA}_caja1_1` }))
    await assertSucceeds(setDoc(doc(db('caja1'), ID2), sesion('caja1', { numero: 2 })))
  })

  test('tesorería, muelle, logística y caja de otra planta no abren turnos; el super_admin abre el suyo y carga fondo a su nombre', async () => {
    await seedTodos()
    await assertFails(setDoc(doc(db('tes1'), `cajaSesiones/${FECHA}_tes1_1`), sesion('tes1')))
    await assertFails(setDoc(doc(db('mue1'), `cajaSesiones/${FECHA}_mue1_1`), sesion('mue1')))
    await assertFails(setDoc(doc(db('log'), `cajaSesiones/${FECHA}_log_1`), sesion('log')))
    await assertFails(setDoc(doc(db('cajam'), `cajaSesiones/${FECHA}_cajam_1`), sesion('cajam')))
    await assertSucceeds(setDoc(doc(db('cajam'), `cajaSesiones/${FECHA}_cajam_1`), sesion('cajam', { plantaId: 'merlo' })))
    await assertFails(setDoc(doc(db('sa'), `cajaSesiones/${FECHA}_sa_1`), sesion('sa', { fondoInicial: 5000, fondoInicialDe: { uid: 'tes1', nombre: 'Y' } })))
    await assertSucceeds(setDoc(doc(db('sa'), `cajaSesiones/${FECHA}_sa_1`), sesion('sa', { fondoInicial: 5000, fondoInicialDe: { uid: 'sa', nombre: 'SA' } })))
  })

  test('lectura: caja, tesorería, gerencia y logística leen; facturación, chofer y cliente no; nadie borra', async () => {
    await seedTodos()
    await seed((d) => setDoc(doc(d, ID1), sesion()))
    for (const u of ['caja2', 'cajam', 'tes1', 'gg', 'log', 'sa']) await assertSucceeds(getDoc(doc(db(u), ID1)))
    for (const u of ['fac1', 'chof1', 'cli']) await assertFails(getDoc(doc(db(u), ID1)))
    await assertFails(deleteDoc(doc(db('caja1'), ID1)))
    await assertFails(deleteDoc(doc(db('sa'), ID1)))
  })
})

describe('rendiciones: sobre de ventanilla y recepción de tesorería (2026-09-14)', () => {
  const FECHA = '2026-09-09'
  const seedTodos = () => seed(async (d) => {
    await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/caja2'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/cajam'), { rol: 'caja', estado: 'activo', planta: 'merlo' })
    await setDoc(doc(d, 'users/tes1'),  { rol: 'tesoreria', estado: 'activo' })
    await setDoc(doc(d, 'users/fac1'),  { rol: 'facturacion', estado: 'activo' })
    await setDoc(doc(d, 'users/gg'),    { rol: 'gerente_general', estado: 'activo' })
    await setDoc(doc(d, 'users/log'),   { rol: 'logistica', estado: 'activo' })
    await setDoc(doc(d, 'users/sa'),    { rol: 'super_admin', estado: 'activo' })
    await setDoc(doc(d, 'users/sup1'),  { rol: 'supervisor', estado: 'activo' })
    await setDoc(doc(d, 'users/cli'),   { rol: 'cliente', estado: 'activo' })
    await setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' })
  })
  const cheque = (numero) => ({ numero, bancoCodigo: '011', bancoNombre: 'Nación', fechaEmision: '2026-09-01', fechaAcreditacion: '2026-09-20', dias: 19, importe: 100, cobranzaId: 'cob1', numeroRecibo: 'RS-1', clienteNombre: 'Cli' })
  const sesion = (uid = 'caja1', extra = {}) => ({
    plantaId: 'torcuato', cajero: { uid, nombre: 'Nico' }, fecha: FECHA, numero: 1, estado: 'abierta',
    abiertaEn: new Date(), fondoInicial: 0, fondoInicialDe: null, ...extra,
  })
  const sesionCerrada = (uid = 'caja1') => sesion(uid, { estado: 'cerrada', cerradaEn: new Date(), rendicionId: `${FECHA}_${uid}_1` })
  const sobre = (uid = 'caja1', extra = {}) => ({
    tipo: 'ventanilla', rindeA: 'tesoreria', plantaId: 'torcuato', fecha: FECHA, numero: 1, codigo: 'RV-DT-000001',
    rindio: { uid, nombre: 'Nico', rol: 'caja' }, cajaSesionId: `${FECHA}_${uid}_1`,
    sistema: {
      efectivo: 1000, cheques: [cheque('11'), cheque('22')], retenciones: [], transferencias: { cantidad: 0, total: 0 },
      detalle: { fondoInicial: 0, ventasEfectivo: 1000, cobranzasEfectivo: 0, recibidoDeLiquidaciones: 0, recibidoDeSobres: 0 },
      origenIds: { ventasIds: ['v1'], cobranzasIds: ['cob1'], liquidacionesIds: [], sobresRecibidosIds: [] },
    },
    declarado: { efectivo: 1000, conteoBilletes: { billetes: { '20000': 0, '10000': 0, '2000': 0, '1000': 1, '500': 0 }, cambioChico: 0, sinEfectivo: false, total: 1000 }, cheques: [{ clave: 'cob1|11', presente: true }, { clave: 'cob1|22', presente: true }], retenciones: [] },
    diferenciaDeclarada: { efectivo: 0, valoresFaltantes: { cantidad: 0, total: 0 } },
    fajos: { redonhielo: 1000, rolito: 0 },
    firmaRinde: 'data:image/png;base64,AAAA', firmanteRinde: 'Nico', cerradaEn: new Date(),
    estado: 'pendiente_recepcion', custodia: { uid, nombre: 'Nico', rol: 'caja', desde: new Date() },
    createdAt: new Date(), ...extra,
  })
  const SESION = `cajaSesiones/${FECHA}_caja1_1`
  const SOBRE  = `rendiciones/${FECHA}_caja1_1`
  // Cerrar el turno y crear el sobre en la MISMA transacción (writeBatch;
  // las reglas se cruzan con getAfter). Una falla no escribe nada, así que
  // se pueden encadenar variantes inválidas antes de la buena.
  const cerrarTurno = (d, uid = 'caja1', sobreExtra = {}, cierreExtra = {}, sobreId = `${FECHA}_${uid}_1`) => {
    const b = writeBatch(d)
    b.update(doc(d, `cajaSesiones/${FECHA}_${uid}_1`), { estado: 'cerrada', cerradaEn: new Date(), rendicionId: sobreId, ...cierreExtra })
    b.set(doc(d, `rendiciones/${sobreId}`), sobre(uid, sobreExtra))
    return b.commit()
  }
  const recepcion = (extra = {}, arriba = {}) => ({
    estado: 'recibida', custodia: { uid: 'tes1', nombre: 'Yanina', rol: 'tesoreria', desde: new Date() },
    recepcion: {
      recibio: { uid: 'tes1', nombre: 'Yanina', rol: 'tesoreria' }, en: new Date(), efectivoContado: 1000,
      cheques: [{ clave: 'cob1|11', recibido: true }, { clave: 'cob1|22', recibido: true }], retenciones: [],
      conformidad: 'conforme', firmaRecibe: 'data:image/png;base64,BBBB', firmanteRecibe: 'Yanina',
      ...extra,
    },
    ...arriba,
  })

  test('el sobre nace SOLO en la transacción que cierra el turno: suelto no, con el turno de otro no, con id distinto al de la sesión no; el turno no se cierra sin sobre', async () => {
    await seedTodos()
    await seed(async (d) => {
      await setDoc(doc(d, SESION), sesion())
      await setDoc(doc(d, `cajaSesiones/${FECHA}_caja2_1`), sesion('caja2'))
    })
    await assertFails(setDoc(doc(db('caja1'), SOBRE), sobre()))
    await assertFails(updateDoc(doc(db('caja1'), SESION), { estado: 'cerrada', cerradaEn: new Date(), rendicionId: `${FECHA}_caja1_1` }))
    await assertFails(updateDoc(doc(db('caja1'), SESION), { estado: 'cerrada', cerradaEn: new Date() }))
    await assertFails(cerrarTurno(db('caja1'), 'caja1', { cajaSesionId: `${FECHA}_caja2_1` }))
    await assertFails(cerrarTurno(db('caja1'), 'caja1', {}, {}, 'otro-id'))
    await assertFails(cerrarTurno(db('caja1'), 'caja1', {}, { fondoInicial: 5 }))
    await assertFails(cerrarTurno(db('caja2'), 'caja1'))                                   // otro cajero no cierra un turno ajeno
    await assertFails(cerrarTurno(db('caja1'), 'caja1', { rindio: { uid: 'caja2', nombre: 'Otro', rol: 'caja' } }))
    await assertSucceeds(cerrarTurno(db('caja1')))
    await assertFails(cerrarTurno(db('caja1')))                                            // ya cerrado, ya existe
    const s = await getDoc(doc(db('caja1'), SESION))
    if (s.data().estado !== 'cerrada' || s.data().rendicionId !== `${FECHA}_caja1_1`) throw new Error('el turno no quedó cerrado con su sobre')
  })

  test('el sobre nace pendiente, de ventanilla a tesorería, con custodia y firma del que rinde, sin recepción; con diferencia pide motivo y nota; cobrador/chofer/mostrador todavía no', async () => {
    await seedTodos()
    await seed((d) => setDoc(doc(d, SESION), sesion()))
    const c = db('caja1')
    await assertFails(cerrarTurno(c, 'caja1', { estado: 'recibida' }))
    await assertFails(cerrarTurno(c, 'caja1', { recepcion: recepcion().recepcion }))
    await assertFails(cerrarTurno(c, 'caja1', { custodia: { uid: 'tes1', nombre: 'Y', rol: 'tesoreria', desde: new Date() } }))
    await assertFails(cerrarTurno(c, 'caja1', { firmaRinde: '' }))
    await assertFails(cerrarTurno(c, 'caja1', { tipo: 'cobrador', rindeA: 'caja' }))
    await assertFails(cerrarTurno(c, 'caja1', { tipo: 'chofer', rindeA: 'caja' }))
    await assertFails(cerrarTurno(c, 'caja1', { tipo: 'mostrador' }))
    await assertFails(cerrarTurno(c, 'caja1', { rindeA: 'caja' }))
    await assertFails(cerrarTurno(c, 'caja1', { rindio: { uid: 'caja1', nombre: 'Nico', rol: 'logistica' } }))
    await assertFails(cerrarTurno(c, 'caja1', { sistema: { efectivo: 'mil', cheques: [], retenciones: [] } }))
    await assertFails(cerrarTurno(c, 'caja1', { declarado: { efectivo: 1000, cheques: 'x', retenciones: [] } }))
    // Conteo de billetes obligatorio y su total tiene que ser el efectivo declarado (2026-09-16).
    await assertFails(cerrarTurno(c, 'caja1', { declarado: { efectivo: 1000, cheques: [], retenciones: [] } }))
    await assertFails(cerrarTurno(c, 'caja1', { declarado: { efectivo: 1000, conteoBilletes: { billetes: { '20000': 0, '10000': 0, '2000': 0, '1000': 2, '500': 0 }, cambioChico: 0, sinEfectivo: false, total: 2000 }, cheques: [], retenciones: [] } }))
    await assertFails(cerrarTurno(c, 'caja1', { declarado: { efectivo: 1000, conteoBilletes: { billetes: { '20000': 0, '10000': 0, '2000': 0, '1000': 1, '500': 0 }, cambioChico: 0, sinEfectivo: false, total: 999 }, cheques: [], retenciones: [] } }))
    await assertFails(cerrarTurno(c, 'caja1', { diferenciaDeclarada: { efectivo: -500, valoresFaltantes: { cantidad: 0, total: 0 } } }))
    await assertFails(cerrarTurno(c, 'caja1', { diferenciaDeclarada: { efectivo: -500, valoresFaltantes: { cantidad: 0, total: 0 } }, motivoDiferencia: { motivo: 'faltante_caja', nota: '' } }))
    await assertFails(cerrarTurno(c, 'caja1', { diferenciaDeclarada: { efectivo: 0, valoresFaltantes: { cantidad: 1, total: 100 } } }))
    await assertSucceeds(cerrarTurno(c, 'caja1', { diferenciaDeclarada: { efectivo: -500, valoresFaltantes: { cantidad: 1, total: 100 } }, motivoDiferencia: { motivo: 'faltante_caja', nota: 'un cheque quedó en el cajón de al lado' } }))
  })

  test('recepción: tesorería recibe UNA vez (su uid en recepción y custodia, mismos valores tildados, firma; con diferencia, motivo y nota); caja y gerencia no; nada más se toca; nadie borra', async () => {
    await seedTodos()
    await seed(async (d) => {
      await setDoc(doc(d, SESION), sesionCerrada())
      await setDoc(doc(d, SOBRE), sobre())
    })
    await assertFails(updateDoc(doc(db('caja1'), SOBRE), recepcion({ recibio: { uid: 'caja1', nombre: 'N', rol: 'caja' } }, { custodia: { uid: 'caja1', nombre: 'N', rol: 'caja', desde: new Date() } })))
    await assertFails(updateDoc(doc(db('gg'), SOBRE), recepcion({ recibio: { uid: 'gg', nombre: 'G', rol: 'gerente_general' } }, { custodia: { uid: 'gg', nombre: 'G', rol: 'gerente_general', desde: new Date() } })))
    await assertFails(updateDoc(doc(db('tes1'), SOBRE), recepcion({ recibio: { uid: 'otro', nombre: 'X', rol: 'tesoreria' } })))
    await assertFails(updateDoc(doc(db('tes1'), SOBRE), recepcion({}, { custodia: { uid: 'caja1', nombre: 'Nico', rol: 'caja', desde: new Date() } })))
    await assertFails(updateDoc(doc(db('tes1'), SOBRE), recepcion({ firmaRecibe: '' })))
    await assertFails(updateDoc(doc(db('tes1'), SOBRE), recepcion({}, { estado: 'pendiente_recepcion' })))
    await assertFails(updateDoc(doc(db('tes1'), SOBRE), recepcion({ cheques: [{ clave: 'cob1|11', recibido: true }] })))
    await assertFails(updateDoc(doc(db('tes1'), SOBRE), recepcion({ retenciones: [{ clave: 'x', recibido: true }] })))
    await assertFails(updateDoc(doc(db('tes1'), SOBRE), recepcion({ conformidad: 'con_diferencia' })))
    await assertFails(updateDoc(doc(db('tes1'), SOBRE), recepcion({ conformidad: 'con_diferencia', diferencia: { efectivo: -10, valoresFaltantes: { cantidad: 0, total: 0 }, motivo: 'faltante_entrega', nota: '' } })))
    await assertFails(updateDoc(doc(db('tes1'), SOBRE), recepcion({ conformidad: 'otra' })))
    await assertFails(updateDoc(doc(db('tes1'), SOBRE), recepcion({ efectivoContado: '990' })))
    await assertFails(updateDoc(doc(db('tes1'), SOBRE), recepcion({}, { 'sistema.efectivo': 1 })))
    await assertFails(updateDoc(doc(db('tes1'), SOBRE), recepcion({}, { firmaRinde: 'otra' })))
    await assertFails(updateDoc(doc(db('tes1'), SOBRE), { estado: 'recibida' }))
    await assertSucceeds(updateDoc(doc(db('tes1'), SOBRE), recepcion({ conformidad: 'con_diferencia', efectivoContado: 990, cheques: [{ clave: 'cob1|11', recibido: true }, { clave: 'cob1|22', recibido: false, motivoNoRecibido: 'no vino' }], diferencia: { efectivo: -10, valoresFaltantes: { cantidad: 1, total: 100 }, motivo: 'faltante_entrega', nota: 'faltan $10 y el cheque 22' } })))
    await assertFails(updateDoc(doc(db('tes1'), SOBRE), recepcion()))                    // segunda recepción
    await assertFails(updateDoc(doc(db('sa'), SOBRE), recepcion({ recibio: { uid: 'sa', nombre: 'SA', rol: 'super_admin' } }, { custodia: { uid: 'sa', nombre: 'SA', rol: 'super_admin', desde: new Date() } })))
    await assertFails(deleteDoc(doc(db('tes1'), SOBRE)))
    await assertFails(deleteDoc(doc(db('caja1'), SOBRE)))
  })

  test('entrega en mano (2026-09-16): el cajero que rindió pasa el sobre a entregada con la firma de alguien de tesorería; otro cajero, tesorería o gerencia no; quien recibe tiene que ser de tesorería y distinto del cajero; solo estado, custodia y entrega; después tesorería lo recibe (cuenta)', async () => {
    await seedTodos()
    await seed(async (d) => {
      await setDoc(doc(d, SESION), sesionCerrada())
      await setDoc(doc(d, SOBRE), sobre())
      await setDoc(doc(d, 'users/tes2'), { rol: 'facturacion', rolesExtra: ['tesoreria'], estado: 'activo' })
    })
    const entrega = (extra = {}, arriba = {}) => ({
      estado: 'entregada', custodia: { uid: 'tes1', nombre: 'Yanina', rol: 'tesoreria', desde: new Date() },
      entrega: { recibio: { uid: 'tes1', nombre: 'Yanina', rol: 'tesoreria' }, en: new Date(), firmaRecibe: 'data:image/png;base64,CCCC', firmanteRecibe: 'Yanina', ...extra },
      ...arriba,
    })
    await assertFails(updateDoc(doc(db('caja2'), SOBRE), entrega()))                                              // otro cajero
    await assertFails(updateDoc(doc(db('tes1'), SOBRE), entrega()))                                               // tesorería no se auto-entrega
    await assertFails(updateDoc(doc(db('gg'), SOBRE), entrega()))
    await assertFails(updateDoc(doc(db('caja1'), SOBRE), entrega({ recibio: { uid: 'fac1', nombre: 'F', rol: 'tesoreria' } }, { custodia: { uid: 'fac1', nombre: 'F', rol: 'tesoreria', desde: new Date() } })))   // no es de tesorería
    await assertFails(updateDoc(doc(db('caja1'), SOBRE), entrega({ recibio: { uid: 'caja1', nombre: 'Nico', rol: 'tesoreria' } }, { custodia: { uid: 'caja1', nombre: 'Nico', rol: 'tesoreria', desde: new Date() } })))   // a sí mismo no
    await assertFails(updateDoc(doc(db('caja1'), SOBRE), entrega({ firmaRecibe: '' })))
    await assertFails(updateDoc(doc(db('caja1'), SOBRE), entrega({}, { custodia: { uid: 'caja1', nombre: 'Nico', rol: 'caja', desde: new Date() } })))   // la custodia pasa a quien recibe
    await assertFails(updateDoc(doc(db('caja1'), SOBRE), entrega({}, { 'sistema.efectivo': 1 })))
    await assertFails(updateDoc(doc(db('caja1'), SOBRE), entrega({}, { estado: 'recibida' })))
    // Con tesorería como rol adicional también vale.
    await assertSucceeds(updateDoc(doc(db('caja1'), SOBRE), entrega({ recibio: { uid: 'tes2', nombre: 'T2', rol: 'tesoreria' } }, { custodia: { uid: 'tes2', nombre: 'T2', rol: 'tesoreria', desde: new Date() } })))
    await assertFails(updateDoc(doc(db('caja1'), SOBRE), entrega()))                                              // segunda entrega no
    // Tesorería cuenta el sobre entregado; el cajero no puede volverlo atrás.
    await assertFails(updateDoc(doc(db('caja1'), SOBRE), { estado: 'pendiente_recepcion' }))
    await assertSucceeds(updateDoc(doc(db('tes1'), SOBRE), recepcion()))
    // Caja lee la lista de tesorería para elegir a quién entrega, pero no al resto del personal.
    await assertSucceeds(getDoc(doc(db('caja1'), 'users/tes1')))
    await assertFails(getDoc(doc(db('caja1'), 'users/fac1')))
  })

  test('anticipo a tesorería (2026-09-23): lo crea el cajero con turno ABIERTO, nace entregado con la firma de tesorería y su custodia, monto positivo sin valores; con turno cerrado, id fuera de molde, receptor que no es de tesorería, monto cero o recepción adentro no; después tesorería lo cuenta', async () => {
    await seedTodos()
    await seed(async (d) => { await setDoc(doc(d, SESION), sesion()) })
    const anticipo = (extra = {}) => ({
      tipo: 'anticipo', rindeA: 'tesoreria', plantaId: 'torcuato', fecha: FECHA, numero: 1, codigo: 'VA-DT-000001',
      rindio: { uid: 'caja1', nombre: 'Nico', rol: 'caja' }, cajaSesionId: `${FECHA}_caja1_1`, anticipo: { empresa: 'redonhielo' },
      sistema: { efectivo: 500000, cheques: [], retenciones: [], transferencias: { cantidad: 0, total: 0 }, origenIds: { ventasIds: [], cobranzasIds: [], liquidacionesIds: [], sobresRecibidosIds: [] } },
      declarado: { efectivo: 500000, cheques: [], retenciones: [] },
      diferenciaDeclarada: { efectivo: 0, valoresFaltantes: { cantidad: 0, total: 0 } },
      firmaRinde: '', firmanteRinde: 'Nico', fajos: { redonhielo: 500000, rolito: 0 }, cerradaEn: new Date(),
      estado: 'entregada', custodia: { uid: 'tes1', nombre: 'Yanina', rol: 'tesoreria', desde: new Date() },
      entrega: { recibio: { uid: 'tes1', nombre: 'Yanina', rol: 'tesoreria' }, en: new Date(), firmaRecibe: 'data:image/png;base64,CCCC', firmanteRecibe: 'Yanina' },
      createdAt: new Date(), ...extra,
    })
    const ID = `rendiciones/${FECHA}_caja1_1_anticipo_1`
    await assertFails(setDoc(doc(db('caja2'), ID), anticipo()))                                                     // otro cajero
    await assertFails(setDoc(doc(db('caja1'), `rendiciones/${FECHA}_caja1_1`), anticipo()))                          // id fuera del molde
    await assertFails(setDoc(doc(db('caja1'), ID), anticipo({ sistema: { ...anticipo().sistema, efectivo: 0 }, declarado: { efectivo: 0, cheques: [], retenciones: [] } })))
    await assertFails(setDoc(doc(db('caja1'), ID), anticipo({ declarado: { efectivo: 1, cheques: [], retenciones: [] } })))   // declarado ≠ sistema
    await assertFails(setDoc(doc(db('caja1'), ID), anticipo({ estado: 'pendiente_recepcion' })))
    await assertFails(setDoc(doc(db('caja1'), ID), anticipo({ anticipo: { empresa: 'otra' } })))
    await assertFails(setDoc(doc(db('caja1'), ID), anticipo({ entrega: { ...anticipo().entrega, recibio: { uid: 'fac1', nombre: 'F', rol: 'tesoreria' } }, custodia: { uid: 'fac1', nombre: 'F', rol: 'tesoreria', desde: new Date() } })))
    await assertFails(setDoc(doc(db('caja1'), ID), anticipo({ custodia: { uid: 'caja1', nombre: 'Nico', rol: 'caja', desde: new Date() } })))
    await assertFails(setDoc(doc(db('caja1'), ID), anticipo({ recepcion: { recibio: { uid: 'tes1' } } })))
    await assertSucceeds(setDoc(doc(db('caja1'), ID), anticipo()))
    await assertSucceeds(setDoc(doc(db('caja1'), `rendiciones/${FECHA}_caja1_1_anticipo_2`), anticipo({ numero: 2, codigo: 'VA-DT-000002', anticipo: { empresa: 'rolito' }, fajos: { redonhielo: 0, rolito: 500000 } })))
    // Tesorería lo cuenta como a cualquier sobre; el cajero no lo toca más.
    await assertFails(updateDoc(doc(db('caja1'), ID), { 'sistema.efectivo': 1 }))
    await assertSucceeds(updateDoc(doc(db('tes1'), ID), recepcion({ efectivoContado: 500000, cheques: [], retenciones: [] })))
    // Con el turno cerrado no se anticipa.
    await seed(async (d) => { await setDoc(doc(d, SESION), sesionCerrada()) })
    await assertFails(setDoc(doc(db('caja1'), `rendiciones/${FECHA}_caja1_1_anticipo_3`), anticipo({ numero: 3, codigo: 'VA-DT-000003' })))
  })

  test('vale de caja (2026-09-25): lo crea el cajero con turno ABIERTO, con receptor, motivo y firma; el cierre del turno le anota el sobre; tesorería lo tilda al contar y nada más (no hay cierre posterior); con turno cerrado, id fuera de molde, importe cero, sin motivo o con estado/cierre adentro no', async () => {
    await seedTodos()
    await seed(async (d) => { await setDoc(doc(d, SESION), sesion()) })
    const vale = (extra = {}) => ({
      plantaId: 'torcuato', fecha: FECHA, numero: 1, codigo: 'VC-DT-000001', cajaSesionId: `${FECHA}_caja1_1`,
      emitio: { uid: 'caja1', nombre: 'Nico', rol: 'caja' }, empresa: 'redonhielo', importe: 50000,
      receptor: { nombre: 'Juan Pérez', dni: '30123456' }, motivo: 'combustible del camión',
      firmaRecibe: 'data:image/png;base64,CCCC', firmanteRecibe: 'Juan Pérez', emitidoEn: new Date(), createdAt: new Date(), ...extra,
    })
    const ID = `valesCaja/${FECHA}_caja1_1_vale_1`
    await assertFails(setDoc(doc(db('caja2'), ID), vale()))                                                          // otro cajero
    await assertFails(setDoc(doc(db('caja1'), `valesCaja/${FECHA}_caja1_1`), vale()))                                 // id fuera del molde
    await assertFails(setDoc(doc(db('caja1'), ID), vale({ importe: 0 })))
    await assertFails(setDoc(doc(db('caja1'), ID), vale({ motivo: '' })))
    await assertFails(setDoc(doc(db('caja1'), ID), vale({ receptor: { nombre: '' } })))
    await assertFails(setDoc(doc(db('caja1'), ID), vale({ firmaRecibe: '' })))
    await assertFails(setDoc(doc(db('caja1'), ID), vale({ estado: 'abierto' })))
    await assertFails(setDoc(doc(db('caja1'), ID), vale({ cierre: { forma: 'devolucion', nota: '', por: { uid: 'caja1' }, en: new Date() } })))
    await assertFails(setDoc(doc(db('tes1'), ID), vale()))                                                           // tesorería no emite
    await assertSucceeds(setDoc(doc(db('caja1'), ID), vale()))
    // El cajero solo anota el sobre en que viajó, una vez; no toca nada más.
    await assertFails(updateDoc(doc(db('caja1'), ID), { importe: 1 }))
    await assertFails(updateDoc(doc(db('caja1'), ID), { estado: 'cerrado' }))
    await assertSucceeds(updateDoc(doc(db('caja1'), ID), { sobreId: `${FECHA}_caja1_1` }))
    await assertFails(updateDoc(doc(db('caja1'), ID), { sobreId: 'otro' }))
    // Tesorería lo tilda al contar; nadie lo "cierra" después.
    await assertSucceeds(updateDoc(doc(db('tes1'), ID), { recibido: { por: { uid: 'tes1', nombre: 'Yanina', rol: 'tesoreria' }, en: new Date(), recibido: true } }))
    await assertFails(updateDoc(doc(db('tes1'), ID), { estado: 'cerrado', cierre: { forma: 'comprobante', nota: 'x', por: { uid: 'tes1', nombre: 'Yanina', rol: 'tesoreria' }, en: new Date() } }))
    await assertFails(updateDoc(doc(db('tes1'), ID), { importe: 1 }))
    // Lo leen caja, tesorería y gerencia; un chofer no.
    await assertSucceeds(getDoc(doc(db('tes1'), ID)))
    await assertFails(getDoc(doc(db('chofer1'), ID)))
    // Con el turno cerrado no se dan vales.
    await seed(async (d) => { await setDoc(doc(d, SESION), sesionCerrada()) })
    await assertFails(setDoc(doc(db('caja1'), `valesCaja/${FECHA}_caja1_1_vale_2`), vale({ numero: 2, codigo: 'VC-DT-000002' })))
  })

  test('el operador (logística / super_admin) también recibe, conforme; tipo cobrador (fase 2) no se recibe todavía por acá', async () => {
    await seedTodos()
    await seed(async (d) => {
      await setDoc(doc(d, SESION), sesionCerrada())
      await setDoc(doc(d, SOBRE), sobre())
      await setDoc(doc(d, `rendiciones/${FECHA}_sup1`), sobre('sup1', { tipo: 'cobrador', rindeA: 'caja', codigo: 'RC-000001', rindio: { uid: 'sup1', nombre: 'S', rol: 'supervisor' }, custodia: { uid: 'sup1', nombre: 'S', rol: 'supervisor', desde: new Date() } }))
    })
    await assertFails(updateDoc(doc(db('tes1'), `rendiciones/${FECHA}_sup1`), recepcion()))
    await assertFails(updateDoc(doc(db('caja1'), `rendiciones/${FECHA}_sup1`), recepcion({ recibio: { uid: 'caja1', nombre: 'N', rol: 'caja' } }, { custodia: { uid: 'caja1', nombre: 'N', rol: 'caja', desde: new Date() } })))
    await assertSucceeds(updateDoc(doc(db('log'), SOBRE), recepcion({ recibio: { uid: 'log', nombre: 'L', rol: 'logistica' } }, { custodia: { uid: 'log', nombre: 'L', rol: 'logistica', desde: new Date() } })))
  })

  test('lectura: el que rindió ve SU sobre aunque su rol no lea la colección; el chofer no ve los demás', async () => {
    await seedTodos()
    await seed(async (d) => {
      await setDoc(doc(d, SOBRE), sobre())
      await setDoc(doc(d, `rendiciones/${FECHA}_chof1`), sobre('chof1', { tipo: 'chofer', rindeA: 'caja', rindio: { uid: 'chof1', nombre: 'C', rol: 'chofer' } }))
    })
    await assertSucceeds(getDoc(doc(db('chof1'), `rendiciones/${FECHA}_chof1`)))
    await assertFails(getDoc(doc(db('chof1'), SOBRE)))
    for (const u of ['caja1', 'caja2', 'tes1', 'gg', 'log', 'sup1']) await assertSucceeds(getDoc(doc(db(u), SOBRE)))
    for (const u of ['fac1', 'cli']) await assertFails(getDoc(doc(db(u), SOBRE)))
  })

  test('contador sobreVentanillaCounter_{planta}: solo caja de esa planta, y solo avanza', async () => {
    await seedTodos()
    await assertSucceeds(setDoc(doc(db('caja1'), 'config/sobreVentanillaCounter_torcuato'), { next: 2 }))
    await assertFails(setDoc(doc(db('cajam'), 'config/sobreVentanillaCounter_torcuato'), { next: 3 }))
    await assertSucceeds(updateDoc(doc(db('caja2'), 'config/sobreVentanillaCounter_torcuato'), { next: 3 }))
    await assertFails(updateDoc(doc(db('caja2'), 'config/sobreVentanillaCounter_torcuato'), { next: 2 }))
    await assertFails(updateDoc(doc(db('caja2'), 'config/sobreVentanillaCounter_torcuato'), { next: 4, otro: 1 }))
    await assertFails(setDoc(doc(db('tes1'), 'config/sobreVentanillaCounter_merlo'), { next: 2 }))
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

describe('supervisor: Reparto en vivo (lee expedición de todos los camiones)', () => {
  test('el supervisor lee remitos de carga, ventas, cambios, descargas y cobranzas de calle; no escribe', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/sup'), { rol: 'supervisor', estado: 'activo' })
      await setDoc(doc(d, 'remitosCarga/r1'), { numero: 1, codigo: 'RC-DT-000001', plantaId: 'torcuato', camionId: 'cam1', camionLabel: 'AA123BB', choferId: 'chof1', choferNombre: 'Chofer', items: [], palletsCarga: 0, estado: 'salido', creadoPor: { uid: 'caja1', nombre: 'Caja' }, fecha: new Date() })
      await setDoc(doc(d, 'ventasCamion/v1'), { canal: 'contado', camionId: 'cam1', choferId: 'chof1', choferNombre: 'Chofer', clienteId: 'cli', clienteNombre: 'Cliente SA', items: [], total: 100, formaPago: 'contado_efectivo', fecha: new Date(), tango: { estado: 'pendiente' } })
      await setDoc(doc(d, 'cambiosCamion/c1'), { camionId: 'cam1', choferId: 'chof1', choferNombre: 'Chofer', clienteId: 'cli', clienteNombre: 'Cliente SA', productoId: 'bolsa_10kg', nombre: 'Hielo 10kg', cantidad: 1, fecha: new Date() })
      await setDoc(doc(d, 'descargasCamion/d1'), { plantaId: 'torcuato', camionId: 'cam1', camionLabel: 'AA123BB', choferId: 'chof1', choferNombre: 'Chofer', items: [], bolsasRotas: [], palletsCompletos: 0, palletsParciales: 0, palletsVacios: 0, registradoPor: { uid: 'mue1', nombre: 'Muelle' }, fecha: new Date() })
      await setDoc(doc(d, 'cobranzas/cc1'), { origen: 'cobrador', registradoPor: { uid: 'chof1', nombre: 'Chofer' }, clienteId: 'cli', clienteNombre: 'Cliente SA', importe: 500, formaPago: 'contado_efectivo', fecha: new Date() })
    })
    await assertSucceeds(getDoc(doc(db('sup'), 'remitosCarga/r1')))
    await assertSucceeds(getDoc(doc(db('sup'), 'ventasCamion/v1')))
    await assertSucceeds(getDoc(doc(db('sup'), 'cambiosCamion/c1')))
    await assertSucceeds(getDoc(doc(db('sup'), 'descargasCamion/d1')))
    await assertSucceeds(getDoc(doc(db('sup'), 'cobranzas/cc1')))
    await assertFails(updateDoc(doc(db('sup'), 'ventasCamion/v1'), { total: 1 }))
    await assertFails(updateDoc(doc(db('sup'), 'remitosCarga/r1'), { estado: 'liquidado' }))
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
    fecha: new Date(), tango: { estado: 'pendiente' }, cajaSesionId: '2026-09-09_caja1_1', ...extra,
  })
  const cobranza = (extra = {}) => ({
    origen: 'caja', plantaId: 'torcuato', registradoPor: { uid: 'caja1', nombre: 'Caja' },
    clienteId: 'cli', clienteNombre: 'Cliente SA', importe: 50000,
    formaPago: 'contado_efectivo', fecha: new Date(), ...extra,
  })

  // Auditoría 2026-09-22: lo del server (factura, anulación, salida, entrega, Tango) no nace con la venta.
  test('la venta de ventanilla NO nace facturada, anulada, entregada, salida ni con Tango confirmado', async () => {
    await seedCaja()
    await sembrarSesionAbierta('caja1')
    for (const extra of [
      { factura: { estado: 'emitida' } },
      { anulacion: { estado: 'anulada' } },
      { envioMail: { estado: 'enviado' } },
      { salida: { uid: 'caja1', nombre: 'Caja', hora: new Date() } },
      { entregadoPor: { uid: 'caja1', nombre: 'Caja', hora: new Date() } },
      { tango: { estado: 'confirmado' } },
      { total: -5 },
      { fecha: new Date(Date.now() - 8 * 24 * 3600 * 1000) },
    ]) {
      await assertFails(setDoc(doc(db('caja1'), 'ventasVentanilla/v1'), venta(extra)))
    }
    await assertSucceeds(setDoc(doc(db('caja1'), 'ventasVentanilla/v1'), venta({ tango: { estado: 'pendiente' } })))
  })

  test('caja crea una venta de ventanilla en su planta', async () => {
    await seedCaja()
    await sembrarSesionAbierta('caja1')
    await assertSucceeds(setDoc(doc(db('caja1'), 'ventasVentanilla/v1'), venta()))
  })

  test('la venta lleva el turno de caja ABIERTO del propio cajero (rendición de fondos, 2026-09-14): sin turno, con el de otro cajero, con uno cerrado o inexistente no', async () => {
    await seedCaja()
    await seedCaja('caja2')
    await sembrarSesionAbierta('caja1')
    await sembrarSesionAbierta('caja2')
    await seed((d) => setDoc(doc(d, 'cajaSesiones/2026-09-08_caja1_1'), { plantaId: 'torcuato', cajero: { uid: 'caja1', nombre: 'C' }, fecha: '2026-09-08', numero: 1, estado: 'cerrada', abiertaEn: new Date(), fondoInicial: 0, fondoInicialDe: null, cerradaEn: new Date(), rendicionId: '2026-09-08_caja1_1' }))
    const { cajaSesionId, ...sinTurno } = venta()
    await assertFails(setDoc(doc(db('caja1'), 'ventasVentanilla/v1'), sinTurno))
    await assertFails(setDoc(doc(db('caja1'), 'ventasVentanilla/v1'), venta({ cajaSesionId: '2026-09-09_caja2_1' })))
    await assertFails(setDoc(doc(db('caja1'), 'ventasVentanilla/v1'), venta({ cajaSesionId: '2026-09-08_caja1_1' })))
    await assertFails(setDoc(doc(db('caja1'), 'ventasVentanilla/v1'), venta({ cajaSesionId: 'no-existe' })))
    await assertFails(setDoc(doc(db('caja1'), 'ventasVentanilla/v1'), venta({ cajaSesionId: 7 })))
    await assertSucceeds(setDoc(doc(db('caja1'), 'ventasVentanilla/v1'), venta()))
    await assertSucceeds(setDoc(doc(db('caja2'), 'ventasVentanilla/v2'), venta({ cajaId: 'caja2', cajaSesionId: '2026-09-09_caja2_1' })))
  })

  test('caja NO crea ventas de otra planta ni a nombre de otro', async () => {
    await seedCaja()
    await sembrarSesionAbierta('caja1')
    await assertFails(setDoc(doc(db('caja1'), 'ventasVentanilla/v1'), venta({ plantaId: 'merlo' })))
    await assertFails(setDoc(doc(db('caja1'), 'ventasVentanilla/v2'), venta({ cajaId: 'otro' })))
  })

  test('caja NO crea la venta ya entregada', async () => {
    await seedCaja()
    await sembrarSesionAbierta('caja1')
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

  test('caja YA NO registra la cobranza simple de mostrador (desde 2026-09-05 solo la completa, con imputaciones)', async () => {
    await seedCaja()
    await assertFails(setDoc(doc(db('caja1'), 'cobranzas/c1'), cobranza()))
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

  // ── Regreso del camión a planta (2026-09-13) ──
  // Lo marcan seguridad (lo ve entrar) o el propio chofer, el primero que toque.
  const regreso = (uid, nombre) => ({ regreso: { uid, nombre, hora: new Date() } })
  const salido = (extra = {}) => remito({ estado: 'salido', salida: { uid: 'seg1', nombre: 'Seguridad', hora: new Date() }, ...extra })

  test('seguridad marca el regreso de un camión que salió', async () => {
    await seedSeguridad()
    await seed((d) => setDoc(doc(d, 'remitosCarga/r1'), salido()))
    await assertSucceeds(updateDoc(doc(db('seg1'), 'remitosCarga/r1'), regreso('seg1', 'Seguridad')))
  })

  test('el chofer marca el regreso de SU camión, no el de otro', async () => {
    await seed((d) => setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'users/chof2'), { rol: 'chofer', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'remitosCarga/r1'), salido()))
    await assertFails(updateDoc(doc(db('chof2'), 'remitosCarga/r1'), regreso('chof2', 'Otro')))
    await assertSucceeds(updateDoc(doc(db('chof1'), 'remitosCarga/r1'), regreso('chof1', 'Chofer Uno')))
  })

  test('el regreso no se puede marcar dos veces: la hora de llegada no se corre', async () => {
    await seedSeguridad()
    await seed((d) => setDoc(doc(d, 'remitosCarga/r1'), salido(regreso('chof1', 'Chofer Uno'))))
    await assertFails(updateDoc(doc(db('seg1'), 'remitosCarga/r1'), regreso('seg1', 'Seguridad')))
  })

  test('el regreso no se marca antes de que el camión salga', async () => {
    await seedSeguridad()
    await seed((d) => setDoc(doc(d, 'remitosCarga/r1'), remito({ estado: 'entregado' })))
    await assertFails(updateDoc(doc(db('seg1'), 'remitosCarga/r1'), regreso('seg1', 'Seguridad')))
  })

  test('marcar el regreso no deja tocar nada más del remito ni firmarlo a nombre de otro', async () => {
    await seed((d) => setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'remitosCarga/r1'), salido()))
    // De paso items (el chofer no puede cambiar lo que dice que cargó).
    await assertFails(updateDoc(doc(db('chof1'), 'remitosCarga/r1'), { ...regreso('chof1', 'Chofer Uno'), items: [] }))
    // Ni cambiar el estado aprovechando el viaje.
    await assertFails(updateDoc(doc(db('chof1'), 'remitosCarga/r1'), { ...regreso('chof1', 'Chofer Uno'), estado: 'liquidado' }))
    // Ni marcarlo a nombre de otro.
    await assertFails(updateDoc(doc(db('chof1'), 'remitosCarga/r1'), regreso('seg1', 'Seguridad')))
  })

  test('muelle y caja NO marcan el regreso (es de seguridad o del chofer)', async () => {
    await seed((d) => setDoc(doc(d, 'users/mue1'), { rol: 'muelle', estado: 'activo', planta: 'torcuato' }))
    await seed((d) => setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' }))
    await seed((d) => setDoc(doc(d, 'remitosCarga/r1'), salido()))
    await assertFails(updateDoc(doc(db('mue1'), 'remitosCarga/r1'), regreso('mue1', 'Muelle')))
    await assertFails(updateDoc(doc(db('caja1'), 'remitosCarga/r1'), regreso('caja1', 'Caja')))
  })

  test('seguridad de otra planta NO marca el regreso', async () => {
    await seedSeguridad('seg9', 'merlo')
    await seed((d) => setDoc(doc(d, 'remitosCarga/r1'), salido()))
    await assertFails(updateDoc(doc(db('seg9'), 'remitosCarga/r1'), regreso('seg9', 'Seguridad Merlo')))
  })

  // ── Dársena del camión que volvió (2026-09-15) ──
  // El chofer estaciona directo en una boca para descargar y la elige entre las
  // libres; la app le muestra solo esas (muelleEstado), las reglas cuidan el dato.
  test('el chofer marca el regreso con la dársena, o la elige después, UNA vez', async () => {
    await seed((d) => setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'remitosCarga/r1'), salido()))
    // Regreso y dársena en el mismo toque.
    await assertSucceeds(updateDoc(doc(db('chof1'), 'remitosCarga/r1'), { regreso: { uid: 'chof1', nombre: 'Chofer Uno', hora: new Date(), darsena: 5 } }))
    // Ya elegida: no se cambia.
    await assertFails(updateDoc(doc(db('chof1'), 'remitosCarga/r1'), { 'regreso.darsena': 3 }))
    // Regreso marcado por seguridad en el portón, sin dársena: el chofer la elige después.
    await seed((d) => setDoc(doc(d, 'remitosCarga/r2'), salido(regreso('seg1', 'Seguridad'))))
    await assertSucceeds(updateDoc(doc(db('chof1'), 'remitosCarga/r2'), { 'regreso.darsena': 2 }))
  })

  test('elegir la dársena no corre la hora, no cambia el remito y no vale para otro chofer', async () => {
    await seed((d) => setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'users/chof2'), { rol: 'chofer', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'remitosCarga/r1'), salido(regreso('chof1', 'Chofer Uno'))))
    await assertFails(updateDoc(doc(db('chof2'), 'remitosCarga/r1'), { 'regreso.darsena': 1 }))
    await assertFails(updateDoc(doc(db('chof1'), 'remitosCarga/r1'), { 'regreso.darsena': 0 }))
    await assertFails(updateDoc(doc(db('chof1'), 'remitosCarga/r1'), { 'regreso.darsena': '5' }))
    await assertFails(updateDoc(doc(db('chof1'), 'remitosCarga/r1'), { 'regreso.darsena': 1, 'regreso.hora': new Date(0) }))
    await assertFails(updateDoc(doc(db('chof1'), 'remitosCarga/r1'), { 'regreso.darsena': 1, estado: 'liquidado' }))
    // Muelle y seguridad tampoco eligen la boca por él.
    await seedSeguridad()
    await assertFails(updateDoc(doc(db('seg1'), 'remitosCarga/r1'), { 'regreso.darsena': 1 }))
    await assertSucceeds(updateDoc(doc(db('chof1'), 'remitosCarga/r1'), { 'regreso.darsena': 1 }))
  })

  test('muelleEstado lo lee cualquier usuario real y no lo escribe nadie', async () => {
    await seed((d) => setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' }))
    await seed((d) => setDoc(doc(d, 'muelleEstado/torcuato'), { plantaId: 'torcuato', fecha: '2026-09-15', ocupadas: { 5: { tipo: 'carga', etiqueta: 'AB123CD' } } }))
    await assertSucceeds(getDoc(doc(db('chof1'), 'muelleEstado/torcuato')))
    await assertFails(updateDoc(doc(db('chof1'), 'muelleEstado/torcuato'), { ocupadas: {} }))
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

  test('el chofer YA NO registra la cobranza simple de calle (desde 2026-09-05 solo la completa, con imputaciones)', async () => {
    await seedChofer()
    await assertFails(setDoc(doc(db('chof1'), 'cobranzas/c1'), cobranzaCalle()))
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

  // Auditoría 2026-09-22: la anulación y el estado de Tango los escribe el server.
  test('el recibo NO nace anulado, con Tango confirmado ni fechado hace más de una semana', async () => {
    await seedSupervisor()
    await assertFails(setDoc(doc(db('sup'), 'cobranzas/c1'), cobranzaSup({ anulacion: { estado: 'anulada' } })))
    await assertFails(setDoc(doc(db('sup'), 'cobranzas/c1'), cobranzaSup({ tango: { estado: 'confirmado', reciboNumero: 'X0001' } })))
    await assertFails(setDoc(doc(db('sup'), 'cobranzas/c1'), cobranzaSup({ fecha: new Date(Date.now() - 8 * 24 * 3600 * 1000) })))
    await assertSucceeds(setDoc(doc(db('sup'), 'cobranzas/c2'), cobranzaSup({ tango: { estado: 'pendiente' } })))
  })

  test('pago a cuenta (2026-09-08): sin facturas imputadas solo si aCuenta > 0; aCuenta, si viene, es un número positivo', async () => {
    await seedSupervisor()
    await assertSucceeds(setDoc(doc(db('sup'), 'cobranzas/c1'), cobranzaSup({ aCuenta: 5000 })))
    await assertSucceeds(setDoc(doc(db('sup'), 'cobranzas/c2'), cobranzaSup({ imputaciones: [], aCuenta: 45000.5 })))
    await assertFails(setDoc(doc(db('sup'), 'cobranzas/c3'), cobranzaSup({ imputaciones: [] })))
    await assertFails(setDoc(doc(db('sup'), 'cobranzas/c4'), cobranzaSup({ imputaciones: [], aCuenta: 0 })))
    await assertFails(setDoc(doc(db('sup'), 'cobranzas/c5'), cobranzaSup({ aCuenta: '5000' })))
    await assertFails(setDoc(doc(db('sup'), 'cobranzas/c6'), cobranzaSup({ aCuenta: -1 })))
  })

  test('el super_admin también crea una cobranza de supervisor a su nombre (la pantalla lo deja entrar)', async () => {
    await seed((d) => setDoc(doc(d, 'users/admin1'), { rol: 'super_admin', estado: 'activo' }))
    await assertSucceeds(setDoc(doc(db('admin1'), 'cobranzas/c1'), cobranzaSup({ registradoPor: { uid: 'admin1', nombre: 'Admin' } })))
    await assertFails(setDoc(doc(db('admin1'), 'cobranzas/c2'), cobranzaSup()))   // a nombre de otro, no
  })

  test('caja crea la cobranza completa en su planta (origen caja) y el chofer en la calle (origen cobrador); no cruzados', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
      await setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' })
    })
    await sembrarSesionAbierta('caja1')
    await sembrarSesionAbierta('caja2')
    // Mostrador: además del rol y la planta, el turno de caja ABIERTO del propio cajero (2026-09-14).
    await assertFails(setDoc(doc(db('caja1'), 'cobranzas/c1'), cobranzaSup({ origen: 'caja', plantaId: 'torcuato', registradoPor: { uid: 'caja1', nombre: 'Caja' } })))
    await assertFails(setDoc(doc(db('caja1'), 'cobranzas/c1'), cobranzaSup({ origen: 'caja', plantaId: 'torcuato', registradoPor: { uid: 'caja1', nombre: 'Caja' }, cajaSesionId: '2026-09-09_caja2_1' })))
    await assertSucceeds(setDoc(doc(db('caja1'), 'cobranzas/c1'), cobranzaSup({ origen: 'caja', plantaId: 'torcuato', registradoPor: { uid: 'caja1', nombre: 'Caja' }, cajaSesionId: '2026-09-09_caja1_1' })))
    await assertFails(setDoc(doc(db('caja1'), 'cobranzas/c2'), cobranzaSup({ origen: 'caja', plantaId: 'merlo', registradoPor: { uid: 'caja1', nombre: 'Caja' }, cajaSesionId: '2026-09-09_caja1_1' })))
    await assertFails(setDoc(doc(db('caja1'), 'cobranzas/c3'), cobranzaSup({ origen: 'supervisor', registradoPor: { uid: 'caja1', nombre: 'Caja' } })))
    await assertSucceeds(setDoc(doc(db('chof1'), 'cobranzas/c4'), cobranzaSup({ origen: 'cobrador', registradoPor: { uid: 'chof1', nombre: 'Chofer' } })))
    await assertFails(setDoc(doc(db('chof1'), 'cobranzas/c5'), cobranzaSup({ origen: 'caja', plantaId: 'torcuato', registradoPor: { uid: 'chof1', nombre: 'Chofer' } })))
  })

  test('caja y chofer leen saldosTango y avanzan el contador de recibos', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
      await setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' })
      await setDoc(doc(d, 'saldosTango/cli'), { idGva14: 1, codigoTango: 'FC.1', empresa: 'redonhielo', razonSocial: 'Cliente', comprobantes: [], saldoTotal: 0 })
      await setDoc(doc(d, 'config/reciboSupervisorCounter'), { next: 41 })
    })
    await assertSucceeds(getDoc(doc(db('caja1'), 'saldosTango/cli')))
    await assertSucceeds(getDoc(doc(db('chof1'), 'saldosTango/cli')))
    await assertSucceeds(updateDoc(doc(db('caja1'), 'config/reciboSupervisorCounter'), { next: 61 }))
    await assertSucceeds(updateDoc(doc(db('chof1'), 'config/reciboSupervisorCounter'), { next: 81 }))
    await assertFails(updateDoc(doc(db('chof1'), 'config/reciboSupervisorCounter'), { next: 10 }))
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

  test('el supervisor lee su cobranza y también las de otros (Reparto en vivo, 2026-09-05); sigue inmutable', async () => {
    await seedSupervisor()
    await seed(async (d) => {
      await setDoc(doc(d, 'cobranzas/mia'), cobranzaSup())
      await setDoc(doc(d, 'cobranzas/ajena'), cobranzaSup({ registradoPor: { uid: 'otro', nombre: 'Otro' } }))
    })
    await assertSucceeds(getDoc(doc(db('sup'), 'cobranzas/mia')))
    await assertSucceeds(getDoc(doc(db('sup'), 'cobranzas/ajena')))
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

  // 2026-09-08: el supervisor (vende desde su depósito) y caja (factura X de
  // promo en ventanilla) también numeran; sin esto la venta salía sin número
  // y Tango la rechazaba. Muelle/seguridad no venden.
  test('supervisor y caja avanzan next igual que el chofer; muelle no', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/sup1'), { rol: 'supervisor', estado: 'activo' })
      await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
      await setDoc(doc(d, 'users/mue1'), { rol: 'muelle', estado: 'activo', planta: 'torcuato' })
      await setDoc(doc(d, 'config/numeracionInterna_facturaX'), { next: 162, puntoVenta: 1104 })
    })
    await assertSucceeds(updateDoc(doc(db('sup1'), 'config/numeracionInterna_facturaX'), { next: 182 }))
    await assertSucceeds(updateDoc(doc(db('caja1'), 'config/numeracionInterna_facturaX'), { next: 183 }))
    await assertFails(updateDoc(doc(db('caja1'), 'config/numeracionInterna_facturaX'), { next: 183, puntoVenta: 1 }))
    await assertFails(updateDoc(doc(db('mue1'), 'config/numeracionInterna_facturaX'), { next: 184 }))
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

  // La hora de la asignación (2026-09-13) viaja con el mismo update, para poder
  // medir cuánto estuvo ocupada la boca sin pedirle nada al muelle.
  test('la darsena puede venir con su hora, y esa hora tiene que ser un timestamp', async () => {
    await seed((d) => setDoc(doc(d, 'users/mue1'), { rol: 'muelle', estado: 'activo', planta: 'torcuato' }))
    await seed((d) => setDoc(doc(d, 'remitosCarga/r1'), remito()))
    await assertSucceeds(updateDoc(doc(db('mue1'), 'remitosCarga/r1'), { darsena: 3, darsenaAsignadaEn: new Date() }))
    await assertFails(updateDoc(doc(db('mue1'), 'remitosCarga/r1'), { darsena: 4, darsenaAsignadaEn: 'ahora' }))
    // Y sigue sin poder colarse ningún otro campo en el mismo update.
    await assertFails(updateDoc(doc(db('mue1'), 'remitosCarga/r1'), { darsena: 4, darsenaAsignadaEn: new Date(), estado: 'entregado' }))
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
    turno: 7, turnoEstado: 'en_espera', fecha: new Date(), cajaSesionId: '2026-09-09_caja1_1', ...extra,
  })

  test('caja NO crea una venta sin turno ni con turnoEstado distinto de en_espera', async () => {
    await seedCaja()
    await sembrarSesionAbierta('caja1')
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

  test('un cliente NO lee su propio saldo (por ahora); el chofer sí (cobranza completa en la calle, 2026-09-05)', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/cli'), cliente())
      await setDoc(doc(d, 'users/ch'), { rol: 'chofer', estado: 'activo' })
      await setDoc(doc(d, 'saldosTango/cli'), saldo)
    })
    await assertFails(getDoc(doc(db('cli'), 'saldosTango/cli')))
    await assertSucceeds(getDoc(doc(db('ch'), 'saldosTango/cli')))
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

// ── clientesIndex: búsqueda liviana de clientes (2026-09-10) ──────────────────
describe('clientesIndex — índice liviano de clientes', () => {
  const idx = { razonSocial: 'ALGAR', cuit: '30661788409', codigos: ['PA.003'], sucursales: [], direccion: 'Mitre 596', localidad: 'SAN MIGUEL', estado: 'activo', vinculadoTango: true }
  test('chofer, caja y supervisor leen; el cliente no; nadie escribe por reglas', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/ch'), { rol: 'chofer', estado: 'activo' })
      await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'dt' })
      await setDoc(doc(d, 'users/sup'), { rol: 'supervisor', estado: 'activo' })
      await setDoc(doc(d, 'users/cli'), cliente())
      await setDoc(doc(d, 'clientesIndex/cli'), idx)
    })
    await assertSucceeds(getDoc(doc(db('ch'), 'clientesIndex/cli')))
    await assertSucceeds(getDoc(doc(db('caja1'), 'clientesIndex/cli')))
    await assertSucceeds(getDoc(doc(db('sup'), 'clientesIndex/cli')))
    await assertFails(getDoc(doc(db('cli'), 'clientesIndex/cli')))
    await assertFails(setDoc(doc(db('sup'), 'clientesIndex/otro'), idx))
    await assertFails(updateDoc(doc(db('ch'), 'clientesIndex/cli'), { estado: 'inactivo' }))
    await assertFails(deleteDoc(doc(db('sup'), 'clientesIndex/cli')))
  })
})

// ── tangoComprobantes / tangoComprobanteDetalle: facturas y remitos de Tango (2026-09-09) ──
describe('tangoComprobantes — facturas y remitos de Tango leídos por el bridge', () => {
  const indice = { empresa: 'redonhielo', codigo: 'PA.003', razonSocial: 'ALGAR', facturas: { FAC_A0010100282787: { tipo: 'FAC', numero: 'A0010100282787', fecha: '2026-09-02', importe: 84216, estado: 'PEN', remitos: ['R0000100482053'], h: 'x' } }, remitos: {} }
  const detalle = { empresa: 'redonhielo', tipo: 'FAC', numero: 'A0010100282787', codigo: 'PA.003', renglones: [], cae: '86351131069060' }
  const seedTodos = () => seed(async (d) => {
    await setDoc(doc(d, 'users/bridge1'), { tangoBridge: true })
    await setDoc(doc(d, 'users/sup'), { rol: 'supervisor', estado: 'activo' })
    await setDoc(doc(d, 'users/tes'), { rol: 'tesoreria', estado: 'activo' })
    await setDoc(doc(d, 'users/ch'), { rol: 'chofer', estado: 'activo' })
    await setDoc(doc(d, 'users/cli'), cliente())
  })

  test('el bridge crea y actualiza el índice y el detalle; nadie borra', async () => {
    await seedTodos()
    await assertSucceeds(setDoc(doc(db('bridge1'), 'tangoComprobantes/redonhielo_PA.003'), indice))
    await assertSucceeds(setDoc(doc(db('bridge1'), 'tangoComprobantes/redonhielo_PA.003'), { facturas: { FAC_A0010100282787: { estado: 'CAN' } } }, { merge: true }))
    await assertSucceeds(setDoc(doc(db('bridge1'), 'tangoComprobanteDetalle/redonhielo_FAC_A0010100282787'), detalle))
    await assertFails(deleteDoc(doc(db('bridge1'), 'tangoComprobantes/redonhielo_PA.003')))
    await assertFails(deleteDoc(doc(db('bridge1'), 'tangoComprobanteDetalle/redonhielo_FAC_A0010100282787')))
  })

  test('supervisor, tesorería y chofer leen; el cliente no; nadie más escribe', async () => {
    await seedTodos()
    await seed(async (d) => {
      await setDoc(doc(d, 'tangoComprobantes/redonhielo_PA.003'), indice)
      await setDoc(doc(d, 'tangoComprobanteDetalle/redonhielo_FAC_A0010100282787'), detalle)
    })
    await assertSucceeds(getDoc(doc(db('sup'), 'tangoComprobantes/redonhielo_PA.003')))
    await assertSucceeds(getDoc(doc(db('tes'), 'tangoComprobanteDetalle/redonhielo_FAC_A0010100282787')))
    await assertSucceeds(getDoc(doc(db('ch'), 'tangoComprobantes/redonhielo_PA.003')))
    await assertFails(getDoc(doc(db('cli'), 'tangoComprobantes/redonhielo_PA.003')))
    await assertFails(getDoc(doc(db('bridge1'), 'tangoComprobantes/redonhielo_PA.003')))
    await assertFails(setDoc(doc(db('sup'), 'tangoComprobantes/redonhielo_X'), indice))
    await assertFails(updateDoc(doc(db('tes'), 'tangoComprobanteDetalle/redonhielo_FAC_A0010100282787'), { cae: '1' }))
  })

  test('enviosComprobantes: lo lee facturación y quien lo mandó; nadie escribe por reglas', async () => {
    await seedTodos()
    await seed(async (d) => {
      await setDoc(doc(d, 'users/fac'), { rol: 'facturacion', estado: 'activo' })
      await setDoc(doc(d, 'enviosComprobantes/e1'), { para: 'x@y.com', comprobante: { tipo: 'FAC', numero: 'A1' }, enviadoPor: { uid: 'sup', nombre: 'S' }, estado: 'enviado' })
    })
    await assertSucceeds(getDoc(doc(db('fac'), 'enviosComprobantes/e1')))
    await assertSucceeds(getDoc(doc(db('sup'), 'enviosComprobantes/e1')))
    await assertFails(getDoc(doc(db('ch'), 'enviosComprobantes/e1')))
    await assertFails(getDoc(doc(db('cli'), 'enviosComprobantes/e1')))
    await assertFails(setDoc(doc(db('sup'), 'enviosComprobantes/e2'), { para: 'a@b.com', enviadoPor: { uid: 'sup' } }))
    await assertFails(deleteDoc(doc(db('fac'), 'enviosComprobantes/e1')))
  })

  test('mailsSalientes: lo leen facturación, gerencia y super_admin; nadie escribe por reglas', async () => {
    await seedTodos()
    await seed(async (d) => {
      await setDoc(doc(d, 'users/fac'), { rol: 'facturacion', estado: 'activo' })
      await setDoc(doc(d, 'users/gg'), { rol: 'gerente_general', estado: 'activo' })
      await setDoc(doc(d, 'users/sa'), { rol: 'super_admin', estado: 'activo' })
      await setDoc(doc(d, 'mailsSalientes/resend_abc'), { proveedor: 'resend', mailId: 'abc', para: ['x@y.com'], asunto: 'Factura', tipo: 'comprobante', adjuntos: 1, estado: 'aceptado' })
    })
    await assertSucceeds(getDoc(doc(db('fac'), 'mailsSalientes/resend_abc')))
    await assertSucceeds(getDoc(doc(db('gg'), 'mailsSalientes/resend_abc')))
    await assertSucceeds(getDoc(doc(db('sa'), 'mailsSalientes/resend_abc')))
    await assertFails(getDoc(doc(db('sup'), 'mailsSalientes/resend_abc')))
    await assertFails(getDoc(doc(db('tes'), 'mailsSalientes/resend_abc')))
    await assertFails(getDoc(doc(db('ch'), 'mailsSalientes/resend_abc')))
    await assertFails(getDoc(doc(db('cli'), 'mailsSalientes/resend_abc')))
    await assertFails(updateDoc(doc(db('fac'), 'mailsSalientes/resend_abc'), { estado: 'entregado' }))
    await assertFails(setDoc(doc(db('sa'), 'mailsSalientes/resend_zzz'), { proveedor: 'resend', estado: 'aceptado' }))
    await assertFails(deleteDoc(doc(db('sa'), 'mailsSalientes/resend_abc')))
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

// ── users.rolesExtra: roles adicionales de expedición (2026-09-07) ───────────
// Lucas es de logística y cubre caja: rol 'logistica' + rolesExtra ['caja'] +
// planta. hasRol() en las reglas mira los dos; solo super_admin los asigna.
describe('users — roles adicionales (rolesExtra)', () => {
  const ventaVentanilla = (extra = {}) => ({
    plantaId: 'torcuato', canal: 'contado', cajaId: 'luc', cajaNombre: 'Lucas',
    clienteNombre: 'Ocasional', items: [{ productoId: 'bolsa_3kg', nombre: 'Hielo 3kg', cantidad: 1, precioUnitario: 100 }],
    total: 100, formaPago: 'contado_efectivo', estado: 'pendiente_entrega', turno: 1, turnoEstado: 'en_espera',
    fecha: new Date(), cajaSesionId: '2026-09-09_luc_1', ...extra,
  })
  const seedLucas = (extra = {}) =>
    seed((d) => setDoc(doc(d, 'users/luc'), { rol: 'logistica', estado: 'activo', rolesExtra: ['caja'], planta: 'torcuato', ...extra }))
  // Sin planta: el doc se siembra sin el campo (deleteField no vale en un setDoc sin merge).
  const seedLucasSinPlanta = () =>
    seed((d) => setDoc(doc(d, 'users/luc'), { rol: 'logistica', estado: 'activo', rolesExtra: ['caja'] }))

  test('logística con rolesExtra caja vende por ventanilla en SU planta, no en otra', async () => {
    await seedLucas()
    await sembrarSesionAbierta('luc')
    await assertSucceeds(setDoc(doc(db('luc'), 'ventasVentanilla/v1'), ventaVentanilla()))
    await assertFails(setDoc(doc(db('luc'), 'ventasVentanilla/v2'), ventaVentanilla({ plantaId: 'merlo' })))
    await assertSucceeds(getDoc(doc(db('luc'), 'ventasVentanilla/v1')))
  })

  test('logística SIN rolesExtra no vende por ventanilla', async () => {
    await seed((d) => setDoc(doc(d, 'users/log1'), { rol: 'logistica', estado: 'activo', planta: 'torcuato' }))
    await assertFails(setDoc(doc(db('log1'), 'ventasVentanilla/v1'), ventaVentanilla({ cajaId: 'log1' })))
  })

  test('rolesExtra sin planta no habilita nada', async () => {
    await seedLucasSinPlanta()
    await assertFails(setDoc(doc(db('luc'), 'ventasVentanilla/v1'), ventaVentanilla()))
  })

  test('nadie se auto-asigna rolesExtra ni planta; el super_admin sí', async () => {
    await seed((d) => setDoc(doc(d, 'users/log1'), { rol: 'logistica', estado: 'activo', nombre: 'L' }))
    await assertFails(updateDoc(doc(db('log1'), 'users/log1'), { rolesExtra: ['caja'], planta: 'torcuato' }))
    await assertFails(updateDoc(doc(db('log1'), 'users/log1'), { rolesExtra: ['caja'] }))
    await assertFails(updateDoc(doc(db('log1'), 'users/log1'), { planta: 'merlo' }))
    await assertSucceeds(updateDoc(doc(db('log1'), 'users/log1'), { nombre: 'Lucas' }))
    await seed((d) => setDoc(doc(d, 'users/sa'), { rol: 'super_admin', estado: 'activo' }))
    await assertSucceeds(updateDoc(doc(db('sa'), 'users/log1'), { rolesExtra: ['caja'], planta: 'torcuato' }))
  })
})

// ── rolesExtra de OFICINA (2026-09-13) ───────────────────────────────────────
// Hasta el 12/09 solo caja / muelle / seguridad preguntaban por el conjunto de
// roles; el resto miraba solo el principal, así que un rol adicional abría el
// menú pero no los datos. Ahora todo permiso funcional va por hasRol/hasAlguno.
// Caso que lo motivó: Lucas es de logística y además hace facturación.
describe('users — roles adicionales de oficina', () => {
  const facturaArchivada = (extra = {}) => ({
    empresa: 'redonhielo', clave: '0001-00000001', storagePath: 'facturas/redonhielo/x.pdf',
    subidoPor: { uid: 'luc', nombre: 'Lucas' }, ...extra,
  })
  const seedLucas = (rolesExtra) =>
    seed((d) => setDoc(doc(d, 'users/luc'), { rol: 'logistica', estado: 'activo', nombre: 'Lucas', ...(rolesExtra ? { rolesExtra } : {}) }))
  const seedSuperAdmin = () => seed((d) => setDoc(doc(d, 'users/sa'), { rol: 'super_admin', estado: 'activo' }))

  test('logística SIN el rol adicional no archiva una factura (Recupero de facturas)', async () => {
    await seedLucas()
    await assertFails(setDoc(doc(db('luc'), 'facturasArchivadas/redonhielo-0001-00000001'), facturaArchivada()))
  })

  test('logística CON facturación como rol adicional sí archiva la factura', async () => {
    await seedLucas(['facturacion'])
    await assertSucceeds(setDoc(doc(db('luc'), 'facturasArchivadas/redonhielo-0001-00000001'), facturaArchivada()))
  })

  test('facturación como rol adicional deja asignar el código de cliente', async () => {
    await seedLucas(['facturacion'])
    await seed((d) => setDoc(doc(d, 'users/cli'), cliente()))
    await assertSucceeds(updateDoc(doc(db('luc'), 'users/cli'), { codigoCliente: 'C-42' }))
  })

  // Lo importante no es lo que el rol adicional concede, sino lo que NO.
  test('el rol adicional concede SOLO lo suyo: ni ventanilla ni lo del super_admin', async () => {
    await seedLucas(['facturacion'])
    // Ventanilla es de caja, y Lucas no la tiene en este escenario.
    await assertFails(setDoc(doc(db('luc'), 'ventasVentanilla/v1'), {
      plantaId: 'torcuato', canal: 'contado', cajaId: 'luc', cajaNombre: 'Lucas',
      clienteNombre: 'Ocasional', items: [{ productoId: 'b', nombre: 'Hielo', cantidad: 1, precioUnitario: 100 }],
      total: 100, formaPago: 'contado_efectivo', estado: 'pendiente_entrega', turno: 1,
      turnoEstado: 'en_espera', fecha: new Date(),
    }))
    // El índice de login del staff lo escribe solo el super_admin.
    await assertFails(setDoc(doc(db('luc'), 'staffDniIndex/30111222'), { uid: 'luc' }))
  })

  test('un rol adicional NUNCA convierte a nadie en super_admin', async () => {
    // Aunque alguien lograra escribirlo en el documento, esSuperAdmin() mira el
    // rol principal: el índice de login del staff le sigue estando vedado.
    await seed((d) => setDoc(doc(d, 'users/luc'), { rol: 'logistica', estado: 'activo', rolesExtra: ['super_admin'] }))
    await assertFails(setDoc(doc(db('luc'), 'staffDniIndex/30111222'), { uid: 'luc' }))
  })

  test('el super_admin NO puede otorgar super_admin ni cliente como rol adicional', async () => {
    await seedSuperAdmin()
    await seedLucas()
    await assertFails(updateDoc(doc(db('sa'), 'users/luc'), { rolesExtra: ['super_admin'] }))
    await assertFails(updateDoc(doc(db('sa'), 'users/luc'), { rolesExtra: ['cliente'] }))
    await assertFails(updateDoc(doc(db('sa'), 'users/luc'), { rolesExtra: ['facturacion', 'super_admin'] }))
    await assertFails(updateDoc(doc(db('sa'), 'users/luc'), { rolesExtra: ['inventado'] }))
  })

  test('los roles de planta exigen planta; los de oficina no', async () => {
    await seedSuperAdmin()
    await seedLucas()
    // caja / muelle / seguridad operan en UNA planta: sin ella las reglas de
    // expedición rechazan todo y el usuario vería pantallas que no funcionan.
    await assertFails(updateDoc(doc(db('sa'), 'users/luc'), { rolesExtra: ['caja'] }))
    await assertSucceeds(updateDoc(doc(db('sa'), 'users/luc'), { rolesExtra: ['caja'], planta: 'torcuato' }))
    // Facturación no tiene planta.
    await seed((d) => setDoc(doc(d, 'users/luc2'), { rol: 'logistica', estado: 'activo', nombre: 'L2' }))
    await assertSucceeds(updateDoc(doc(db('sa'), 'users/luc2'), { rolesExtra: ['facturacion'] }))
  })

  test('el usuario sigue sin poder auto-asignarse un rol adicional de oficina', async () => {
    await seedLucas()
    await assertFails(updateDoc(doc(db('luc'), 'users/luc'), { rolesExtra: ['facturacion'] }))
  })
})

// ── supervisor: service y comodato desde la calle (2026-09-07) ───────────────
describe('supervisor: service de heladera y comodato desde la ficha del cliente', () => {
  const seedSupervisor = (uid = 'sup1') => seed((d) => setDoc(doc(d, `users/${uid}`), { rol: 'supervisor', estado: 'activo' }))
  const heladeraEnComodato = (extra = {}) => ({
    codigoInterno: 'HL-001', numeroSerie: 'S-1', modelo: 'Slim 300', estado: 'en_comodato',
    clienteAsignadoId: 'cli', clienteAsignadoNombre: 'Cliente de Prueba SA', historialAcciones: [],
    comodatoNumero: 10, comodatoFirmadoEl: new Date('2025-01-01'), comodatoVenceEl: new Date('2026-01-01'), ...extra,
  })
  const ticketSup = (extra = {}) => ({
    numero: 1, heladeraId: 'h1', heladeraCodigo: 'HL-001', clientId: 'cli', clientName: 'Cliente de Prueba SA',
    motivoId: 'm1', motivoNombre: 'No enfría', requiereChofer: false, urgente: false,
    origen: 'supervisor', creadoPor: { uid: 'sup1', nombre: 'Super Uno' }, observacion: 'Hace ruido', fotoUrl: null,
    estado: 'abierto', asignadoA: null, historialAcciones: [], fechaPedido: new Date(), createdAt: new Date(), updatedAt: new Date(), ...extra,
  })
  const renovacion = (extra = {}) => ({
    heladeraId: 'h1', heladeraCodigo: 'HL-001', clientId: 'cli', clientName: 'Cliente de Prueba SA',
    tipo: 'renovacion', numero: 11, firmaDataUrl: 'data:image/png;base64,xx', firmanteNombre: 'Juan', firmanteCargo: 'Dueño',
    actor: { uid: 'sup1', nombre: 'Super Uno' }, fecha: new Date(), ...extra,
  })

  test('lee cualquier heladera (ficha del cliente y QR)', async () => {
    await seedSupervisor()
    await seed((d) => setDoc(doc(d, 'heladeras/h1'), heladeraEnComodato({ clienteAsignadoId: 'otro' })))
    await assertSucceeds(getDoc(doc(db('sup1'), 'heladeras/h1')))
  })

  test('crea un ticket para una heladera del cliente, con origen supervisor y a su nombre; el contador avanza de a 1', async () => {
    await seedSupervisor()
    await seed(async (d) => {
      await setDoc(doc(d, 'heladeras/h1'), heladeraEnComodato())
      await setDoc(doc(d, 'config/ticketServicioCounter'), { next: 5 })
    })
    await assertSucceeds(setDoc(doc(db('sup1'), 'ticketsServicio/t1'), ticketSup()))
    await assertSucceeds(updateDoc(doc(db('sup1'), 'config/ticketServicioCounter'), { next: 6 }))
    await assertFails(updateDoc(doc(db('sup1'), 'config/ticketServicioCounter'), { next: 8 }))
    // Línea de historial en la heladera (crearTicket) — nada más.
    await assertSucceeds(updateDoc(doc(db('sup1'), 'heladeras/h1'), { historialAcciones: [{ accion: 'service_abierto' }], updatedAt: new Date() }))
    // Lee el ticket que creó.
    await assertSucceeds(getDoc(doc(db('sup1'), 'ticketsServicio/t1')))
  })

  test('NO crea tickets de heladeras ajenas al cliente, con otro origen, a nombre de otro, ni asignados', async () => {
    await seedSupervisor()
    await seed((d) => setDoc(doc(d, 'heladeras/h1'), heladeraEnComodato({ clienteAsignadoId: 'otro-cliente' })))
    await assertFails(setDoc(doc(db('sup1'), 'ticketsServicio/t1'), ticketSup()))
    await seed((d) => setDoc(doc(d, 'heladeras/h1'), heladeraEnComodato()))
    await assertFails(setDoc(doc(db('sup1'), 'ticketsServicio/t2'), ticketSup({ origen: 'staff' })))
    await assertFails(setDoc(doc(db('sup1'), 'ticketsServicio/t3'), ticketSup({ creadoPor: { uid: 'sup2', nombre: 'Otro' } })))
    await assertFails(setDoc(doc(db('sup1'), 'ticketsServicio/t4'), ticketSup({ asignadoA: { tipo: 'tecnico', uid: 'tec', nombre: 'T' } })))
    await assertFails(setDoc(doc(db('sup1'), 'ticketsServicio/t5'), ticketSup({ estado: 'cerrado' })))
  })

  test('NO lee tickets de otro supervisor ni los edita', async () => {
    await seedSupervisor()
    await seed((d) => setDoc(doc(d, 'ticketsServicio/t1'), ticketSup({ creadoPor: { uid: 'sup2', nombre: 'Otro' } })))
    await assertFails(getDoc(doc(db('sup1'), 'ticketsServicio/t1')))
    await seed((d) => setDoc(doc(d, 'ticketsServicio/t2'), ticketSup()))
    await assertFails(updateDoc(doc(db('sup1'), 'ticketsServicio/t2'), { estado: 'cerrado' }))
  })

  test('renueva el comodato: vigencia nueva en la heladera, asignación tipo renovación firmada y contador +1', async () => {
    await seedSupervisor()
    await seed(async (d) => {
      await setDoc(doc(d, 'heladeras/h1'), heladeraEnComodato())
      await setDoc(doc(d, 'config/movimientoHeladeraCounter'), { next: 11 })
    })
    await assertSucceeds(updateDoc(doc(db('sup1'), 'heladeras/h1'), {
      comodatoNumero: 11, comodatoFirmadoEl: new Date(), comodatoVenceEl: new Date('2027-09-07'), comodatoAvisoEnviado: false,
      historialAcciones: [{ accion: 'comodato_renovado' }], updatedAt: new Date(),
    }))
    await assertSucceeds(setDoc(doc(db('sup1'), 'asignacionesHeladera/a1'), renovacion()))
    await assertSucceeds(updateDoc(doc(db('sup1'), 'config/movimientoHeladeraCounter'), { next: 12 }))
  })

  test('NO toca estado/cliente de la heladera, ni heladeras fuera de comodato, ni crea asignaciones/retiros', async () => {
    await seedSupervisor()
    await seed((d) => setDoc(doc(d, 'heladeras/h1'), heladeraEnComodato()))
    await assertFails(updateDoc(doc(db('sup1'), 'heladeras/h1'), { estado: 'disponible' }))
    await assertFails(updateDoc(doc(db('sup1'), 'heladeras/h1'), { clienteAsignadoId: 'otro', updatedAt: new Date() }))
    await assertFails(updateDoc(doc(db('sup1'), 'heladeras/h1'), { comodatoNumero: 11, comodatoFirmadoEl: new Date(), comodatoVenceEl: new Date(), estado: 'baja' }))
    await seed((d) => setDoc(doc(d, 'heladeras/h2'), heladeraEnComodato({ estado: 'disponible', clienteAsignadoId: null })))
    await assertFails(updateDoc(doc(db('sup1'), 'heladeras/h2'), { historialAcciones: [{ accion: 'x' }], updatedAt: new Date() }))
    await assertFails(setDoc(doc(db('sup1'), 'asignacionesHeladera/a1'), renovacion({ tipo: 'asignacion' })))
    await assertFails(setDoc(doc(db('sup1'), 'asignacionesHeladera/a2'), renovacion({ tipo: 'retiro' })))
    await assertFails(setDoc(doc(db('sup1'), 'asignacionesHeladera/a3'), renovacion({ actor: { uid: 'sup2', nombre: 'Otro' } })))
    await assertFails(setDoc(doc(db('sup1'), 'asignacionesHeladera/a4'), renovacion({ firmaDataUrl: '' })))
  })

  test('otros roles de calle (chofer, caja) no ganan nada con esto', async () => {
    await seed((d) => setDoc(doc(d, 'users/ch1'), { rol: 'chofer', estado: 'activo', email: 'ch@x.com' }))
    await seed((d) => setDoc(doc(d, 'heladeras/h1'), heladeraEnComodato()))
    await assertFails(getDoc(doc(db('ch1', 'ch@x.com'), 'heladeras/h1')))
    await assertFails(setDoc(doc(db('ch1', 'ch@x.com'), 'ticketsServicio/t1'), ticketSup({ creadoPor: { uid: 'ch1', nombre: 'Ch' } })))
  })
})

// ── facturasArchivadas (2026-09-07) ─────────────────────────────────────────
describe('facturasArchivadas: facturas de Tango archivadas por administración', () => {
  const factura = (extra = {}) => ({
    clave: 'A0010100173697', empresa: 'redonhielo', letra: 'A', puntoVenta: 101, numero: 173697, fecha: '2026-07-14',
    total: 1250000, cuitCliente: '30-71234567-8', razonSocial: 'Cliente de Prueba SA',
    storagePath: 'facturas/redonhielo/A0010100173697.pdf', subidoPor: { uid: 'fac1', nombre: 'Facturación' }, subidoEn: new Date(), ...extra,
  })
  const ID = 'redonhielo-A0010100173697'

  test('facturación y super_admin archivan con el id = empresa-clave; el supervisor y caja leen; el cliente no', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/fac1'), { rol: 'facturacion', estado: 'activo' })
      await setDoc(doc(d, 'users/sa'), { rol: 'super_admin', estado: 'activo' })
      await setDoc(doc(d, 'users/sup1'), { rol: 'supervisor', estado: 'activo' })
      await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
      await setDoc(doc(d, 'users/cli'), cliente())
    })
    await assertSucceeds(setDoc(doc(db('fac1'), `facturasArchivadas/${ID}`), factura()))
    await assertSucceeds(setDoc(doc(db('sa'), 'facturasArchivadas/rolito-A0000100000031'), factura({ empresa: 'rolito', clave: 'A0000100000031', subidoPor: { uid: 'sa', nombre: 'Ariel' } })))
    await assertSucceeds(getDoc(doc(db('sup1'), `facturasArchivadas/${ID}`)))
    await assertSucceeds(getDoc(doc(db('caja1'), `facturasArchivadas/${ID}`)))
    await assertFails(getDoc(doc(db('cli', 'c@x.com'), `facturasArchivadas/${ID}`)))
  })

  test('NO archivan: supervisor/caja, id que no coincide, a nombre de otro, empresa inválida; nadie borra', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/fac1'), { rol: 'facturacion', estado: 'activo' })
      await setDoc(doc(d, 'users/sup1'), { rol: 'supervisor', estado: 'activo' })
      await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
      await setDoc(doc(d, `facturasArchivadas/${ID}`), factura())
    })
    await assertFails(setDoc(doc(db('sup1'), 'facturasArchivadas/redonhielo-B0010100000001'), factura({ clave: 'B0010100000001', subidoPor: { uid: 'sup1', nombre: 'S' } })))
    await assertFails(setDoc(doc(db('caja1'), 'facturasArchivadas/redonhielo-B0010100000001'), factura({ clave: 'B0010100000001', subidoPor: { uid: 'caja1', nombre: 'C' } })))
    await assertFails(setDoc(doc(db('fac1'), 'facturasArchivadas/otro-id'), factura()))
    await assertFails(setDoc(doc(db('fac1'), 'facturasArchivadas/redonhielo-B0010100000001'), factura({ clave: 'B0010100000001', subidoPor: { uid: 'sa', nombre: 'X' } })))
    await assertFails(setDoc(doc(db('fac1'), 'facturasArchivadas/otra-B0010100000001'), factura({ empresa: 'otra', clave: 'B0010100000001' })))
    await assertFails(deleteDoc(doc(db('fac1'), `facturasArchivadas/${ID}`)))
  })

  test('el supervisor lee ventasVentanilla (regenera la factura del mostrador desde la ficha)', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/sup1'), { rol: 'supervisor', estado: 'activo' })
      await setDoc(doc(d, 'ventasVentanilla/v1'), { plantaId: 'torcuato', canal: 'contado', total: 100, items: [], factura: { estado: 'emitida', puntoVenta: 1104, numero: 1 } })
    })
    await assertSucceeds(getDoc(doc(db('sup1'), 'ventasVentanilla/v1')))
  })
})

// ── supervisor: pedido y visita a logística, historial (2026-09-07) ─────────
describe('supervisor: pedido / visita a logística e historial del cliente', () => {
  const seedSup = () => seed(async (d) => {
    await setDoc(doc(d, 'users/sup1'), { rol: 'supervisor', estado: 'activo' })
    await setDoc(doc(d, 'users/cli'), cliente())
  })
  const pedidoSup = (extra = {}) => ({
    clientId: 'cli', clientEmail: 'c@x.com', clientName: 'Cliente de Prueba SA', clientAddress: 'Calle 1', clientPhone: '',
    products: [{ name: 'Hielo 10kg', quantity: 5, productoId: 'bolsa_10kg' }], status: 'pendiente', date: new Date(), driverId: null,
    notes: 'dejar en el fondo', origenSupervisor: { uid: 'sup1', nombre: 'Super Uno' }, createdAt: new Date(), updatedAt: new Date(), ...extra,
  })
  const visitaSup = (extra = {}) => ({
    clientId: 'cli', clientName: 'Cliente de Prueba SA', clientAddress: 'Calle 1', clientPhone: '', fecha: new Date(),
    driverId: null, status: 'pendiente', notas: 'quiere ver precios', origenSupervisor: { uid: 'sup1', nombre: 'Super Uno' }, createdAt: new Date(), ...extra,
  })

  test('crea un pedido pendiente sin chofer a su nombre para un cliente real; y lo lee', async () => {
    await seedSup()
    await assertSucceeds(setDoc(doc(db('sup1'), 'orders/o1'), pedidoSup()))
    await assertSucceeds(getDoc(doc(db('sup1'), 'orders/o1')))
  })

  test('NO crea pedidos con chofer, confirmados, a nombre de otro, ni para un no-cliente; no edita', async () => {
    await seedSup()
    await seed((d) => setDoc(doc(d, 'users/ch1'), { rol: 'chofer', estado: 'activo', email: 'ch@x.com' }))
    await assertFails(setDoc(doc(db('sup1'), 'orders/o1'), pedidoSup({ driverId: 'ch@x.com' })))
    await assertFails(setDoc(doc(db('sup1'), 'orders/o2'), pedidoSup({ status: 'confirmado' })))
    await assertFails(setDoc(doc(db('sup1'), 'orders/o3'), pedidoSup({ origenSupervisor: { uid: 'sup2', nombre: 'Otro' } })))
    await assertFails(setDoc(doc(db('sup1'), 'orders/o4'), pedidoSup({ clientId: 'ch1' })))
    await seed((d) => setDoc(doc(d, 'orders/o5'), pedidoSup()))
    await assertFails(updateDoc(doc(db('sup1'), 'orders/o5'), { status: 'confirmado' }))
  })

  test('crea una visita pendiente sin chofer a su nombre; no con chofer, ni a nombre de otro, ni la edita', async () => {
    await seedSup()
    await assertSucceeds(setDoc(doc(db('sup1'), 'visitas-puntuales/v1'), visitaSup()))
    await assertFails(setDoc(doc(db('sup1'), 'visitas-puntuales/v2'), visitaSup({ driverId: 'ch@x.com' })))
    await assertFails(setDoc(doc(db('sup1'), 'visitas-puntuales/v3'), visitaSup({ status: 'visitado' })))
    await assertFails(setDoc(doc(db('sup1'), 'visitas-puntuales/v4'), visitaSup({ origenSupervisor: { uid: 'sup2', nombre: 'Otro' } })))
    await assertFails(updateDoc(doc(db('sup1'), 'visitas-puntuales/v1'), { driverId: 'ch@x.com' }))
  })

  test('config/cobranzas (alertas de mora): el supervisor lee, no escribe; super_admin escribe', async () => {
    await seedSup()
    await seed(async (d) => {
      await setDoc(doc(d, 'users/sa'), { rol: 'super_admin', estado: 'activo' })
      await setDoc(doc(d, 'config/cobranzas'), { alertasMora: { diasAmarillo: 30, diasRojo: 60, importeRojo: 500000 } })
    })
    await assertSucceeds(getDoc(doc(db('sup1'), 'config/cobranzas')))
    await assertFails(setDoc(doc(db('sup1'), 'config/cobranzas'), { alertasMora: { diasAmarillo: 1, diasRojo: 2, importeRojo: 3 } }, { merge: true }))
    await assertSucceeds(setDoc(doc(db('sa'), 'config/cobranzas'), { alertasMora: { diasAmarillo: 20, diasRojo: 45, importeRojo: 300000 } }, { merge: true }))
  })

  test('config/ventanilla (copias del comprobante de turno): caja lee, no escribe; super_admin escribe', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/sa'), { rol: 'super_admin', estado: 'activo' })
      await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
      await setDoc(doc(d, 'config/ventanilla'), { copiasTicket: { torcuato: 3, merlo: 3 } })
    })
    await assertSucceeds(getDoc(doc(db('caja1'), 'config/ventanilla')))
    await assertFails(setDoc(doc(db('caja1'), 'config/ventanilla'), { copiasTicket: { torcuato: 1, merlo: 1 } }, { merge: true }))
    await assertSucceeds(setDoc(doc(db('sa'), 'config/ventanilla'), { copiasTicket: { torcuato: 2, merlo: 3 } }, { merge: true }))
  })
})

describe('entregasTesoreria (entrega de caja a tesorería)', () => {
  const seedTodos = () => seed(async (d) => {
    await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/caja2'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/cajam'), { rol: 'caja', estado: 'activo', planta: 'merlo' })
    await setDoc(doc(d, 'users/mue1'),  { rol: 'muelle', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/tes1'),  { rol: 'tesoreria', estado: 'activo' })
    await setDoc(doc(d, 'users/fac1'),  { rol: 'facturacion', estado: 'activo' })
    await setDoc(doc(d, 'users/gg'),    { rol: 'gerente_general', estado: 'activo' })
    await setDoc(doc(d, 'users/log'),   { rol: 'logistica', estado: 'activo' })
    await setDoc(doc(d, 'users/cli'),   { rol: 'cliente', estado: 'activo' })
    await setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' })
  })
  const cheque = (numero) => ({ numero, bancoCodigo: '', bancoNombre: 'Galicia', fechaEmision: '', fechaAcreditacion: '2026-09-20', dias: 0, importe: 100, cobranzaId: 'cob1', clienteNombre: 'Cli' })
  const entrega = (extra = {}) => ({
    numero: 1, codigo: 'ET-DT-000001', fecha: '2026-09-09', plantaId: 'torcuato', estado: 'entregada', destino: 'tesoreria',
    liquidacionIds: ['2026-09-09_chof1'], rendicionIds: ['2026-09-09_caja1'],
    liquidaciones: [{ id: '2026-09-09_chof1', codigo: 'LQ-21-000001', fecha: '2026-09-09', choferId: 'chof1', choferNombre: 'C', efectivoRecibido: 1000, incluidaEnCierre: true }],
    rendiciones: [{ id: '2026-09-09_caja1', codigo: 'RD-DT-000001', fecha: '2026-09-09', sujetoId: 'caja1', sujetoNombre: 'N', efectivoContado: 5000 }],
    efectivo: { cierresCaja: 5000, liquidacionesSueltas: 0, teorico: 5000 }, efectivoEntregado: 5000,
    cheques: [cheque('11'), cheque('22')], retenciones: [],
    entregadoPor: { uid: 'caja1', nombre: 'Nico' }, firmaEntrega: 'data:image/png;base64,AAAA', firmanteEntrega: 'Nico',
    createdAt: new Date(), recibidoPor: null,
    ...extra,
  })
  const ID = 'entregasTesoreria/2026-09-09_torcuato_1'
  const confirmacion = (extra = {}) => ({
    estado: 'confirmada', recibidoPor: { uid: 'tes1', nombre: 'Yanina' }, firmaRecibe: 'data:image/png;base64,BBBB', firmanteRecibe: 'Yanina',
    efectivoContado: 4990, diferenciaEfectivo: -10, diferencia: { motivo: 'faltante_entrega', nota: '' }, valoresFaltantes: { cantidad: 1, total: 100 },
    cheques: [{ ...cheque('11'), recibido: true }, { ...cheque('22'), recibido: false, motivoNoEntregado: 'no vino' }], retenciones: [], confirmadaEn: new Date(),
    ...extra,
  })

  test('caja de la planta crea la entrega firmada con id determinístico y su uid; otra planta, muelle, tesorería, id inventado o sin firma no', async () => {
    await seedTodos()
    await assertFails(setDoc(doc(db('caja1'), ID), entrega({ entregadoPor: { uid: 'caja2', nombre: 'Otro' } })))
    await assertFails(setDoc(doc(db('caja1'), 'entregasTesoreria/otro'), entrega()))
    await assertFails(setDoc(doc(db('caja1'), ID), entrega({ firmaEntrega: '' })))
    await assertFails(setDoc(doc(db('caja1'), ID), entrega({ estado: 'confirmada' })))
    await assertFails(setDoc(doc(db('caja1'), ID), entrega({ recibidoPor: { uid: 'tes1', nombre: 'Y' } })))
    await assertFails(setDoc(doc(db('caja1'), ID), entrega({ cheques: 'x' })))
    await assertFails(setDoc(doc(db('cajam'), ID), entrega({ entregadoPor: { uid: 'cajam', nombre: 'M' } })))
    await assertFails(setDoc(doc(db('mue1'), ID), entrega({ entregadoPor: { uid: 'mue1', nombre: 'M' } })))
    await assertFails(setDoc(doc(db('tes1'), ID), entrega({ entregadoPor: { uid: 'tes1', nombre: 'Y' } })))
    await assertSucceeds(setDoc(doc(db('caja1'), ID), entrega()))
    await assertSucceeds(setDoc(doc(db('cajam'), 'entregasTesoreria/2026-09-09_merlo_1'), entrega({ plantaId: 'merlo', codigo: 'ET-ML-000001', entregadoPor: { uid: 'cajam', nombre: 'M' } })))
  })

  test('lectura: caja, tesorería, gerencia y logística leen; facturación, cliente y chofer no', async () => {
    await seedTodos()
    await seed((d) => setDoc(doc(d, ID), entrega()))
    for (const u of ['caja2', 'cajam', 'tes1', 'gg', 'log']) await assertSucceeds(getDoc(doc(db(u), ID)))
    for (const u of ['fac1', 'cli', 'chof1']) await assertFails(getDoc(doc(db(u), ID)))
  })

  test('tesorería confirma una vez (su uid, firma, efectivo contado, mismos valores tildados); caja no; no se toca lo entregado; nadie borra', async () => {
    await seedTodos()
    await seed((d) => setDoc(doc(d, ID), entrega()))
    await assertFails(updateDoc(doc(db('caja1'), ID), confirmacion({ recibidoPor: { uid: 'caja1', nombre: 'N' } })))
    await assertFails(updateDoc(doc(db('tes1'), ID), confirmacion({ recibidoPor: { uid: 'otro', nombre: 'X' } })))
    await assertFails(updateDoc(doc(db('tes1'), ID), confirmacion({ firmaRecibe: '' })))
    await assertFails(updateDoc(doc(db('tes1'), ID), confirmacion({ estado: 'entregada' })))
    await assertFails(updateDoc(doc(db('tes1'), ID), confirmacion({ efectivoEntregado: 1 })))
    await assertFails(updateDoc(doc(db('tes1'), ID), confirmacion({ cheques: [{ ...cheque('11'), recibido: true }] })))
    await assertFails(updateDoc(doc(db('tes1'), ID), { estado: 'confirmada' }))
    await assertSucceeds(updateDoc(doc(db('tes1'), ID), confirmacion()))
    await assertFails(updateDoc(doc(db('tes1'), ID), confirmacion()))
    await assertFails(deleteDoc(doc(db('tes1'), ID)))
    await assertFails(deleteDoc(doc(db('caja1'), ID)))
  })

  test('el operador también confirma; super_admin y gerente general no la crean', async () => {
    await seedTodos()
    await seed(async (d) => {
      await setDoc(doc(d, 'users/sa'), { rol: 'super_admin', estado: 'activo' })
      await setDoc(doc(d, ID), entrega())
    })
    await assertFails(setDoc(doc(db('gg'), 'entregasTesoreria/2026-09-09_torcuato_2'), entrega({ numero: 2, entregadoPor: { uid: 'gg', nombre: 'G' } })))
    await assertFails(updateDoc(doc(db('gg'), ID), confirmacion({ recibidoPor: { uid: 'gg', nombre: 'G' } })))
    await assertSucceeds(updateDoc(doc(db('sa'), ID), confirmacion({ recibidoPor: { uid: 'sa', nombre: 'SA' } })))
  })

  test('contador entregaCounter_{planta}: solo caja de esa planta, y solo avanza', async () => {
    await seedTodos()
    await assertSucceeds(setDoc(doc(db('caja1'), 'config/entregaCounter_torcuato'), { next: 2 }))
    await assertFails(setDoc(doc(db('cajam'), 'config/entregaCounter_torcuato'), { next: 3 }))
    await assertSucceeds(updateDoc(doc(db('caja2'), 'config/entregaCounter_torcuato'), { next: 3 }))
    await assertFails(updateDoc(doc(db('caja2'), 'config/entregaCounter_torcuato'), { next: 2 }))
    await assertFails(setDoc(doc(db('tes1'), 'config/entregaCounter_merlo'), { next: 2 }))
    await assertFails(setDoc(doc(db('mue1'), 'config/entregaCounter_torcuato'), { next: 4 }))
  })
})

describe('desviosDescarga (autorizar un faltante de mercadería, 2026-09-13)', () => {
  const ID = 'desviosDescarga/2026-09-13_chof1'
  const seedTodos = () => seed(async (d) => {
    await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/cajam'), { rol: 'caja', estado: 'activo', planta: 'merlo' })
    await setDoc(doc(d, 'users/aut1'),  { rol: 'facturacion', estado: 'activo', autorizaAnulaciones: true })
    await setDoc(doc(d, 'users/sa'),    { rol: 'super_admin', estado: 'activo' })
    await setDoc(doc(d, 'users/log'),   { rol: 'logistica', estado: 'activo' })
    await setDoc(doc(d, 'users/mue1'),  { rol: 'muelle', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' })
    // Caja con el permiso: pide y NO puede aprobarse a sí misma.
    await setDoc(doc(d, 'users/cajaAut'), { rol: 'caja', estado: 'activo', planta: 'torcuato', autorizaAnulaciones: true })
  })
  const pedido = (extra = {}) => ({
    fecha: '2026-09-13', plantaId: 'torcuato', choferId: 'chof1', choferNombre: 'Chofer Uno', depositoTango: '21',
    bolsasFaltantes: 42, productos: [{ productoId: 'b3', nombre: 'Hielo 3 kg', faltan: 42 }], umbral: 10,
    estado: 'pendiente', motivo: 'a_investigar', nota: 'se contó dos veces',
    solicitadoPor: { uid: 'caja1', nombre: 'Caja' }, solicitadaEn: new Date(), resueltaPor: null, ...extra,
  })
  const resolucion = (estado, uid, extra = {}) => ({
    estado, resueltaPor: { uid, nombre: 'Autorizante' }, resueltaEn: new Date(),
    notaResolucion: estado === 'rechazada' ? 'que el muelle lo recuente' : '', ...extra,
  })

  test('caja de la planta pide la autorización: id {fecha}_{chofer}, pendiente y a su nombre', async () => {
    await seedTodos()
    await assertSucceeds(setDoc(doc(db('caja1'), ID), pedido()))
  })

  test('el pedido mal formado no entra', async () => {
    await seedTodos()
    // Id que no coincide con fecha_chofer.
    await assertFails(setDoc(doc(db('caja1'), 'desviosDescarga/otro_id'), pedido()))
    // Nace resuelto, o aprobado de entrada.
    await assertFails(setDoc(doc(db('caja1'), ID), pedido({ estado: 'aprobada' })))
    await assertFails(setDoc(doc(db('caja1'), ID), pedido({ resueltaPor: { uid: 'caja1', nombre: 'Caja' } })))
    // Sin faltante, o con un faltante que no es número.
    await assertFails(setDoc(doc(db('caja1'), ID), pedido({ bolsasFaltantes: 0 })))
    await assertFails(setDoc(doc(db('caja1'), ID), pedido({ bolsasFaltantes: 'muchas' })))
    // Sin motivo.
    await assertFails(setDoc(doc(db('caja1'), ID), pedido({ motivo: '' })))
    // A nombre de otro.
    await assertFails(setDoc(doc(db('caja1'), ID), pedido({ solicitadoPor: { uid: 'cajaAut', nombre: 'Otro' } })))
    // Caja de la otra planta, muelle, el chofer y logística no piden.
    await assertFails(setDoc(doc(db('cajam'), ID), pedido({ solicitadoPor: { uid: 'cajam', nombre: 'Caja Merlo' } })))
    await assertFails(setDoc(doc(db('mue1'), ID), pedido({ solicitadoPor: { uid: 'mue1', nombre: 'Muelle' } })))
    await assertFails(setDoc(doc(db('chof1'), ID), pedido({ solicitadoPor: { uid: 'chof1', nombre: 'Chofer' } })))
    await assertFails(setDoc(doc(db('log'), ID), pedido({ solicitadoPor: { uid: 'log', nombre: 'Logistica' } })))
  })

  test('lo resuelve quien tiene el permiso, nunca el que lo pidió, y rechazar exige nota', async () => {
    await seedTodos()
    await seed((d) => setDoc(doc(d, ID), pedido()))
    // El que pidió no se aprueba solo, ni teniendo el permiso.
    await assertFails(updateDoc(doc(db('caja1'), ID), resolucion('aprobada', 'caja1')))
    // Sin el permiso no se resuelve.
    await assertFails(updateDoc(doc(db('log'), ID), resolucion('aprobada', 'log')))
    await assertFails(updateDoc(doc(db('mue1'), ID), resolucion('aprobada', 'mue1')))
    // Rechazar sin nota no dice qué hacer.
    await assertFails(updateDoc(doc(db('aut1'), ID), resolucion('rechazada', 'aut1', { notaResolucion: '' })))
    // No se puede tocar el faltante de paso.
    await assertFails(updateDoc(doc(db('aut1'), ID), { ...resolucion('aprobada', 'aut1'), bolsasFaltantes: 1 }))
    // A nombre de otro tampoco.
    await assertFails(updateDoc(doc(db('aut1'), ID), resolucion('aprobada', 'sa')))
    // POSITIVO, y una sola vez: ya resuelto no se vuelve a tocar.
    await assertSucceeds(updateDoc(doc(db('aut1'), ID), resolucion('aprobada', 'aut1')))
    await assertFails(updateDoc(doc(db('aut1'), ID), resolucion('rechazada', 'aut1')))
  })

  test('el super_admin también resuelve; el pedido no se borra nunca', async () => {
    await seedTodos()
    await seed((d) => setDoc(doc(d, ID), pedido()))
    await assertSucceeds(updateDoc(doc(db('sa'), ID), resolucion('rechazada', 'sa')))
    await assertFails(deleteDoc(doc(db('sa'), ID)))
    await assertFails(deleteDoc(doc(db('caja1'), ID)))
  })

  test('lo leen caja, los autorizantes y gerencia; no el chofer ni el cliente', async () => {
    await seedTodos()
    await seed((d) => setDoc(doc(d, ID), pedido()))
    await assertSucceeds(getDoc(doc(db('caja1'), ID)))
    await assertSucceeds(getDoc(doc(db('aut1'), ID)))
    await assertSucceeds(getDoc(doc(db('sa'), ID)))
    await assertFails(getDoc(doc(db('chof1'), ID)))
    await assertFails(getDoc(doc(db('mue1'), ID)))
  })
})

describe('anulacionesVentanilla (anulación de factura con nota de crédito)', () => {
  const ventaFacturada = (cajaId, turno, numero, extra = {}) => ({
    plantaId: 'torcuato', canal: 'contado', cajaId, cajaNombre: 'Caja', clienteNombre: 'Cliente SA', items: [], total: 20000,
    formaPago: 'contado_efectivo', estado: 'entregado', turno, turnoEstado: 'en_espera', fecha: new Date(),
    factura: { estado: 'emitida', numero, puntoVenta: 1104, cbteTipo: 1, cae: '75', caeFchVto: '20260920' }, ...extra,
  })
  const seedTodos = () => seed(async (d) => {
    await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/caja2'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/cajam'), { rol: 'caja', estado: 'activo', planta: 'merlo' })
    await setDoc(doc(d, 'users/tes1'),  { rol: 'tesoreria', estado: 'activo' })
    await setDoc(doc(d, 'users/aut1'),  { rol: 'facturacion', estado: 'activo', autorizaAnulaciones: true })
    await setDoc(doc(d, 'users/aut2'),  { rol: 'tesoreria', estado: 'activo', autorizaAnulaciones: true })
    await setDoc(doc(d, 'users/sa'),    { rol: 'super_admin', estado: 'activo' })
    await setDoc(doc(d, 'users/log'),   { rol: 'logistica', estado: 'activo' })
    await setDoc(doc(d, 'users/cli'),   { rol: 'cliente', estado: 'activo' })
    await setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' })
    await setDoc(doc(d, 'ventasVentanilla/v1'), ventaFacturada('caja1', 1, 116))
    const { factura: _sinFactura, ...v2 } = ventaFacturada('caja1', 2, 0)
    await setDoc(doc(d, 'ventasVentanilla/v2'), { ...v2, formaPago: 'cuenta_corriente' })
    await setDoc(doc(d, 'ventasVentanilla/v3'), ventaFacturada('caja2', 3, 117))
    await setDoc(doc(d, 'ventasVentanilla/v4'), ventaFacturada('caja1', 4, 118, { anulacion: { estado: 'anulada', solicitudId: 'v4' } }))
    await setDoc(doc(d, 'ventasVentanilla/v5'), ventaFacturada('caja1', 5, 119, { anulacion: { estado: 'rechazada', solicitudId: 'v5' } }))
  })
  const solicitud = (extra = {}) => ({
    ventaId: 'v1', coleccion: 'ventasVentanilla', plantaId: 'torcuato', cajaId: 'caja1', cajaNombre: 'Caja', clienteNombre: 'Cliente SA', fechaVenta: '2026-09-09',
    facturaOriginal: { cbteTipo: 1, puntoVenta: 1104, numero: 116, cae: '75', total: 20000 },
    motivo: 'cliente_equivocado', nota: 'era la sucursal 2', estado: 'pendiente',
    solicitadoPor: { uid: 'caja1', nombre: 'Caja' }, solicitadaEn: new Date(), resueltaPor: null,
    ...extra,
  })
  const ID = 'anulacionesVentanilla/v1'
  const resolucion = (estado, uid, extra = {}) => ({ estado, resueltaPor: { uid, nombre: 'X' }, resueltaEn: new Date(), notaResolucion: estado === 'rechazada' ? 'no corresponde' : '', ...extra })

  test('el cajero pide la anulación de SU venta facturada, con id = venta y estado pendiente', async () => {
    await seedTodos()
    await assertSucceeds(setDoc(doc(db('caja1'), ID), solicitud()))
    // Puede volver a pedir sobre una venta cuya anulación fue rechazada.
    await assertSucceeds(setDoc(doc(db('caja1'), 'anulacionesVentanilla/v5'), solicitud({ ventaId: 'v5', facturaOriginal: { cbteTipo: 1, puntoVenta: 1104, numero: 119, cae: '78', total: 1 } })))
  })

  test('no sobre la venta de otro cajero, ni sin factura, ni ya anulada, ni con id inventado, ni con estado distinto de pendiente', async () => {
    await seedTodos()
    await assertFails(setDoc(doc(db('caja1'), 'anulacionesVentanilla/v3'), solicitud({ ventaId: 'v3' })))
    await assertFails(setDoc(doc(db('caja2'), 'anulacionesVentanilla/v3'), solicitud({ ventaId: 'v3', cajaId: 'caja2', solicitadoPor: { uid: 'caja1', nombre: 'Caja' } })))
    await assertFails(setDoc(doc(db('caja1'), 'anulacionesVentanilla/v2'), solicitud({ ventaId: 'v2' })))
    await assertFails(setDoc(doc(db('caja1'), 'anulacionesVentanilla/v4'), solicitud({ ventaId: 'v4' })))
    await assertFails(setDoc(doc(db('caja1'), 'anulacionesVentanilla/otro'), solicitud()))
    await assertFails(setDoc(doc(db('caja1'), ID), solicitud({ estado: 'aprobada' })))
    await assertFails(setDoc(doc(db('caja1'), ID), solicitud({ resueltaPor: { uid: 'aut1', nombre: 'A' } })))
    await assertFails(setDoc(doc(db('caja1'), ID), solicitud({ motivo: 7 })))
    await assertFails(setDoc(doc(db('cajam'), ID), solicitud({ cajaId: 'cajam', solicitadoPor: { uid: 'cajam', nombre: 'M' } })))
    await assertFails(setDoc(doc(db('tes1'), ID), solicitud({ cajaId: 'tes1', solicitadoPor: { uid: 'tes1', nombre: 'T' } })))
    await assertFails(setDoc(doc(db('aut1'), ID), solicitud()))
  })

  test('lectura: caja, tesorería, logística, autorizantes y super_admin leen; cliente y chofer no', async () => {
    await seedTodos()
    await seed((d) => setDoc(doc(d, ID), solicitud()))
    for (const u of ['caja1', 'caja2', 'cajam', 'tes1', 'log', 'aut1', 'sa']) await assertSucceeds(getDoc(doc(db(u), ID)))
    for (const u of ['cli', 'chof1']) await assertFails(getDoc(doc(db(u), ID)))
  })

  test('aprueba o rechaza solo quien tiene el permiso (o super_admin), una vez, solo esos campos, nunca el propio solicitante', async () => {
    await seedTodos()
    await seed(async (d) => {
      await setDoc(doc(d, ID), solicitud())
      await setDoc(doc(d, 'anulacionesVentanilla/v5'), solicitud({ ventaId: 'v5' }))
      await setDoc(doc(d, 'users/cajaAut'), { rol: 'caja', estado: 'activo', planta: 'torcuato', autorizaAnulaciones: true })
      await setDoc(doc(d, 'anulacionesVentanilla/v3'), solicitud({ ventaId: 'v3', cajaId: 'cajaAut', solicitadoPor: { uid: 'cajaAut', nombre: 'CA' } }))
    })
    // Sin permiso: tesorería, logística, el cajero.
    await assertFails(updateDoc(doc(db('tes1'), ID), resolucion('aprobada', 'tes1')))
    await assertFails(updateDoc(doc(db('log'), ID), resolucion('aprobada', 'log')))
    await assertFails(updateDoc(doc(db('caja1'), ID), resolucion('aprobada', 'caja1')))
    // Con permiso pero con el uid de otro, con más campos, con un estado que no es resolución, o rechazo sin nota.
    await assertFails(updateDoc(doc(db('aut1'), ID), resolucion('aprobada', 'aut2')))
    await assertFails(updateDoc(doc(db('aut1'), ID), resolucion('aprobada', 'aut1', { motivo: 'otro' })))
    await assertFails(updateDoc(doc(db('aut1'), ID), resolucion('emitida', 'aut1')))
    await assertFails(updateDoc(doc(db('aut1'), ID), resolucion('rechazada', 'aut1', { notaResolucion: '' })))
    // El que pidió no se aprueba a sí mismo aunque tenga el permiso.
    await assertFails(updateDoc(doc(db('cajaAut'), 'anulacionesVentanilla/v3'), resolucion('aprobada', 'cajaAut')))
    // OK: autorizante aprueba; otro rechaza con nota; super_admin aprueba. Una vez.
    await assertSucceeds(updateDoc(doc(db('aut1'), ID), resolucion('aprobada', 'aut1')))
    await assertFails(updateDoc(doc(db('aut2'), ID), resolucion('rechazada', 'aut2')))
    await assertSucceeds(updateDoc(doc(db('aut2'), 'anulacionesVentanilla/v5'), resolucion('rechazada', 'aut2')))
    await assertSucceeds(updateDoc(doc(db('sa'), 'anulacionesVentanilla/v3'), resolucion('aprobada', 'sa')))
    // Nadie borra ni vuelve atrás desde el cliente.
    await assertFails(deleteDoc(doc(db('sa'), ID)))
    await assertFails(deleteDoc(doc(db('caja1'), ID)))
    await assertFails(updateDoc(doc(db('aut1'), 'anulacionesVentanilla/v5'), { estado: 'pendiente' }))
  })

  test('una anulación en error (ARCA rechazó la NC) se puede volver a aprobar; una emitida o rechazada no', async () => {
    await seedTodos()
    await seed(async (d) => {
      await setDoc(doc(d, 'anulacionesVentanilla/v1'), solicitud({ estado: 'error', ultimoError: 'x' }))
      await setDoc(doc(d, 'anulacionesVentanilla/v3'), solicitud({ ventaId: 'v3', estado: 'emitida' }))
      await setDoc(doc(d, 'anulacionesVentanilla/v5'), solicitud({ ventaId: 'v5', estado: 'rechazada' }))
    })
    await assertSucceeds(updateDoc(doc(db('aut1'), 'anulacionesVentanilla/v1'), resolucion('aprobada', 'aut1')))
    await assertFails(updateDoc(doc(db('aut1'), 'anulacionesVentanilla/v3'), resolucion('aprobada', 'aut1')))
    await assertFails(updateDoc(doc(db('aut1'), 'anulacionesVentanilla/v5'), resolucion('aprobada', 'aut1')))
  })

  test('una anulación en error (ARCA rechazó la NC) se puede volver a aprobar; una emitida o rechazada no', async () => {
    await seedTodos()
    await seed(async (d) => {
      await setDoc(doc(d, 'anulacionesVentanilla/v1'), solicitud({ estado: 'error', ultimoError: 'x' }))
      await setDoc(doc(d, 'anulacionesVentanilla/v3'), solicitud({ ventaId: 'v3', estado: 'emitida' }))
      await setDoc(doc(d, 'anulacionesVentanilla/v5'), solicitud({ ventaId: 'v5', estado: 'rechazada' }))
    })
    await assertSucceeds(updateDoc(doc(db('aut1'), 'anulacionesVentanilla/v1'), resolucion('aprobada', 'aut1')))
    await assertFails(updateDoc(doc(db('aut1'), 'anulacionesVentanilla/v3'), resolucion('aprobada', 'aut1')))
    await assertFails(updateDoc(doc(db('aut1'), 'anulacionesVentanilla/v5'), resolucion('aprobada', 'aut1')))
  })

  test('quien autoriza (y facturación) lee la venta de la solicitud para el PDF de la nota de crédito', async () => {
    await seedTodos()
    await seed((d) => setDoc(doc(d, 'users/autSup'), { rol: 'supervisor', estado: 'activo', autorizaAnulaciones: true }))
    await assertSucceeds(getDoc(doc(db('aut1'), 'ventasVentanilla/v1')))
    await assertSucceeds(getDoc(doc(db('autSup'), 'ventasVentanilla/v1')))
    await assertFails(getDoc(doc(db('cli'), 'ventasVentanilla/v1')))
  })

  test('el permiso autorizaAnulaciones solo lo da el super_admin: ni uno mismo ni logística', async () => {
    await seedTodos()
    await seed((d) => setDoc(doc(d, 'users/aut1'), { rol: 'facturacion', estado: 'activo', nombre: 'F' }))
    await assertFails(updateDoc(doc(db('aut1'), 'users/aut1'), { autorizaAnulaciones: true }))
    await assertFails(updateDoc(doc(db('tes1'), 'users/tes1'), { autorizaAnulaciones: true }))
    await assertFails(updateDoc(doc(db('log'), 'users/aut1'), { autorizaAnulaciones: true }))
    await assertSucceeds(updateDoc(doc(db('aut1'), 'users/aut1'), { nombre: 'Facturación' }))
    await assertSucceeds(updateDoc(doc(db('sa'), 'users/aut1'), { autorizaAnulaciones: true }))
  })
})

// ── "Ver como usuario" (2026-09-10): sesión impersonada = solo lectura ────────
// El super_admin abre la app con un custom token del usuario observado que
// trae el claim `impersonadoPor`. Lee lo mismo que esa persona; no escribe nada.
describe('impersonación (Ver como) — solo lectura', () => {
  const verComo = (uid, email) =>
    testEnv.authenticatedContext(uid, { ...(email ? { email } : {}), impersonadoPor: 'sa' }).firestore()

  const seedBase = () => seed(async (d) => {
    await setDoc(doc(d, 'users/sa'),  { rol: 'super_admin', estado: 'activo', nombre: 'Ariel' })
    await setDoc(doc(d, 'users/cli'), cliente())
    await setDoc(doc(d, 'users/ch1'), { rol: 'chofer', estado: 'activo', email: 'ch@x.com', nombre: 'Chofer' })
    await setDoc(doc(d, 'users/log'), { rol: 'logistica', estado: 'activo', email: 'l@x.com', nombre: 'Logi' })
    await setDoc(doc(d, 'orders/o1'), pedido())
    await setDoc(doc(d, 'liquidaciones/2026-09-10_ch1'), { choferId: 'ch1', fecha: '2026-09-10', plantaId: 'torcuato', productos: [] })
    await setDoc(doc(d, 'flota/f1'), { patente: 'AA123BB' })
  })

  test('un cliente impersonado LEE su perfil y sus pedidos', async () => {
    await seedBase()
    await assertSucceeds(getDoc(doc(verComo('cli', 'c@x.com'), 'users/cli')))
    await assertSucceeds(getDoc(doc(verComo('cli', 'c@x.com'), 'orders/o1')))
  })

  test('un cliente impersonado NO crea pedidos, NO cancela, NO edita su perfil ni sus recurrentes', async () => {
    await seedBase()
    const v = verComo('cli', 'c@x.com')
    await assertFails(setDoc(doc(v, 'orders/o2'), pedido()))
    await assertFails(updateDoc(doc(v, 'orders/o1'), { status: 'cancelado', motivoCancelacion: 'x', updatedAt: new Date() }))
    await assertFails(updateDoc(doc(v, 'users/cli'), { phone: '111' }))
    await assertFails(setDoc(doc(v, 'pedidos-recurrentes/cli'), { clientId: 'cli', items: [] }))
    // Regresión: el mismo cliente SIN el claim sigue pudiendo.
    await assertSucceeds(setDoc(doc(db('cli', 'c@x.com'), 'orders/o2'), pedido()))
    await assertSucceeds(updateDoc(doc(db('cli', 'c@x.com'), 'users/cli'), { phone: '111' }))
  })

  test('un chofer impersonado LEE su liquidación pero NO escribe su GPS ni sus pedidos', async () => {
    await seedBase()
    await seed((d) => setDoc(doc(d, 'orders/o3'), pedido({ status: 'en_camino', driverId: 'ch@x.com' })))
    const v = verComo('ch1', 'ch@x.com')
    await assertSucceeds(getDoc(doc(v, 'liquidaciones/2026-09-10_ch1')))
    await assertSucceeds(getDoc(doc(v, 'orders/o3')))
    await assertFails(setDoc(doc(v, 'ubicaciones/ch@x.com'), { lat: 1, lng: 2, activo: true }))
    await assertFails(updateDoc(doc(v, 'orders/o3'), { status: 'entregado', updatedAt: new Date() }))
    await assertSucceeds(setDoc(doc(db('ch1', 'ch@x.com'), 'ubicaciones/ch@x.com'), { lat: 1, lng: 2, activo: true }))
  })

  test('staff impersonado (logística) LEE la flota pero NO la escribe', async () => {
    await seedBase()
    const v = verComo('log', 'l@x.com')
    await assertSucceeds(getDoc(doc(v, 'flota/f1')))
    await assertFails(updateDoc(doc(v, 'flota/f1'), { patente: 'ZZ999ZZ' }))
    await assertFails(deleteDoc(doc(v, 'flota/f1')))
    await assertSucceeds(updateDoc(doc(db('log', 'l@x.com'), 'flota/f1'), { patente: 'ZZ999ZZ' }))
  })

  test('el claim no agranda permisos: un impersonado sigue sin leer lo que su rol no lee', async () => {
    await seedBase()
    await seed((d) => setDoc(doc(d, 'historialAdmin/h1'), { coleccion: 'users', accion: 'creado', riesgo: 'alto', actor: { uid: 'sa' } }))
    await assertFails(getDoc(doc(verComo('cli', 'c@x.com'), 'liquidaciones/2026-09-10_ch1')))
    await assertFails(getDoc(doc(verComo('cli', 'c@x.com'), 'historialAdmin/h1')))
    await assertFails(getDoc(doc(verComo('ch1', 'ch@x.com'), 'historialAdmin/h1')))
  })
})

describe('anulacionesCobranza (anular un recibo con autorización, 2026-09-15)', () => {
  // El que cobró pide sobre SU recibo numerado, mientras su día no esté cerrado;
  // aprueba quien tiene autorizaAnulaciones, nunca el propio solicitante; la
  // cobranza sigue inmutable para todos (la marca el server).
  const recibo = (uid, extra = {}) => ({
    origen: 'supervisor', registradoPor: { uid, nombre: 'Cobrador' }, clienteId: 'cli', clienteNombre: 'Cliente SA',
    importe: 200000, formaPago: 'mixto', fecha: new Date(), numeroRecibo: 'RS-000168', empresa: 'redonhielo',
    imputaciones: [], medios: { efectivo: 0, transferencia: 0, cheques: [], retenciones: [] }, ...extra,
  })
  const seedTodos = () => seed(async (d) => {
    await setDoc(doc(d, 'users/sup'),   { rol: 'supervisor', estado: 'activo' })
    await setDoc(doc(d, 'users/sup2'),  { rol: 'supervisor', estado: 'activo' })
    await setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' })
    await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/tes1'),  { rol: 'tesoreria', estado: 'activo' })
    await setDoc(doc(d, 'users/aut1'),  { rol: 'facturacion', estado: 'activo', autorizaAnulaciones: true })
    await setDoc(doc(d, 'cobranzas/c1'), recibo('sup'))
    await setDoc(doc(d, 'cobranzas/c2'), recibo('sup', { numeroRecibo: null }))                                   // sin número: no es un recibo completo
    await setDoc(doc(d, 'cobranzas/c3'), recibo('sup', { anulacion: { estado: 'anulada', solicitudId: 'c3' } }))  // ya anulada
    await setDoc(doc(d, 'cobranzas/c4'), recibo('chof1', { origen: 'cobrador' }))
    await setDoc(doc(d, 'cobranzas/c5'), recibo('caja1', { origen: 'caja', plantaId: 'torcuato' }))
    await setDoc(doc(d, 'cobranzas/c6'), recibo('sup', { anulacion: { estado: 'rechazada', solicitudId: 'c6' } })) // rechazada: se puede volver a pedir
  })
  const solicitud = (cobranzaId, uid, extra = {}) => ({
    cobranzaId, origen: 'supervisor', cobradorId: uid, cobradorNombre: 'Cobrador', clienteId: 'cli', clienteNombre: 'Cliente SA',
    numeroRecibo: 'RS-000168', importe: 200000, resumen: { efectivo: 0, transferencia: 0, cheques: [], retenciones: 0, facturas: [], aCuenta: 0 },
    fechaCobranza: '2026-09-15', motivo: 'cheque_equivocado', nota: '', estado: 'pendiente',
    solicitadoPor: { uid, nombre: 'Cobrador' }, solicitadaEn: new Date(), resueltaPor: null, ...extra,
  })
  const resolucion = (estado, uid, extra = {}) => ({ estado, resueltaPor: { uid, nombre: 'X' }, resueltaEn: new Date(), notaResolucion: estado === 'rechazada' ? 'no corresponde' : '', ...extra })

  test('el que cobró pide anular SU recibo numerado; no uno ajeno, sin número o ya anulado', async () => {
    await seedTodos()
    await assertSucceeds(setDoc(doc(db('sup'), 'anulacionesCobranza/c1'), solicitud('c1', 'sup')))
    await assertSucceeds(setDoc(doc(db('sup'), 'anulacionesCobranza/c6'), solicitud('c6', 'sup')))
    await assertFails(setDoc(doc(db('sup2'), 'anulacionesCobranza/c1'), solicitud('c1', 'sup2')))
    await assertFails(setDoc(doc(db('sup'), 'anulacionesCobranza/c2'), solicitud('c2', 'sup')))
    await assertFails(setDoc(doc(db('sup'), 'anulacionesCobranza/c3'), solicitud('c3', 'sup')))
    // Forma: id = cobranza, nace pendiente, sin resolver, con motivo.
    await assertFails(setDoc(doc(db('sup'), 'anulacionesCobranza/c1'), solicitud('c1', 'sup', { estado: 'aprobada' })))
    await assertFails(setDoc(doc(db('sup'), 'anulacionesCobranza/otro'), solicitud('c1', 'sup')))
    await assertFails(setDoc(doc(db('sup'), 'anulacionesCobranza/c1'), solicitud('c1', 'sup', { motivo: '' })))
    // Chofer y cajero, sobre los suyos.
    await assertSucceeds(setDoc(doc(db('chof1'), 'anulacionesCobranza/c4'), solicitud('c4', 'chof1', { origen: 'cobrador' })))
    await assertSucceeds(setDoc(doc(db('caja1'), 'anulacionesCobranza/c5'), solicitud('c5', 'caja1', { origen: 'caja', plantaId: 'torcuato' })))
  })

  test('con el día ya cerrado (liquidación del cobrador o cierre de caja) no se pide más', async () => {
    await seedTodos()
    await seed((d) => setDoc(doc(d, 'liquidaciones/2026-09-15_sup'), { fecha: '2026-09-15', choferId: 'sup' }))
    await seed((d) => setDoc(doc(d, 'rendiciones/2026-09-15_caja1'), { fecha: '2026-09-15', cajeroId: 'caja1' }))
    await assertFails(setDoc(doc(db('sup'), 'anulacionesCobranza/c1'), solicitud('c1', 'sup')))
    await assertFails(setDoc(doc(db('caja1'), 'anulacionesCobranza/c5'), solicitud('c5', 'caja1', { origen: 'caja', plantaId: 'torcuato' })))
    // Otro día sigue abierto.
    await assertSucceeds(setDoc(doc(db('sup'), 'anulacionesCobranza/c1'), solicitud('c1', 'sup', { fechaCobranza: '2026-09-14' })))
  })

  test('aprueba o rechaza solo quien tiene el permiso, nunca el solicitante, solo esos campos', async () => {
    await seedTodos()
    await seed((d) => setDoc(doc(d, 'anulacionesCobranza/c1'), solicitud('c1', 'sup')))
    await assertFails(updateDoc(doc(db('sup'), 'anulacionesCobranza/c1'), resolucion('aprobada', 'sup')))
    await assertFails(updateDoc(doc(db('tes1'), 'anulacionesCobranza/c1'), resolucion('aprobada', 'tes1')))
    await assertFails(updateDoc(doc(db('aut1'), 'anulacionesCobranza/c1'), resolucion('rechazada', 'aut1', { notaResolucion: '' })))
    await assertFails(updateDoc(doc(db('aut1'), 'anulacionesCobranza/c1'), resolucion('aprobada', 'aut1', { importe: 1 })))
    await assertSucceeds(updateDoc(doc(db('aut1'), 'anulacionesCobranza/c1'), resolucion('aprobada', 'aut1')))
    // Ya resuelta: no se toca más.
    await assertFails(updateDoc(doc(db('aut1'), 'anulacionesCobranza/c1'), resolucion('rechazada', 'aut1')))
    // Y la cobranza sigue inmutable para todos: la marca el server.
    await assertFails(updateDoc(doc(db('aut1'), 'cobranzas/c1'), { anulacion: { estado: 'anulada', solicitudId: 'c1' } }))
    await assertFails(updateDoc(doc(db('sup'), 'cobranzas/c1'), { anulacion: { estado: 'anulada', solicitudId: 'c1' } }))
  })

  test('la lee el que pidió, la oficina y quien autoriza; otro cobrador no', async () => {
    await seedTodos()
    await seed((d) => setDoc(doc(d, 'anulacionesCobranza/c1'), solicitud('c1', 'sup')))
    await assertSucceeds(getDoc(doc(db('sup'), 'anulacionesCobranza/c1')))
    await assertSucceeds(getDoc(doc(db('aut1'), 'anulacionesCobranza/c1')))
    await assertSucceeds(getDoc(doc(db('tes1'), 'anulacionesCobranza/c1')))
    await assertFails(getDoc(doc(db('sup2'), 'anulacionesCobranza/c1')))
  })
})

describe('anulación de facturas del camión desde la liquidación (2026-09-11)', () => {
  const ventaCamion = (choferId, numero, extra = {}) => ({
    canal: 'contado', camionId: '', choferId, choferNombre: 'Chofer', clienteId: 'cli', clienteNombre: 'Cliente SA', items: [], total: 20000,
    formaPago: 'contado_efectivo', fecha: new Date(), pedidoId: null, tango: { estado: 'confirmado' },
    factura: { estado: 'emitida', numero, puntoVenta: 1104, cbteTipo: 1, cae: '75', caeFchVto: '20260920' }, ...extra,
  })
  const seedTodos = () => seed(async (d) => {
    await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/cajam'), { rol: 'caja', estado: 'activo', planta: 'merlo' })
    await setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' })
    await setDoc(doc(d, 'users/aut1'),  { rol: 'facturacion', estado: 'activo', autorizaAnulaciones: true })
    await setDoc(doc(d, 'ventasCamion/c1'), ventaCamion('chof1', 300))
    await setDoc(doc(d, 'ventasCamion/c2'), ventaCamion('chof1', 301))
    const { factura: _sinFactura, ...c3 } = ventaCamion('chof1', 0)
    await setDoc(doc(d, 'ventasCamion/c3'), { ...c3, formaPago: 'cuenta_corriente', comprobanteInterno: { tipo: 'remito', puntoVenta: 1105, numero: 9 } })
    await setDoc(doc(d, 'ventasCamion/c4'), ventaCamion('chof1', 302, { anulacion: { estado: 'pendiente', solicitudId: 'c4' } }))
    // Liquidación ya cerrada del chofer para el día de c2.
    await setDoc(doc(d, 'liquidaciones/2026-09-10_chof1'), { fecha: '2026-09-10', choferId: 'chof1', plantaId: 'torcuato' })
  })
  const solicitud = (ventaId, extra = {}) => ({
    ventaId, coleccion: 'ventasCamion', plantaId: 'torcuato', cajaId: 'caja1', cajaNombre: 'Caja', choferId: 'chof1', choferNombre: 'Chofer',
    clienteNombre: 'Cliente SA', fechaVenta: '2026-09-11',
    facturaOriginal: { cbteTipo: 1, puntoVenta: 1104, numero: 300, cae: '75', total: 20000 },
    motivo: 'cliente_equivocado', nota: '', estado: 'pendiente',
    solicitadoPor: { uid: 'caja1', nombre: 'Caja' }, solicitadaEn: new Date(), resueltaPor: null,
    ...extra,
  })

  test('caja de la planta pide anular una factura emitida del chofer con la liquidación del día abierta', async () => {
    await seedTodos()
    await assertSucceeds(setDoc(doc(db('caja1'), 'anulacionesVentanilla/c1'), solicitud('c1')))
  })

  test('no con la liquidación de ese día cerrada, ni un remito, ni con anulación en curso, ni con otro chofer, ni desde otra planta, ni el chofer', async () => {
    await seedTodos()
    await assertFails(setDoc(doc(db('caja1'), 'anulacionesVentanilla/c2'), solicitud('c2', { fechaVenta: '2026-09-10' })))
    await assertFails(setDoc(doc(db('caja1'), 'anulacionesVentanilla/c3'), solicitud('c3')))
    await assertFails(setDoc(doc(db('caja1'), 'anulacionesVentanilla/c4'), solicitud('c4')))
    await assertFails(setDoc(doc(db('caja1'), 'anulacionesVentanilla/c1'), solicitud('c1', { choferId: 'otro' })))
    // La caja de otra planta SÍ puede (la venta del camión no lleva planta; el control es la autorización).
    await assertSucceeds(setDoc(doc(db('cajam'), 'anulacionesVentanilla/c1'), solicitud('c1', { cajaId: 'cajam', plantaId: 'merlo', solicitadoPor: { uid: 'cajam', nombre: 'M' } })))
    await assertFails(setDoc(doc(db('chof1'), 'anulacionesVentanilla/c2'), solicitud('c2', { cajaId: 'chof1', solicitadoPor: { uid: 'chof1', nombre: 'C' } })))
    // Con coleccion de ventanilla sobre una venta que no existe ahí, tampoco.
    await assertFails(setDoc(doc(db('caja1'), 'anulacionesVentanilla/c2'), solicitud('c2', { coleccion: 'ventasVentanilla' })))
  })

  test('el autorizante aprueba la del camión igual que la de ventanilla', async () => {
    await seedTodos()
    await seed((d) => setDoc(doc(d, 'anulacionesVentanilla/c1'), solicitud('c1')))
    await assertSucceeds(updateDoc(doc(db('aut1'), 'anulacionesVentanilla/c1'), { estado: 'aprobada', resueltaPor: { uid: 'aut1', nombre: 'A' }, resueltaEn: new Date(), notaResolucion: '' }))
  })
})

describe('anulación de una promo (factura X) con nota de crédito interna (2026-09-11)', () => {
  const seedTodos = () => seed(async (d) => {
    await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' })
    await setDoc(doc(d, 'ventasCamion/p1'), { canal: 'promo', camionId: '', choferId: 'chof1', choferNombre: 'C', clienteId: 'cli', clienteNombre: 'Cliente', items: [], total: 5000, formaPago: 'contado_efectivo', fecha: new Date(), pedidoId: null, comprobanteInterno: { tipo: 'facturaX', puntoVenta: 1104, numero: 640 }, tango: { estado: 'confirmado', facturaNumero: 'B0110400000640' } })
    await setDoc(doc(d, 'ventasCamion/p2'), { canal: 'promo', camionId: '', choferId: 'chof1', choferNombre: 'C', clienteId: 'cli', clienteNombre: 'Cliente', items: [], total: 5000, formaPago: 'contado_efectivo', fecha: new Date(), pedidoId: null })
    await setDoc(doc(d, 'ventasVentanilla/pv1'), { plantaId: 'torcuato', canal: 'promo', cajaId: 'caja1', cajaNombre: 'Caja', clienteNombre: 'Cliente', items: [], total: 5000, formaPago: 'contado_efectivo', estado: 'entregado', turno: 9, turnoEstado: 'en_espera', fecha: new Date(), comprobanteInterno: { tipo: 'facturaX', puntoVenta: 1104, numero: 641 } })
  })
  const base = { plantaId: 'torcuato', cajaId: 'caja1', cajaNombre: 'Caja', clienteNombre: 'Cliente', fechaVenta: '2026-09-11', motivo: 'cliente_equivocado', nota: '', estado: 'pendiente', solicitadoPor: { uid: 'caja1', nombre: 'Caja' }, solicitadaEn: new Date(), resueltaPor: null, facturaOriginal: { cbteTipo: 0, puntoVenta: 1104, numero: 640, cae: null, total: 5000 } }
  test('caja pide anular una promo numerada del camión y de ventanilla; sin número de factura X no', async () => {
    await seedTodos()
    await assertSucceeds(setDoc(doc(db('caja1'), 'anulacionesVentanilla/p1'), { ...base, ventaId: 'p1', coleccion: 'ventasCamion', choferId: 'chof1', choferNombre: 'C' }))
    await assertSucceeds(setDoc(doc(db('caja1'), 'anulacionesVentanilla/pv1'), { ...base, ventaId: 'pv1', coleccion: 'ventasVentanilla' }))
    await assertFails(setDoc(doc(db('caja1'), 'anulacionesVentanilla/p2'), { ...base, ventaId: 'p2', coleccion: 'ventasCamion', choferId: 'chof1', choferNombre: 'C' }))
  })
})

describe('remito de cta. cte. anulado por el chofer sin autorización (2026-09-11)', () => {
  const remito = (over = {}) => ({
    canal: 'contado', camionId: '', choferId: 'chof1', choferNombre: 'C', clienteId: 'cli', clienteNombre: 'Cliente', items: [], total: 1000,
    formaPago: 'cuenta_corriente', fecha: new Date(), pedidoId: null, comprobanteInterno: { tipo: 'remito', puntoVenta: 1105, numero: 700 }, ...over,
  })
  const seedTodos = () => seed(async (d) => {
    await setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' })
    await setDoc(doc(d, 'users/chof2'), { rol: 'chofer', estado: 'activo' })
    await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'ventasCamion/r1'), remito())
    await setDoc(doc(d, 'ventasCamion/r2'), remito())
    const { comprobanteInterno: _ci, ...facturada } = remito({ formaPago: 'contado_efectivo', factura: { estado: 'emitida', numero: 5, puntoVenta: 1104, cbteTipo: 1, cae: '1' } })
    await setDoc(doc(d, 'ventasCamion/r3'), facturada)
    await setDoc(doc(d, 'ventasCamion/r4'), remito({ anulacion: { estado: 'anulada', tipo: 'remito', solicitudId: '' } }))
    await setDoc(doc(d, 'ventasCamion/r5'), remito({ fecha: new Date(Date.now() - 2 * 60 * 60 * 1000) }))
    await setDoc(doc(d, 'liquidaciones/2026-09-10_chof1'), { fecha: '2026-09-10', choferId: 'chof1', plantaId: 'torcuato' })
  })
  const anulacion = (over = {}) => ({ anulacion: { estado: 'anulada', solicitudId: '', tipo: 'remito', motivo: 'cliente_equivocado', nota: '', anuladaPor: { uid: 'chof1', nombre: 'C' }, anuladaEn: new Date(), fechaVenta: '2026-09-11', ...over } })

  test('el chofer anula SU remito de hoy; solo el campo anulacion', async () => {
    await seedTodos()
    await assertSucceeds(updateDoc(doc(db('chof1'), 'ventasCamion/r1'), anulacion()))
    await assertFails(updateDoc(doc(db('chof1'), 'ventasCamion/r2'), { ...anulacion(), total: 5 }))
  })
  test('no otro chofer, ni caja, ni una factura, ni una ya anulada, ni con la liquidación de ese día cerrada, ni con otro estado', async () => {
    await seedTodos()
    await assertFails(updateDoc(doc(db('chof2'), 'ventasCamion/r2'), anulacion({ anuladaPor: { uid: 'chof2', nombre: 'X' } })))
    await assertFails(updateDoc(doc(db('caja1'), 'ventasCamion/r2'), anulacion({ anuladaPor: { uid: 'caja1', nombre: 'X' } })))
    await assertFails(updateDoc(doc(db('chof1'), 'ventasCamion/r3'), anulacion()))
    await assertFails(updateDoc(doc(db('chof1'), 'ventasCamion/r4'), anulacion()))
    await assertFails(updateDoc(doc(db('chof1'), 'ventasCamion/r2'), anulacion({ fechaVenta: '2026-09-10' })))
    await assertFails(updateDoc(doc(db('chof1'), 'ventasCamion/r2'), anulacion({ estado: 'pendiente' })))
    await assertFails(updateDoc(doc(db('chof1'), 'ventasCamion/r2'), anulacion({ tipo: 'factura' })))
    // Pasada la hora desde la venta (2026-09-12), el chofer ya no anula solo.
    await assertFails(updateDoc(doc(db('chof1'), 'ventasCamion/r5'), anulacion()))
  })
})

describe('anulación de ventas de días ya cerrados, pedida por facturación (2026-09-11)', () => {
  const ventaCamion = (over = {}) => ({
    canal: 'contado', camionId: '', choferId: 'chof1', choferNombre: 'C', clienteId: 'cli', clienteNombre: 'Cliente', items: [], total: 1000,
    formaPago: 'contado_efectivo', fecha: new Date('2026-09-05T12:00:00-03:00'), pedidoId: null, factura: { estado: 'emitida', numero: 5, puntoVenta: 1104, cbteTipo: 1, cae: '1' }, ...over,
  })
  const ventaVentanilla = (over = {}) => ({
    plantaId: 'torcuato', canal: 'contado', cajaId: 'caja1', cajaNombre: 'Caja', clienteId: 'cli', clienteNombre: 'Cliente', items: [], total: 1000, formaPago: 'contado_efectivo',
    estado: 'entregado', turno: 1, turnoEstado: 'en_espera', fecha: new Date('2026-09-05T12:00:00-03:00'), factura: { estado: 'emitida', numero: 6, puntoVenta: 1104, cbteTipo: 1, cae: '1' }, ...over,
  })
  const seedTodos = () => seed(async (d) => {
    await setDoc(doc(d, 'users/fac'), { rol: 'facturacion', estado: 'activo' })
    await setDoc(doc(d, 'users/adm'), { rol: 'super_admin', estado: 'activo' })
    await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' })
    await setDoc(doc(d, 'ventasCamion/fc1'), ventaCamion())
    const { factura: _f, ...sinFactura } = ventaCamion()
    await setDoc(doc(d, 'ventasCamion/fc2'), sinFactura)
    await setDoc(doc(d, 'ventasCamion/fr1'), { ...sinFactura, formaPago: 'cuenta_corriente', comprobanteInterno: { tipo: 'remito', puntoVenta: 1105, numero: 700 } })
    await setDoc(doc(d, 'ventasVentanilla/fv1'), ventaVentanilla())
    // Cierres de ese día, ya hechos.
    await setDoc(doc(d, 'liquidaciones/2026-09-05_chof1'), { fecha: '2026-09-05', choferId: 'chof1', plantaId: 'torcuato' })
    await setDoc(doc(d, 'rendiciones/2026-09-05_caja1'), { fecha: '2026-09-05', sujetoId: 'caja1', plantaId: 'torcuato' })
  })
  const solicitud = (uid, ventaId, coleccion, over = {}) => ({
    ventaId, coleccion, origen: 'facturacion', clienteId: 'cli', plantaId: 'torcuato', cajaId: uid, cajaNombre: 'F', clienteNombre: 'Cliente', fechaVenta: '2026-09-05',
    ...(coleccion === 'ventasCamion' ? { choferId: 'chof1', choferNombre: 'C' } : {}),
    facturaOriginal: { cbteTipo: 1, puntoVenta: 1104, numero: 5, cae: '1', total: 1000 }, items: [], total: 1000, formaPago: 'contado_efectivo',
    motivo: 'cliente_equivocado', nota: '', estado: 'pendiente', solicitadoPor: { uid, nombre: 'F' }, solicitadaEn: new Date(), resueltaPor: null, ...over,
  })

  test('facturación (y el super_admin) piden anular una factura del camión o de ventanilla aunque el día esté cerrado', async () => {
    await seedTodos()
    await assertSucceeds(setDoc(doc(db('fac'), 'anulacionesVentanilla/fc1'), solicitud('fac', 'fc1', 'ventasCamion')))
    await assertSucceeds(setDoc(doc(db('adm'), 'anulacionesVentanilla/fv1'), solicitud('adm', 'fv1', 'ventasVentanilla')))
  })
  test('sin origen facturación, con otro origen, por caja, sobre una venta sin factura, con otro chofer o con otro estado, no', async () => {
    await seedTodos()
    const { origen: _o, ...sinOrigen } = solicitud('fac', 'fc1', 'ventasCamion')
    await assertFails(setDoc(doc(db('fac'), 'anulacionesVentanilla/fc1'), sinOrigen))
    await assertFails(setDoc(doc(db('fac'), 'anulacionesVentanilla/fc1'), solicitud('fac', 'fc1', 'ventasCamion', { origen: 'caja' })))
    // Caja no puede usar el atajo de facturación (su liquidación de ese día ya está cerrada).
    await assertFails(setDoc(doc(db('caja1'), 'anulacionesVentanilla/fc1'), solicitud('caja1', 'fc1', 'ventasCamion')))
    await assertFails(setDoc(doc(db('fac'), 'anulacionesVentanilla/fc2'), solicitud('fac', 'fc2', 'ventasCamion')))
    await assertFails(setDoc(doc(db('fac'), 'anulacionesVentanilla/fc1'), solicitud('fac', 'fc1', 'ventasCamion', { choferId: 'otro' })))
    await assertFails(setDoc(doc(db('fac'), 'anulacionesVentanilla/fc1'), solicitud('fac', 'fc1', 'ventasCamion', { estado: 'aprobada' })))
    await assertFails(setDoc(doc(db('fac'), 'anulacionesVentanilla/fc1'), solicitud('fac', 'fc1', 'ventasCamion', { solicitadoPor: { uid: 'otro', nombre: 'X' } })))
    await assertFails(setDoc(doc(db('chof1'), 'anulacionesVentanilla/fc1'), solicitud('chof1', 'fc1', 'ventasCamion')))
  })
  const anulacionRemito = (uid, over = {}) => ({ anulacion: { estado: 'anulada', solicitudId: '', tipo: 'remito', origen: 'facturacion', motivo: 'cliente_equivocado', nota: '', anuladaPor: { uid, nombre: 'F' }, anuladaEn: new Date(), fechaVenta: '2026-09-05', ...over } })
  test('facturación anula un remito de cta. cte. de un día cerrado; el chofer no, y facturación tampoco sin origen ni sobre una factura', async () => {
    await seedTodos()
    await assertFails(updateDoc(doc(db('chof1'), 'ventasCamion/fr1'), anulacionRemito('chof1')))
    const { anulacion: { origen: _o, ...sinOrigen } } = anulacionRemito('fac')
    await assertFails(updateDoc(doc(db('fac'), 'ventasCamion/fr1'), { anulacion: sinOrigen }))
    await assertFails(updateDoc(doc(db('fac'), 'ventasCamion/fc1'), anulacionRemito('fac')))
    await assertFails(updateDoc(doc(db('caja1'), 'ventasCamion/fr1'), anulacionRemito('caja1')))
    await assertSucceeds(updateDoc(doc(db('fac'), 'ventasCamion/fr1'), anulacionRemito('fac')))
  })
})

describe('rol en el token (custom claims, 2026-09-12): las reglas no leen users/{uid} si el token trae el rol', () => {
  const conClaims = (uid, claims) => testEnv.authenticatedContext(uid, claims).firestore()
  const venta = (choferId) => ({ canal: 'contado', camionId: '', choferId, choferNombre: 'C', clienteId: 'cli', clienteNombre: 'Cliente', items: [], total: 100, formaPago: 'cuenta_corriente', fecha: new Date(), pedidoId: null })
  const seedTodos = () => seed(async (d) => {
    await setDoc(doc(d, 'ventasCamion/vc1'), venta('chofTok'))
    await setDoc(doc(d, 'ventasCamion/vc2'), venta('otroChofer'))
    await setDoc(doc(d, 'ventasCamion/vc3'), venta('chofDoc'))
    // Documento que dice INACTIVO: si el token dice activo, manda el token (lo mantiene el server).
    await setDoc(doc(d, 'users/chofDoc'), { rol: 'chofer', estado: 'activo' })
    await setDoc(doc(d, 'orders/o1'), pedido())
  })
  test('un chofer SIN documento pero con claims lee su venta y no la de otro', async () => {
    await seedTodos()
    const ch = conClaims('chofTok', { rol: 'chofer', estado: 'activo' })
    await assertSucceeds(getDoc(doc(ch, 'ventasCamion/vc1')))
    await assertFails(getDoc(doc(ch, 'ventasCamion/vc2')))
  })
  test('claims de super_admin y de caja con planta valen igual que el documento', async () => {
    await seedTodos()
    await assertSucceeds(getDoc(doc(conClaims('admTok', { rol: 'super_admin', estado: 'activo' }), 'ventasCamion/vc2')))
    await assertSucceeds(getDoc(doc(conClaims('cajaTok', { rol: 'caja', estado: 'activo', planta: 'torcuato' }), 'ventasCamion/vc2')))
    // Rol adicional por claims: un logístico que también hace caja lee remitos de carga como caja.
    await assertSucceeds(getDoc(doc(conClaims('logTok', { rol: 'logistica', estado: 'activo', rolesExtra: ['caja'], planta: 'torcuato' }), 'ventasCamion/vc2')))
  })
  test('sin claims se sigue leyendo el documento (camino viejo), y un token sin rol ni doc no entra', async () => {
    await seedTodos()
    await assertSucceeds(getDoc(doc(db('chofDoc'), 'ventasCamion/vc3')))
    await assertFails(getDoc(doc(db('chofDoc'), 'ventasCamion/vc2')))
    await assertFails(getDoc(doc(db('nadie'), 'ventasCamion/vc1')))
    await assertFails(getDoc(doc(conClaims('cliTok', { rol: 'cliente', estado: 'activo' }), 'ventasCamion/vc1')))
  })
  test('el token de "Ver como" sigue sin poder escribir aunque traiga rol', async () => {
    await seedTodos()
    const verComo = conClaims('admTok', { rol: 'super_admin', estado: 'activo', impersonadoPor: 'jefe', impersonadoPorNombre: 'Jefe' })
    await assertFails(updateDoc(doc(verComo, 'orders/o1'), { status: 'confirmado' }))
  })
})

// ── El viaje se cierra en dos mitades independientes (2026-09-18) ─────────────
// PLATA: liquidaciones/{remitoId} (la cierra caja). MERCADERÍA:
// cierresMercaderia/{remitoId} (la escribe el servidor al contarse la descarga).
// Muelle trabaja 24 horas y caja 12: el camión que vuelve a las 20 descarga sin
// problema pero no tiene a quién rendirle el dinero, así que cada mitad se
// cierra cuando puede y en cualquier orden.
describe('viaje en dos partes: plata y mercadería (2026-09-18)', () => {
  const desglose = (billetes = {}, sinEfectivo = false) => {
    const b = { '20000': 0, '10000': 0, '2000': 0, '1000': 0, '500': 0, ...billetes }
    const total = sinEfectivo ? 0 : b['20000'] * 20000 + b['10000'] * 10000 + b['2000'] * 2000 + b['1000'] * 1000 + b['500'] * 500
    return { billetes: b, cambioChico: 0, sinEfectivo, total }
  }
  // Cierre de PLATA: sin `productos` (la mercadería vive aparte desde el corte).
  const plata = (extra = {}) => ({
    fecha: '2026-09-18', plantaId: 'torcuato', choferId: 'chof1', choferNombre: 'Chofer Uno',
    remitoId: 'r1', remitoCodigo: 'RC-DT-000001',
    cambios: { registrados: 0, rotasRecibidas: 0 },
    importes: { contadoEfectivo: 1000, contadoTransferencia: 0, cuentaCorriente: 0, total: 1000 },
    efectivoARendir: 1000, efectivoRecibido: 1000, diferenciaEfectivo: 0,
    numero: 1, codigo: 'LQ-21-000001',
    firmaRepartidor: 'data:image/png;base64,AAAA', firmanteRepartidor: 'Chofer Uno',
    firmaRecibe: 'data:image/png;base64,BBBB', firmanteRecibe: 'Caja',
    cheques: [], retenciones: [], valoresFaltantes: { cantidad: 0, total: 0 }, entregaId: null,
    conteoBilletes: { redonhielo: desglose({ '1000': 1 }), rolito: desglose({}, true) },
    cerradaPor: { uid: 'caja1', nombre: 'Caja' }, createdAt: new Date(), ...extra,
  })
  const mercaderia = (extra = {}) => ({
    remitoId: 'r1', remitoCodigo: 'RC-DT-000001', plantaId: 'torcuato',
    choferId: 'chof1', choferNombre: 'Chofer Uno', diaReparto: '2026-09-18',
    productos: [], envases: { salieron: {}, volvieron: {}, diferencia: {}, racksFaltantes: [] },
    faltante: { bolsasFaltantes: 0, bolsasSobrantes: 0, productos: [], grave: false, umbral: 10 },
    descargaIds: ['d1'], descargaCodigos: ['DC-DT-000001'],
    contadaPor: { uid: 'mue1', nombre: 'Muelle' }, contadaEn: new Date(), ...extra,
  })
  const seedTodos = () => seed(async (d) => {
    await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' })
    await setDoc(doc(d, 'users/sup1'),  { rol: 'supervisor', estado: 'activo' })
  })

  test('la PLATA del viaje se cierra con id {remitoId}', async () => {
    await seedTodos()
    await assertSucceeds(setDoc(doc(db('caja1'), 'liquidaciones/r1'), plata()))
  })

  test('el id de la liquidación tiene que ser ESE remito, no otro ni la clave por día', async () => {
    await seedTodos()
    await assertFails(setDoc(doc(db('caja1'), 'liquidaciones/r9'), plata()))
    await assertFails(setDoc(doc(db('caja1'), 'liquidaciones/2026-09-18_chof1'), plata()))
    await assertFails(setDoc(doc(db('caja1'), 'liquidaciones/r1'), plata({ remitoId: 7 })))
  })

  test('el cierre de la plata ya NO exige productos (la mercadería vive aparte)', async () => {
    await seedTodos()
    // Sin productos entra; con productos (cierre viejo) también, mientras sea lista.
    await assertSucceeds(setDoc(doc(db('caja1'), 'liquidaciones/r1'), plata()))
    await assertSucceeds(setDoc(doc(db('caja1'), 'liquidaciones/r2'), plata({ remitoId: 'r2', productos: [] })))
    await assertFails(setDoc(doc(db('caja1'), 'liquidaciones/r3'), plata({ remitoId: 'r3', productos: 'nada' })))
  })

  test('la MERCADERÍA se puede cerrar antes que la plata: el cierre del server no traba a caja', async () => {
    await seedTodos()
    // Muelle contó de noche y el servidor cerró la mercadería del viaje.
    await seed((d) => setDoc(doc(d, 'cierresMercaderia/r1'), mercaderia()))
    // A la mañana caja cierra la plata del MISMO viaje.
    await assertSucceeds(setDoc(doc(db('caja1'), 'liquidaciones/r1'), plata()))
  })

  test('y la PLATA se puede cerrar antes que la mercadería: son independientes', async () => {
    await seedTodos()
    // Caja cierra la plata con el camión todavía sin contar.
    await assertSucceeds(setDoc(doc(db('caja1'), 'liquidaciones/r1'), plata()))
    // Y el cierre de mercadería que llega después lo escribe el servidor: ningún
    // cliente puede, ni siquiera caja con la plata ya cerrada.
    await assertFails(setDoc(doc(db('caja1'), 'cierresMercaderia/r1'), mercaderia()))
  })

  test('un cobrador sin camión sigue cerrando con la clave por día', async () => {
    await seedTodos()
    const { remitoId: _r, remitoCodigo: _rc, ...sinViaje } = plata({ choferId: 'sup1', choferNombre: 'Supervisor' })
    await assertSucceeds(setDoc(doc(db('caja1'), 'liquidaciones/2026-09-18_sup1'), sinViaje))
    // Con la clave del viaje, que él no tiene, no.
    await assertFails(setDoc(doc(db('caja1'), 'liquidaciones/r1'), sinViaje))
  })

  test('el chofer lee la liquidación de SU viaje aunque el id ya no lleve su uid', async () => {
    await seedTodos()
    await seed(async (d) => {
      await setDoc(doc(d, 'liquidaciones/r1'), plata())
      await setDoc(doc(d, 'liquidaciones/r9'), plata({ remitoId: 'r9', choferId: 'otro' }))
    })
    await assertSucceeds(getDoc(doc(db('chof1'), 'liquidaciones/r1')))
    await assertFails(getDoc(doc(db('chof1'), 'liquidaciones/r9')))
  })

  // ── cuadre de envases guardado con el conteo (2026-09-18) ──
  test('la descarga puede traer el cuadre de envases del viaje; mal formado no entra; el número lo pone el server', async () => {
    await seed(async (d) => {
      await setDoc(doc(d, 'users/mue1'), { rol: 'muelle', estado: 'activo', planta: 'torcuato' })
      // El viaje al que se imputa tiene que existir y ser del mismo repartidor (2026-09-22).
      await setDoc(doc(d, 'remitosCarga/r1'), { plantaId: 'torcuato', choferId: 'chof1', camionId: 'cam1', estado: 'entregado', fecha: new Date() })
    })
    const descarga = (extra = {}) => ({
      plantaId: 'torcuato', camionId: 'cam1', camionLabel: 'AB123CD',
      choferId: 'chof1', choferNombre: 'Chofer Uno', remitoId: 'r1', remitoCodigo: 'RC-DT-000001',
      items: [{ productoId: 'bolsa_10kg', nombre: 'Hielo 10kg', cantidad: 20 }],
      bolsasRotas: [], envases: { tarimasMadera: 1, palletsMetal: 0, puntales: 4, aros: 1, racks: [12] },
      registradoPor: { uid: 'mue1', nombre: 'Muelle' }, fecha: new Date(), diaReparto: '2026-09-18', ...extra,
    })
    const cuadre = { salieron: { tarimasMadera: 1, palletsMetal: 1 }, volvieron: { tarimasMadera: 1, palletsMetal: 0 }, diferencia: { tarimasMadera: 0, palletsMetal: -1 }, racksFaltantes: [15] }
    // Sin cuadre (fletero sin remito digital) y con cuadre: las dos entran.
    await assertSucceeds(setDoc(doc(db('mue1'), 'descargasCamion/d1'), descarga()))
    await assertSucceeds(setDoc(doc(db('mue1'), 'descargasCamion/d2'), descarga({ envasesCuadre: cuadre })))
    // Mal formado: no.
    await assertFails(setDoc(doc(db('mue1'), 'descargasCamion/d3'), descarga({ envasesCuadre: 'faltan 2' })))
    await assertFails(setDoc(doc(db('mue1'), 'descargasCamion/d4'), descarga({ envasesCuadre: { ...cuadre, racksFaltantes: [15, 15] } })))
    // El número correlativo lo asigna el servidor cuando el doc llega (la tablet
    // guarda sin señal), así que la descarga entra SIN numero ni codigo.
    await assertSucceeds(setDoc(doc(db('mue1'), 'descargasCamion/d5'), descarga({ envasesCuadre: cuadre })))
  })
})

// ── desviosDescarga con la clave del viaje y el estado 'observado' (2026-09-18) ─
describe('desviosDescarga: id por viaje y desvío observado (2026-09-18)', () => {
  const seedTodos = () => seed(async (d) => {
    await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/aut1'),  { rol: 'facturacion', estado: 'activo', autorizaAnulaciones: true })
  })
  const pedido = (extra = {}) => ({
    fecha: '2026-09-18', plantaId: 'torcuato', choferId: 'chof1', choferNombre: 'Chofer Uno', depositoTango: '21',
    remitoId: 'r1', remitoCodigo: 'RC-DT-000001',
    bolsasFaltantes: 42, productos: [{ productoId: 'b3', nombre: 'Hielo 3 kg', faltan: 42 }], umbral: 10,
    estado: 'pendiente', motivo: 'a_investigar', nota: 'se contó dos veces',
    solicitadoPor: { uid: 'caja1', nombre: 'Caja' }, solicitadaEn: new Date(), resueltaPor: null, ...extra,
  })

  test('con remitoId el id del desvío es el del VIAJE, no {fecha}_{chofer}', async () => {
    await seedTodos()
    await assertSucceeds(setDoc(doc(db('caja1'), 'desviosDescarga/r1'), pedido()))
    await assertFails(setDoc(doc(db('caja1'), 'desviosDescarga/2026-09-18_chof1'), pedido()))
    await assertFails(setDoc(doc(db('caja1'), 'desviosDescarga/r9'), pedido()))
  })

  test('sin remitoId (fletero, o un desvío anterior al corte) sigue valiendo la clave por día', async () => {
    await seedTodos()
    const { remitoId: _r, remitoCodigo: _rc, ...viejo } = pedido()
    await assertSucceeds(setDoc(doc(db('caja1'), 'desviosDescarga/2026-09-18_chof1'), viejo))
    await assertFails(setDoc(doc(db('caja1'), 'desviosDescarga/r1'), viejo))
  })

  // 'observado' = caja cerró haciéndose cargo del faltante sin esperar a nadie.
  // Un tema de stock nunca traba el turno de caja, pero queda escrito.
  test("caja crea el desvío 'observado' directamente, sin autorización de nadie", async () => {
    await seedTodos()
    await assertSucceeds(setDoc(doc(db('caja1'), 'desviosDescarga/r1'), pedido({ estado: 'observado' })))
    // Y sigue sin poder nacer resuelto.
    await assertFails(setDoc(doc(db('caja1'), 'desviosDescarga/r2'), pedido({ remitoId: 'r2', estado: 'aprobada' })))
    await assertFails(setDoc(doc(db('caja1'), 'desviosDescarga/r3'), pedido({ remitoId: 'r3', estado: 'rechazada' })))
  })

  test('un desvío observado no se resuelve después: la autorización es solo para los pendientes', async () => {
    await seedTodos()
    await seed((d) => setDoc(doc(d, 'desviosDescarga/r1'), pedido({ estado: 'observado' })))
    await assertFails(updateDoc(doc(db('aut1'), 'desviosDescarga/r1'), {
      estado: 'aprobada', resueltaPor: { uid: 'aut1', nombre: 'A' }, resueltaEn: new Date(), notaResolucion: '',
    }))
  })
})

// ── Los gates de anulación preguntan por la PLATA DEL VIAJE (2026-09-18) ──────
// Un chofer puede hacer dos viajes en un día y cerrar el primero mientras el
// segundo sigue en la calle: preguntar por {fecha}_{uid} trababa anulaciones
// legítimas del viaje abierto.
describe('anulaciones: el gate es el viaje, no el día (2026-09-18)', () => {
  const ventaRemito = (over = {}) => ({
    canal: 'contado', camionId: 'cam1', choferId: 'chof1', choferNombre: 'C', clienteId: 'cli', clienteNombre: 'Cliente',
    items: [], total: 1000, formaPago: 'cuenta_corriente', fecha: new Date(), pedidoId: null,
    comprobanteInterno: { tipo: 'remito', puntoVenta: 1105, numero: 700 }, ...over,
  })
  const ventaFacturada = (over = {}) => ({
    canal: 'contado', camionId: 'cam1', choferId: 'chof1', choferNombre: 'C', clienteId: 'cli', clienteNombre: 'Cliente',
    items: [], total: 20000, formaPago: 'contado_efectivo', fecha: new Date(), pedidoId: null,
    tango: { estado: 'confirmado' },
    factura: { estado: 'emitida', numero: 300, puntoVenta: 1104, cbteTipo: 1, cae: '75', caeFchVto: '20260920' }, ...over,
  })
  const cobranza = (over = {}) => ({
    origen: 'chofer', registradoPor: { uid: 'chof1', nombre: 'C' }, clienteId: 'cli', clienteNombre: 'Cliente',
    importe: 5000, formaPago: 'contado_efectivo', numeroRecibo: 'RS-000168', fecha: new Date(), ...over,
  })
  const seedTodos = () => seed(async (d) => {
    await setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' })
    await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
    // Viaje r1 CERRADO (la plata ya se rindió) y viaje r2 todavía abierto.
    await setDoc(doc(d, 'liquidaciones/r1'), { fecha: '2026-09-18', remitoId: 'r1', choferId: 'chof1', plantaId: 'torcuato' })
    // Remitos de cta. cte. de cada viaje.
    await setDoc(doc(d, 'ventasCamion/vr1'), ventaRemito({ remitoId: 'r1' }))
    await setDoc(doc(d, 'ventasCamion/vr2'), ventaRemito({ remitoId: 'r2' }))
    // Facturas de cada viaje.
    await setDoc(doc(d, 'ventasCamion/vf1'), ventaFacturada({ remitoId: 'r1' }))
    await setDoc(doc(d, 'ventasCamion/vf2'), ventaFacturada({ remitoId: 'r2', factura: { estado: 'emitida', numero: 301, puntoVenta: 1104, cbteTipo: 1, cae: '76', caeFchVto: '20260920' } }))
    // Recibos de cada viaje.
    await setDoc(doc(d, 'cobranzas/rc1'), cobranza({ remitoId: 'r1' }))
    await setDoc(doc(d, 'cobranzas/rc2'), cobranza({ remitoId: 'r2', numeroRecibo: 'RS-000169' }))
    // Y una venta vieja, sin remitoId: sigue preguntando por la clave del día.
    await setDoc(doc(d, 'ventasCamion/vieja'), ventaRemito())
    await setDoc(doc(d, 'liquidaciones/2026-09-18_chof1'), { fecha: '2026-09-18', choferId: 'chof1', plantaId: 'torcuato' })
  })
  const anulacionRemito = (over = {}) => ({ anulacion: { estado: 'anulada', solicitudId: '', tipo: 'remito', motivo: 'cliente_equivocado', nota: '', anuladaPor: { uid: 'chof1', nombre: 'C' }, anuladaEn: new Date(), fechaVenta: '2026-09-18', ...over } })

  test('el chofer NO anula el remito de un viaje ya liquidado, y SÍ el del viaje que sigue abierto', async () => {
    await seedTodos()
    await assertFails(updateDoc(doc(db('chof1'), 'ventasCamion/vr1'), anulacionRemito()))
    await assertSucceeds(updateDoc(doc(db('chof1'), 'ventasCamion/vr2'), anulacionRemito()))
  })

  test('una venta sin remitoId (anterior al corte) sigue mirando la liquidación del día', async () => {
    await seedTodos()
    await assertFails(updateDoc(doc(db('chof1'), 'ventasCamion/vieja'), anulacionRemito()))
  })

  const solicitud = (ventaId, over = {}) => ({
    ventaId, coleccion: 'ventasCamion', plantaId: 'torcuato', cajaId: 'caja1', cajaNombre: 'Caja',
    choferId: 'chof1', choferNombre: 'C', clienteNombre: 'Cliente', fechaVenta: '2026-09-18',
    facturaOriginal: { cbteTipo: 1, puntoVenta: 1104, numero: 300, cae: '75', total: 20000 },
    motivo: 'cliente_equivocado', nota: '', estado: 'pendiente',
    solicitadoPor: { uid: 'caja1', nombre: 'Caja' }, solicitadaEn: new Date(), resueltaPor: null, ...over,
  })

  test('caja NO pide anular la factura de un viaje ya liquidado, y SÍ la del viaje abierto', async () => {
    await seedTodos()
    await assertFails(setDoc(doc(db('caja1'), 'anulacionesVentanilla/vf1'), solicitud('vf1')))
    await assertSucceeds(setDoc(doc(db('caja1'), 'anulacionesVentanilla/vf2'), solicitud('vf2')))
  })

  const solicitudRecibo = (cobranzaId, over = {}) => ({
    cobranzaId, cobradorId: 'chof1', clienteNombre: 'Cliente', importe: 5000, fechaCobranza: '2026-09-18',
    motivo: 'numero_de_cheque_mal', nota: '', estado: 'pendiente',
    solicitadoPor: { uid: 'chof1', nombre: 'C' }, solicitadaEn: new Date(), resueltaPor: null, ...over,
  })

  test('el cobrador NO pide anular el recibo de un viaje ya liquidado, y SÍ el del viaje abierto', async () => {
    await seedTodos()
    await assertFails(setDoc(doc(db('chof1'), 'anulacionesCobranza/rc1'), solicitudRecibo('rc1')))
    await assertSucceeds(setDoc(doc(db('chof1'), 'anulacionesCobranza/rc2'), solicitudRecibo('rc2')))
  })
})

// ── El chofer mira las dos mitades de SU viaje antes de que existan (2026-09-18) ──
// `liquidaciones/{remitoId}` la escribe caja a la mañana y `cierresMercaderia/
// {remitoId}` el servidor al contarse la descarga: el teléfono se suscribe a
// las dos desde que el camión sale, con el doc todavía inexistente. Ahí no hay
// `resource` que mirar y el id no dice de quién es el viaje, así que la
// pertenencia sale del remito.
describe('el chofer lee las dos mitades de su viaje (2026-09-18)', () => {
  const seedViajes = () => seed(async (d) => {
    await setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' })
    await setDoc(doc(d, 'users/chof2'), { rol: 'chofer', estado: 'activo' })
    await setDoc(doc(d, 'remitosCarga/r1'), {
      numero: 1, codigo: 'RC-DT-000001', plantaId: 'torcuato', camionId: 'cam1', camionLabel: 'AAA111',
      choferId: 'chof1', choferNombre: 'Uno', items: [{ productoId: 'bolsa_10kg', nombre: '10kg', cantidad: 10 }],
      palletsCarga: 1, estado: 'salido', fecha: new Date(),
    })
    await setDoc(doc(d, 'remitosCarga/r2'), {
      numero: 2, codigo: 'RC-DT-000002', plantaId: 'torcuato', camionId: 'cam2', camionLabel: 'BBB222',
      choferId: 'chof2', choferNombre: 'Dos', items: [{ productoId: 'bolsa_10kg', nombre: '10kg', cantidad: 10 }],
      palletsCarga: 1, estado: 'salido', fecha: new Date(),
    })
  })

  test('la plata de su viaje, aunque caja todavía no la haya cerrado', async () => {
    await seedViajes()
    await assertSucceeds(getDoc(doc(db('chof1'), 'liquidaciones/r1')))
    await assertFails(getDoc(doc(db('chof1'), 'liquidaciones/r2')))
  })

  test('la mercadería de su viaje, aunque el servidor todavía no la haya escrito', async () => {
    await seedViajes()
    await assertSucceeds(getDoc(doc(db('chof1'), 'cierresMercaderia/r1')))
    await assertFails(getDoc(doc(db('chof1'), 'cierresMercaderia/r2')))
  })

  test('la clave vieja por día sigue andando y no se cuela la de otro', async () => {
    await seedViajes()
    await assertSucceeds(getDoc(doc(db('chof1'), 'liquidaciones/2026-09-18_chof1')))
    await assertFails(getDoc(doc(db('chof1'), 'liquidaciones/2026-09-18_chof2')))
  })
})

// ── Auditoría del módulo del chofer (2026-09-26): C4 y C5 ─────────────────────
// Primero se escribieron para reproducir el hueco (fallaban con las reglas
// viejas) y después se corrigieron las reglas.
describe('auditoría chofer — C4: entrega con remito de fábrica', () => {
  const seedBase = () => seed(async (d) => {
    await setDoc(doc(d, 'users/ch'), { rol: 'chofer', estado: 'activo', email: 'ch@x.com' })
    await setDoc(doc(d, 'remitosCarga/rem1'), { choferId: 'ch', camionId: 'cam1', estado: 'salido', fecha: new Date() })
    await setDoc(doc(d, 'remitosCarga/remOtro'), { choferId: 'otro', camionId: 'cam2', estado: 'salido', fecha: new Date() })
  })
  const seedPedido = (extra = {}) => seed((d) => setDoc(doc(d, 'orders/o1'), pedido({ driverId: 'ch@x.com', entregaSinComprobante: true, ...extra })))
  const entrega = (remitoId = 'rem1', cantidad = 460) => ({
    choferId: 'ch', choferNombre: 'Chofer Uno', remitoId, remitoCodigo: 'RC-DT-000001', camionId: 'cam1',
    dia: '2026-09-23', en: new Date(), productos: [{ productoId: 'bolsa_2kg', nombre: 'Hielo bolsa 2kg', cantidad }],
  })
  const marcar = (e) => updateDoc(doc(db('ch', 'ch@x.com'), 'orders/o1'), {
    status: 'entregado', productosEntregados: [{ name: 'Hielo bolsa 2kg', quantity: 460, productoId: 'bolsa_2kg' }],
    entregaParcial: false, notaEntrega: '', updatedAt: new Date(), entregaFabrica: e,
  })

  test('el chofer registra la entrega en SU viaje', async () => {
    await seedBase(); await seedPedido()
    await assertSucceeds(marcar(entrega('rem1')))
  })
  test('sin viaje (remitoId null) también: se ubica por chofer y día', async () => {
    await seedBase(); await seedPedido()
    await assertSucceeds(marcar(entrega(null)))
  })
  test('NO la imputa al viaje de otro chofer', async () => {
    await seedBase(); await seedPedido()
    await assertFails(marcar(entrega('remOtro')))
  })
  test('NO reescribe una entrega de fábrica ya registrada (por ejemplo, para inflar cantidades)', async () => {
    await seedBase(); await seedPedido({ status: 'entregado', entregaFabrica: entrega('rem1', 100) })
    await assertFails(updateDoc(doc(db('ch', 'ch@x.com'), 'orders/o1'), { entregaFabrica: entrega('rem1', 900), updatedAt: new Date() }))
  })
})

describe('auditoría chofer — C5: la venta y la cobranza van a SU viaje', () => {
  const seedBase = () => seed(async (d) => {
    await setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' })
    await setDoc(doc(d, 'users/sup1'), { rol: 'supervisor', estado: 'activo' })
    await setDoc(doc(d, 'remitosCarga/rem1'), { choferId: 'chof1', camionId: 'cam1', estado: 'salido', fecha: new Date() })
    await setDoc(doc(d, 'remitosCarga/remSup'), { choferId: 'sup1', camionId: 'cam9', estado: 'salido', fecha: new Date() })
    await setDoc(doc(d, 'remitosCarga/remOtro'), { choferId: 'otro', camionId: 'cam2', estado: 'salido', fecha: new Date() })
  })
  const venta = (extra = {}) => ({
    canal: 'contado', camionId: 'cam1', choferId: 'chof1', choferNombre: 'Chofer Uno',
    clienteId: 'cli', clienteNombre: 'Cliente SA',
    items: [{ productoId: 'bolsa_10kg', nombre: 'Hielo 10kg', cantidad: 5, precioUnitario: 100 }],
    total: 500, formaPago: 'contado_efectivo', fecha: new Date(),
    pedidoId: null, tango: { estado: 'pendiente' }, ...extra,
  })
  const cobranza = (extra = {}) => ({
    origen: 'cobrador', registradoPor: { uid: 'chof1', nombre: 'Chofer Uno' },
    clienteId: 'cli', clienteNombre: 'Cliente SA', importe: 45000.5,
    formaPago: 'mixto', fecha: new Date(), numeroRecibo: 'RS-000124', empresa: 'redonhielo',
    imputaciones: [{ comprobanteTipo: 'FAC', comprobanteNumero: 'A-0001-00000001', saldoAlMomento: 60000, importeImputado: 45000.5 }],
    medios: { efectivo: 45000.5, transferencia: 0, cheques: [], retenciones: [] },
    tango: { estado: 'pendiente' }, ...extra,
  })

  test('venta en su viaje, o sin viaje: pasa', async () => {
    await seedBase()
    await assertSucceeds(setDoc(doc(db('chof1'), 'ventasCamion/v1'), venta({ remitoId: 'rem1' })))
    await assertSucceeds(setDoc(doc(db('chof1'), 'ventasCamion/v2'), venta({ remitoId: null })))
    await assertSucceeds(setDoc(doc(db('chof1'), 'ventasCamion/v3'), venta()))
  })
  test('el supervisor vende en SU viaje', async () => {
    await seedBase()
    await assertSucceeds(setDoc(doc(db('sup1'), 'ventasCamion/v1'), venta({ choferId: 'sup1', remitoId: 'remSup', camionId: 'cam9' })))
  })
  test('venta NO va al viaje de otro chofer', async () => {
    await seedBase()
    await assertFails(setDoc(doc(db('chof1'), 'ventasCamion/v1'), venta({ remitoId: 'remOtro' })))
  })
  test('venta NO nace con el control del server', async () => {
    await seedBase()
    await assertFails(setDoc(doc(db('chof1'), 'ventasCamion/v1'), venta({ control: {} })))
  })
  test('cobranza en su viaje pasa; en el de otro no; sin control del server', async () => {
    await seedBase()
    await assertSucceeds(setDoc(doc(db('chof1'), 'cobranzas/c1'), cobranza({ remitoId: 'rem1' })))
    await assertFails(setDoc(doc(db('chof1'), 'cobranzas/c2'), cobranza({ remitoId: 'remOtro', numeroRecibo: 'RS-000125' })))
    await assertFails(setDoc(doc(db('chof1'), 'cobranzas/c3'), cobranza({ control: {}, numeroRecibo: 'RS-000126' })))
  })
  test('los demás roles siguen leyendo las ventas y las cobranzas igual', async () => {
    await seedBase()
    await seed(async (d) => {
      for (const [uid, rol, extra] of [['caja1', 'caja', { planta: 'torcuato' }], ['tes1', 'tesoreria', {}], ['fact1', 'facturacion', {}], ['log1', 'logistica', {}], ['ger1', 'gerente_general', {}], ['gc1', 'gerente_comercial', {}]]) {
        await setDoc(doc(d, `users/${uid}`), { rol, estado: 'activo', ...extra })
      }
      await setDoc(doc(d, 'ventasCamion/v1'), venta({ remitoId: 'rem1' }))
      await setDoc(doc(d, 'cobranzas/c1'), cobranza({ remitoId: 'rem1' }))
    })
    for (const uid of ['caja1', 'tes1', 'fact1', 'log1', 'ger1', 'gc1', 'sup1']) {
      await assertSucceeds(getDoc(doc(db(uid), 'ventasCamion/v1')))
    }
    for (const uid of ['caja1', 'tes1', 'log1', 'sup1']) {
      await assertSucceeds(getDoc(doc(db(uid), 'cobranzas/c1')))
    }
  })
})

describe('auditoría chofer — C2: la entrega de un pedido no sale dos veces', () => {
  test('la segunda venta con el id fijo del pedido es una actualización y se rechaza', async () => {
    await seed((d) => setDoc(doc(d, 'users/chof1'), { rol: 'chofer', estado: 'activo' }))
    const venta = {
      canal: 'contado', camionId: 'cam1', choferId: 'chof1', choferNombre: 'Chofer Uno',
      clienteId: 'cli', clienteNombre: 'Cliente SA',
      items: [{ productoId: 'bolsa_10kg', nombre: 'Hielo 10kg', cantidad: 5, precioUnitario: 100 }],
      total: 500, formaPago: 'cuenta_corriente', fecha: new Date(), pedidoId: 'o1', tango: { estado: 'pendiente' },
    }
    await assertSucceeds(setDoc(doc(db('chof1'), 'ventasCamion/pedido_o1'), venta))
    await assertFails(setDoc(doc(db('chof1'), 'ventasCamion/pedido_o1'), { ...venta, fecha: new Date() }))
  })
})

describe('auditoría chofer — A1: el chofer solo entrega pedidos abiertos', () => {
  const seedBase = (extra = {}) => seed(async (d) => {
    await setDoc(doc(d, 'users/ch'), { rol: 'chofer', estado: 'activo', email: 'ch@x.com' })
    await setDoc(doc(d, 'orders/o1'), pedido({ driverId: 'ch@x.com', historialAcciones: [{ accion: 'creado' }], ...extra }))
  })
  const entregar = (extra = {}) => updateDoc(doc(db('ch', 'ch@x.com'), 'orders/o1'), {
    status: 'entregado', productosEntregados: [{ name: 'Hielo', quantity: 10 }], entregaParcial: false, notaEntrega: '',
    updatedAt: new Date(), historialAcciones: arrayUnion({ accion: 'entregado', en: 'ahora' }), ...extra,
  })
  test('entrega un pedido confirmado o en camino', async () => {
    await seedBase({ status: 'confirmado' })
    await assertSucceeds(entregar())
  })
  test('NO entrega un pedido cancelado', async () => {
    await seedBase({ status: 'cancelado' })
    await assertFails(entregar())
  })
  test('NO vuelve a tocar un pedido ya entregado', async () => {
    await seedBase({ status: 'entregado' })
    await assertFails(entregar({ productosEntregados: [{ name: 'Hielo', quantity: 1 }] }))
  })
  test('NO pone otro estado que entregado', async () => {
    await seedBase({ status: 'confirmado' })
    await assertFails(entregar({ status: 'cancelado' }))
  })
  test('NO reescribe ni borra el historial', async () => {
    await seedBase({ status: 'confirmado' })
    await assertFails(entregar({ historialAcciones: [] }))
  })
  test('logística sigue cancelando y reabriendo pedidos', async () => {
    await seedBase({ status: 'confirmado' })
    await seed((d) => setDoc(doc(d, 'users/log1'), { rol: 'logistica', estado: 'activo' }))
    await assertSucceeds(updateDoc(doc(db('log1'), 'orders/o1'), { status: 'cancelado', updatedAt: new Date() }))
    await assertSucceeds(updateDoc(doc(db('log1'), 'orders/o1'), { status: 'pendiente', updatedAt: new Date() }))
  })
})

describe('auditoría chofer — A4: visitas puntuales', () => {
  const seedBase = () => seed(async (d) => {
    await setDoc(doc(d, 'users/ch'), { rol: 'chofer', estado: 'activo', email: 'ch@x.com' })
    await setDoc(doc(d, 'users/log1'), { rol: 'logistica', estado: 'activo' })
    await setDoc(doc(d, 'visitas-puntuales/sinChofer'), { clientId: 'cli', clientName: 'Cliente', driverId: null, status: 'pendiente', fecha: '2026-09-26' })
    await setDoc(doc(d, 'visitas-puntuales/mia'), { clientId: 'cli', clientName: 'Cliente', driverId: 'ch@x.com', status: 'pendiente', fecha: '2026-09-26' })
    await setDoc(doc(d, 'visitas-puntuales/ajena'), { clientId: 'cli', clientName: 'Cliente', driverId: 'otro@x.com', status: 'pendiente', fecha: '2026-09-26' })
  })
  const ch = () => db('ch', 'ch@x.com')
  test('marca su propia visita como antes', async () => {
    await seedBase()
    await assertSucceeds(updateDoc(doc(ch(), 'visitas-puntuales/mia'), { status: 'visitado' }))
  })
  test('toma una visita sin chofer al marcarla visitada o sin contacto', async () => {
    await seedBase()
    await assertSucceeds(updateDoc(doc(ch(), 'visitas-puntuales/sinChofer'), { status: 'sin_contacto', notas: 'Local cerrado', driverId: 'ch@x.com' }))
  })
  test('no toma una visita sin chofer a nombre de otro ni con otro estado', async () => {
    await seedBase()
    await assertFails(updateDoc(doc(ch(), 'visitas-puntuales/sinChofer'), { status: 'visitado', driverId: 'otro@x.com' }))
    await assertFails(updateDoc(doc(ch(), 'visitas-puntuales/sinChofer'), { status: 'pendiente', driverId: 'ch@x.com' }))
    await assertFails(updateDoc(doc(ch(), 'visitas-puntuales/sinChofer'), { status: 'visitado', driverId: 'ch@x.com', fecha: '2026-10-01' }))
  })
  test('no toca la visita de otro chofer', async () => {
    await seedBase()
    await assertFails(updateDoc(doc(ch(), 'visitas-puntuales/ajena'), { status: 'visitado', driverId: 'ch@x.com' }))
  })
  test('logística sigue asignando visitas', async () => {
    await seedBase()
    await assertSucceeds(updateDoc(doc(db('log1'), 'visitas-puntuales/sinChofer'), { driverId: 'ch@x.com' }))
  })
})

describe('auditoría chofer — A5: perfil propio y lectura de otros usuarios', () => {
  const seedBase = () => seed(async (d) => {
    await setDoc(doc(d, 'users/ch'), { rol: 'chofer', estado: 'activo', email: 'ch@x.com', camionId: 'cam1', subrol: null, tipoChofer: 'fletero', comisionPorcentaje: 8, dni: '11111111', username: '11111111' })
    await setDoc(doc(d, 'users/ch2'), { rol: 'chofer', estado: 'activo', email: 'ch2@x.com', tipoChofer: 'fletero', comisionPorcentaje: 10 })
    await setDoc(doc(d, 'users/cli'), cliente())
    await setDoc(doc(d, 'users/caja1'), { rol: 'caja', estado: 'activo', planta: 'torcuato' })
    await setDoc(doc(d, 'users/log1'), { rol: 'logistica', estado: 'activo' })
  })
  const ch = () => db('ch', 'ch@x.com')
  test('el chofer sigue guardando su suscripción de avisos y su teléfono', async () => {
    await seedBase()
    await assertSucceeds(updateDoc(doc(ch(), 'users/ch'), { pushSubscription: { endpoint: 'x' } }))
    await assertSucceeds(updateDoc(doc(ch(), 'users/ch'), { telefono: '1155556666' }))
  })
  test('el chofer NO se cambia camión, subrol, tipo, comisión, área ni identidad', async () => {
    await seedBase()
    for (const campo of [{ camionId: 'cam9' }, { camionPatente: 'ZZ999ZZ' }, { subrol: 'ayudante' }, { tipoChofer: 'propio' }, { comisionPorcentaje: 50 }, { area: 'heladeras' }, { dni: '22222222' }, { username: '22222222' }, { legajo: 'L1' }]) {
      await assertFails(updateDoc(doc(ch(), 'users/ch'), campo))
    }
  })
  test('el chofer lee clientes pero NO el perfil de otro chofer', async () => {
    await seedBase()
    await assertSucceeds(getDoc(doc(ch(), 'users/cli')))
    await assertFails(getDoc(doc(ch(), 'users/ch2')))
  })
  test('caja y logística siguen leyendo choferes; logística le asigna el camión', async () => {
    await seedBase()
    await assertSucceeds(getDoc(doc(db('caja1'), 'users/ch2')))
    await assertSucceeds(getDoc(doc(db('log1'), 'users/ch2')))
  })
})

describe('auditoría chofer — A7: el chofer lista sus últimas rendiciones', () => {
  const seedBase = () => seed(async (d) => {
    await setDoc(doc(d, 'users/ch'), { rol: 'chofer', estado: 'activo', email: 'ch@x.com' })
    await setDoc(doc(d, 'liquidaciones/rem1'), { choferId: 'ch', fecha: '2026-09-24', codigo: 'LQ-21-000001' })
    await setDoc(doc(d, 'liquidaciones/rem2'), { choferId: 'ch', fecha: '2026-09-25', codigo: 'LQ-21-000002' })
    await setDoc(doc(d, 'liquidaciones/rem3'), { choferId: 'otro', fecha: '2026-09-25', codigo: 'LQ-22-000001' })
  })
  test('lista las suyas por chofer y días (con la clave por viaje)', async () => {
    await seedBase()
    // query y where vienen del import de arriba
    const snap = await assertSucceeds(getDocs(query(collection(db('ch', 'ch@x.com'), 'liquidaciones'), where('choferId', '==', 'ch'), where('fecha', 'in', ['2026-09-24', '2026-09-25']))))
    if (snap.size !== 2) throw new Error('esperaba 2 y vinieron ' + snap.size)
  })
  test('no lista las de otro chofer', async () => {
    await seedBase()
    const { query, where } = await import('firebase/firestore')
    await assertFails(getDocs(query(collection(db('ch', 'ch@x.com'), 'liquidaciones'), where('choferId', '==', 'otro'))))
    await assertFails(getDocs(query(collection(db('ch', 'ch@x.com'), 'liquidaciones'), where('fecha', '==', '2026-09-25'))))
  })
})
