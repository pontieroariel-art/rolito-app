import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { calcularOcupadas, rangoDiaArt, type BorradorLite, type DescargaLite, type RemitoLite, type VentaLite } from '../services/muelleEstado'

// Estado PÚBLICO del muelle (`muelleEstado/{plantaId}`, 2026-09-15): qué dársenas
// están ocupadas ahora. Derivado sanitizado de remitos de carga, descargas y
// turnos de ventanilla, recalculado ENTERO en cada write de cualquiera de los tres
// (son decenas de docs por día por planta; recomputar es más simple y a prueba de
// estados intermedios que parchear). Lo lee el chofer que volvió para elegir en
// qué boca estacionó entre las libres. Lógica pura y tests en services/muelleEstado.

async function recalcular(plantaId: string): Promise<void> {
  const db = getFirestore()
  const { ymd, desde, hasta } = rangoDiaArt()
  const dia = (col: string) => db.collection(col).where('plantaId', '==', plantaId).where('fecha', '>=', desde).where('fecha', '<', hasta).get()
  // Los borradores se piden por `paraFecha` y no por `fecha`: el de un camión que
  // sale a las 4 se armó la tarde anterior, así que su `fecha` es de ayer pero la
  // boca la está ocupando hoy.
  const [remitos, descargas, ventas, borradores] = await Promise.all([
    dia('remitosCarga'), dia('descargasCamion'), dia('ventasVentanilla'),
    db.collection('borradoresCarga').where('plantaId', '==', plantaId).where('estado', '==', 'pendiente').get(),
  ])
  const ocupadas = calcularOcupadas(
    remitos.docs.map((d) => d.data() as RemitoLite),
    descargas.docs.map((d) => d.data() as DescargaLite),
    ventas.docs.map((d) => d.data() as VentaLite),
    borradores.docs.map((d) => d.data() as BorradorLite),
  )
  await db.collection('muelleEstado').doc(plantaId).set({
    plantaId, fecha: ymd, ocupadas, actualizado: FieldValue.serverTimestamp(),
  })
}

const plantaDe = (event: { data?: { after: { exists: boolean; data(): unknown }; before: { data(): unknown } } }): string | undefined => {
  const data = (event.data?.after.exists ? event.data.after.data() : event.data?.before.data()) as { plantaId?: string } | undefined
  return data?.plantaId
}

export const publicarMuelleEstadoRemito = onDocumentWritten('remitosCarga/{id}', async (event) => {
  const plantaId = plantaDe(event)
  if (plantaId) await recalcular(plantaId)
})

export const publicarMuelleEstadoDescarga = onDocumentWritten('descargasCamion/{id}', async (event) => {
  const plantaId = plantaDe(event)
  if (plantaId) await recalcular(plantaId)
})

export const publicarMuelleEstadoVentanilla = onDocumentWritten('ventasVentanilla/{id}', async (event) => {
  const plantaId = plantaDe(event)
  if (plantaId) await recalcular(plantaId)
})

// El camión que está cargando ocupa la boca desde el borrador, que es lo único
// que existe mientras carga (2026-09-18).
export const publicarMuelleEstadoBorrador = onDocumentWritten('borradoresCarga/{id}', async (event) => {
  const plantaId = plantaDe(event)
  if (plantaId) await recalcular(plantaId)
})
