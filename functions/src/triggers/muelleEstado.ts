import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { calcularOcupadas, rangoDiaArt, type DescargaLite, type RemitoLite, type VentaLite } from '../services/muelleEstado'

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
  const [remitos, descargas, ventas] = await Promise.all([dia('remitosCarga'), dia('descargasCamion'), dia('ventasVentanilla')])
  const ocupadas = calcularOcupadas(
    remitos.docs.map((d) => d.data() as RemitoLite),
    descargas.docs.map((d) => d.data() as DescargaLite),
    ventas.docs.map((d) => d.data() as VentaLite),
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
