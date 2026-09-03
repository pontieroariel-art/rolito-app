import { useCallback, useEffect, useSyncExternalStore } from 'react'

// Suscripción a Firestore COMPARTIDA entre todos los componentes que la usan.
//
// useFirestoreSubscription abre un onSnapshot por instancia de hook: en el
// dashboard de heladeras tres componentes montados a la vez tenían cada uno su
// copia de las ~1700 heladeras, y navegar entre pantallas del módulo
// desmontaba y volvía a armar la suscripción (spinner + parseo de la
// colección entera desde la cache) en cada ruta. Acá la suscripción vive a
// nivel módulo, keyed por `key`:
//   - se abre cuando monta el primer consumidor,
//   - todos los consumidores leen el MISMO array (una sola copia en memoria,
//     un solo parseo por snapshot),
//   - al desmontar el último consumidor se mantiene viva `keepAliveMs` antes
//     de cerrarla, así cambiar de pantalla dentro del módulo no rearma nada.
//
// Para streams parametrizados (por cliente, por fecha) incluí el parámetro en
// la key: 'heladerasPorCliente:' + clientId. `enabled: false` no suscribe
// (útil para no bajar una colección entera hasta que la pantalla la necesite).
//
// En desarrollo loguea apertura/cierre y tamaño de cada snapshot
// (`[sub] heladeras: 1734 docs`) para ver cuánto baja cada pantalla.

export interface SharedSubscriptionResult<T> {
  data:     T
  loading:  boolean
  error:    boolean
  timedOut: boolean
}

type Subscribe<T> = (cb: (data: T) => void, onError?: (err: Error) => void) => () => void

interface Entry<T> {
  state:      SharedSubscriptionResult<T>
  listeners:  Set<() => void>
  consumers:  number
  unsub:      (() => void) | null
  closeTimer: ReturnType<typeof setTimeout> | null
  timeoutTimer: ReturnType<typeof setTimeout> | null
}

const entries = new Map<string, Entry<unknown>>()
const DEV = import.meta.env.DEV

function log(msg: string) {
  if (DEV) console.debug(`[sub] ${msg}`)
}

function sizeOf(data: unknown): string {
  if (Array.isArray(data)) return `${data.length} docs`
  if (data === null || data === undefined) return 'vacío'
  return '1 doc'
}

function getEntry<T>(key: string, initial: T): Entry<T> {
  let e = entries.get(key) as Entry<T> | undefined
  if (!e) {
    e = {
      state: { data: initial, loading: true, error: false, timedOut: false },
      listeners: new Set(), consumers: 0, unsub: null, closeTimer: null, timeoutTimer: null,
    }
    entries.set(key, e as Entry<unknown>)
  }
  return e
}

function setState<T>(e: Entry<T>, patch: Partial<SharedSubscriptionResult<T>>) {
  e.state = { ...e.state, ...patch }
  e.listeners.forEach((l) => l())
}

function open<T>(key: string, e: Entry<T>, subscribe: Subscribe<T>, timeoutMs: number) {
  if (e.unsub) return
  log(`${key}: abierta`)
  setState(e, { loading: e.state.loading, error: false, timedOut: false })
  e.timeoutTimer = setTimeout(() => setState(e, { timedOut: true }), timeoutMs)
  const clearTimeoutTimer = () => { if (e.timeoutTimer) { clearTimeout(e.timeoutTimer); e.timeoutTimer = null } }
  e.unsub = subscribe(
    (d) => { clearTimeoutTimer(); log(`${key}: ${sizeOf(d)}`); setState(e, { data: d, loading: false, error: false }) },
    ()  => { clearTimeoutTimer(); log(`${key}: error`); setState(e, { loading: false, error: true }) },
  )
}

function close<T>(key: string, e: Entry<T>) {
  if (e.timeoutTimer) { clearTimeout(e.timeoutTimer); e.timeoutTimer = null }
  if (e.unsub) { e.unsub(); e.unsub = null; log(`${key}: cerrada`) }
  // Próximo consumidor arranca con loading para no mostrar datos viejos como
  // si fueran frescos hasta que llegue el primer snapshot.
  e.state = { ...e.state, loading: true }
}

export function useSharedSubscription<T>(
  key:       string,
  subscribe: Subscribe<T>,
  initial:   T,
  opts: { enabled?: boolean; keepAliveMs?: number; timeoutMs?: number } = {},
): SharedSubscriptionResult<T> {
  const { enabled = true, keepAliveMs = 30_000, timeoutMs = 15_000 } = opts
  const e = getEntry<T>(key, initial)

  useEffect(() => {
    if (!enabled) return
    const entry = getEntry<T>(key, initial)
    entry.consumers++
    if (entry.closeTimer) { clearTimeout(entry.closeTimer); entry.closeTimer = null }
    open(key, entry, subscribe, timeoutMs)
    return () => {
      entry.consumers--
      if (entry.consumers > 0) return
      entry.closeTimer = setTimeout(() => {
        entry.closeTimer = null
        if (entry.consumers === 0) close(key, entry)
      }, keepAliveMs)
    }
    // `subscribe` e `initial` se consideran estables por key: la suscripción es
    // una por key, no por identidad de la función.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])

  const subscribeStore = useCallback((cb: () => void) => {
    const entry = getEntry<T>(key, initial)
    entry.listeners.add(cb)
    return () => { entry.listeners.delete(cb) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const state = useSyncExternalStore(subscribeStore, () => e.state)

  if (!enabled) return { data: initial, loading: false, error: false, timedOut: false }
  return state
}
