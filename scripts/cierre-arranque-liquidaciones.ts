/**
 * Cierre de arranque de las liquidaciones abiertas (2026-09-16, decisión de Ariel).
 *
 * Antes de que caja y muelle usaran el circuito completo quedaron días con remito
 * de carga (o cobranzas de calle) y sin liquidación, y los camiones "llenos" en
 * Tango porque nadie contó la descarga. Este script, por cada persona + día abierto
 * hasta la fecha tope:
 *   1. Escribe una DESCARGA TEÓRICA (carga − ventas − cambios, y todos los envases
 *      de vuelta), fechada ese día, marcada `teorica`. El trigger de siempre la
 *      encola a Tango como transferencia camión → planta: el depósito queda en cero.
 *   2. Cierra la LIQUIDACIÓN del día con el mismo cálculo que caja, sin firmas,
 *      efectivo recibido = efectivo a rendir, valores en papel como recibidos, y
 *      marcada `cierreArranque` para que el historial lo diga.
 *
 * Desde el 2026-09-21 (circuito del viaje en dos partes) cada grupo es UN VIAJE:
 * la liquidación se guarda por `remitoId`, y las ventas, cambios, cobranzas y
 * descargas son SOLO las de ese viaje (`utils/viajeDeVenta`), no las del día del
 * chofer. Sin esto, dos viajes del mismo día rendían la misma plata dos veces.
 * Cuando el muelle ya había contado la descarga pero el viaje no tiene su
 * `cierresMercaderia` (contado antes del estreno), se escribe acá con la misma
 * lógica del servidor, sin encolar ninguna diferencia a Tango.
 *
 * Corre con el Admin SDK (scripts/serviceAccount.json). Por defecto NO escribe.
 *
 *   npx esbuild scripts/cierre-arranque-liquidaciones.ts --bundle --platform=node --format=cjs \
 *     --alias:@=./src --packages=external --log-level=warning --outfile=scripts/.build/cierre-arranque.cjs \
 *   && node scripts/.build/cierre-arranque.cjs [--hasta 2026-09-14] [--desde 2026-08-01] [--actor <uid>] [--aplicar]
 *
 *   --hasta   último día que se cierra (default: ayer; hoy se deja para que caja lo cierre bien)
 *   --desde   primer día que se mira (default: 45 días atrás)
 *   --actor   uid que firma como "cerradaPor" (default: el super_admin llamado Ariel)
 *   --excluir códigos de remito que NO se cierran, separados por coma (--excluir RC-DT-000097,RC-DT-000098)
 *   --aplicar escribe; sin esto solo muestra
 *
 * Tesorería (2026-09-23, Ariel: "sin que impacte en tesorería, empezamos a usar la app
 * correctamente desde ayer"): un cierre de arranque NO es plata que caja tenga que
 * entregar. Se guarda SIN el campo `entregaId` (ni null): Entrega a tesorería y el
 * tile "Tiene que llegarme" solo cuentan los docs con `entregaId === null`
 * (utils/entregaTesoreria.ts), y el historial no lo marca "en caja". Con --aplicar
 * también se les saca el `entregaId: null` a los cierres de arranque anteriores
 * (los 79 del 21/09), que hasta hoy sumaban $4,1M en "Entrega a tesorería".
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { CambioCamion, CierreMercaderia, Cobranza, DescargaCamion, EnvasesDescarga, Liquidacion, RemitoCarga, VentaCamion } from '@/types'
import { calcularLiquidacion, codigoLiquidacion, referenciasDelReparto, serieLiquidacion } from '@/utils/liquidacion'
import { valoresEnPapel } from '@/utils/valoresEnPapel'
import { descargasVigentes } from '@/utils/rectificacionDescarga'
import { envasesDeRemito } from '@/utils/envases'
import { gruposAbiertos, type GrupoAbierto } from '@/utils/liquidacionesAbiertas'
import { ventasDelViaje, viajeDeVenta } from '@/utils/viajeDeVenta'
import { claveDia } from '@/utils/diaReparto'
import { addDaysStr, todayString } from '@/utils/helpers'
// La misma cuenta pura que usa el servidor al contar una descarga (functions/triggers/tangoOutbox).
import { armarCierreMercaderia } from '../functions/src/services/cierreMercaderia'

// Bundle CommonJS (esbuild --format=cjs): `require` y `__dirname` existen en tiempo de ejecución.
declare const require: (id: string) => unknown
declare const __dirname: string
// El bundle vive en scripts/.build: la raíz del repo está dos niveles arriba.
const RAIZ = path.resolve(__dirname, '..', '..')
// firebase-admin 14 ya no trae la API con namespace: la arma el shim de los scripts (2026-09-22).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const admin = require(path.join(RAIZ, 'scripts', 'lib', 'firebase-admin-compat.cjs'))
type Admin = typeof import('firebase-admin')
const a = admin as Admin
a.initializeApp({ credential: a.credential.cert(JSON.parse(readFileSync(path.join(RAIZ, 'scripts', 'serviceAccount.json'), 'utf8'))) })
const db = a.firestore()
const { Timestamp, FieldValue } = a.firestore

const args = process.argv.slice(2)
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const APLICAR = args.includes('--aplicar')
const EXCLUIR = new Set((opt('--excluir') ?? '').split(',').map((s) => s.trim()).filter(Boolean))
const HOY = todayString()
const HASTA = opt('--hasta') ?? addDaysStr(HOY, -1)
const DESDE = opt('--desde') ?? addDaysStr(HOY, -45)
const MOTIVO = 'Cierre de arranque del circuito de liquidaciones (días abiertos sin descarga contada)'
if (!/^\d{4}-\d{2}-\d{2}$/.test(HASTA) || !/^\d{4}-\d{2}-\d{2}$/.test(DESDE)) throw new Error('--hasta / --desde con formato yyyy-MM-dd')
if (HASTA >= HOY) throw new Error(`--hasta ${HASTA} no puede ser hoy ni después: el día de hoy lo cierra caja`)

const docs = <T>(snap: FirebaseFirestore.QuerySnapshot): T[] => snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T)
const plata = (n: number) => n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })

async function docsDelDia(choferId: string, fecha: string) {
  const desde = new Date(fecha + 'T00:00:00'); const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 1)
  const q = (col: string, campo: string) => db.collection(col).where(campo, '==', choferId).where('fecha', '>=', Timestamp.fromDate(desde)).where('fecha', '<', Timestamp.fromDate(hasta)).get()
  const [v, c, d, co] = await Promise.all([
    q('ventasCamion', 'choferId'), q('cambiosCamion', 'choferId'),
    // Descargas por día de VIAJE (diaReparto): la contada al día siguiente es de
    // este día, no del que la contaron. Por fecha física, Mira del 16/09 (contado
    // el 17 a las 18:22) figuraba sin descarga y se le escribía otra teórica.
    db.collection('descargasCamion').where('choferId', '==', choferId).where('diaReparto', '==', fecha).get(),
    q('cobranzas', 'registradoPor.uid'),
  ])
  return { ventas: docs<VentaCamion>(v), cambios: docs<CambioCamion>(c), descargas: descargasVigentes(docs<DescargaCamion>(d)), cobranzas: docs<Cobranza>(co) }
}

/** Todos los envases que salieron vuelven: es lo que se asume al no haber conteo. */
function envasesTeoricos(remitos: RemitoCarga[]): EnvasesDescarga {
  const acum: Record<string, unknown> = {}
  for (const r of remitos) {
    for (const [k, v] of Object.entries(envasesDeRemito(r) as unknown as Record<string, unknown>)) {
      if (k === 'origen') continue   // marca interna de envasesDeRemito, no es un envase
      if (typeof v === 'number') acum[k] = ((acum[k] as number) ?? 0) + v
      else if (Array.isArray(v)) acum[k] = [...((acum[k] as unknown[]) ?? []), ...v]
      else if (v !== undefined) acum[k] = v
    }
  }
  return acum as unknown as EnvasesDescarga
}

async function main() {
  // Quién firma.
  let actorUid = opt('--actor')
  if (!actorUid) {
    const sa = await db.collection('users').where('rol', '==', 'super_admin').get()
    actorUid = sa.docs.find((d) => /ariel/i.test(String(d.data().nombre ?? '')))?.id
    if (!actorUid) throw new Error('No encontré al super_admin Ariel: pasá --actor <uid>')
  }
  const actorDoc = await db.doc(`users/${actorUid}`).get()
  const actor = { uid: actorUid, nombre: String(actorDoc.data()?.nombre ?? 'Administración') }

  // Depósitos de Tango por identidad (para numerar la liquidación como caja).
  const depositos = await db.collection('depositos').get()
  const depositoDe = new Map<string, { codigo: string; nombre: string }>()
  for (const d of depositos.docs) { const x = d.data(); const id = x.uid ? String(x.uid) : `dep:${x.codigo}`; depositoDe.set(id, { codigo: String(x.codigo), nombre: String(x.usuarioNombre?.trim() || x.nombre || '') }) }

  const desdeTs = Timestamp.fromDate(new Date(DESDE + 'T00:00:00'))
  const [rem, cob, liq, cm] = await Promise.all([
    db.collection('remitosCarga').where('fecha', '>=', desdeTs).get(),
    db.collection('cobranzas').where('fecha', '>=', desdeTs).get(),
    db.collection('liquidaciones').where('fecha', '>=', DESDE).get(),
    db.collection('cierresMercaderia').get(),
  ])
  const todosLosRemitos = docs<RemitoCarga>(rem)
  const cierresHechos = new Set(docs<CierreMercaderia>(cm).map((c) => c.remitoId))
  const todosLosGrupos = gruposAbiertos(todosLosRemitos, docs<Cobranza>(cob), docs<Liquidacion>(liq), docs<CierreMercaderia>(cm)).filter((g) => g.fecha <= HASTA)
  const excluidos = todosLosGrupos.filter((g) => g.remitos.some((r) => EXCLUIR.has(r.codigo)))
  const grupos = todosLosGrupos.filter((g) => !excluidos.includes(g))
  console.log(`${APLICAR ? 'APLICANDO' : 'EN SECO'} · abiertas del ${DESDE} al ${HASTA}: ${todosLosGrupos.length} · firma: ${actor.nombre} (${actor.uid})`)
  if (excluidos.length) console.log(`Se dejan abiertas ${excluidos.length}: ${excluidos.map((g) => `${g.remitos.map((r) => r.codigo).join('+')} (${g.choferNombre}, ${g.fecha})`).join(', ')}`)
  for (const codigo of EXCLUIR) if (!todosLosGrupos.some((g) => g.remitos.some((r) => r.codigo === codigo))) console.log(`  (aviso: --excluir ${codigo} no está entre las abiertas hasta ${HASTA})`)

  // Cierres de arranque anteriores que todavía figuran como plata a entregar.
  const arranqueEnTesoreria = docs<Liquidacion>(liq).filter((l) => l.cierreArranque && l.entregaId === null)
  if (arranqueEnTesoreria.length) {
    console.log(`Cierres de arranque anteriores con entregaId null (suman en Entrega a tesorería): ${arranqueEnTesoreria.length}, efectivo ${plata(arranqueEnTesoreria.reduce((s, l) => s + (l.efectivoRecibido ?? 0), 0))} → ${APLICAR ? 'se les saca el campo' : 'con --aplicar se les saca el campo'}`)
    if (APLICAR) {
      let b = db.batch(); let n = 0
      for (const l of arranqueEnTesoreria) { b.update(db.doc(`liquidaciones/${l.id}`), { entregaId: FieldValue.delete() }); if (++n % 400 === 0) { await b.commit(); b = db.batch() } }
      await b.commit()
    }
  }
  console.log()

  const porDeposito = new Map<string, Map<string, number>>()
  let descargasNuevas = 0, cierres = 0, cierresMercaderia = 0
  for (const g of grupos) {
    const todo = await docsDelDia(g.choferId, g.fecha)
    const dep = depositoDe.get(g.choferId)
    const remito0 = g.remitos[0] as RemitoCarga | undefined
    const depositoTango = remito0?.depositoTango ?? dep?.codigo
    const depositoTangoNombre = remito0?.depositoTangoNombre ?? dep?.nombre ?? ''

    // Lo del VIAJE, no lo del día: un chofer con dos salidas rinde dos veces y
    // cada una lleva solo sus ventas (el `remitoId` que escribió el backfill, o
    // el viaje que ya había salido cuando se vendió). Un grupo sin remito (cobrador,
    // ventas sin carga) se queda con lo que no se pudo ubicar en ningún viaje.
    const viajesDelChofer = todosLosRemitos
      .filter((r) => r.choferId === g.choferId && claveDia(r.fecha.toDate()) === g.fecha)
      .sort((x, y) => x.fecha.toMillis() - y.fecha.toMillis())
    const unSoloViaje = viajesDelChofer.length <= 1
    // Las descargas anteriores al 18/09 no traen `remitoId`: con un solo viaje son
    // de ese viaje; con varios, del ÚLTIMO (el conteo es de cuando el camión volvió
    // por última vez), y los anteriores llevan su descarga teórica.
    const esUltimoViaje = viajesDelChofer[viajesDelChofer.length - 1]?.id === g.remitoId
    const d = g.remitoId
      ? {
          ventas:    ventasDelViaje(todo.ventas, viajesDelChofer, g.remitoId),
          cambios:   ventasDelViaje(todo.cambios, viajesDelChofer, g.remitoId),
          descargas: todo.descargas.filter((x) => x.remitoId === g.remitoId || (!x.remitoId && (unSoloViaje || esUltimoViaje))),
          cobranzas: g.cobranzas as Cobranza[],
        }
      : {
          ventas:    todo.ventas.filter((v) => viajeDeVenta(v, viajesDelChofer) === null),
          cambios:   todo.cambios.filter((c) => viajeDeVenta(c, viajesDelChofer) === null),
          descargas: [] as DescargaCamion[],
          cobranzas: g.cobranzas as Cobranza[],
        }

    // 1. Descarga teórica (solo si hubo remito y muelle no contó).
    const sinConteo = calcularLiquidacion(g.remitos, d.ventas, d.cambios, d.descargas, d.cobranzas)
    let descargaTeorica: (Omit<DescargaCamion, 'id'> & { teorica: { motivo: string; en: FirebaseFirestore.Timestamp } }) | null = null
    if (remito0 && d.descargas.length === 0) {
      const items = sinConteo.productos.filter((p) => p.devolucionTeorica > 0).map((p) => ({ productoId: p.productoId, nombre: p.nombre, cantidad: p.devolucionTeorica }))
      const fechaDescarga = Timestamp.fromDate(new Date(g.fecha + 'T23:50:00'))
      descargaTeorica = {
        plantaId: remito0.plantaId, camionId: remito0.camionId, camionLabel: remito0.camionLabel,
        choferId: g.choferId, choferNombre: g.choferNombre,
        ...(depositoTango ? { depositoTango, depositoTangoNombre } : {}),
        items, bolsasRotas: [],
        remitoId: remito0.id, remitoCodigo: remito0.codigo,
        envases: envasesTeoricos(g.remitos),
        fecha: fechaDescarga,
        diaReparto: g.fecha,
        registradoPor: { uid: actor.uid, nombre: 'Cierre de arranque' },
        teorica: { motivo: MOTIVO, en: Timestamp.now() },
      } as typeof descargaTeorica
    }
    const descargasFinales = descargaTeorica ? [...d.descargas, { id: 'teorica', ...descargaTeorica } as unknown as DescargaCamion] : d.descargas

    // 2. Liquidación con la descarga incluida (diferencia 0 por producto).
    const calc = calcularLiquidacion(g.remitos, d.ventas, d.cambios, descargasFinales, d.cobranzas)
    const papel = valoresEnPapel(d.cobranzas)
    const serie = serieLiquidacion(g.choferId, depositoTango)
    const plantaId = remito0?.plantaId ?? (d.cobranzas.find((c) => c.plantaId)?.plantaId ?? 'torcuato')

    const dev = sinConteo.productos.filter((p) => p.devolucionTeorica > 0).map((p) => `${p.devolucionTeorica} ${p.nombre}`).join(', ')
    console.log(`${g.fecha}  ${g.choferNombre.padEnd(30)} ${(depositoTango ?? '—').padStart(4)}  remitos ${g.remitos.map((r) => r.codigo).join(' ') || '—'}`)
    const faltaCierreMercaderia = !!g.remitoId && d.descargas.length > 0 && !cierresHechos.has(g.remitoId)
    console.log(`   carga ${sinConteo.productos.reduce((s, p) => s + p.carga, 0)} · vendió ${sinConteo.productos.reduce((s, p) => s + p.ventaContado + p.ventaPromo + p.cambios, 0)} · ${descargaTeorica ? `descarga teórica: ${dev || 'nada que devolver'}` : d.descargas.length ? `ya tenía descarga contada${faltaCierreMercaderia ? ' (se escribe el cierre de mercadería)' : ''}` : 'sin remito'}${!unSoloViaje && g.remitoId ? ` · viaje ${viajesDelChofer.findIndex((r) => r.id === g.remitoId) + 1} de ${viajesDelChofer.length} del día` : ''}`)
    console.log(`   ventas ${calc.cantidadVentas ?? d.ventas.length} = ${plata(calc.importes.total)} · cobranzas ${calc.cobranzasCalle?.cantidad ?? 0} = ${plata(calc.cobranzasCalle?.total ?? 0)} · efectivo a rendir ${plata(calc.efectivoARendir)} · cheques ${papel.cheques.length} · retenciones ${papel.retenciones.length} → ${codigoLiquidacion(serie.prefijo, 0).replace('000000', 'nuevo')}`)
    if (descargaTeorica && depositoTango) {
      const m = porDeposito.get(depositoTango) ?? new Map<string, number>()
      for (const i of descargaTeorica.items) m.set(i.nombre, (m.get(i.nombre) ?? 0) + i.cantidad)
      porDeposito.set(depositoTango, m)
    }

    if (!APLICAR) continue

    let descargaId: string | null = null
    if (descargaTeorica) {
      const ref = await db.collection('descargasCamion').add(descargaTeorica)
      descargaId = ref.id; descargasNuevas++
    }
    const referencias = referenciasDelReparto(g.remitos, d.ventas, descargaId ? [...d.descargas, { id: descargaId } as DescargaCamion] : d.descargas, d.cobranzas)
    // La plata de un viaje va por su remito (`liquidaciones/{remitoId}`, igual
    // que `cerrarLiquidacion`); sin viaje, la clave por día de siempre.
    const id = g.clave
    const ref = db.doc(`liquidaciones/${id}`)
    const counter = db.doc(`config/liquidacionCounter_${serie.clave}`)
    await db.runTransaction(async (tx) => {
      const [existente, cs] = await Promise.all([tx.get(ref), tx.get(counter)])
      if (existente.exists) throw new Error(`${id} ya estaba cerrada`)
      const numero = cs.exists ? (cs.data()!.next as number) : 1
      tx.set(counter, { next: numero + 1 })
      const data = {
        numero, codigo: codigoLiquidacion(serie.prefijo, numero), fecha: g.fecha, plantaId,
        choferId: g.choferId, choferNombre: g.choferNombre,
        ...(g.remitoId && remito0 ? { remitoId: g.remitoId, remitoCodigo: remito0.codigo } : {}),
        ...(depositoTango ? { depositoTango, depositoTangoNombre } : {}),
        ...calc,
        efectivoRecibido: calc.efectivoARendir, diferenciaEfectivo: 0,
        cheques: papel.cheques.map((c) => ({ ...c, recibido: true })),
        retenciones: papel.retenciones.map((r) => ({ ...r, recibido: true })),
        valoresFaltantes: { cantidad: 0, total: 0 },
        confirmoSinPendientes: true,
        ...referencias,
        cierreArranque: { motivo: MOTIVO, en: Timestamp.now() },
        cerradaPor: { uid: actor.uid, nombre: actor.nombre },
        createdAt: FieldValue.serverTimestamp(),
        // Sin `entregaId`: no es plata que caja tenga que entregar (ver cabecera).
      }
      tx.set(ref, data)
    })
    cierres++

    // 3. La otra mitad: si el muelle ya había contado pero el viaje no tiene su
    // cierre de mercadería (contado antes del estreno del circuito), se escribe
    // acá con la misma cuenta del servidor. La descarga teórica no lo necesita:
    // el trigger lo escribe al crearla.
    if (faltaCierreMercaderia && remito0 && g.remitoId) {
      const ultima = [...d.descargas].sort((x, y) => y.fecha.toMillis() - x.fecha.toMillis())[0]
      const cierre = armarCierreMercaderia({
        remito: {
          id: remito0.id, codigo: remito0.codigo, plantaId: remito0.plantaId,
          choferId: remito0.choferId, choferNombre: remito0.choferNombre,
          depositoTango: remito0.depositoTango ?? null, depositoTangoNombre: remito0.depositoTangoNombre ?? null,
          items: remito0.items, palletsCarga: remito0.palletsCarga, envases: remito0.envases ?? null,
        },
        ventas:    d.ventas,
        cambios:   d.cambios as unknown as Parameters<typeof armarCierreMercaderia>[0]['cambios'],
        descargas: d.descargas as unknown as Parameters<typeof armarCierreMercaderia>[0]['descargas'],
        diaReparto: g.fecha,
        contadaPor: ultima.registradoPor,
        contadaEn:  ultima.fecha,
      })
      await db.doc(`cierresMercaderia/${g.remitoId}`).set({ ...cierre, cierreArranque: { motivo: MOTIVO, en: Timestamp.now() } })
      cierresMercaderia++
    }
    console.log(`   ✔ cerrada${descargaId ? ` · descarga ${descargaId}` : ''}${faltaCierreMercaderia ? ' · cierre de mercadería' : ''}`)
  }

  console.log('\nDEVOLUCIÓN TEÓRICA POR DEPÓSITO DE CAMIÓN (lo que vuelve a la planta en Tango):')
  for (const [dep, m] of [...porDeposito.entries()].sort()) console.log(`  ${dep}: ${[...m.entries()].map(([n, c]) => `${c} ${n}`).join(' · ')}`)
  console.log(APLICAR ? `\nListo: ${cierres} liquidaciones cerradas, ${descargasNuevas} descargas teóricas encoladas a Tango, ${cierresMercaderia} cierres de mercadería escritos.` : `\n(en seco: nada escrito; corré con --aplicar para cerrar ${grupos.length})`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
