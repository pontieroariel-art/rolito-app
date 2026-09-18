/**
 * seed-dia-caja.mjs — "Un día de ventanilla y tesorería" en el emulador.
 *
 * Arma, para HOY y en la planta Torcuato, la foto de un día a media mañana
 * para practicar el circuito completo de la plata sin tocar producción:
 *
 *   · Chofer Prueba Uno (depósito 21): salió con remito, vendió (contado con
 *     factura, promo, cuenta corriente, transferencia), cobró en la calle
 *     (efectivo + cheque), VOLVIÓ y muelle ya contó la descarga
 *     → caja lo puede LIQUIDAR ahora mismo (tabla de billetes por empresa).
 *   · Chofer Prueba Dos (depósito 22): sigue en la calle con ventas subidas
 *     → aparece "en calle" en Tesorería en vivo y en Liquidaciones abiertas.
 *   · Supervisor Prueba (depósito 31): tres recibos del día (efectivo
 *     Redonhielo, cheque + retención Redonhielo, efectivo Rolito)
 *     → caja lo liquida como "día solo de cobranzas".
 *   · Caja Torcuato Prueba: turno ABIERTO desde las 07:30 con cuatro ventas
 *     de ventanilla (una en cola de muelle) y una cobranza de mostrador
 *     → seguir vendiendo, liquidar a los de arriba, cerrar el turno (sobre RV).
 *   · Ayer: un sobre RV-DT-000001 que tesorería todavía no recibió
 *     → Recepción lo muestra "en camino" con horas de atraso.
 *
 * Requiere los emuladores corriendo y `npm run seed:emulator` ya corrido
 * (usa sus usuarios, clientes y precios). Es idempotente: ids determinísticos.
 *
 * Uso:
 *   npm run seed:dia               → siembra el día
 *   npm run seed:dia -- --limpiar  → borra TODO lo de hoy y ayer del circuito
 *                                    (ventas, cobranzas, turnos, sobres,
 *                                    liquidaciones, descargas) y vuelve a
 *                                    sembrar: para "jugar el día" de nuevo.
 *
 * Las Cloud Functions no corren en el emulador: para que las ventas de contado
 * que hagas en la app reciban su factura (y el IVA cuente en el "a rendir"),
 * dejá corriendo `npm run emular:arca` en otra terminal.
 */

process.env.FIRESTORE_EMULATOR_HOST     = 'localhost:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099'

import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

initializeApp({ projectId: 'rolito-app' })
const auth = getAuth()
const db   = getFirestore()

const LIMPIAR = process.argv.includes('--limpiar')
const PLANTA  = 'torcuato'

// ── Fechas ───────────────────────────────────────────────────────────────────
const pad2 = (n) => String(n).padStart(2, '0')
const dateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const hoyDate = new Date()
const HOY  = dateStr(hoyDate)
const ayerDate = new Date(hoyDate); ayerDate.setDate(ayerDate.getDate() - 1)
const AYER = dateStr(ayerDate)
// El borrador del primer viaje se arma siempre el día anterior: el camión sale a
// las 4 y caja abre a las 6.
const mananaDate = new Date(hoyDate); mananaDate.setDate(mananaDate.getDate() + 1)
const MANANA = dateStr(mananaDate)
/** Timestamp de hoy (o de otro día) a una hora dada: hora('09:15') */
const hora = (hhmm, base = hoyDate) => {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(base); d.setHours(h, m, 0, 0)
  return Timestamp.fromDate(d)
}
const AAAAMMDD = (d) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`

// ── Usuarios del seed base ──────────────────────────────────────────────────
async function uidDe(email) {
  try { return (await auth.getUserByEmail(email)).uid } catch { return null }
}
async function perfil(uid) {
  const s = await db.collection('users').doc(uid).get()
  return s.exists ? s.data() : null
}

// ── Precios (los mismos que seed-emulator) ──────────────────────────────────
const P = {
  bolsa_10kg: { nombre: 'Hielo bolsa 10kg',        precio: 4000 },
  bolsa_3kg:  { nombre: 'Hielo bolsa 3kg',         precio: 1600 },
  barra:      { nombre: 'Barra de hielo',          precio: 6000 },
  agua_6l:    { nombre: 'Agua de mesa x 6 litros', precio: 3000 },
}
const item = (id, cantidad) => ({ productoId: id, nombre: P[id].nombre, cantidad, precioUnitario: P[id].precio })
const totalDe = (items) => items.reduce((s, i) => s + i.cantidad * i.precioUnitario, 0)

// Factura de ARCA "emitida" con IVA 21 % (las listas son netas): lo que se le
// cobró de verdad al cliente es `importes.total`, no `total`.
let nroFactura = 500
function facturaArca(items, letra, base = hoyDate) {
  const neto = totalDe(items)
  const iva  = Math.round(neto * 0.21 * 100) / 100
  const vto  = new Date(base); vto.setDate(vto.getDate() + 10)
  nroFactura += 1
  return {
    estado: 'emitida', numero: nroFactura, puntoVenta: 1104, cbteTipo: letra === 'A' ? 1 : 6,
    cae: `7${String(nroFactura).padStart(13, '0')}`, caeFchVto: AAAAMMDD(vto),
    importes: { fecha: AAAAMMDD(base), neto, iva, tributos: 0, total: Math.round((neto + iva) * 100) / 100 },
  }
}
const CHEQUE = (numero, banco, importe, dias, extra = {}) => {
  const emision = new Date(hoyDate); const acred = new Date(hoyDate); acred.setDate(acred.getDate() + dias)
  return { numero, bancoCodigo: banco.codigo, bancoNombre: banco.nombre, fechaEmision: dateStr(emision), fechaAcreditacion: dateStr(acred), dias, importe, ...extra }
}
const BANCOS = { nacion: { codigo: '011', nombre: 'Banco Nación' }, galicia: { codigo: '007', nombre: 'Banco Galicia' }, macro: { codigo: '285', nombre: 'Banco Macro' } }

// Firma de mentira (PNG de 1×1) para los docs que la exigen.
const FIRMA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

// ── Limpieza opcional ───────────────────────────────────────────────────────
async function limpiar() {
  const desde = new Date(ayerDate); desde.setHours(0, 0, 0, 0)
  const hasta = new Date(hoyDate);  hasta.setDate(hasta.getDate() + 1); hasta.setHours(0, 0, 0, 0)
  // El día legacy de ayer (seed-emulator: remito + descarga viejos) se queda: sirve para ver una abierta vieja.
  const DEL_SEED_BASE = new Set(['seed-rc-legacy', 'seed-desc-legacy'])
  const porFechaTs = ['ventasVentanilla', 'ventasCamion', 'cobranzas', 'descargasCamion', 'cambiosCamion']
  const porFechaStr = ['cajaSesiones', 'rendiciones', 'liquidaciones', 'entregasTesoreria']
  let borrados = 0
  for (const col of porFechaTs) {
    const snap = await db.collection(col).where('fecha', '>=', Timestamp.fromDate(desde)).where('fecha', '<', Timestamp.fromDate(hasta)).get()
    for (const d of snap.docs) { if (DEL_SEED_BASE.has(d.id)) continue; await d.ref.delete(); borrados++ }
  }
  for (const col of porFechaStr) {
    const snap = await db.collection(col).where('fecha', '>=', AYER).where('fecha', '<=', HOY).get()
    for (const d of snap.docs) { await d.ref.delete(); borrados++ }
  }
  // Solicitudes de anulación, desvíos y las dos colecciones del circuito del
  // viaje en dos partes (2026-09-18) que hayan quedado de una vuelta anterior.
  for (const col of ['anulacionesVentanilla', 'anulacionesCobranza', 'desviosDescarga', 'borradoresCarga', 'cierresMercaderia', 'camionesEnViaje']) {
    const snap = await db.collection(col).get()
    for (const d of snap.docs) { await d.ref.delete(); borrados++ }
  }
  // El remito de hoy y el de ayer del seed base se rehacen abajo; los que creó la app en la vuelta anterior, fuera.
  const remitos = await db.collection('remitosCarga').where('fecha', '>=', Timestamp.fromDate(desde)).where('fecha', '<', Timestamp.fromDate(hasta)).get()
  for (const d of remitos.docs) { if (DEL_SEED_BASE.has(d.id)) continue; await d.ref.delete(); borrados++ }
  console.log(`🧹 Limpieza: ${borrados} documentos de hoy y ayer borrados\n`)
}

async function main() {
  console.log(`Sembrando un día de ventanilla y tesorería en el emulador (${HOY}, planta Torcuato)...\n`)

  const [cajaUid, tesoUid, supUid, muelleUid, chofer1Uid, chofer2Uid, clienteUid, factUid] = await Promise.all([
    uidDe('20000003@staff.rolito.internal'), uidDe('20000011@staff.rolito.internal'), uidDe('20000009@staff.rolito.internal'),
    uidDe('20000004@staff.rolito.internal'), uidDe('20111111112@rolito.app'), uidDe('20222222223@rolito.app'),
    uidDe('cliente.prueba@rolito.test'), uidDe('cliente.facturable@rolito.test'),
  ])
  if (!cajaUid || !tesoUid || !supUid || !muelleUid || !chofer1Uid || !chofer2Uid || !clienteUid || !factUid) {
    console.error('Faltan usuarios del seed base. Corré primero `npm run seed:emulator` (con los emuladores levantados).')
    process.exit(1)
  }
  const [caja, sup, muelle, chofer1, chofer2, cliente, fact] = await Promise.all([cajaUid, supUid, muelleUid, chofer1Uid, chofer2Uid, clienteUid, factUid].map(perfil))

  if (LIMPIAR) await limpiar()

  const CAJA    = { uid: cajaUid,    nombre: caja.nombre }
  const MUELLE  = { uid: muelleUid,  nombre: muelle.nombre }
  const SUP     = { uid: supUid,     nombre: sup.nombre }
  const CH1     = { uid: chofer1Uid, nombre: chofer1.nombre }
  const CH2     = { uid: chofer2Uid, nombre: chofer2.nombre }
  // Cliente de Prueba SA: sin condición de IVA (no se factura por ARCA) → cta. cte. y promo.
  const CLI  = { id: clienteUid, nombre: cliente.razonSocial, codigoTango: cliente.codigoTango, idGva14: cliente.idGva14Tango }
  // Facturable SA: responsable inscripto → factura A.
  const FACT = { id: factUid, nombre: fact.razonSocial, codigoTango: fact.codigoTango, idGva14: fact.idGva14Tango }

  // ── Depósitos de Tango (la liquidación elige a QUIÉN cerrar de acá) ────────
  const depositos = [
    { codigo: '01', nombre: 'PLANTA DON TORCUATO', idSta22: 1,  tipo: 'planta',     activo: true },
    { codigo: '02', nombre: 'PLANTA MERLO',        idSta22: 2,  tipo: 'planta',     activo: true },
    { codigo: '21', nombre: 'CAMION 21',           idSta22: 21, tipo: 'repartidor', activo: true, uid: CH1.uid, usuarioNombre: CH1.nombre, usuarioRol: 'chofer' },
    { codigo: '22', nombre: 'CAMION 22',           idSta22: 22, tipo: 'repartidor', activo: true, uid: CH2.uid, usuarioNombre: CH2.nombre, usuarioRol: 'chofer' },
    { codigo: '31', nombre: 'SUPERVISOR 31',       idSta22: 31, tipo: 'repartidor', activo: true, uid: SUP.uid, usuarioNombre: SUP.nombre, usuarioRol: 'supervisor' },
    { codigo: '33', nombre: 'NOAIN 01 (fletero sin usuario)', idSta22: 33, tipo: 'repartidor', activo: true, uid: null, usuarioNombre: null, usuarioRol: null },
  ]
  // OJO: `codigo` va también como campo: la app lee la colección con orderBy('codigo') y un doc sin el campo no aparece.
  for (const d of depositos) {
    await db.collection('depositosTango').doc(d.codigo).set({ ...d, inhabilitado: false, actualizadoEn: Timestamp.now() }, { merge: true })
  }
  await db.collection('config').doc('tango').set({ depositos: { [CH1.uid]: '21', [CH2.uid]: '22', [SUP.uid]: '31' } }, { merge: true })
  console.log('✓ Depósitos de Tango: 21 (Chofer Uno), 22 (Chofer Dos), 31 (Supervisor), 33 (fletero sin usuario)')

  // ── Config del circuito ───────────────────────────────────────────────────
  const cfg = (id, data) => db.collection('config').doc(id).set(data, { merge: true })
  await Promise.all([
    cfg('turnoVentanilla_torcuato',      { fecha: HOY, next: 5 }),
    cfg('numeracionInterna_facturaX',    { next: 46,  puntoVenta: 1 }),
    cfg('numeracionInterna_remito',      { next: 121, puntoVenta: 1 }),
    cfg('numeracionInterna_remitoPromo', { next: 12,  puntoVenta: 1 }),
    cfg('sobreVentanillaCounter_torcuato', { next: 2 }),
    cfg('liquidacionCounter_21', { next: 16 }),
    cfg('liquidacionCounter_22', { next: 9 }),
    cfg('liquidacionCounter_31', { next: 3 }),
    cfg('rendicionCounter_torcuato', { next: 9 }),
    cfg('cargaCounter_torcuato', { next: 4 }),
    cfg('reciboSupervisorCounter', { next: 120 }),
    cfg('arca', { habilitado: false, preciosIncluyenIva: false, topeConsumidorFinalSinIdentificar: 50000 }),
    cfg('tesoreria', { horasAvisoSobre: 2 }),
    cfg('emuladorArca', { next: 600 }),
  ])
  console.log('✓ Contadores y config (turnos, numeración interna, sobres, liquidaciones, ARCA apagado, aviso de sobre a las 2 h)')

  // ── CHOFER UNO: salió, vendió, cobró, volvió y muelle ya contó ────────────
  const cam1 = { camionId: 'camion-1', camionLabel: 'AF313WU · Accelo 1016' }
  await db.collection('remitosCarga').doc('seed-rc-1').set({
    numero: 1, codigo: 'RC-DT-000001', plantaId: PLANTA, choferId: CH1.uid, choferNombre: CH1.nombre, ...cam1,
    depositoTango: '21', depositoTangoNombre: 'CAMION 21',
    items: [{ productoId: 'bolsa_10kg', nombre: P.bolsa_10kg.nombre, cantidad: 264, pallets: 3 }, { productoId: 'agua_6l', nombre: P.agua_6l.nombre, cantidad: 60 }],
    palletsCarga: 3, envases: { tarimasMadera: 2, palletsMetal: 1, racks: [12, 15, 18] },
    estado: 'salido', creadoPor: CAJA, fecha: hora('06:40'),
    entregadoPor: { ...MUELLE, hora: hora('06:55') }, darsena: 1, darsenaAsignadaEn: hora('06:50'),
    salida: { uid: 'seed-seguridad', nombre: 'Seguridad Torcuato Prueba', hora: hora('07:05') },
    regreso: { ...CH1, hora: hora('11:20'), darsena: 2 },
    tango: { estado: 'confirmado', remitoNumero: 'R000100000901' },
  })
  const ventaCamion = async (id, v) => {
    await db.collection('ventasCamion').doc(id).set(v)
    return v
  }
  const base1 = { camionId: 'camion-1', remitoId: 'seed-rc-1', remitoCodigo: 'RC-DT-000001', choferId: CH1.uid, choferNombre: CH1.nombre, depositoTango: '21', depositoTangoNombre: 'CAMION 21', firmaCliente: FIRMA, tango: { estado: 'confirmado' } }
  const vc = []
  // Contado con factura A (Redonhielo) en efectivo: el cliente pagó neto + IVA.
  let items = [item('bolsa_10kg', 40)]
  vc.push(await ventaCamion('seed-vc1-1', { ...base1, canal: 'contado', clienteId: FACT.id, clienteNombre: FACT.nombre, clienteCodigoTango: FACT.codigoTango, clienteIdGva14Tango: FACT.idGva14, items, total: totalDe(items), formaPago: 'contado_efectivo', firmanteNombre: 'Ana Facturable', fecha: hora('07:50'), factura: facturaArca(items, 'A') }))
  // Cuenta corriente con remito (Redonhielo): no es plata.
  items = [item('bolsa_10kg', 30)]
  vc.push(await ventaCamion('seed-vc1-2', { ...base1, canal: 'contado', clienteId: CLI.id, clienteNombre: CLI.nombre, clienteCodigoTango: CLI.codigoTango, clienteIdGva14Tango: CLI.idGva14, items, total: totalDe(items), formaPago: 'cuenta_corriente', firmanteNombre: 'Juan Prueba', fecha: hora('08:30'), comprobanteInterno: { tipo: 'remito', puntoVenta: 1, numero: 118 }, ordenCompra: 'OC-7781' }))
  // Promo (Rolito) en efectivo con factura X.
  items = [item('bolsa_10kg', 25)]
  vc.push(await ventaCamion('seed-vc1-3', { ...base1, canal: 'promo', clienteId: CLI.id, clienteNombre: CLI.nombre, clienteCodigoTango: CLI.codigoTango, clienteIdGva14Tango: CLI.idGva14, items, total: totalDe(items), formaPago: 'contado_efectivo', firmanteNombre: 'Juan Prueba', fecha: hora('09:10'), comprobanteInterno: { tipo: 'facturaX', puntoVenta: 1, numero: 44 } }))
  // Contado por transferencia con factura A: se informa, no se rinde.
  items = [item('bolsa_10kg', 10), item('agua_6l', 20)]
  vc.push(await ventaCamion('seed-vc1-4', { ...base1, canal: 'contado', clienteId: FACT.id, clienteNombre: FACT.nombre, clienteCodigoTango: FACT.codigoTango, clienteIdGva14Tango: FACT.idGva14, items, total: totalDe(items), formaPago: 'contado_transferencia', firmanteNombre: 'Ana Facturable', fecha: hora('09:45'), factura: facturaArca(items, 'A') }))
  // Promo en cuenta corriente: en Rolito no hay remito, sale factura X y se cobra después con recibo (Ariel, 16/09).
  items = [item('agua_6l', 15)]
  vc.push(await ventaCamion('seed-vc1-5', { ...base1, canal: 'promo', clienteId: CLI.id, clienteNombre: CLI.nombre, clienteCodigoTango: CLI.codigoTango, clienteIdGva14Tango: CLI.idGva14, items, total: totalDe(items), formaPago: 'cuenta_corriente', firmanteNombre: 'Juan Prueba', fecha: hora('10:20'), comprobanteInterno: { tipo: 'facturaX', puntoVenta: 1, numero: 42 } }))

  // Cobranza de calle del chofer (origen 'cobrador'): efectivo + cheque, Redonhielo.
  const cheque1 = CHEQUE('00045712', BANCOS.nacion, 120000, 15)
  await db.collection('cobranzas').doc('seed-cob-ch1').set({
    origen: 'cobrador', registradoPor: CH1, depositoTango: '21', remitoId: 'seed-rc-1', remitoCodigo: 'RC-DT-000001',
    clienteId: CLI.id, clienteNombre: CLI.nombre, empresa: 'redonhielo', codigoTango: CLI.codigoTango,
    numeroRecibo: 'RS-000110', importe: 155000.5, formaPago: 'mixto', fecha: hora('10:05'),
    imputaciones: [
      { comprobanteTipo: 'FAC', comprobanteNumero: 'A-0001-00000087', saldoAlMomento: 35000.5, importeImputado: 35000.5 },
      { comprobanteTipo: 'FAC', comprobanteNumero: 'A-0001-00000101', saldoAlMomento: 120000,  importeImputado: 120000 },
    ],
    medios: { efectivo: 35000.5, transferencia: 0, cheques: [cheque1], retenciones: [] },
    tango: { estado: 'confirmado', reciboNumero: 'X0110600000110' },
  })

  // Muelle contó la descarga (ciego): vendió 105 bolsas y 35 aguas → tenían que
  // volver 159 bolsas y 25 aguas; contó 157 bolsas (faltan 2, desvío chico).
  await db.collection('descargasCamion').doc('seed-desc-ch1').set({
    plantaId: PLANTA, ...cam1, choferId: CH1.uid, choferNombre: CH1.nombre, depositoTango: '21', depositoTangoNombre: 'CAMION 21',
    remitoId: 'seed-rc-1', remitoCodigo: 'RC-DT-000001',
    items: [{ productoId: 'bolsa_10kg', nombre: P.bolsa_10kg.nombre, cantidad: 157 }, { productoId: 'agua_6l', nombre: P.agua_6l.nombre, cantidad: 25 }],
    bolsasRotas: [],
    envases: { tarimasMadera: 2, palletsMetal: 1, puntales: 12, aros: 2, sombreros: 3, racks: [12, 15, 18] },
    registradoPor: MUELLE, fecha: hora('11:35'),
    tango: { estado: 'confirmado' },
    revision: { requiere: false, bolsasFaltantes: 2, bolsasSobrantes: 0, productos: [{ productoId: 'bolsa_10kg', nombre: P.bolsa_10kg.nombre, faltan: 2 }], umbral: 5, calculadoEn: hora('11:35') },
  })
  const ef1 = vc.filter((v) => v.formaPago === 'contado_efectivo').reduce((s, v) => s + (v.factura?.importes?.total ?? v.total), 0) + 35000.5
  console.log(`✓ Chofer Uno (dep. 21): remito, 5 ventas, 1 cobranza con cheque, VOLVIÓ (dársena 2) y muelle contó → listo para liquidar (efectivo a rendir ≈ $${ef1.toLocaleString('es-AR')})`)

  // ── CHOFER DOS: sigue en la calle ─────────────────────────────────────────
  const cam2 = { camionId: 'camion-2', camionLabel: 'AB222CC · Cargo 816' }
  await db.collection('remitosCarga').doc('seed-rc-3').set({
    numero: 3, codigo: 'RC-DT-000003', plantaId: PLANTA, choferId: CH2.uid, choferNombre: CH2.nombre, ...cam2,
    depositoTango: '22', depositoTangoNombre: 'CAMION 22',
    items: [{ productoId: 'bolsa_10kg', nombre: P.bolsa_10kg.nombre, cantidad: 176, pallets: 2 }, { productoId: 'barra', nombre: P.barra.nombre, cantidad: 30 }],
    palletsCarga: 2, envases: { tarimasMadera: 2, palletsMetal: 0, racks: [] },
    estado: 'salido', creadoPor: CAJA, fecha: hora('07:10'),
    entregadoPor: { ...MUELLE, hora: hora('07:25') }, darsena: 3, darsenaAsignadaEn: hora('07:20'),
    salida: { uid: 'seed-seguridad', nombre: 'Seguridad Torcuato Prueba', hora: hora('07:40') },
    tango: { estado: 'confirmado', remitoNumero: 'R000100000903' },
  })
  const base2 = { camionId: 'camion-2', remitoId: 'seed-rc-3', remitoCodigo: 'RC-DT-000003', choferId: CH2.uid, choferNombre: CH2.nombre, depositoTango: '22', depositoTangoNombre: 'CAMION 22', firmaCliente: FIRMA, tango: { estado: 'confirmado' } }
  items = [item('bolsa_10kg', 50)]
  await ventaCamion('seed-vc2-1', { ...base2, canal: 'contado', clienteId: FACT.id, clienteNombre: FACT.nombre, clienteCodigoTango: FACT.codigoTango, clienteIdGva14Tango: FACT.idGva14, items, total: totalDe(items), formaPago: 'contado_efectivo', firmanteNombre: 'Ana Facturable', fecha: hora('08:40'), factura: facturaArca(items, 'A') })
  items = [item('barra', 20)]
  await ventaCamion('seed-vc2-2', { ...base2, canal: 'promo', clienteId: CLI.id, clienteNombre: CLI.nombre, clienteCodigoTango: CLI.codigoTango, clienteIdGva14Tango: CLI.idGva14, items, total: totalDe(items), formaPago: 'contado_efectivo', firmanteNombre: 'Juan Prueba', fecha: hora('10:50'), comprobanteInterno: { tipo: 'facturaX', puntoVenta: 1, numero: 45 } })
  console.log('✓ Chofer Dos (dep. 22): remito salido, 2 ventas, sin volver → "en calle" en Tesorería en vivo y en Liquidaciones abiertas')

  // ── El viaje del chofer uno, con la MERCADERÍA ya cerrada ─────────────────
  // Lo escribe el servidor al contarse la descarga; acá se siembra a mano para
  // poder probar sin functions. Con esto la liquidación de hoy del chofer uno
  // arranca con una mitad hecha y la otra pendiente: es el orden habitual
  // (muelle 24 h contra caja 12 h).
  await db.collection('cierresMercaderia').doc('seed-rc-1').set({
    remitoId: 'seed-rc-1', remitoCodigo: 'RC-DT-000001', plantaId: PLANTA,
    choferId: CH1.uid, choferNombre: CH1.nombre, depositoTango: '21', depositoTangoNombre: 'CAMION 21',
    diaReparto: HOY,
    productos: [
      { productoId: 'bolsa_10kg', nombre: P.bolsa_10kg.nombre, carga: 264, ventaContado: 80, ventaPromo: 25, cambios: 0, devolucionTeorica: 159, descarga: 157, diferencia: -2, rotas: 0 },
      { productoId: 'agua_6l', nombre: P.agua_6l.nombre, carga: 60, ventaContado: 20, ventaPromo: 15, cambios: 0, devolucionTeorica: 25, descarga: 25, diferencia: 0, rotas: 0 },
    ],
    envases: {
      salieron:  { tarimasMadera: 2, palletsMetal: 1, puntales: 12, aros: 2, sombreros: 3, racks: [12, 15, 18] },
      volvieron: { tarimasMadera: 2, palletsMetal: 1, puntales: 12, aros: 2, sombreros: 3, racks: [12, 15, 18] },
      diferencia: { tarimasMadera: 0, palletsMetal: 0, puntales: 0, aros: 0, sombreros: 0 },
      racksFaltantes: [], racksSobrantes: [],
    },
    faltante: { bolsasFaltantes: 2, bolsasSobrantes: 0, productos: [{ productoId: 'bolsa_10kg', nombre: P.bolsa_10kg.nombre, faltan: 2 }], grave: false, umbral: 5 },
    descargaIds: ['seed-desc-ch1'], descargaCodigos: ['DC-DT-000001'],
    contadaPor: MUELLE, contadaEn: hora('11:35'),
  })
  await db.collection('descargasCamion').doc('seed-desc-ch1').update({ numero: 1, codigo: 'DC-DT-000001' })
  console.log('✓ Mercadería del chofer Uno CERRADA (DC-DT-000001, faltan 2 bolsas) y su plata pendiente → el orden habitual')

  // ── Borrador para mañana: lo que muelle va a aceptar a las 4 ──────────────
  await db.collection('borradoresCarga').doc('seed-borrador-1').set({
    plantaId: PLANTA, paraFecha: MANANA,
    camionId: 'camion-1', camionLabel: 'AF313WU · Accelo 1016',
    choferId: CH1.uid, choferNombre: CH1.nombre, depositoTango: '21', depositoTangoNombre: 'CAMION 21',
    items: [{ productoId: 'bolsa_10kg', nombre: P.bolsa_10kg.nombre, cantidad: 264, pallets: 3 }],
    // Sin envases: los cuenta muelle al entregar el camión.
    kg: 2640,
    cotDestino: {
      destino: { tipo: 'planta', plantaId: 'merlo' },
      respaldo: { codigoComprobante: '091', prefijo: 25, importe: 0 },
      patente: 'AF313WU', recorrido: 'corto',
    },
    estado: 'pendiente', creadoPor: CAJA, fecha: hora('17:30'),
    venceEn: Timestamp.fromDate(new Date(`${MANANA}T23:59:59`)),
  })
  console.log(`✓ Borrador para mañana (${MANANA}): camión 1 con 264 bolsas → muelle lo acepta y ahí nace el remito`)

  // ── Vuelta NOCTURNA de ayer: sobre en el buzón ───────────────────────────
  // El chofer volvió a las 21, muelle contó y él dejó la plata en el buzón con
  // el código escrito a mano. Caja lo abre a la mañana: es el caso que motivó
  // todo el circuito.
  await db.collection('remitosCarga').doc('seed-rc-noche').set({
    numero: 9, codigo: 'RC-DT-000009', plantaId: PLANTA, choferId: CH2.uid, choferNombre: CH2.nombre,
    camionId: 'camion-3', camionLabel: 'AD444EE · Atego 1725',
    depositoTango: '22', depositoTangoNombre: 'CAMION 22',
    items: [{ productoId: 'bolsa_10kg', nombre: P.bolsa_10kg.nombre, cantidad: 176, pallets: 2 }],
    palletsCarga: 2, envases: { tarimasMadera: 2, palletsMetal: 0, racks: [] },
    estado: 'salido', creadoPor: CAJA, fecha: hora('14:00', ayerDate),
    entregadoPor: { ...MUELLE, hora: hora('14:10', ayerDate) },
    salida: { uid: 'seed-seguridad', nombre: 'Seguridad Torcuato Prueba', hora: hora('14:20', ayerDate) },
    regreso: { ...CH2, hora: hora('21:05', ayerDate), darsena: 3 },
    tango: { estado: 'confirmado' },
  })
  items = [item('bolsa_10kg', 60)]
  await ventaCamion('seed-vc-noche', {
    camionId: 'camion-3', remitoId: 'seed-rc-noche', remitoCodigo: 'RC-DT-000009',
    choferId: CH2.uid, choferNombre: CH2.nombre, depositoTango: '22', depositoTangoNombre: 'CAMION 22',
    canal: 'contado', clienteId: FACT.id, clienteNombre: FACT.nombre, clienteCodigoTango: FACT.codigoTango, clienteIdGva14Tango: FACT.idGva14,
    items, total: totalDe(items), formaPago: 'contado_efectivo', firmanteNombre: 'Ana Facturable', firmaCliente: FIRMA,
    fecha: hora('18:30', ayerDate), factura: facturaArca(items, 'A'), tango: { estado: 'confirmado' },
  })
  await db.collection('descargasCamion').doc('seed-desc-noche').set({
    plantaId: PLANTA, camionId: 'camion-3', camionLabel: 'AD444EE · Atego 1725',
    choferId: CH2.uid, choferNombre: CH2.nombre, depositoTango: '22', depositoTangoNombre: 'CAMION 22',
    remitoId: 'seed-rc-noche', remitoCodigo: 'RC-DT-000009', diaReparto: AYER,
    numero: 2, codigo: 'DC-DT-000002',
    items: [{ productoId: 'bolsa_10kg', nombre: P.bolsa_10kg.nombre, cantidad: 116 }],
    bolsasRotas: [],
    envases: { tarimasMadera: 2, palletsMetal: 0, puntales: 8, aros: 2, sombreros: 2, racks: [] },
    registradoPor: MUELLE, fecha: hora('21:40', ayerDate), tango: { estado: 'confirmado' },
  })
  await db.collection('cierresMercaderia').doc('seed-rc-noche').set({
    remitoId: 'seed-rc-noche', remitoCodigo: 'RC-DT-000009', plantaId: PLANTA,
    choferId: CH2.uid, choferNombre: CH2.nombre, depositoTango: '22', depositoTangoNombre: 'CAMION 22',
    diaReparto: AYER,
    productos: [{ productoId: 'bolsa_10kg', nombre: P.bolsa_10kg.nombre, carga: 176, ventaContado: 60, ventaPromo: 0, cambios: 0, devolucionTeorica: 116, descarga: 116, diferencia: 0, rotas: 0 }],
    envases: {
      salieron:  { tarimasMadera: 2, palletsMetal: 0, puntales: 8, aros: 2, sombreros: 2, racks: [] },
      volvieron: { tarimasMadera: 2, palletsMetal: 0, puntales: 8, aros: 2, sombreros: 2, racks: [] },
      diferencia: { tarimasMadera: 0, palletsMetal: 0, puntales: 0, aros: 0, sombreros: 0 },
      racksFaltantes: [], racksSobrantes: [],
    },
    faltante: { bolsasFaltantes: 0, bolsasSobrantes: 0, productos: [], grave: false, umbral: 5 },
    descargaIds: ['seed-desc-noche'], descargaCodigos: ['DC-DT-000002'],
    contadaPor: MUELLE, contadaEn: hora('21:40', ayerDate),
  })
  console.log('✓ Vuelta NOCTURNA de ayer: contada (DC-DT-000002) y sin liquidar → aparece en el Buzón esperando el sobre')

  // ── Camión con descarga pendiente: la regla que frena la carga ────────────
  // El camión 2 salió hoy y nadie contó su descarga. Mientras exista este doc,
  // muelle no puede emitirle un remito nuevo.
  await db.collection('camionesEnViaje').doc('camion-2').set({
    remitoId: 'seed-rc-3', remitoCodigo: 'RC-DT-000003', plantaId: PLANTA,
    choferNombre: CH2.nombre, desde: hora('07:10'), volvio: false,
  })
  console.log('✓ camionesEnViaje: el camión 2 tiene descarga pendiente → no recibe carga nueva')

  // ── SUPERVISOR: día solo de cobranzas ─────────────────────────────────────
  const cobSup = (id, c) => db.collection('cobranzas').doc(id).set({ origen: 'supervisor', registradoPor: SUP, depositoTango: '31', tango: { estado: 'confirmado' }, ...c })
  await cobSup('seed-cob-sup1', {
    clienteId: FACT.id, clienteNombre: FACT.nombre, empresa: 'redonhielo', codigoTango: FACT.codigoTango,
    numeroRecibo: 'RS-000101', importe: 150000, formaPago: 'contado_efectivo', fecha: hora('08:15'),
    imputaciones: [{ comprobanteTipo: 'FAC', comprobanteNumero: 'A-0001-00000300', saldoAlMomento: 150000, importeImputado: 150000 }],
    medios: { efectivo: 150000, transferencia: 0, cheques: [], retenciones: [] },
  })
  const chequeSup = CHEQUE('00009921', BANCOS.galicia, 80000, 30, { esEcheq: true })
  await cobSup('seed-cob-sup2', {
    clienteId: CLI.id, clienteNombre: CLI.nombre, empresa: 'redonhielo', codigoTango: CLI.codigoTango,
    numeroRecibo: 'RS-000102', importe: 85000, formaPago: 'mixto', fecha: hora('09:30'),
    imputaciones: [{ comprobanteTipo: 'FAC', comprobanteNumero: 'A-0001-00000102', saldoAlMomento: 85000, importeImputado: 85000 }],
    medios: { efectivo: 0, transferencia: 0, cheques: [chequeSup], retenciones: [{ tipo: 'iibb_pba', nroCertificado: 'RET-2026-0471', importe: 5000, fecha: HOY }] },
  })
  await cobSup('seed-cob-sup3', {
    clienteId: CLI.id, clienteNombre: CLI.nombre, empresa: 'rolito', codigoTango: CLI.codigoTango,
    numeroRecibo: 'RS-000103', importe: 60000, formaPago: 'contado_efectivo', fecha: hora('10:40'),
    imputaciones: [{ comprobanteTipo: 'FAC', comprobanteNumero: 'X-0001-00000045', saldoAlMomento: 60000, importeImputado: 60000 }],
    medios: { efectivo: 60000, transferencia: 0, cheques: [], retenciones: [] },
  })
  console.log('✓ Supervisor (dep. 31): 3 recibos — $150.000 efectivo Redonhielo, cheque $80.000 + retención $5.000 Redonhielo, $60.000 efectivo Rolito')

  // ── VENTANILLA: turno abierto con ventas y una cobranza de mostrador ──────
  const sesionId = `${HOY}_${CAJA.uid}_1`
  await db.collection('cajaSesiones').doc(sesionId).set({
    plantaId: PLANTA, cajero: CAJA, fecha: HOY, numero: 1, estado: 'abierta', abiertaEn: hora('07:30'), fondoInicial: 0, fondoInicialDe: null,
  })
  const baseV = { plantaId: PLANTA, cajaId: CAJA.uid, cajaNombre: CAJA.nombre, cajaSesionId: sesionId, tango: { estado: 'confirmado' } }
  const ventaV = (id, v) => db.collection('ventasVentanilla').doc(id).set({ ...baseV, ...v })
  items = [item('bolsa_10kg', 20)]
  await ventaV('seed-vv-1', { canal: 'contado', clienteId: FACT.id, clienteNombre: FACT.nombre, clienteCodigoTango: FACT.codigoTango, clienteIdGva14Tango: FACT.idGva14, items, total: totalDe(items), formaPago: 'contado_efectivo', estado: 'entregado', turno: 1, turnoEstado: 'llamado', darsena: 4, llamadoAt: hora('08:05'), entregadoPor: { ...MUELLE, hora: hora('08:10') }, fecha: hora('08:00'), factura: facturaArca(items, 'A') })
  items = [item('bolsa_3kg', 10)]
  await ventaV('seed-vv-2', { canal: 'promo', clienteNombre: 'Kiosco El Sol', clienteOcasional: { nombre: 'Kiosco El Sol', cuit: '20301234567' }, items, total: totalDe(items), formaPago: 'contado_efectivo', estado: 'entregado', turno: 2, turnoEstado: 'llamado', darsena: 5, llamadoAt: hora('08:50'), entregadoPor: { ...MUELLE, hora: hora('08:55') }, fecha: hora('08:45'), comprobanteInterno: { tipo: 'facturaX', puntoVenta: 1, numero: 43 } })
  items = [item('bolsa_10kg', 30)]
  await ventaV('seed-vv-3', { canal: 'contado', clienteId: CLI.id, clienteNombre: CLI.nombre, clienteCodigoTango: CLI.codigoTango, clienteIdGva14Tango: CLI.idGva14, items, total: totalDe(items), formaPago: 'cuenta_corriente', estado: 'pendiente_entrega', turno: 3, turnoEstado: 'preparado', fecha: hora('10:30'), comprobanteInterno: { tipo: 'remito', puntoVenta: 1, numero: 120 } })
  items = [item('bolsa_3kg', 5)]
  await ventaV('seed-vv-4', { canal: 'contado', clienteNombre: 'Consumidor final', clienteOcasional: { nombre: 'Consumidor final', dni: '30111222' }, items, total: totalDe(items), formaPago: 'contado_efectivo', estado: 'pendiente_entrega', turno: 4, turnoEstado: 'en_espera', fecha: hora('11:05'), factura: facturaArca(items, 'B') })
  await db.collection('cobranzas').doc('seed-cob-caja').set({
    origen: 'caja', plantaId: PLANTA, cajaSesionId: sesionId, registradoPor: CAJA,
    clienteId: CLI.id, clienteNombre: CLI.nombre, empresa: 'redonhielo', codigoTango: CLI.codigoTango,
    numeroRecibo: 'RS-000104', importe: 15000, formaPago: 'contado_efectivo', fecha: hora('09:20'),
    imputaciones: [{ comprobanteTipo: 'ND', comprobanteNumero: 'A-0001-00000012', saldoAlMomento: 15000, importeImputado: 15000 }],
    medios: { efectivo: 15000, transferencia: 0, cheques: [], retenciones: [] },
    tango: { estado: 'confirmado', reciboNumero: 'X0110600000104' },
  })
  console.log('✓ Ventanilla: turno abierto 07:30, 4 ventas (turnos 1-4; el 3 preparado y el 4 en espera en muelle) y 1 cobranza de mostrador')

  // ── AYER: sobre de ventanilla que tesorería todavía no recibió ────────────
  const sesionAyer = `${AYER}_${CAJA.uid}_1`
  const sobreAyer  = sesionAyer
  await db.collection('cajaSesiones').doc(sesionAyer).set({
    plantaId: PLANTA, cajero: CAJA, fecha: AYER, numero: 1, estado: 'cerrada', abiertaEn: hora('07:30', ayerDate), cerradaEn: hora('18:30', ayerDate), fondoInicial: 0, fondoInicialDe: null, rendicionId: sobreAyer,
  })
  const actorCaja = { ...CAJA, rol: 'caja' }
  await db.collection('rendiciones').doc(sobreAyer).set({
    tipo: 'ventanilla', rindeA: 'tesoreria', plantaId: PLANTA, fecha: AYER, numero: 1, codigo: 'RV-DT-000001',
    rindio: actorCaja, cajaSesionId: sesionAyer,
    sistema: {
      efectivo: 250000, cheques: [], retenciones: [], transferencias: { cantidad: 0, total: 0 },
      detalle: { fondoInicial: 0, ventasEfectivo: 250000, cobranzasEfectivo: 0, recibidoDeLiquidaciones: 0, recibidoDeSobres: 0 },
      origenIds: { ventasIds: [], cobranzasIds: [], liquidacionesIds: [], sobresRecibidosIds: [] },
    },
    declarado: { efectivo: 250000, cheques: [], retenciones: [] },
    diferenciaDeclarada: { efectivo: 0, valoresFaltantes: { cantidad: 0, total: 0 } },
    firmaRinde: FIRMA, firmanteRinde: CAJA.nombre,
    cerradaEn: hora('18:30', ayerDate), estado: 'pendiente_recepcion',
    custodia: { ...actorCaja, desde: hora('18:30', ayerDate) },
    createdAt: hora('18:30', ayerDate),
  })
  console.log('✓ Ayer: sobre RV-DT-000001 ($250.000) cerrado a las 18:30 y todavía sin recibir → Recepción lo muestra atrasado')

  console.log(`
── Cómo jugar el día ─────────────────────────────────────────────
Pestaña 1 · CAJA  (/empresa → DNI 20000003 / test1234)
  1. Ventanilla: vendé un par más (contado efectivo pide factura: con
     \`npm run emular:arca\` corriendo llega en ~3 s).
  2. Liquidaciones: elegí "21 · ${CH1.nombre}" → contá los billetes de
     Redonhielo y de Rolito, tildá el cheque, dos firmas → LQ-21-000016.
  3. Liquidaciones: "31 · ${SUP.nombre}" (solo cobranzas) → LQ-31-000003.
  4. Mi turno: contá a ciegas, tildá valores, revelá, firmá → sobre RV-DT-000002.
Pestaña 2 · TESORERÍA  (/empresa → DNI 20000011 / test1234)
  5. Tesorería en vivo: calle (Chofer Dos), ventanillas, supervisores.
  6. Recepción: primero RV-DT-000001 de ayer (atrasado), después el de hoy:
     contá a ciegas, tildá el cheque, revelá, firmá.
  7. Liquidaciones abiertas: Chofer Dos (en calle) y el legacy de ayer.
Para repetir el día desde cero: npm run seed:dia -- --limpiar
`)
  process.exit(0)
}

main().catch((err) => { console.error('Error sembrando el día:', err); process.exit(1) })
