import { useMemo, useState } from 'react'
import Button from '../../components/ui/Button'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import ClienteCombobox from '@/components/common/ClienteCombobox'
import AsignarEquipoModal from '../../components/heladeras/AsignarEquipoModal'
import RetirarEquipoModal from '../../components/heladeras/RetirarEquipoModal'
import { useAuth } from '../../context/AuthContext'
import { getUserDocument } from '../../services/userService'
import { useHeladeras } from '../../hooks/useHeladeras'
import { usePasosTaller } from '../../hooks/usePasosTaller'
import { puedeGestionarHeladeras } from '../../utils/heladeraLabels'
import { Heladera, UserProfile } from '../../types'

export default function AsignacionEquiposPage() {
  const { user } = useAuth()
  const { heladeras, loading: loadingHeladeras } = useHeladeras()
  const { pasos: catalogoPasos } = usePasosTaller()

  const [cliente,    setCliente]    = useState<UserProfile | null>(null)
  const [asignarAbierto, setAsignarAbierto] = useState(false)
  const [retirarObjetivo, setRetirarObjetivo] = useState<Heladera | null>(null)

  const puedeGestionar = puedeGestionarHeladeras(user?.rol)

  const heladerasDelCliente = useMemo(
    () => (cliente ? heladeras.filter((h) => h.clienteAsignadoId === cliente.uid) : []),
    [heladeras, cliente],
  )
  const heladerasDisponibles = useMemo(() => heladeras.filter((h) => h.estado === 'disponible'), [heladeras])

  if (loadingHeladeras) return <LoadingSpinner fullScreen />

  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2] text-gray-900">
      <main className="max-w-2xl mx-auto p-4 space-y-6 pb-10">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Asignación de equipos</h1>
          <p className="text-gray-500 text-sm">Buscá un cliente para ver o gestionar sus heladeras</p>
        </div>

        {!cliente ? (
          <ClienteCombobox
            modo="busqueda"
            autoFocus
            value=""
            placeholder="Buscar por razón social, contacto, CUIT o código de cliente…"
            onChange={async (uid) => { const ficha = await getUserDocument(uid); if (ficha) setCliente(ficha) }}
          />
        ) : (
          <div className="space-y-4">
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 flex justify-between items-center">
              <div>
                <p className="text-sm font-semibold text-gray-900">{cliente.razonSocial}</p>
                <p className="text-xs text-gray-500">
                  {cliente.codigoCliente ? `Código ${cliente.codigoCliente} · ` : ''}CUIT {cliente.cuit}
                </p>
              </div>
              <button onClick={() => setCliente(null)} className="text-xs text-gray-500 hover:text-accent">
                Buscar otro
              </button>
            </div>

            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Heladeras asignadas</h2>
              {puedeGestionar && (
                <Button onClick={() => setAsignarAbierto(true)} className="text-sm">+ Asignar heladera</Button>
              )}
            </div>

            {heladerasDelCliente.length === 0 ? (
              <p className="text-gray-400 text-sm">Este cliente no tiene heladeras asignadas.</p>
            ) : (
              <div className="space-y-2">
                {heladerasDelCliente.map((h) => (
                  <div key={h.id} className="bg-white border border-[#D3D1C7] rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-bold text-sm text-gray-900">{h.codigoInterno}</p>
                      <p className="text-gray-500 text-xs">{h.modelo} · serie {h.numeroSerie}</p>
                      {h.clienteAsignadoDireccion && (
                        <p className="text-accent text-xs">{h.clienteAsignadoDireccion}</p>
                      )}
                    </div>
                    {puedeGestionar && (
                      <Button variant="outline" className="text-sm" onClick={() => setRetirarObjetivo(h)}>Retirar</Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {asignarAbierto && cliente && user && (
        <AsignarEquipoModal
          clienteFijo={cliente}
          heladerasDisponibles={heladerasDisponibles}
          actor={{ uid: user.uid, nombre: user.nombre }}
          onClose={() => setAsignarAbierto(false)}
        />
      )}
      {retirarObjetivo && user && (
        <RetirarEquipoModal
          heladera={retirarObjetivo}
          actor={{ uid: user.uid, nombre: user.nombre }}
          catalogo={catalogoPasos}
          onClose={() => setRetirarObjetivo(null)}
        />
      )}
    </div>
  )
}
