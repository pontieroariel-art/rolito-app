import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Ban, Printer } from 'lucide-react'
import Navbar from '@/components/layout/Navbar'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import Badge from '@/components/common/Badge'
import { useAuth } from '@/context/AuthContext'
import { anularPallet, getPalletProduccion } from '@/services/produccionService'
import { reportError } from '@/services/observability'
import { PLANTA_INFO } from '@/utils/constants'
import { tieneAlgunRol } from '@/utils/roles'
import { PalletProduccion } from '@/types'

// Vista de consulta para gerencia/logística — NO es el destino del QR/barcode
// del ticket (esos llevan el código en texto plano, pedido explícito del
// cliente). Sirve para buscar un pallet a mano desde /produccion/listado.
//
// Desde el 2026-09-25 el encargado anula acá un pallet cargado por error:
// queda con motivo y firma, y deja de contar en todos los totales.
export default function FichaPalletPage() {
  const { palletId } = useParams<{ palletId: string }>()
  const { user } = useAuth()
  const [pallet, setPallet] = useState<PalletProduccion | null | undefined>(undefined)
  const [anulando, setAnulando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const puedeAnular = tieneAlgunRol(user, ['produccion_encargado', 'super_admin'])

  useEffect(() => {
    if (!palletId) return
    getPalletProduccion(palletId).then(setPallet).catch((err) => {
      reportError(err, { origen: 'FichaPalletPage', accion: 'cargar pallet', palletId })
      setPallet(null)
    })
  }, [palletId])

  if (pallet === undefined) return <LoadingSpinner fullScreen />

  const confirmarAnulacion = async () => {
    if (!pallet || !user) return
    setGuardando(true)
    setError(null)
    try {
      await anularPallet(pallet.id, motivo, { uid: user.uid, nombre: user.nombre ?? '' })
      setPallet(await getPalletProduccion(pallet.id))
      setAnulando(false)
    } catch (err) {
      reportError(err, { origen: 'FichaPalletPage', accion: 'anular pallet', palletId: pallet.id })
      setError('No se pudo anular el pallet. Probá de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  const motivoValido = motivo.trim().length >= 3

  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2] text-gray-900">
      <Navbar />
      <main className="max-w-md mx-auto p-4 pb-10">
        {pallet === null ? (
          <p className="text-sm text-secundario">No se encontró el pallet.</p>
        ) : (
          <div className="bg-white border border-[#D3D1C7] rounded-xl p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-secundario">Código</p>
                <p className={`text-lg font-bold ${pallet.anulacion ? 'text-secundario line-through' : 'text-gray-900'}`}>{pallet.codigo}</p>
              </div>
              {pallet.anulacion && <Badge tono="cancelado">Anulado</Badge>}
            </div>

            {pallet.anulacion && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
                <p className="font-medium text-red-800">No cuenta en la producción.</p>
                <p className="text-gray-900">Motivo: {pallet.anulacion.motivo}</p>
                <p className="text-secundario text-xs mt-1">
                  Anuló {pallet.anulacion.por.nombre}
                  {pallet.anulacion.en ? ` el ${pallet.anulacion.en.toDate().toLocaleString('es-AR')}` : ''}
                </p>
              </div>
            )}

            <div>
              <p className="text-xs text-secundario">Producto</p>
              <p className="text-sm text-gray-900">{pallet.productoNombre} — {pallet.unidades} unidades</p>
            </div>
            <div>
              <p className="text-xs text-secundario">Planta</p>
              <p className="text-sm text-gray-900">{PLANTA_INFO[pallet.plantaId].localidad}</p>
            </div>
            <div>
              <p className="text-xs text-secundario">Operario</p>
              <p className="text-sm text-gray-900">{pallet.operador.nombre}</p>
            </div>
            <div>
              <p className="text-xs text-secundario">Fabricación</p>
              <p className="text-sm text-gray-900">
                {pallet.fechaFabricacion.toDate().toLocaleString('es-AR')}
              </p>
            </div>

            {!pallet.anulacion && (
              /* /produccion/ticket abre la etiqueta y dispara la impresión
                 sola — target _blank para no perder la ficha al volver. */
              <Link
                to={`/produccion/ticket/${pallet.id}`}
                target="_blank"
                className="flex items-center justify-center gap-2 w-full h-11 border border-[#D3D1C7] hover:border-accent text-sm text-gray-700 hover:text-accent rounded-lg px-4 transition-colors"
              >
                <Printer size={16} />
                Reimprimir etiqueta
              </Link>
            )}

            {puedeAnular && !pallet.anulacion && !anulando && (
              <button
                type="button"
                onClick={() => setAnulando(true)}
                className="flex items-center justify-center gap-2 w-full h-11 border border-red-200 text-sm text-red-700 hover:bg-red-50 rounded-lg px-4 transition-colors"
              >
                <Ban size={16} />
                Anular pallet
              </button>
            )}

            {anulando && (
              <div className="border-t border-[#E7E5DC] pt-3 space-y-2">
                <label htmlFor="motivo-anulacion" className="block text-sm font-medium text-gray-900">
                  ¿Por qué se anula?
                </label>
                <textarea
                  id="motivo-anulacion"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  maxLength={200}
                  rows={2}
                  placeholder="Ej.: se cargó hielo picado y era escama"
                  className="w-full border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm"
                />
                <p className="text-xs text-secundario">
                  El pallet no se borra: queda anulado con tu nombre y deja de contar. Sacale la etiqueta.
                </p>
                {error && <p className="text-sm text-red-700">{error}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setAnulando(false); setMotivo(''); setError(null) }}
                    disabled={guardando}
                    className="flex-1 h-11 border border-[#D3D1C7] rounded-lg text-sm text-gray-700"
                  >
                    Volver
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirmarAnulacion()}
                    disabled={!motivoValido || guardando}
                    className="flex-1 h-11 rounded-lg text-sm font-medium text-white bg-red-600 disabled:bg-red-300"
                  >
                    {guardando ? 'Anulando…' : 'Confirmar anulación'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
