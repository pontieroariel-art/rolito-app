import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { assertNoImpersonado } from '../authz'
import { defineSecret } from 'firebase-functions/params'
import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore'
import { assertRateLimit } from '../rateLimit'
import { armarArchivoCot, fechaValidez, parsearRespuestaCot, type CotConfig, type CotSolicitud } from '../services/arba/cot'
import { presentarArchivoCot } from '../services/arba/cotHttp'

// COT de ARBA para el remito de carga (2026-09-10). Cuando caja emite un remito
// de carga que requiere COT, el doc nace con `cotSolicitud` (destino, remito R
// que lo respalda, patente, recorrido, salida). Acá se arma el TXT, se presenta
// al web service de ARBA y se guarda el resultado en `remitosCarga.cot` (solo
// el Admin SDK escribe ese campo: las reglas de update de remitosCarga tienen
// hasOnly). El interruptor es config/cot.habilitado; la clave CIT es el secret
// ARBA_CIT. Reintentos: la callable presentarCotRemito (caja, desde la
// pantalla de remitos). Ver docs/arba/COT.md.

export const arbaCit = defineSecret('ARBA_CIT')

const ROLES_PRESENTAN = new Set(['super_admin', 'logistica', 'caja', 'facturacion'])

export async function presentarCotDeRemito(db: Firestore, remitoId: string, cit: string, origen: 'trigger' | 'manual'): Promise<{ ok: boolean; cot?: string; error?: string }> {
  const ref = db.doc(`remitosCarga/${remitoId}`)
  const snap = await ref.get()
  const r = snap.data()
  if (!r) throw new HttpsError('not-found', 'El remito de carga no existe')
  const sol = r.cotSolicitud as CotSolicitud | undefined
  if (!sol) return { ok: false, error: 'El remito no tiene datos para el COT (se emitió sin pedirlo)' }
  if (r.cot?.estado === 'presentado' && r.cot?.numero) return { ok: true, cot: String(r.cot.numero) }

  const cfg = ((await db.doc('config/cot').get()).data() ?? {}) as Partial<CotConfig>
  const intentos = Number(r.cot?.intentos ?? 0) + 1
  const fallar = async (error: string) => {
    await ref.set({ cot: { estado: 'error', error: error.slice(0, 500), intentos, origen, actualizadoEn: FieldValue.serverTimestamp() } }, { merge: true })
    console.error(`[cot] ${r.codigo ?? remitoId}: ${error}`)
    return { ok: false, error }
  }
  if (cfg.habilitado !== true) return fallar('La presentación del COT a ARBA está deshabilitada (config/cot.habilitado)')
  if (!cit) return fallar('Falta el secret ARBA_CIT (clave de transporte de ARBA)')

  let archivo
  try {
    const fechaEmision: Date = r.fecha instanceof Timestamp ? r.fecha.toDate() : new Date()
    archivo = armarArchivoCot(
      { plantaId: String(r.plantaId), fechaEmision, items: (r.items ?? []) as { productoId: string; nombre: string; cantidad: number }[] },
      sol,
      cfg as CotConfig,
      Number(r.numero ?? 0) || 1,
    )
  } catch (e) {
    return fallar((e as Error).message)
  }

  let respuesta
  try {
    const ambiente = cfg.ambiente === 'prueba' ? 'prueba' : 'produccion'
    const http = await presentarArchivoCot(ambiente, { cuit: String(cfg.cuit ?? ''), cit }, archivo)
    if (http.status !== 200) return fallar(`ARBA respondió HTTP ${http.status}: ${http.xml.slice(0, 200)}`)
    respuesta = parsearRespuestaCot(http.xml)
  } catch (e) {
    return fallar(`No se pudo conectar con ARBA: ${(e as Error).message}`)
  }
  if (!respuesta.ok || !respuesta.cot) return fallar(respuesta.error ?? 'ARBA no devolvió COT')

  await ref.set({
    cot: {
      estado: 'presentado',
      numero: respuesta.cot,
      ...(respuesta.numeroUnico ? { numeroUnico: respuesta.numeroUnico } : {}),
      archivo: archivo.nombre,
      txt: archivo.contenido,
      kg: archivo.kg,
      fechaValidez: fechaValidez(sol.fechaSalida),
      intentos,
      origen,
      presentadoEn: FieldValue.serverTimestamp(),
      actualizadoEn: FieldValue.serverTimestamp(),
      error: FieldValue.delete(),
    },
  }, { merge: true })
  console.log(`[cot] ${r.codigo ?? remitoId}: COT ${respuesta.cot} (${archivo.nombre}, ${archivo.kg} kg)`)
  return { ok: true, cot: respuesta.cot }
}

/** Al emitir el remito de carga con datos de COT, se presenta enseguida (antes de que el camión salga). */
export const onRemitoCargaCotSolicitado = onDocumentCreated(
  { document: 'remitosCarga/{remitoId}', secrets: [arbaCit], timeoutSeconds: 60 },
  async (event) => {
    const data = event.data?.data()
    if (!data?.cotSolicitud) return
    try {
      await presentarCotDeRemito(getFirestore(), event.params.remitoId, arbaCit.value(), 'trigger')
    } catch (e) {
      console.error(`[cot] ${event.params.remitoId}: ${(e as Error).message}`)
    }
  },
)

/** Reintento manual desde la pantalla de remitos de carga (caja / logística / super_admin). */
export const presentarCotRemito = onCall(
  { secrets: [arbaCit], timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Requiere autenticación')
    assertNoImpersonado(request)
    const uid = request.auth.uid
    const db = getFirestore()
    const perfil = (await db.doc(`users/${uid}`).get()).data()
    const rolesExtra = ((perfil?.rolesExtra ?? []) as { rol?: string }[]).map((x) => x?.rol ?? '')
    if (perfil?.estado !== 'activo' || (!ROLES_PRESENTAN.has(String(perfil?.rol)) && !rolesExtra.some((x) => ROLES_PRESENTAN.has(x)))) {
      throw new HttpsError('permission-denied', 'No autorizado')
    }
    const remitoId = String(request.data?.remitoId ?? '').trim()
    if (!remitoId) throw new HttpsError('invalid-argument', 'Falta remitoId')
    await assertRateLimit(uid, 'presentarCotRemito', 30, 3600)
    return presentarCotDeRemito(db, remitoId, arbaCit.value(), 'manual')
  },
)
