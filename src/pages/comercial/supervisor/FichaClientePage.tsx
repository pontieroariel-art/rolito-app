import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import SupervisorHeader from '@/components/supervisor/SupervisorHeader'
import AccionesFicha, { EstadoDeuda } from '@/components/supervisor/ficha/AccionesFicha'
import SeccionContacto from '@/components/supervisor/ficha/SeccionContacto'
import SeccionDatos from '@/components/supervisor/ficha/SeccionDatos'
import SeccionDomicilios from '@/components/supervisor/ficha/SeccionDomicilios'
import SeccionHeladeras from '@/components/supervisor/ficha/SeccionHeladeras'
import SeccionHistorial from '@/components/supervisor/ficha/SeccionHistorial'
import SeccionPedido from '@/components/supervisor/ficha/SeccionPedido'
import SeccionSaldo from '@/components/supervisor/ficha/SeccionSaldo'
import { useAuth } from '@/context/AuthContext'
import { useClienteSupervisor } from '@/hooks/useClienteSupervisor'
import { useSaldoClienteEnVivo } from '@/hooks/useSaldoClienteEnVivo'
import { codigosTangoResumen } from '@/pages/admin/user-management/listaTango'

// Ficha completa de un cliente para el supervisor en la calle: datos, contacto,
// domicilios, heladeras, pedido a logística, historial y el saldo de Tango con
// su composición para compartir. Las acciones —cobrar, llamar, WhatsApp, cómo
// llegar— viven en la barra fija de abajo (AccionesFicha).
//
// El saldo se pide UNA sola vez acá y se reparte: useSaldoClienteEnVivo dispara
// una consulta on-demand a Tango por cada montaje, así que llamarlo también en
// SeccionSaldo duplicaría las consultas de la cola.
export default function FichaClientePage() {
  const { uid } = useParams<{ uid: string }>()
  const { user } = useAuth()
  const { cliente, cargando, error } = useClienteSupervisor(uid)
  const actor = useMemo(() => (user ? { uid: user.uid, nombre: user.nombre } : null), [user])
  const saldoEnVivo = useSaldoClienteEnVivo(cliente, actor)

  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2]">
      {/* Volver A LA LISTA, no al inicio: el recorrido real es lista → ficha →
          volver → otro cliente, diez veces por mañana. */}
      <SupervisorHeader title={cliente?.razonSocial ?? 'Ficha del cliente'} back volverA="/supervisor/clientes" />
      <main className="max-w-md mx-auto p-4 space-y-3 pb-40">
        {cargando && <p className="text-sm text-secundario text-center pt-8">Cargando ficha…</p>}
        {!cargando && error && (
          <div className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-4 text-center">
            <p className="text-sm text-gray-600">{error}</p>
          </div>
        )}
        {cliente && (
          <>
            <div className="px-1">
              <h1 className="text-lg font-bold text-gray-900 leading-tight">{cliente.razonSocial}</h1>
              <p className="text-xs text-secundario">
                {codigosTangoResumen(cliente) || 'Sin código de Tango'}
                {cliente.estado !== 'activo' && <span className="text-amber-600"> · {cliente.estado}</span>}
              </p>
            </div>
            <EstadoDeuda saldoEnVivo={saldoEnVivo} />
            <SeccionSaldo c={cliente} saldoEnVivo={saldoEnVivo} />
            <SeccionContacto c={cliente} />
            <SeccionDomicilios c={cliente} />
            <SeccionHeladeras c={cliente} />
            <SeccionPedido c={cliente} />
            <SeccionHistorial c={cliente} />
            <SeccionDatos c={cliente} />
            <AccionesFicha c={cliente} saldoEnVivo={saldoEnVivo} supervisor={user} />
          </>
        )}
      </main>
    </div>
  )
}
