import { getFunctions, httpsCallable } from 'firebase/functions'

interface Product {
  name: string
  quantity: number
}

// Relative when hosted on Netlify; override via env var for other setups
const BASE = import.meta.env.VITE_NETLIFY_FUNCTIONS_URL ?? '/.netlify/functions'

const post = (fn: string, body: unknown): Promise<void> =>
  fetch(`${BASE}/${fn}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  }).then((r) => {
    if (!r.ok) console.error(`notify ${fn} returned ${r.status}`)
  })

// Los emails de registro, aprobación de cliente, pedido recibido, nuevo pedido
// al admin, confirmado y en-camino los envían triggers de Firestore server-side
// (functions/src/triggers). No se disparan desde el cliente para evitar emails
// duplicados y para no exponer un endpoint de envío abierto.

export const notifyCerca = (data: {
  email:    string
  nombre:   string
  products: Product[]
}): Promise<void> => post('notify-cerca', data)

export const notifyReprogramado = (data: {
  email:      string
  nombre:     string
  products:   Product[]
  fechaNueva: string
  motivo:     string
}): Promise<void> => post('notify-reprogramado', data)

// El envío de web-push corre en una Cloud Function callable
// (functions/src/triggers/push.ts). Antes iba a una Netlify Function que quedó
// inalcanzable al hostear la app en Firebase Hosting.
export const sendPush = async (data: {
  subscription: PushSubscriptionJSON
  title:        string
  body:         string
}): Promise<void> => {
  try {
    await httpsCallable(getFunctions(), 'sendPush')(data)
  } catch (err) {
    console.error('sendPush error:', err)
  }
}
