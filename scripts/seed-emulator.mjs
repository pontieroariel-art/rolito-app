/**
 * seed-emulator.mjs
 * Carga datos mínimos de prueba en los emuladores de Firestore + Auth
 * (npm run emulators) para poder probar Planificación/Despacho localmente
 * sin tocar producción.
 *
 * Requiere los emuladores corriendo (`npm run emulators` en otra terminal).
 *
 * Uso:
 *   npm run seed:emulator
 *
 * Es seguro correrlo varias veces: usa IDs determinísticos (no duplica) y
 * si un usuario de Auth ya existe, solo le refresca la contraseña.
 */

process.env.FIRESTORE_EMULATOR_HOST     = 'localhost:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099'

import admin from 'firebase-admin'

// Tiene que ser el MISMO project id que usa la app (VITE_FIREBASE_PROJECT_ID
// en .env.local) — el emulador aloja los datos separados por project id, así
// que si no coinciden la app busca en un "proyecto" vacío y nunca encuentra
// nada, aunque el seed haya corrido bien.
admin.initializeApp({ projectId: 'rolito-app' })
const auth = admin.auth()
const db   = admin.firestore()

const { Timestamp, FieldValue } = admin.firestore

const PASSWORD = 'test1234'

function dniToStaffEmail(dni) {
  return `${dni}@staff.rolito.internal`
}

function dniFromCuit(cuit) {
  return cuit.slice(2, 10)
}

function padPin(pin) {
  return `${pin}__ch`
}

// Crea el usuario de Auth si no existe; si ya existe, le refresca la
// contraseña — así correr el script de nuevo no rompe con "email ya usado".
async function upsertAuthUser(email, password) {
  try {
    const created = await auth.createUser({ email, password, emailVerified: true })
    return created.uid
  } catch (err) {
    if (err.code !== 'auth/email-already-exists') throw err
    const existing = await auth.getUserByEmail(email)
    await auth.updateUser(existing.uid, { password })
    return existing.uid
  }
}

function baseUserFields(overrides) {
  return {
    nombre: '', razonSocial: '', nombreContacto: '',
    telefono: '', phone: '', cuit: '',
    addresses: [], address: '', lat: null, lng: null,
    estado: 'activo',
    fechaCreacion: FieldValue.serverTimestamp(),
    fechaAprobacion: FieldValue.serverTimestamp(),
    aprobadoPor: null,
    ...overrides,
  }
}

async function main() {
  console.log('Sembrando datos de prueba en el emulador...\n')

  // ── Staff ────────────────────────────────────────────────────────────────
  const staffSeed = [
    { dni: '20000001', password: PASSWORD, nombre: 'Admin Prueba', rol: 'super_admin' },
    { dni: '34551070', password: 'prueba', nombre: 'Ariel Pontiero', rol: 'super_admin' },
    { dni: '20000002', password: PASSWORD, nombre: 'Gerente Comercial Prueba', rol: 'gerente_comercial' },
  ]
  for (const s of staffSeed) {
    const staffEmail = dniToStaffEmail(s.dni)
    const staffUid   = await upsertAuthUser(staffEmail, s.password)
    await db.collection('users').doc(staffUid).set(baseUserFields({
      email: staffEmail, nombre: s.nombre, nombreContacto: s.nombre,
      rol: s.rol, username: s.dni,
    }), { merge: true })
    await db.collection('staffDniIndex').doc(s.dni).set({ email: staffEmail })
    console.log(`✓ Staff (${s.rol}) — DNI ${s.dni} / contraseña ${s.password}`)
  }

  // ── Choferes ─────────────────────────────────────────────────────────────
  const choferesSeed = [
    { cuit: '20111111112', nombre: 'Chofer Prueba Uno' },
    { cuit: '20222222223', nombre: 'Chofer Prueba Dos' },
  ]
  for (const c of choferesSeed) {
    const dni   = dniFromCuit(c.cuit)
    const email = `${c.cuit}@rolito.app`
    const uid   = await upsertAuthUser(email, padPin('1234'))
    await db.collection('users').doc(uid).set(baseUserFields({
      email, nombre: c.nombre, nombreContacto: c.nombre, cuit: c.cuit,
      rol: 'chofer', username: dni,
    }), { merge: true })
    await db.collection('dniIndex').doc(dni).set({ email, cuit: c.cuit })
    console.log(`✓ Chofer — DNI ${dni} / PIN 1234 (${c.nombre})`)
  }

  // ── Cliente ──────────────────────────────────────────────────────────────
  const clienteCuit  = '30111111118'
  const clienteEmail = 'cliente.prueba@rolito.test'
  const clienteUid   = await upsertAuthUser(clienteEmail, PASSWORD)
  const direccion = {
    id: 'addr1', nombre: 'Depósito', address: 'Av. Siempre Viva 123, CABA',
    lat: -34.6037, lng: -58.3816, horarioApertura: '08:00', horarioCierre: '18:00',
    contactoNombre: 'Juan Prueba', contactoTelefono: '1122334455', esPrincipal: false,
  }
  // Segunda sucursal — "grupo empresario" (mismo CUIT, ninguna marcada
  // principal) para probar que el chequeo de pedido duplicado no confunda
  // sucursales distintas del mismo cliente.
  const direccion2 = {
    id: 'addr2', nombre: 'Sucursal Norte', address: 'Av. Cabildo 2450, CABA',
    lat: -34.5631, lng: -58.4593, horarioApertura: '08:00', horarioCierre: '18:00',
    contactoNombre: 'María Prueba', contactoTelefono: '1122334456', esPrincipal: false,
  }
  await db.collection('users').doc(clienteUid).set(baseUserFields({
    email: clienteEmail, razonSocial: 'Cliente de Prueba SA', nombreContacto: 'Juan Prueba',
    cuit: clienteCuit, telefono: '1122334455', phone: '1122334455',
    addresses: [direccion, direccion2], address: direccion.address, lat: direccion.lat, lng: direccion.lng,
    codigoCliente: 'CL-0001', rol: 'cliente',
  }), { merge: true })
  await db.collection('cuitIndex').doc(clienteCuit).set({ email: clienteEmail })
  console.log(`✓ Cliente — CUIT ${clienteCuit} / contraseña ${PASSWORD}`)

  // ── Flota (camiones activos) ────────────────────────────────────────────
  const camiones = [
    { id: 'camion-1', patente: 'AF313WU', modelo: 'Accelo 1016', marca: 'Mercedes-Benz', capacidadPallets: 14 },
    { id: 'camion-2', patente: 'AB222CC', modelo: 'Cargo 816',   marca: 'Ford',          capacidadPallets: 10 },
  ]
  for (const cam of camiones) {
    await db.collection('flota').doc(cam.id).set({
      patente: cam.patente, modelo: cam.modelo, marca: cam.marca,
      activo: true, capacidadPallets: cam.capacidadPallets, canales: [],
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  }
  console.log(`✓ ${camiones.length} camiones activos en Flota`)

  // ── Pedidos ──────────────────────────────────────────────────────────────
  const today    = new Date(); today.setHours(12, 0, 0, 0)
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
  const pedidos = [
    { id: 'seed-order-1', date: today,    products: [{ name: 'Hielo en cubo 5kg', quantity: 20 }] },
    { id: 'seed-order-2', date: today,    products: [{ name: 'Hielo en bolsa 2kg', quantity: 15 }] },
    { id: 'seed-order-3', date: tomorrow, products: [{ name: 'Hielo en cubo 5kg', quantity: 30 }] },
    // Nombre "RAZÓN SOCIAL (SUCURSAL)" + OC — para probar splitSucursalLabel()
    { id: 'seed-order-4', date: today, products: [{ name: 'Hielo en cubo 5kg', quantity: 88 }],
      clientName: 'DELIVERY HERO E-COMMERCE SA (LA PLATA)', numeroOC: '4521' },
    // Mismo clientId que DELIVERY_HERO_CLIENT_ID (src/utils/constants.ts) —
    // para probar el ícono 🛵 en vez del prefijo de texto.
    { id: 'seed-order-5', date: today, products: [{ name: 'Hielo en cubo 5kg', quantity: 100 }],
      clientId: 'W5ipfqI6gEfRqFk5X13HdTi57l93', clientName: 'DELIVERY HERO E-COMMERCE SA (NUÑEZ)' },
  ]
  for (const p of pedidos) {
    await db.collection('orders').doc(p.id).set({
      clientId: p.clientId ?? clienteUid, clientEmail: clienteEmail, clientName: p.clientName ?? 'Cliente de Prueba SA',
      clientAddress: direccion.address, clientPhone: '1122334455',
      products: p.products, status: 'pendiente', driverId: null, notes: '',
      ...(p.numeroOC ? { numeroOC: p.numeroOC } : {}),
      date: Timestamp.fromDate(p.date),
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  }
  console.log(`✓ ${pedidos.length} pedidos de prueba (Sin asignar)`)

  console.log('\n── Credenciales ─────────────────────────────────')
  staffSeed.forEach((s) => console.log(`Staff (${s.rol}):  DNI ${s.dni}  /  ${s.password}`))
  console.log(`Choferes:             DNI ${dniFromCuit(choferesSeed[0].cuit)} o ${dniFromCuit(choferesSeed[1].cuit)}  /  PIN 1234`)
  console.log(`Cliente:              CUIT ${clienteCuit}  /  ${PASSWORD}`)
  console.log('\n¡Listo! Abrí la URL que te muestre `npm run dev` (por defecto http://localhost:5173).')
  process.exit(0)
}

main().catch((err) => {
  console.error('Error sembrando datos:', err)
  process.exit(1)
})
