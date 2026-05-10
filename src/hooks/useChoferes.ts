import { useEffect, useState } from 'react'
import {
  getChoferes,
  addChofer,
  removeChofer as removeChoferSvc,
} from '../services/configService'

export function useChoferes() {
  const [choferes, setChoferes] = useState<string[]>([])
  const [loading,  setLoading]  = useState(true)

  const load = async () => {
    const data = await getChoferes()
    setChoferes(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const addNewChofer = async (email: string): Promise<void> => {
    if (!email?.trim()) return
    await addChofer(email.trim().toLowerCase())
    await load()
  }

  const removeChofer = async (email: string): Promise<void> => {
    await removeChoferSvc(email)
    await load()
  }

  return { choferes, loading, addNewChofer, removeChofer }
}
