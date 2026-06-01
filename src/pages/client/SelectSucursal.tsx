import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useBranch } from '../../context/BranchContext'
import { DeliveryAddress } from '../../types'

export default function SelectSucursal() {
  const { user }               = useAuth()
  const { setSelectedAddress } = useBranch()
  const navigate               = useNavigate()

  const addresses: DeliveryAddress[] = user?.addresses ?? []
  const nombre = (user?.nombreContacto || user?.nombre)?.split(' ')[0] ?? ''

  const handleSelect = (addr: DeliveryAddress) => {
    setSelectedAddress(addr)
    navigate('/dashboard', { replace: true })
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4 py-10">

      {/* Logo */}
      <div className="mb-8 flex flex-col items-center gap-3">
        <div className="bg-white rounded-2xl p-2 shadow-lg border border-gray-100">
          <img src="/isotipo-rolito.png" alt="Rolito" className="w-14 h-14 object-contain" />
        </div>
        <div className="text-center">
          <p className="text-gray-900 font-semibold text-lg">
            Hola{nombre ? `, ${nombre}` : ''} 👋
          </p>
          <p className="text-gray-500 text-sm mt-1">¿Desde qué sucursal vas a pedir?</p>
        </div>
      </div>

      {/* Lista de sucursales */}
      <div className="w-full max-w-sm space-y-3">
        {addresses.map((addr) => (
          <button
            key={addr.id}
            onClick={() => handleSelect(addr)}
            className="w-full text-left bg-white border border-gray-200 hover:border-accent/60 rounded-2xl px-5 py-4 transition-colors group shadow-sm"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-gray-900 group-hover:text-accent transition-colors">
                  {addr.nombre}
                </p>
                <p className="text-xs text-gray-500 mt-0.5 truncate">{addr.address}</p>
                {addr.horarioApertura && addr.horarioCierre && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {addr.horarioApertura} – {addr.horarioCierre}
                  </p>
                )}
              </div>
              <span className="text-gray-400 text-xl group-hover:text-accent group-hover:translate-x-1 transition-all shrink-0">
                →
              </span>
            </div>
          </button>
        ))}
      </div>

      {addresses.length === 0 && (
        <div className="w-full max-w-sm text-center mt-4">
          <p className="text-gray-500 text-sm">No tenés sucursales registradas.</p>
          <p className="text-gray-400 text-xs mt-1">Pedile al administrador que agregue tu dirección.</p>
        </div>
      )}
    </div>
  )
}
