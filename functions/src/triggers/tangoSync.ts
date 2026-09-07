import { onRequest } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { agregarTangoId, EMPRESAS, tangoIdsDe, type Empresa, type TangoIds } from '../services/tango/empresas'
import { cuitValido } from '../services/tango/cuit'

const tangoBridgeSecret = defineSecret('TANGO_BRIDGE_SECRET')

// Tope de filas por request (auditoría 2026-08-29, H11): el bridge sincroniza el
// padrón en lotes y ninguno legítimo se acerca a esto. Acota el costo / DoS si
// el secret se filtrara o el bridge tuviera un bug que mande un array enorme.
const MAX_ROWS_POR_LOTE = 10000

// Fila recortada de la respuesta de Tango (Api/Get, process=2117 = Clientes)
// de UNA empresa. Ver docs/tango/INTEGRACION.md §6.1.
export interface TangoClienteRow {
  idGva14:          number
  codGva14:         string
  cuit:             string
  razonSocial?:     string
  email?:           string
  telefono1?:       string
  telefono2?:       string
  telefonoMovil?:   string
  condicionVentaDesc?: string
  categoriaIvaCodigo?: string
  categoriaIvaDesc?:   string
  vendedorCodigo?:     string
  domicilio?:          string
  localidad?:          string
  provinciaDesc?:      string
  codigoPostal?:       string
  fechaAlta?:          string
  habilitado?:         boolean
}

interface ResultadoFila {
  idGva14: number
  cuit:    string
  motivo:  string
}

export interface ResultadoSync {
  succeeded: boolean
  dryRun: boolean
  reason?: string
  received?: number
  matchedByIdGva14?: number
  matchedByCuit?: number
  matchedByCodigo?: number
  newlyLinkedCodigoTango?: number
  codigosSecundarios?: number
  skippedNoMatch?: number
  skippedAmbiguousCuit?: number
  actualizados?: number
  emailsActualizados?: number
  emailsConError?: number
  wouldUpdate?: unknown[]
  errores?: ResultadoFila[]
  // Filas de Tango sin cuenta en la app (candidatas a alta automática).
  sinCuenta?: TangoClienteRow[]
  // Cuentas vinculadas que aparecieron en este lote, con si la fila estaba
  // habilitada en Tango (para la baja automática de las que no aparecen).
  vistos?: Array<{ uid: string; habilitado: boolean }>
}

export function soloDigitos(v: string | undefined | null): string {
  return v != null ? String(v).replace(/\D/g, '') : ''
}

// Tango mezcla texto libre en los teléfonos (ej. "0810-3216-2576 pagos") — solo
// se acepta un candidato si, sacando espacios/guiones/paréntesis, queda algo que
// parece un teléfono de verdad. Si ninguno pasa, se deja el que ya hay en la app.
export function sanitizarTelefono(candidatos: Array<string | undefined>): string | null {
  for (const c of candidatos) {
    if (!c) continue
    const limpio = c.trim()
    if (/^[\d\s\-()+]{6,20}$/.test(limpio)) {
      const soloNumeros = limpio.replace(/\D/g, '')
      if (soloNumeros.length >= 6 && soloNumeros.length <= 15) return limpio
    }
  }
  return null
}

export function pareceEmailValido(email: string | undefined | null): email is string {
  return !!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

// ── Índice de cuentas de cliente, UNA vez por corrida ────────────────────────
// Antes se leía la colección entera por cada lote de 300 filas (≈20 escaneos
// por corrida). Ahora se arma una vez y se comparte entre empresas y lotes; los
// vínculos que se hacen en memoria (perfil.tangoIds) se ven en los lotes que
// siguen, así otra fila con el mismo CUIT no reconquista al mismo cliente.
export interface IndiceUsuarios {
  perfilPorUid: Map<string, FirebaseFirestore.DocumentData>
  porIdGva14:   Record<Empresa, Map<number, string>>
  porCodigo:    Record<Empresa, Map<string, string>>
  porCuit:      Map<string, string[]>
}

export async function indiceUsuariosClientes(db: FirebaseFirestore.Firestore): Promise<IndiceUsuarios> {
  const usersSnap = await db.collection('users').where('rol', '==', 'cliente').get()
  const indice: IndiceUsuarios = {
    perfilPorUid: new Map(),
    porIdGva14: { redonhielo: new Map(), rolito: new Map() },
    porCodigo:  { redonhielo: new Map(), rolito: new Map() },
    porCuit: new Map(),
  }
  usersSnap.forEach((doc) => {
    const data = doc.data()
    data.tangoIdsRaw = data.tangoIds ?? {}   // lo que hay escrito en Firestore
    data.tangoIds = tangoIdsDe(data)         // normalizado, con los legacy absorbidos
    indice.perfilPorUid.set(doc.id, data)
    for (const empresa of EMPRESAS) {
      for (const id of (data.tangoIds as TangoIds)[empresa] ?? []) {
        indice.porIdGva14[empresa].set(id.idGva14, doc.id)
        indice.porCodigo[empresa].set(id.codigo, doc.id)
      }
    }
    const cuit = soloDigitos(data.cuit)
    if (cuit.length >= 6) {
      if (!indice.porCuit.has(cuit)) indice.porCuit.set(cuit, [])
      indice.porCuit.get(cuit)!.push(doc.id)
    }
  })
  return indice
}

/**
 * Vincula y actualiza las cuentas de la app con las filas de Tango de UNA
 * empresa. La ficha (razón social, IVA, domicilio, email…) la manda Redonhielo;
 * de Rolito solo se toma la identidad (tangoIds.rolito), salvo que el cliente
 * exista únicamente en Rolito. Varias filas con el mismo CUIT → una cuenta con
 * varios códigos (la primera vinculada es la principal).
 */
export async function procesarLoteClientesTango(
  db: FirebaseFirestore.Firestore,
  rows: TangoClienteRow[],
  opts: { dryRun: boolean; empresa?: Empresa; indice?: IndiceUsuarios },
): Promise<ResultadoSync> {
  const empresa: Empresa = opts.empresa ?? 'redonhielo'
  const indice = opts.indice ?? await indiceUsuariosClientes(db)
  const { perfilPorUid, porIdGva14, porCodigo, porCuit } = indice

  let matchedByIdGva14 = 0
  let matchedByCuit = 0
  let matchedByCodigo = 0
  let newlyLinkedCodigoTango = 0
  let codigosSecundarios = 0
  let skippedNoMatch = 0
  let skippedAmbiguousCuit = 0
  let actualizados = 0
  let emailsActualizados = 0
  let emailsConError = 0
  const errores: ResultadoFila[] = []
  const wouldUpdate: unknown[] = []
  const sinCuenta: TangoClienteRow[] = []
  const vistos: Array<{ uid: string; habilitado: boolean }> = []

  const auth = getAuth()
  let batch = db.batch()
  let enBatch = 0

  const flush = async () => {
    if (enBatch === 0) return
    if (!opts.dryRun) await batch.commit()
    batch = db.batch()
    enBatch = 0
  }

  for (const row of rows) {
    let uid = porIdGva14[empresa].get(row.idGva14)
    let esNuevoLink = false

    if (uid) {
      matchedByIdGva14++
    } else {
      // Misma cuenta por CUIT (una cuenta por CUIT en la app). Si el cliente ya
      // tiene un código vinculado en esta empresa, esta fila es OTRO código del
      // mismo CUIT (sucursal / grupo empresario) y se agrega como secundario.
      // Solo con CUIT válido: los rellenos ("00000000000", consumidor final)
      // colgarían cientos de códigos de una misma cuenta.
      const cuit = soloDigitos(row.cuit)
      const candidatos = cuitValido(cuit) ? (porCuit.get(cuit) ?? []) : []
      if (candidatos.length > 1) {
        skippedAmbiguousCuit++
        errores.push({ idGva14: row.idGva14, cuit: row.cuit, motivo: 'CUIT ambiguo: más de un cliente de la app con ese CUIT' })
        continue
      }
      if (candidatos.length === 1) {
        uid = candidatos[0]
        matchedByCuit++
      } else if (empresa !== 'redonhielo' && row.codGva14 && porCodigo.redonhielo.has(row.codGva14)) {
        // Rolito comparte los códigos de cliente con Redonhielo: si el CUIT no
        // alcanzó (vacío / distinto), el código sí identifica la cuenta.
        uid = porCodigo.redonhielo.get(row.codGva14)!
        matchedByCodigo++
      } else {
        skippedNoMatch++
        if (sinCuenta.length < 10000) sinCuenta.push(row)
        continue
      }
      esNuevoLink = true
    }

    const perfil = perfilPorUid.get(uid)!
    const ids = perfil.tangoIds as TangoIds
    vistos.push({ uid, habilitado: row.habilitado !== false })
    const tienePrincipal = (ids[empresa]?.length ?? 0) > 0
    const esPrincipal = !tienePrincipal || ids[empresa]![0].idGva14 === row.idGva14
    const update: Record<string, unknown> = {}

    if (esNuevoLink) {
      const lista = agregarTangoId(ids[empresa], { idGva14: row.idGva14, codigo: row.codGva14 }, { principal: !tienePrincipal })
      ids[empresa] = lista
      update[`tangoIds.${empresa}`] = lista
      porIdGva14[empresa].set(row.idGva14, uid)
      porCodigo[empresa].set(row.codGva14, uid)
      if (tienePrincipal) codigosSecundarios++
      else newlyLinkedCodigoTango++
      if (empresa === 'redonhielo' && !tienePrincipal) {
        // Alias legacy del principal de Redonhielo (los usan precios, writers, UI).
        update.codigoTango = row.codGva14
        update.idGva14Tango = row.idGva14
        perfil.codigoTango = row.codGva14
        perfil.idGva14Tango = row.idGva14
      }
    } else if (esPrincipal && !perfilTieneTangoIds(perfil, empresa)) {
      // Cuenta vinculada por los campos legacy (idGva14Tango) pero sin
      // `tangoIds` escrito todavía: se materializa una vez.
      update[`tangoIds.${empresa}`] = ids[empresa]
    }
    if (update[`tangoIds.${empresa}`]) perfil.tangoIdsRaw[empresa] = update[`tangoIds.${empresa}`]
    if (esPrincipal && ids[empresa] && ids[empresa]![0].codigo !== row.codGva14) {
      // El código cambió en Tango (raro): se refleja.
      ids[empresa] = agregarTangoId(ids[empresa], { idGva14: row.idGva14, codigo: row.codGva14 }, { principal: true })
      update[`tangoIds.${empresa}`] = ids[empresa]
      if (empresa === 'redonhielo') update.codigoTango = row.codGva14
    }

    // La ficha la manda Redonhielo. Rolito solo si el cliente NO existe en Redonhielo.
    const escribeFicha = esPrincipal && (empresa === 'redonhielo' || !(ids.redonhielo?.length))
    if (escribeFicha) {
      if (row.razonSocial) update.razonSocial = row.razonSocial
      if (row.condicionVentaDesc) update.condicionVenta = row.condicionVentaDesc
      if (row.categoriaIvaCodigo) update.categoriaIvaTango = row.categoriaIvaCodigo
      if (row.categoriaIvaDesc) update.categoriaIvaTangoDesc = row.categoriaIvaDesc
      if (row.vendedorCodigo) update.codVendedor = row.vendedorCodigo
      if (row.domicilio) update.domicilioTango = row.domicilio
      if (row.localidad) update.localidadTango = row.localidad
      if (row.provinciaDesc) update.provinciaTango = row.provinciaDesc
      if (row.codigoPostal) update.codigoPostalTango = row.codigoPostal
      if (row.fechaAlta) {
        const fecha = new Date(row.fechaAlta)
        if (!isNaN(fecha.getTime())) update.fechaAlta = Timestamp.fromDate(fecha)
      }

      const telefono = sanitizarTelefono([row.telefono1, row.telefono2, row.telefonoMovil])
      if (telefono) update.telefono = telefono

      // Email: hay 2 modelos de cuenta distintos en la base:
      // - Clientes importados / creados desde Tango tienen `emailAuth` separado
      //   ("{cuit}@rolito.app") que es la credencial real de Firebase Auth — `email`
      //   ahí es puramente de contacto. Alcanza con actualizar `email`.
      // - Clientes que se autorregistraron NO tienen `emailAuth` — `email` ES la
      //   credencial, y hay que actualizar las 3 patas juntas (Auth + cuitIndex +
      //   perfil), nunca solo 2 de 3.
      if (pareceEmailValido(row.email) && row.email !== perfil.email) {
        // Las cuentas sin CUIT no tienen usuario de Auth: solo el contacto.
        if (perfil.emailAuth || perfil.sinCuit || opts.dryRun) {
          update.email = row.email
        } else {
          try {
            await auth.updateUser(uid, { email: row.email })
            const cuitDigits = soloDigitos(perfil.cuit)
            if (cuitDigits.length === 11) {
              await db.doc(`cuitIndex/${cuitDigits}`).set({ email: row.email })
            }
            update.email = row.email
            emailsActualizados++
          } catch (err) {
            emailsConError++
            errores.push({
              idGva14: row.idGva14,
              cuit: row.cuit,
              motivo: `No se pudo actualizar el email (¿ya está en uso por otra cuenta?): ${err instanceof Error ? err.message : String(err)}`,
            })
          }
        }
      }
    }

    update.tangoUltimaSync = FieldValue.serverTimestamp()

    if (opts.dryRun) {
      if (wouldUpdate.length < 20) wouldUpdate.push({ uid, empresa, ...update })
      actualizados++
      continue
    }

    batch.update(db.collection('users').doc(uid), update)
    actualizados++
    enBatch++
    if (enBatch >= 400) await flush()
  }

  await flush()

  return {
    succeeded: true,
    dryRun: opts.dryRun,
    received: rows.length,
    matchedByIdGva14,
    matchedByCuit,
    matchedByCodigo,
    newlyLinkedCodigoTango,
    codigosSecundarios,
    skippedNoMatch,
    skippedAmbiguousCuit,
    actualizados,
    emailsActualizados,
    emailsConError,
    ...(opts.dryRun ? { wouldUpdate } : {}),
    errores,
    sinCuenta,
    vistos,
  }
}

// ¿El doc en Firestore ya tiene `tangoIds.<empresa>` escrito? (tangoIdsDe lo
// sintetiza en memoria desde los legacy, así que no alcanza con mirar perfil.tangoIds.)
function perfilTieneTangoIds(perfil: FirebaseFirestore.DocumentData, empresa: Empresa): boolean {
  return Array.isArray(perfil.tangoIdsRaw?.[empresa]) && perfil.tangoIdsRaw[empresa].length > 0
}

// Recibe lotes de clientes de Tango desde el script que corría en la VM (ver
// scripts/tango/bridge-sync-clientes.mjs — reemplazado por
// syncClientesTangoConnect el 2026-09-03; queda por compatibilidad). Bearer
// secret angosto, no un usuario autenticado. Ver docs/tango/INTEGRACION.md §4/§6.
export const syncClientesTango = onRequest(
  { secrets: [tangoBridgeSecret], invoker: 'public' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ succeeded: false, reason: 'method not allowed' })
      return
    }

    const authHeader = req.headers.authorization ?? ''
    if (authHeader !== `Bearer ${tangoBridgeSecret.value()}`) {
      res.status(401).json({ succeeded: false, reason: 'unauthorized' })
      return
    }

    const db = getFirestore()
    const dryRun = req.body?.dryRun === true

    if (!dryRun) {
      const cfgSnap = await db.doc('config/tango').get()
      if (cfgSnap.data()?.enabled !== true) {
        res.status(200).json({ succeeded: false, dryRun, reason: 'tango sync disabled via config/tango.enabled' })
        return
      }
    }

    const rows = req.body?.rows as TangoClienteRow[] | undefined
    if (!Array.isArray(rows)) {
      res.status(400).json({ succeeded: false, reason: 'rows[] requerido' })
      return
    }
    if (rows.length > MAX_ROWS_POR_LOTE) {
      res.status(413).json({ succeeded: false, reason: `demasiadas filas (${rows.length} > ${MAX_ROWS_POR_LOTE}); enviá lotes más chicos` })
      return
    }

    try {
      const resultado = await procesarLoteClientesTango(db, rows, { dryRun, empresa: 'redonhielo' })
      delete resultado.sinCuenta
      res.status(200).json(resultado)
    } catch (err) {
      console.error('[syncClientesTango] error procesando lote:', err)
      res.status(500).json({ succeeded: false, reason: err instanceof Error ? err.message : String(err) })
    }
  },
)
