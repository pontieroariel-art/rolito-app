import { useCallback, useEffect, useState } from 'react'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { inicializarContador, getProximoNumero } from '../../services/produccionCounterService'
import { PLANTAS, PlantaId } from '../../types'

// Configuración por planta (correlativo de pallets) — vivía incrustada
// arriba de la lista de operarios; es algo que se toca una vez cada tanto,
// no gestión diaria, por eso tiene su propio panel bajo "Configuración".
function ContadorPlanta({ plantaId }: { plantaId: PlantaId }) {
  const [proximo, setProximo] = useState<number | null | undefined>(undefined)
  const [primerNumero, setPrimerNumero] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const cargar = useCallback(() => getProximoNumero(plantaId).then(setProximo), [plantaId])
  useEffect(() => { cargar() }, [cargar])

  const handleInicializar = async () => {
    const n = parseInt(primerNumero, 10)
    if (!n || n < 1) { setError('Ingresá un número válido'); return }
    setSaving(true)
    setError('')
    try {
      await inicializarContador(plantaId, n)
      await cargar()
    } catch {
      setError('No se pudo inicializar. ¿Ya tiene un número asignado?')
    } finally {
      setSaving(false)
    }
  }

  if (proximo === undefined) return <LoadingSpinner />

  return (
    <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-2">
      <p className="font-bold text-sm text-gray-900">{PLANTAS[plantaId].label}</p>
      <p className="text-xs text-gray-400">Ingreso de operarios: /produccion-{plantaId}</p>
      {proximo !== null ? (
        <p className="text-sm text-gray-600">Próximo número de pallet: <span className="font-semibold">{proximo}</span></p>
      ) : (
        <>
          <p className="text-xs text-amber-600">Todavía no tiene número de arranque — no se pueden cargar pallets acá hasta inicializarlo.</p>
          <div className="flex gap-2">
            <Input
              value={primerNumero} onChange={(e) => setPrimerNumero(e.target.value.replace(/\D/g, ''))}
              placeholder="Número de arranque" inputMode="numeric" className="flex-1"
            />
            <Button size="sm" onClick={handleInicializar} loading={saving}>Inicializar</Button>
          </div>
          {error && <p className="text-red-500 text-xs">{error}</p>}
        </>
      )}
    </div>
  )
}

export default function PlantasProduccionPage() {
  return (
    <main className="max-w-2xl mx-auto p-4 space-y-6 pb-10">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Plantas</h1>
        <p className="text-gray-500 text-sm">Correlativo de pallets por planta</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {Object.keys(PLANTAS).map((id) => <ContadorPlanta key={id} plantaId={id as PlantaId} />)}
      </div>
    </main>
  )
}
