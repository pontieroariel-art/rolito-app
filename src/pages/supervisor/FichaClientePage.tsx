import { useParams } from 'react-router-dom'
import SupervisorHeader from '@/components/supervisor/SupervisorHeader'
import SeccionContacto from '@/components/supervisor/ficha/SeccionContacto'
import SeccionDatos from '@/components/supervisor/ficha/SeccionDatos'
import SeccionDomicilios from '@/components/supervisor/ficha/SeccionDomicilios'
import SeccionSaldo from '@/components/supervisor/ficha/SeccionSaldo'
import { useClienteSupervisor } from '@/hooks/useClienteSupervisor'
import { codigosTangoResumen } from '@/pages/admin/user-management/listaTango'

// Ficha completa de un cliente para el supervisor en la calle: datos, contacto
// (llamar / WhatsApp), domicilios con "Ir" a Google Maps y saldo de Tango con
// Cobrar y Composición de saldos. Solo lectura; las heladeras, el historial y
// el pedido a logística se agregan en las próximas entregas.
export default function FichaClientePage() {
  const { uid } = useParams<{ uid: string }>()
  const { cliente, cargando, error } = useClienteSupervisor(uid)

  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2]">
      <SupervisorHeader title={cliente?.razonSocial ?? 'Ficha del cliente'} back />
      <main className="max-w-md mx-auto p-4 space-y-3 pb-10">
        {cargando && <p className="text-sm text-gray-500 text-center pt-8">Cargando ficha…</p>}
        {!cargando && error && (
          <div className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-4 text-center">
            <p className="text-sm text-gray-600">{error}</p>
          </div>
        )}
        {cliente && (
          <>
            <div className="px-1">
              <h1 className="text-lg font-bold text-gray-900 leading-tight">{cliente.razonSocial}</h1>
              <p className="text-xs text-gray-500">
                {codigosTangoResumen(cliente) || 'Sin código de Tango'}
                {cliente.estado !== 'activo' && <span className="text-amber-600"> · {cliente.estado}</span>}
              </p>
            </div>
            <SeccionSaldo c={cliente} />
            <SeccionContacto c={cliente} />
            <SeccionDomicilios c={cliente} />
            <SeccionDatos c={cliente} />
          </>
        )}
      </main>
    </div>
  )
}
