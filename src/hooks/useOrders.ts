import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  subscribeClientOrders,
  subscribeAllOrders,
  subscribeKanbanOrders,
  subscribeDriverOrders,
} from '../services/orderService'
import { Order } from '../types'

export function useClientOrders(): { orders: Order[]; loading: boolean; error: boolean } {
  const { user }              = useAuth()
  const [orders, setOrders]   = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    if (!user?.uid) return
    const unsub = subscribeClientOrders(
      user.uid,
      (data) => { setOrders(data); setLoading(false); setError(false) },
      ()     => { setLoading(false); setError(true) },
    )
    return unsub
  }, [user?.uid])

  return { orders, loading, error }
}

export function useAllOrders(): { orders: Order[]; loading: boolean; error: boolean } {
  const [orders, setOrders]   = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    const unsub = subscribeAllOrders(
      (data) => { setOrders(data); setLoading(false); setError(false) },
      ()     => { setLoading(false); setError(true) },
    )
    return unsub
  }, [])

  return { orders, loading, error }
}

export function useKanbanOrders(): { orders: Order[]; loading: boolean; error: boolean } {
  const [orders, setOrders]   = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    const unsub = subscribeKanbanOrders(
      (data) => { setOrders(data); setLoading(false); setError(false) },
      ()     => { setLoading(false); setError(true) },
    )
    return unsub
  }, [])

  return { orders, loading, error }
}

// overrideEmail: undefined = usar email propio; null = no cargar (ayudante sin turno asignado)
export function useDriverOrders(overrideEmail?: string | null): { orders: Order[]; loading: boolean; error: boolean } {
  const { user }              = useAuth()
  const [orders, setOrders]   = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  const email = overrideEmail === undefined ? user?.email : overrideEmail

  useEffect(() => {
    if (!email) {
      setOrders([])
      setLoading(false)
      return
    }
    setLoading(true)
    setOrders([])
    const unsub = subscribeDriverOrders(
      email,
      (data) => { setOrders(data); setLoading(false); setError(false) },
      ()     => { setLoading(false); setError(true) },
    )
    return unsub
  }, [email])

  return { orders, loading, error }
}
