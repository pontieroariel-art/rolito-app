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

export function useDriverOrders(): { orders: Order[]; loading: boolean } {
  const { user }              = useAuth()
  const [orders, setOrders]   = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.email) return
    const unsub = subscribeDriverOrders(
      user.email,
      (data) => { setOrders(data); setLoading(false) },
      ()     => setLoading(false),
    )
    return unsub
  }, [user?.email])

  return { orders, loading }
}
