import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  subscribeClientOrders,
  subscribeAllOrders,
  subscribeDriverOrders,
} from '../services/orderService'

export function useClientOrders() {
  const { user }              = useAuth()
  const [orders, setOrders]   = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.uid) return
    const unsub = subscribeClientOrders(user.uid, (data) => {
      setOrders(data)
      setLoading(false)
    })
    return unsub
  }, [user?.uid])

  return { orders, loading }
}

export function useAllOrders() {
  const [orders, setOrders]   = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = subscribeAllOrders((data) => {
      setOrders(data)
      setLoading(false)
    })
    return unsub
  }, [])

  return { orders, loading }
}

export function useDriverOrders() {
  const { user }              = useAuth()
  const [orders, setOrders]   = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.email) return
    // driverId almacena el email del chofer, no el uid
    const unsub = subscribeDriverOrders(user.email, (data) => {
      setOrders(data)
      setLoading(false)
    })
    return unsub
  }, [user?.email])

  return { orders, loading }
}
