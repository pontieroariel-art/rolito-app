import { useEffect, useState } from 'react'
import { getUserDocument } from '@/services/userService'
import { reportError } from '@/services/observability'
import type { UserProfile } from '@/types'

// Perfil de UN cliente para la ficha del supervisor (lectura puntual, sin
// stream: la ficha se abre, se mira y se cierra). Solo acepta clientes: las
// reglas ya cortan a los demás roles, y acá se refleja como "no encontrado".
export function useClienteSupervisor(uid: string | undefined) {
  const [cliente, setCliente] = useState<UserProfile | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let vivo = true
    setCliente(null)
    setError('')
    setCargando(!!uid)
    if (!uid) return
    getUserDocument(uid)
      .then((u) => {
        if (!vivo) return
        if (!u || u.rol !== 'cliente') { setError('Cliente no encontrado.'); return }
        setCliente(u)
      })
      .catch((err) => {
        if (!vivo) return
        reportError(err, { origen: 'useClienteSupervisor', uid })
        setError('No se pudo cargar la ficha. Revisá la señal y probá de nuevo.')
      })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [uid])

  return { cliente, cargando, error }
}
