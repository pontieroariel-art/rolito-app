import { tieneRol } from '@/utils/roles'
import { useRemitosChoferHoy } from '@/hooks/useSuscripcionesChofer'
import { useAuth } from '../context/AuthContext'

// Remitos de carga de HOY del chofer logueado — su "carga del día" real (lo
// que caja despachó a su camión) y, de paso, la fuente del camión asignado.
export function useRemitosCargaChofer() {
  const { user } = useAuth()
  // Suscripción compartida entre pantallas (R6).
  const { data: remitos } = useRemitosChoferHoy(user?.uid, !!user && tieneRol(user, 'chofer'))
  return { remitos }
}
