import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GoogleMap, Marker } from '@react-google-maps/api'
import { Search } from 'lucide-react'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useAuth } from '../../context/AuthContext'
import { useGoogleMapsLoader } from '../../hooks/useGoogleMapsLoader'
import { useClientesActivos } from '../../hooks/useClientesActivos'
import { subscribePreventivosDelAnio, marcarPreventivoHecho, desmarcarPreventivo } from '../../services/preventivoService'
import { makePin } from '../../utils/mapPins'
import { haversineKm, LatLng } from '../../utils/routeMath'
import { UserProfile, Preventivo, getPrimaryAddress } from '../../types'

const DEFAULT_CENTER: LatLng = { lat: -34.6037, lng: -58.3816 }
const YEAR = new Date().getFullYear()

function clientCoords(u: UserProfile): LatLng | null {
  const addr = getPrimaryAddress(u)
  if (addr?.lat && addr?.lng) return { lat: addr.lat, lng: addr.lng }
  if (u.lat && u.lng) return { lat: u.lat, lng: u.lng }
  return null
}

interface ClientePin {
  user: UserProfile
  pos:  LatLng
}

export default function MapaClientesHeladerasPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { isLoaded } = useGoogleMapsLoader()
  const { clientes, loading: loadingClientes } = useClientesActivos()

  const [preventivos, setPreventivos] = useState<Preventivo[]>([])
  const [loadingPrev, setLoadingPrev] = useState(true)
  useEffect(() => subscribePreventivosDelAnio(YEAR, (p) => { setPreventivos(p); setLoadingPrev(false) }), [])

  const hechoSet = useMemo(() => new Set(preventivos.filter((p) => p.hecho).map((p) => p.clientId)), [preventivos])

  const [busquedaCentro, setBusquedaCentro] = useState('')
  const [centro, setCentro] = useState<UserProfile | null>(null)
  const [radioKm, setRadioKm] = useState(10)
  const [seleccionado, setSeleccionado] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const puedeGestionar = user && ['heladeras_encargado', 'super_admin', 'gerente_comercial'].includes(user.rol)

  const conCoords: ClientePin[] = useMemo(
    () => clientes.map((u) => { const pos = clientCoords(u); return pos ? { user: u, pos } : null }).filter((x): x is ClientePin => !!x),
    [clientes],
  )

  const centroPos = centro ? clientCoords(centro) : null

  const visibles = useMemo(() => {
    if (!centro || !centroPos) return conCoords
    return conCoords.filter((c) => c.user.uid === centro.uid || haversineKm(centroPos, c.pos) <= radioKm)
  }, [conCoords, centro, centroPos, radioKm])

  const resultadosBusqueda = useMemo(() => {
    const q = busquedaCentro.trim().toLowerCase()
    if (!q || centro) return []
    return clientes
      .filter((c) => c.razonSocial?.toLowerCase().includes(q) || c.nombreContacto?.toLowerCase().includes(q) || c.cuit?.includes(q))
      .slice(0, 8)
  }, [clientes, busquedaCentro, centro])

  const mapRef = useRef<google.maps.Map | null>(null)
  const pinCache = useRef<Map<string, google.maps.Icon>>(new Map())
  const getPin = useCallback((hecho: boolean, selected: boolean) => {
    const fill = hecho ? '#10B981' : '#EF4444'
    const key  = `${fill}|${selected}`
    if (!pinCache.current.has(key)) pinCache.current.set(key, makePin(fill, selected ? '#111827' : '#ffffff', '', selected ? 46 : 32))
    return pinCache.current.get(key)!
  }, [])

  useEffect(() => {
    if (!isLoaded || !mapRef.current || visibles.length === 0) return
    const bounds = new google.maps.LatLngBounds()
    visibles.forEach((c) => bounds.extend(c.pos))
    mapRef.current.fitBounds(bounds, 60)
  }, [isLoaded, visibles])

  const clienteSel = seleccionado ? conCoords.find((c) => c.user.uid === seleccionado)?.user : null

  const toggleHecho = async () => {
    if (!clienteSel || !user) return
    setSaving(true)
    try {
      if (hechoSet.has(clienteSel.uid)) await desmarcarPreventivo(clienteSel.uid, YEAR)
      else await marcarPreventivoHecho(clienteSel.uid, YEAR, { uid: user.uid, nombre: user.nombre })
    } finally {
      setSaving(false)
    }
  }

  if (loadingClientes || loadingPrev || !isLoaded) return <LoadingSpinner fullScreen />

  return (
    <div className="min-h-screen bg-[#F8F7F2] text-gray-900">
      <div className="flex flex-col h-[calc(100vh-48px)] md:h-screen">
        <div className="p-3 border-b border-[#D3D1C7] bg-white flex flex-wrap items-center gap-2">
          <h1 className="text-base font-bold text-gray-900 mr-2">Mapa de clientes</h1>
          {!centro ? (
            <div className="relative flex-1 min-w-[220px] max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={busquedaCentro}
                onChange={(e) => setBusquedaCentro(e.target.value)}
                placeholder="Centrar en un cliente…"
                className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg pl-8 pr-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
              />
              {resultadosBusqueda.length > 0 && (
                <div className="absolute z-30 top-full left-0 right-0 bg-white border border-[#D3D1C7] rounded-lg mt-1 divide-y divide-gray-100 shadow-lg">
                  {resultadosBusqueda.map((c) => (
                    <button key={c.uid} onClick={() => { setCentro(c); setBusquedaCentro('') }} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm">
                      {c.razonSocial}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-1.5">
              <span className="text-sm text-gray-900">{centro.razonSocial}</span>
              <input
                type="number" min={1} value={radioKm}
                onChange={(e) => setRadioKm(Number(e.target.value) || 1)}
                className="w-14 bg-white border border-[#D3D1C7] rounded px-1.5 py-0.5 text-xs text-right"
              />
              <span className="text-xs text-gray-500">km</span>
              <button onClick={() => setCentro(null)} className="text-xs text-gray-500 hover:text-accent ml-1">Ver todos</button>
            </div>
          )}
          <div className="flex items-center gap-3 ml-auto text-xs text-gray-500">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500" /> Preventivo {YEAR} hecho</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Pendiente</span>
            <span>{visibles.length} clientes</span>
          </div>
        </div>

        <div className="flex-1 relative">
          {seleccionado && clienteSel && (
            <div className="absolute top-3 right-3 z-20 w-72 bg-white rounded-2xl shadow-xl border border-[#D3D1C7] p-4 space-y-3">
              <div className="flex justify-between items-start">
                <p className="font-bold text-sm text-gray-900">{clienteSel.razonSocial}</p>
                <button onClick={() => setSeleccionado(null)} className="text-gray-400 hover:text-gray-700">✕</button>
              </div>
              {clienteSel.cuit && <p className="text-xs text-gray-500">CUIT {clienteSel.cuit}</p>}
              {getPrimaryAddress(clienteSel)?.address && <p className="text-xs text-gray-500">{getPrimaryAddress(clienteSel)?.address}</p>}
              <span className={`inline-block text-xs px-2 py-1 rounded-full border font-medium ${
                hechoSet.has(clienteSel.uid) ? 'bg-green-100 text-green-700 border-green-200' : 'bg-red-100 text-red-700 border-red-200'
              }`}>
                Preventivo {YEAR}: {hechoSet.has(clienteSel.uid) ? 'hecho' : 'pendiente'}
              </span>
              {puedeGestionar && (
                <div className="flex flex-col gap-1.5 pt-1">
                  <button
                    onClick={toggleHecho}
                    disabled={saving}
                    className="text-xs py-2 rounded-lg border border-[#D3D1C7] hover:border-accent transition-colors disabled:opacity-50"
                  >
                    {hechoSet.has(clienteSel.uid) ? 'Desmarcar preventivo' : 'Marcar preventivo hecho'}
                  </button>
                  <button
                    onClick={() => navigate(`/heladeras/toma-service?clientId=${clienteSel.uid}`)}
                    className="text-xs py-2 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition-colors"
                  >
                    Abrir ticket de servicio
                  </button>
                </div>
              )}
            </div>
          )}

          <GoogleMap
            mapContainerStyle={{ width: '100%', height: '100%' }}
            center={centroPos ?? DEFAULT_CENTER}
            zoom={11}
            options={{ disableDefaultUI: false, zoomControl: true, gestureHandling: 'greedy', fullscreenControl: false }}
            onLoad={(m) => { mapRef.current = m }}
            onClick={() => setSeleccionado(null)}
          >
            {visibles.map((c) => (
              <Marker
                key={c.user.uid}
                position={c.pos}
                icon={getPin(hechoSet.has(c.user.uid), seleccionado === c.user.uid)}
                zIndex={seleccionado === c.user.uid ? 100 : 1}
                onClick={() => setSeleccionado(c.user.uid)}
              />
            ))}
          </GoogleMap>
        </div>
      </div>
    </div>
  )
}
