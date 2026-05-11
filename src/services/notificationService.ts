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

export const notifyRegistro = (email: string, nombre: string): Promise<void> =>
  post('notify-registro', { email, nombre })

export const notifyAprobado = (email: string, nombre: string): Promise<void> =>
  post('notify-aprobado', { email, nombre })

export const notifyPedidoRecibido = (data: {
  email:      string
  nombre:     string
  products:   Product[]
  date:       string
  notes?:     string
}): Promise<void> => post('notify-pedido-recibido', data)

export const notifyEnCamino = (data: {
  email:    string
  nombre:   string
  products: Product[]
}): Promise<void> => post('notify-en-camino', data)

export const notifyAdminNuevoPedido = (data: {
  adminEmails:   string[]
  clientName:    string
  clientAddress: string
  clientPhone:   string
  products:      Product[]
  date:          string
  notes?:        string
}): Promise<void> => post('notify-admin-nuevo-pedido', data)

export const notifyCerca = (data: {
  email:    string
  nombre:   string
  products: Product[]
}): Promise<void> => post('notify-cerca', data)
