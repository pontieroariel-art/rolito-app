import { test, describe, before, after, beforeEach } from 'node:test'
import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'

// Tests de las reglas de Storage contra el emulador (2026-09-26, auditoría del
// módulo del chofer, hallazgo C3). Hasta acá no había suite de Storage: el
// hueco era que cualquier usuario logueado (un chofer, un cliente) podía listar
// y bajar los PDF compartidos de otros en compartidos/{uid}/. Se prueban también
// las demás carpetas para que el ajuste no cambie nada a los otros roles.
//
// Los usuarios llevan el rol en los custom claims, como en producción desde el
// 12/09 (las reglas leen primero los claims y usan Firestore solo de respaldo).

let testEnv

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]) // "%PDF-1.4"
const IMG = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

const ctx = (uid, claims) => testEnv.authenticatedContext(uid, claims).storage()
const chofer = (uid = 'chofer1') => ctx(uid, { rol: 'chofer' })
const cliente = (uid = 'cliente1') => ctx(uid, { rol: 'cliente' })
const facturacion = (uid = 'fact1') => ctx(uid, { rol: 'facturacion' })
const supervisor = (uid = 'sup1') => ctx(uid, { rol: 'supervisor' })
const comercial = (uid = 'com1') => ctx(uid, { rol: 'comercial' })
const caja = (uid = 'caja1') => ctx(uid, { rol: 'caja' })
const anonimo = () => ctx('anon1', { firebase: { sign_in_provider: 'anonymous' } })
const verComo = (uid = 'chofer1') => ctx(uid, { rol: 'chofer', impersonadoPor: 'admin1' })
const sinSesion = () => testEnv.unauthenticatedContext().storage()

const sembrar = (ruta, bytes = PDF, contentType = 'application/pdf') =>
  testEnv.withSecurityRulesDisabled((c) => c.storage().ref(ruta).put(bytes, { contentType }))

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-rolito',
    storage: { rules: readFileSync('storage.rules', 'utf8'), host: 'localhost', port: 9199 },
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: 'localhost', port: 8080 },
  })
})

after(async () => { await testEnv?.cleanup() })

beforeEach(async () => {
  await testEnv.clearStorage()
  await sembrar('compartidos/chofer1/2026-09-26-factura.pdf')
  await sembrar('compartidos/caja1/2026-09-26-liquidacion.pdf')
  await sembrar('facturas/redonhielo/A-0001-00000101.pdf')
  await sembrar('ticketsServicio/t1/foto.jpg', IMG, 'image/jpeg')
  await sembrar('catalogo/bolsa_2kg', IMG, 'image/png')
})

describe('compartidos/{uid} — PDF para WhatsApp (C3)', () => {
  const propio = 'compartidos/chofer1/2026-09-26-factura.pdf'

  test('el dueño sube su PDF y lo lee (necesita el link)', async () => {
    await assertSucceeds(chofer().ref('compartidos/chofer1/2026-09-26-recibo.pdf').put(PDF, { contentType: 'application/pdf' }))
    await assertSucceeds(chofer().ref(propio).getDownloadURL())
    await assertSucceeds(chofer().ref(propio).getMetadata())
  })

  test('el staff de otros sectores sigue subiendo y leyendo lo suyo', async () => {
    await assertSucceeds(caja().ref('compartidos/caja1/2026-09-26-ticket.pdf').put(PDF, { contentType: 'application/pdf' }))
    await assertSucceeds(caja().ref('compartidos/caja1/2026-09-26-liquidacion.pdf').getDownloadURL())
    await assertSucceeds(facturacion().ref('compartidos/fact1/2026-09-26-lote.pdf').put(PDF, { contentType: 'application/pdf' }))
  })

  test('otro chofer NO lee ni lista la carpeta ajena', async () => {
    await assertFails(chofer('chofer2').ref(propio).getDownloadURL())
    await assertFails(chofer('chofer2').ref(propio).getMetadata())
    await assertFails(chofer('chofer2').ref('compartidos/chofer1').listAll())
  })

  test('un cliente NO lee comprobantes compartidos de nadie', async () => {
    await assertFails(cliente().ref(propio).getDownloadURL())
    await assertFails(cliente().ref('compartidos/chofer1').listAll())
  })

  test('otro rol de oficina NO lee la carpeta de otro usuario', async () => {
    await assertFails(facturacion().ref(propio).getDownloadURL())
    await assertFails(caja().ref(propio).getDownloadURL())
  })

  test('anónimo y sin sesión NO leen', async () => {
    await assertFails(anonimo().ref(propio).getDownloadURL())
    await assertFails(sinSesion().ref(propio).getDownloadURL())
  })

  test('nadie escribe en la carpeta de otro', async () => {
    await assertFails(chofer('chofer2').ref('compartidos/chofer1/x.pdf').put(PDF, { contentType: 'application/pdf' }))
  })

  test('un cliente no sube a compartidos, ni a su propia carpeta', async () => {
    await assertFails(cliente().ref('compartidos/cliente1/x.pdf').put(PDF, { contentType: 'application/pdf' }))
  })

  test('"Ver como" no sube, pero puede mirar lo del usuario que mira', async () => {
    await assertFails(verComo().ref('compartidos/chofer1/x.pdf').put(PDF, { contentType: 'application/pdf' }))
    await assertSucceeds(verComo().ref(propio).getMetadata())
  })

  test('solo PDF o imagen, y menos de 5 MB', async () => {
    await assertFails(chofer().ref('compartidos/chofer1/x.txt').put(PDF, { contentType: 'text/plain' }))
    await assertFails(chofer().ref('compartidos/chofer1/grande.pdf').put(new Uint8Array(5 * 1024 * 1024 + 1), { contentType: 'application/pdf' }))
  })
})

describe('las demás carpetas no cambian', () => {
  test('catálogo: lectura pública, escribe comercial, no el chofer', async () => {
    await assertSucceeds(sinSesion().ref('catalogo/bolsa_2kg').getDownloadURL())
    await assertSucceeds(comercial().ref('catalogo/bolsa_3kg').put(IMG, { contentType: 'image/png' }))
    await assertFails(chofer().ref('catalogo/bolsa_3kg').put(IMG, { contentType: 'image/png' }))
  })

  test('tickets de service: sube el supervisor, lee cualquier usuario logueado, no el anónimo', async () => {
    await assertSucceeds(supervisor().ref('ticketsServicio/t2/foto.jpg').put(IMG, { contentType: 'image/jpeg' }))
    await assertSucceeds(chofer().ref('ticketsServicio/t1/foto.jpg').getDownloadURL())
    await assertFails(anonimo().ref('ticketsServicio/t1/foto.jpg').getDownloadURL())
  })

  test('facturas archivadas: sube facturación, lee el staff, nunca un cliente', async () => {
    await assertSucceeds(facturacion().ref('facturas/rolito/X-0001-00000001.pdf').put(PDF, { contentType: 'application/pdf' }))
    await assertSucceeds(chofer().ref('facturas/redonhielo/A-0001-00000101.pdf').getDownloadURL())
    await assertSucceeds(supervisor().ref('facturas/redonhielo/A-0001-00000101.pdf').getDownloadURL())
    await assertFails(cliente().ref('facturas/redonhielo/A-0001-00000101.pdf').getDownloadURL())
    await assertFails(chofer().ref('facturas/redonhielo/Z.pdf').put(PDF, { contentType: 'application/pdf' }))
  })

  test('cualquier otra ruta está cerrada', async () => {
    await assertFails(chofer().ref('otra/cosa.pdf').put(PDF, { contentType: 'application/pdf' }))
    await assertFails(facturacion().ref('otra/cosa.pdf').getDownloadURL())
  })
})
