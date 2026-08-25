import { onSchedule } from 'firebase-functions/v2/scheduler'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { sendEmail, APP_URL, resendApiKey } from '../email'
import { tplComodatosPorVencer } from '../templates'

const TZ = 'America/Argentina/Buenos_Aires'

// Cuántos comodatos vencidos como máximo entran en el aviso semanal. Existe
// para no volcarle al encargado, de una sola vez, el backlog completo de las
// ~1300 heladeras importadas del listado histórico (nunca tuvieron firma
// real, así que arrancan todas "vencidas" el mismo día) — se van
// despachando de a poco, semana a semana, hasta que el backlog se pone al
// día y esto pasa a avisar solo lo que realmente se va venciendo.
const CUPO_SEMANAL = 25

interface HeladeraComodato {
  codigoInterno:          string
  estado:                 string
  clienteAsignadoNombre?: string | null
  clienteAsignadoDireccion?: string | null
  comodatoVenceEl?:       Timestamp | null
  comodatoAvisoEnviado?:  boolean
}

// Lunes a la mañana — es una lista de visitas para la semana, no una alarma
// diaria. Sin índice compuesto: filtra solo por `estado` (igualdad) y
// resuelve fecha/orden/cupo en memoria — la colección en_comodato (~1300
// docs) es chica para un vistazo server-side semanal.
export const avisarComodatosPorVencer = onSchedule(
  { schedule: '0 8 * * 1', timeZone: TZ, secrets: [resendApiKey] },
  async () => {
    const db  = getFirestore()
    const now = Timestamp.now()

    const snap = await db.collection('heladeras')
      .where('estado', '==', 'en_comodato')
      .get()

    const vencidas = snap.docs
      .map((d) => ({ ref: d.ref, data: d.data() as HeladeraComodato }))
      .filter(({ data }) =>
        data.comodatoVenceEl != null &&
        data.comodatoVenceEl.toMillis() <= now.toMillis() &&
        data.comodatoAvisoEnviado !== true)
      .sort((a, b) => a.data.comodatoVenceEl!.toMillis() - b.data.comodatoVenceEl!.toMillis())
      .slice(0, CUPO_SEMANAL)

    if (vencidas.length === 0) {
      console.log('[avisarComodatosPorVencer] nada para avisar esta semana')
      return
    }

    const encargados = await db.collection('users')
      .where('rol', '==', 'heladeras_encargado').where('estado', '==', 'activo').get()
    const emails = encargados.docs.map((d) => d.data().email as string).filter(Boolean)

    if (emails.length > 0) {
      const items = vencidas.map(({ data }) => ({
        heladeraCodigo: data.codigoInterno,
        clientName:     data.clienteAsignadoNombre ?? '—',
        direccion:      data.clienteAsignadoDireccion,
        diasVencido:    Math.max(0, Math.floor((now.toMillis() - data.comodatoVenceEl!.toMillis()) / 86400000)),
      }))
      await sendEmail(emails, `${vencidas.length} comodato(s) para renovar - Rolito`, tplComodatosPorVencer(items, APP_URL))
    }

    await Promise.all(vencidas.map(({ ref }) => ref.update({ comodatoAvisoEnviado: true })))
    console.log(`[avisarComodatosPorVencer] ${vencidas.length} heladera(s) avisadas de ${snap.size} en comodato`)
  },
)
