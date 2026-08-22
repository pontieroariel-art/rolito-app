import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { getPalletProduccion } from '../../services/produccionService'
import { PLANTA_INFO } from '../../utils/constants'
import { PalletProduccion } from '../../types'

// Vista de consulta para gerencia/logística — NO es el destino del QR/barcode
// del ticket (esos llevan el código en texto plano, pedido explícito del
// cliente). Sirve para buscar un pallet a mano desde /produccion/listado.
export default function FichaPalletPage() {
  const { palletId } = useParams<{ palletId: string }>()
  const [pallet, setPallet] = useState<PalletProduccion | null | undefined>(undefined)

  useEffect(() => {
    if (!palletId) return
    getPalletProduccion(palletId).then(setPallet)
  }, [palletId])

  if (pallet === undefined) return <LoadingSpinner fullScreen />

  return (
    <div className="min-h-screen bg-[#F8F7F2] text-gray-900">
      <Navbar />
      <main className="max-w-md mx-auto p-4 pb-10">
        {pallet === null ? (
          <p className="text-sm text-gray-500">No se encontró el pallet.</p>
        ) : (
          <div className="bg-white border border-[#D3D1C7] rounded-xl p-5 space-y-3">
            <div>
              <p className="text-xs text-gray-400">Código</p>
              <p className="text-lg font-bold text-gray-900">{pallet.codigo}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Producto</p>
              <p className="text-sm text-gray-900">{pallet.productoNombre} — {pallet.unidades} unidades</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Planta</p>
              <p className="text-sm text-gray-900">{PLANTA_INFO[pallet.plantaId].localidad}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Operario</p>
              <p className="text-sm text-gray-900">{pallet.operador.nombre}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Fabricación</p>
              <p className="text-sm text-gray-900">
                {pallet.fechaFabricacion.toDate().toLocaleString('es-AR')}
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
