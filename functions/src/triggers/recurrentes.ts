import { onSchedule } from 'firebase-functions/v2/scheduler'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'

const TZ = 'America/Argentina/Buenos_Aires'

interface PedidoRecurrente {
  clientId:          string
  clientEmail:       string
  clientName:        string
  clientAddress:     string
  clientPhone:       string
  diasSemana:        number[]      // 0=Dom … 6=Sáb
  products:          unknown[]
  activo:            boolean
  notas?:            string
  ultimaGeneracion?: Timestamp | null
}

// 'YYYY-MM-DD' de una fecha vista desde Argentina (en-CA da ese formato).
const fechaART = (d: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)

// Día de semana (0=Dom … 6=Sáb) visto desde Argentina.
const diaSemanaART = (d: Date): number =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    .indexOf(new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(d))

// Genera los pedidos recurrentes del día. Antes esto corría en el navegador
// cuando un admin abría el AdminDashboard (generateRecurrentesForToday), o sea
// que un feriado sin actividad de admins dejaba pedidos sin generar. Corre
// temprano para que el pedido ya esté cuando logística arma el despacho.
//
// La transacción por plantilla re-lee `ultimaGeneracion` y la compara contra la
// fecha de HOY en Argentina: si otra ejecución (o un retry del scheduler) ya
// generó el pedido de hoy, se saltea — mismo anti-duplicado que tenía el cliente.
export const generarPedidosRecurrentes = onSchedule(
  { schedule: '0 6 * * *', timeZone: TZ },
  async () => {
    const db  = getFirestore()
    const now = new Date()
    const hoyStr = fechaART(now)
    const hoyDia = diaSemanaART(now)

    const templates = await db.collection('pedidos-recurrentes')
      .where('activo', '==', true)
      .get()

    let generados = 0
    for (const tSnap of templates.docs) {
      const t = tSnap.data() as PedidoRecurrente
      if (!t.diasSemana?.includes(hoyDia)) continue

      const orderRef = db.collection('orders').doc()
      try {
        const creado = await db.runTransaction(async (tx) => {
          const fresh = await tx.get(tSnap.ref)
          if (!fresh.exists) return false

          const ultima = (fresh.data() as PedidoRecurrente).ultimaGeneracion
          if (ultima && fechaART(ultima.toDate()) === hoyStr) return false

          tx.set(orderRef, {
            clientId:         t.clientId,
            clientEmail:      t.clientEmail,
            clientName:       t.clientName,
            clientAddress:    t.clientAddress,
            clientPhone:      t.clientPhone,
            products:         t.products,
            status:           'pendiente',
            date:             Timestamp.now(),
            driverId:         null,
            notes:            t.notas ?? '',
            origenRecurrente: true,
            createdAt:        FieldValue.serverTimestamp(),
            updatedAt:        FieldValue.serverTimestamp(),
          })
          tx.update(tSnap.ref, { ultimaGeneracion: FieldValue.serverTimestamp() })
          return true
        })
        if (creado) generados++
      } catch (err) {
        console.error(`[generarPedidosRecurrentes] error en plantilla ${tSnap.id}:`, err)
      }
    }

    console.log(`[generarPedidosRecurrentes] ${generados} pedido(s) generados para ${hoyStr}`)
  },
)
