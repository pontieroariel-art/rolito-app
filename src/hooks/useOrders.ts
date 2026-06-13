import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  subscribeClientOrders,
  subscribeAllOrders,
  subscribeDriverOrders,
} from '../services/orderService'
import { Order } from '../types'

export function useClientOrders(): { orders: Order[]; loading: boolean } {
  const { user }              = useAuth()
  const [orders, setOrders]   = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.uid) return
    const unsub = subscribeClientOrders(
      user.uid,
      (data) => { setOrders(data); setLoading(false) },
      ()     => setLoading(false),
    )
    return unsub
  }, [user?.uid])

  return { orders, loading }
}

export function useAllOrders(): { orders: Order[]; loading: boolean } {
  const [orders, setOrders]   = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = subscribeAllOrders(
      (data) => { setOrders(data); setLoading(false) },
      ()     => setLoading(false),
    )
    return unsub
  }, [])

  return { orders, loading }
}

// overrideEmail: undefined = usar email propio; null = no cargar (ayudante sin turno asignado)
export function useDriverOrders(overrideEmail?: string | null): { orders: Order[]; loading: boolean } {
  const { user }              = useAuth()
  const [orders, setOrders]   = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

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
      (data) => { setOrders(data); setLoading(false) },
      ()     => setLoading(false),
    )
    return unsub
  }, [email])

  return { orders, loading }
}
