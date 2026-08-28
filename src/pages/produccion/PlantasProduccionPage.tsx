import { useCallback, useEffect, useState } from 'react'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { inicializarContador, getProximoNumero, BATCH_SIZE } from '../../services/produccionCounterService'
import { getUltimoPallet } from '../../services/produccionService'
import { PalletProduccion, PLANTAS, PlantaId } from '../../types'

// Configuración por planta (correlativo de pallets) — vivía incrustada
// arriba de la lista de operarios; es algo que se toca una vez cada tanto,
// no gestión diaria, por eso tiene su propio panel bajo "Configuración".
function ContadorPlanta({ plantaId }: { plantaId: PlantaId }) {
  const [proximo, setProximo] = useState<number | null | undefined>(undefined)
  const [ultimo,  setUltimo]  = useState<PalletProduccion | null>(null)
  const [primerNumero, setPrimerNumero] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const cargar = useCallback(() => Promise.all([
    getProximoNumero(plantaId).then(setProximo),
    getUltimoPallet(plantaId).then(setUltimo),
  ]), [plantaId])
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
        <>
          <p className="text-sm text-gray-600">
            Último pallet cargado:{' '}
            <span className="font-semibold">{ultimo ? `${ultimo.codigo} (N° ${ultimo.numero})` : 'ninguno todavía'}</span>
          </p>
          <p className="text-sm text-gray-600">
            Números entregados a tablets: <span className="font-semibold">hasta el {proximo - 1}</span>
          </p>
          <p className="text-xs text-gray-400">
            Las tablets reservan números en lotes de {BATCH_SIZE} para poder cargar sin wifi — el próximo
            lote arranca en el {proximo}. Es normal que este número vaya adelantado al último pallet real.
          </p>
        </>
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
