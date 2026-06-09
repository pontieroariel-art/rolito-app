import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { GoogleMap, Marker, InfoWindow } from '@react-google-maps/api'
import { ArrowLeft, Search, MapPin, Users, AlertCircle, CheckCircle, Loader2, X } from 'lucide-react'
import Navbar from '../../components/layout/Navbar'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useGoogleMapsLoader } from '../../hooks/useGoogleMapsLoader'
import { getAllUsers } from '../../services/userService'
import { updateUserDocument } from '../../services/userService'
import { UserProfile } from '../../types'

// ── Colores por sector ────────────────────────────────────────────────────────

const SECTOR_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#06B6D4', '#F97316', '#84CC16', '#EC4899', '#14B8A6',
  '#6366F1', '#D946EF', '#FB923C', '#34D399', '#A78BFA',
]

const SECTOR_SIN = '#9CA3AF'

const sectorColorMap = new Map<string, string>()

function getSectorColor(sector: string | undefined): string {
  if (!sector) return SECTOR_SIN
  if (!sectorColorMap.has(sector)) {
    sectorColorMap.set(sector, SECTOR_COLORS[sectorColorMap.size % SECTOR_COLORS.length])
  }
  return sectorColorMap.get(sector)!
}

// ── Map styles ────────────────────────────────────────────────────────────────

const MAP_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#f5f3ee' }] },
  { featureType: 'water',    elementType: 'geometry', stylers: [{ color: '#c9e4f5' }] },
  { featureType: 'road',     elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#e8e4dc' }] },
  { featureType: 'poi',      stylers: [{ visibility: 'off' }] },
  { featureType: 'transit',  stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#555' }] },
]

// ── SVG pin ───────────────────────────────────────────────────────────────────

function makePin(color: string, size = 26) {
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size + 8}">` +
    `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 1}" fill="${color}" stroke="white" stroke-width="2.5"/>` +
    `<line x1="${size / 2}" y1="${size - 1}" x2="${size / 2}" y2="${size + 7}" stroke="${color}" stroke-width="2"/>` +
    `</svg>`,
  )
  return {
    url:        `data:image/svg+xml;charset=UTF-8,${svg}`,
    scaledSize: new google.maps.Size(size, size + 8),
    anchor:     new google.maps.Point(size / 2, size + 8),
  }
}

// ── Geocoding cache en memoria ────────────────────────────────────────────────

const geoCache = new Map<string, { lat: number; lng: number } | null>()

// ── Helpers ───────────────────────────────────────────────────────────────────

function primaryAddress(u: UserProfile): string {
  if (u.addresses?.length) {
    const p = u.addresses.find((a) => a.esPrincipal) ?? u.addresses[0]
    return p.address
  }
  return u.address ?? ''
}

function primaryCoords(u: UserProfile): { lat: number; lng: number } | null {
  // Coordenadas ya guardadas en el doc
  if (u.lat && u.lng) return { lat: u.lat, lng: u.lng }
  if (u.addresses?.length) {
    const p = u.addresses.find((a) => a.esPrincipal) ?? u.addresses[0]
    if (p.lat && p.lng) return { lat: p.lat, lng: p.lng }
  }
  return null
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

// ── InfoCard ──────────────────────────────────────────────────────────────────

function InfoCard({ user, onClose }: { user: UserProfile; onClose: () => void }) {
  const color  = getSectorColor(user.sector)
  const tel    = user.telefono || user.phone || ''
  const addr   = primaryAddress(user)
  const status = user.estado === 'activo' ? { label: 'Activo', cls: 'bg-emerald-100 text-emerald-700' }
               : user.estado === 'pendiente' ? { label: 'Pendiente', cls: 'bg-amber-100 text-amber-700' }
               : { label: 'Inactivo', cls: 'bg-gray-100 text-gray-500' }

  return (
    <div style={{ minWidth: 220, maxWidth: 260, fontFamily: 'sans-serif', fontSize: 13, lineHeight: 1.6, color: '#111' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <div style={{ fontWeight: 700, fontSize: 14, flex: 1, marginRight: 6 }}>{user.razonSocial || user.nombre}</div>
        <button onClick={onClose} style={{ cursor: 'pointer', background: 'none', border: 'none', fontSize: 16, color: '#999', lineHeight: 1, padding: 0 }}>✕</button>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        {user.sector && (
          <span style={{ background: color, color: 'white', fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 99 }}>
            {user.sector}
          </span>
        )}
        <span style={{ background: status.cls.includes('emerald') ? '#d1fae5' : status.cls.includes('amber') ? '#fef3c7' : '#f3f4f6',
                       color: status.cls.includes('emerald') ? '#065f46' : status.cls.includes('amber') ? '#92400e' : '#6b7280',
                       fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 99 }}>
          {status.label}
        </span>
      </div>
      {user.codigoCliente && (
        <div style={{ marginBottom: 3 }}>
          <span style={{ color: '#888', fontSize: 11 }}>Código: </span>
          <span style={{ fontWeight: 600 }}>{user.codigoCliente}</span>
        </div>
      )}
      {user.cuit && (
        <div style={{ marginBottom: 3 }}>
          <span style={{ color: '#888', fontSize: 11 }}>CUIT: </span>
          <span>{user.cuit}</span>
        </div>
      )}
      {tel && (
        <div style={{ marginBottom: 3 }}>
          <span style={{ color: '#888', fontSize: 11 }}>Tel: </span>
          <span>{tel}</span>
        </div>
      )}
      {addr && (
        <div style={{ marginBottom: 3, color: '#555' }}>
          <span style={{ color: '#888', fontSize: 11 }}>Dir: </span>
          {addr}
        </div>
      )}
      {user.notasContacto && (
        <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid #eee', color: '#666', fontSize: 11 }}>
          {user.notasContacto}
        </div>
      )}
    </div>
  )
}

// ── Componente mapa ───────────────────────────────────────────────────────────

interface GeoResult { uid: string; lat: number; lng: number }

function ClientesMap({
  clients, geoResults, selectedUid, onSelect,
}: {
  clients:     UserProfile[]
  geoResults:  Map<string, { lat: number; lng: number } | null>
  selectedUid: string | null
  onSelect:    (uid: string | null) => void
}) {
  const { isLoaded } = useGoogleMapsLoader()
  const mapRef = useRef<google.maps.Map | null>(null)

  const pinCache = useRef<Map<string, google.maps.Icon>>(new Map())

  const getPin = useCallback((sector: string | undefined) => {
    const color = getSectorColor(sector)
    if (!pinCache.current.has(color)) {
      pinCache.current.set(color, makePin(color))
    }
    return pinCache.current.get(color)!
  }, [])

  // Calcular bounds cuando hay resultados
  useEffect(() => {
    if (!mapRef.current || geoResults.size === 0) return
    const bounds = new google.maps.LatLngBounds()
    let count = 0
    geoResults.forEach((pt) => {
      if (pt) { bounds.extend(pt); count++ }
    })
    if (count >= 2) mapRef.current.fitBounds(bounds, 60)
    else if (count === 1) {
      geoResults.forEach((pt) => { if (pt) { mapRef.current!.panTo(pt); mapRef.current!.setZoom(14) } })
    }
  }, [geoResults.size]) // eslint-disable-line react-hooks/exhaustive-deps

  const markers = useMemo(() => {
    const list: { user: UserProfile; lat: number; lng: number }[] = []
    for (const u of clients) {
      const pt = geoResults.get(u.uid)
      if (pt) list.push({ user: u, lat: pt.lat, lng: pt.lng })
    }
    return list
  }, [clients, geoResults])

  const selectedUser = selectedUid ? clients.find((u) => u.uid === selectedUid) : null
  const selectedPt   = selectedUid ? geoResults.get(selectedUid) : null

  if (!isLoaded) return <div className="flex-1 bg-gray-100 animate-pulse" />

  return (
    <GoogleMap
      mapContainerStyle={{ width: '100%', height: '100%' }}
      center={{ lat: -34.6037, lng: -58.3816 }}
      zoom={11}
      options={{ disableDefaultUI: false, zoomControl: true, gestureHandling: 'greedy', styles: MAP_STYLES, fullscreenControl: false }}
      onLoad={(m) => { mapRef.current = m }}
      onClick={() => onSelect(null)}
    >
      {markers.map(({ user, lat, lng }) => (
        <Marker
          key={user.uid}
          position={{ lat, lng }}
          icon={getPin(user.sector)}
          zIndex={selectedUid === user.uid ? 100 : 1}
          onClick={() => onSelect(user.uid)}
        />
      ))}

      {selectedUser && selectedPt && (
        <InfoWindow
          position={selectedPt}
          onCloseClick={() => onSelect(null)}
          options={{ disableAutoPan: false, pixelOffset: new google.maps.Size(0, -30) }}
        >
          <InfoCard user={selectedUser} onClose={() => onSelect(null)} />
        </InfoWindow>
      )}
    </GoogleMap>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function ClientesMapPage() {
  const navigate = useNavigate()
  const [allClients, setAllClients]       = useState<UserProfile[]>([])
  const [loading, setLoading]             = useState(true)
  const [search, setSearch]               = useState('')
  const [sectorFilter, setSectorFilter]   = useState<string>('all')
  const [geoResults, setGeoResults]       = useState<Map<string, { lat: number; lng: number } | null>>(new Map())
  const [geocoding, setGeocoding]         = useState(false)
  const [geoProgress, setGeoProgress]     = useState({ done: 0, total: 0 })
  const [selectedUid, setSelectedUid]     = useState<string | null>(null)
  const geocodingRef = useRef(false)

  // Cargar clientes
  useEffect(() => {
    getAllUsers().then((all) => {
      const clientes = all.filter((u) => u.rol === 'cliente')
      setAllClients(clientes)
      // Pre-cargar coordenadas ya guardadas
      const initial = new Map<string, { lat: number; lng: number } | null>()
      for (const u of clientes) {
        const pt = primaryCoords(u)
        if (pt) { initial.set(u.uid, pt); geoCache.set(u.uid, pt) }
      }
      setGeoResults(new Map(initial))
      setLoading(false)
    })
  }, [])

  // Sectores únicos
  const sectors = useMemo(() => {
    const set = new Set<string>()
    allClients.filter((u) => u.sector).forEach((u) => set.add(u.sector!))
    // Inicializar colores en orden consistente
    Array.from(set).sort().forEach((s) => getSectorColor(s))
    return Array.from(set).sort()
  }, [allClients])

  // Clientes filtrados
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return allClients.filter((u) => {
      const matchSector = sectorFilter === 'all' || u.sector === sectorFilter
      const matchSearch = !q ||
        u.razonSocial?.toLowerCase().includes(q) ||
        u.nombre?.toLowerCase().includes(q) ||
        u.codigoCliente?.toLowerCase().includes(q)
      return matchSector && matchSearch
    })
  }, [allClients, search, sectorFilter])

  const withCoords    = filtered.filter((u) => geoResults.get(u.uid))
  const withoutCoords = filtered.filter((u) => !geoResults.get(u.uid))

  // Geocodificación en lote
  const runGeocoding = useCallback(async () => {
    if (geocodingRef.current) return
    const toGeocode = withoutCoords.filter((u) => {
      const addr = primaryAddress(u)
      return addr && !geoCache.has(u.uid)
    })
    if (toGeocode.length === 0) return

    geocodingRef.current = true
    setGeocoding(true)
    setGeoProgress({ done: 0, total: toGeocode.length })

    const geocoder = new google.maps.Geocoder()
    const BATCH = 6

    for (let i = 0; i < toGeocode.length; i += BATCH) {
      if (!geocodingRef.current) break
      const chunk = toGeocode.slice(i, i + BATCH)
      await Promise.all(
        chunk.map(
          (u) =>
            new Promise<void>((resolve) => {
              const addr = primaryAddress(u)
              geocoder.geocode(
                { address: `${addr}, Argentina`, componentRestrictions: { country: 'AR' } },
                async (results, status) => {
                  const pt =
                    status === 'OK' && results?.[0]
                      ? { lat: results[0].geometry.location.lat(), lng: results[0].geometry.location.lng() }
                      : null
                  geoCache.set(u.uid, pt)
                  if (pt) {
                    setGeoResults((prev) => new Map(prev).set(u.uid, pt))
                    // Guardar en Firestore para no repetir
                    updateUserDocument(u.uid, { lat: pt.lat, lng: pt.lng }).catch(() => {})
                  }
                  resolve()
                },
              )
            }),
        ),
      )
      setGeoProgress((prev) => ({ ...prev, done: Math.min(i + BATCH, toGeocode.length) }))
      await sleep(120)
    }

    geocodingRef.current = false
    setGeocoding(false)
  }, [withoutCoords])

  const stopGeocoding = () => { geocodingRef.current = false }

  if (loading) return <><Navbar /><LoadingSpinner fullScreen /></>

  const pct = geoProgress.total > 0 ? Math.round((geoProgress.done / geoProgress.total) * 100) : 0

  return (
    <>
      <Navbar />
      <div className="flex" style={{ height: 'calc(100vh - 56px)' }}>

        {/* ── Sidebar ── */}
        <aside className="w-72 shrink-0 bg-white border-r border-[#D3D1C7] flex flex-col overflow-hidden">

          {/* Header */}
          <div className="p-4 border-b border-[#D3D1C7]">
            <div className="flex items-center gap-2 mb-1">
              <button
                onClick={() => navigate('/admin/usuarios')}
                className="text-gray-400 hover:text-gray-700 transition-colors p-1 -ml-1 rounded-lg hover:bg-gray-100"
              >
                <ArrowLeft size={16} />
              </button>
              <h1 className="text-base font-bold text-gray-900">Mapa de clientes</h1>
            </div>
            <p className="text-xs text-gray-500 pl-6">
              {withCoords.length} en mapa · {withoutCoords.length} sin geocodificar
            </p>
          </div>

          {/* Búsqueda */}
          <div className="px-3 pt-3 pb-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar cliente..."
                className="w-full bg-gray-50 border border-[#D3D1C7] rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent text-gray-900 placeholder-gray-400"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Filtro sector */}
          <div className="px-3 pb-3 border-b border-[#D3D1C7]">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Sector</p>
            <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
              <button
                onClick={() => setSectorFilter('all')}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  sectorFilter === 'all' ? 'bg-gray-900 text-white border-gray-900' : 'border-[#D3D1C7] text-gray-500 hover:border-gray-400'
                }`}
              >
                Todos ({allClients.length})
              </button>
              {sectors.map((s) => {
                const color = getSectorColor(s)
                const count = allClients.filter((u) => u.sector === s).length
                const active = sectorFilter === s
                return (
                  <button
                    key={s}
                    onClick={() => setSectorFilter(active ? 'all' : s)}
                    style={active ? { background: color, borderColor: color, color: 'white' } : { borderColor: color + '80', color }}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors hover:opacity-80`}
                  >
                    {s} ({count})
                  </button>
                )
              })}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-2 p-3 border-b border-[#D3D1C7]">
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <div className="flex items-center justify-center gap-1 text-emerald-600 mb-0.5">
                <CheckCircle size={13} />
                <span className="text-xs font-medium">En mapa</span>
              </div>
              <p className="text-xl font-bold text-gray-900">{withCoords.length}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <div className="flex items-center justify-center gap-1 text-amber-500 mb-0.5">
                <AlertCircle size={13} />
                <span className="text-xs font-medium">Sin ubicar</span>
              </div>
              <p className="text-xl font-bold text-gray-900">{withoutCoords.length}</p>
            </div>
          </div>

          {/* Geocodificar */}
          {withoutCoords.length > 0 && (
            <div className="p-3 border-b border-[#D3D1C7]">
              {geocoding ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span className="flex items-center gap-1.5">
                      <Loader2 size={12} className="animate-spin text-accent" />
                      Geocodificando... {geoProgress.done}/{geoProgress.total}
                    </span>
                    <button onClick={stopGeocoding} className="text-red-400 hover:text-red-600 font-medium">Detener</button>
                  </div>
                  <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              ) : (
                <button
                  onClick={runGeocoding}
                  className="w-full py-2 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors flex items-center justify-center gap-2"
                >
                  <MapPin size={14} />
                  Geocodificar {withoutCoords.length} clientes
                </button>
              )}
            </div>
          )}

          {/* Leyenda */}
          <div className="flex-1 overflow-y-auto p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Leyenda</p>
            <div className="space-y-1.5">
              {sectors.map((s) => {
                const color  = getSectorColor(s)
                const total  = filtered.filter((u) => u.sector === s).length
                const mapped = filtered.filter((u) => u.sector === s && geoResults.get(u.uid)).length
                return (
                  <button
                    key={s}
                    onClick={() => setSectorFilter(sectorFilter === s ? 'all' : s)}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors hover:bg-gray-50 ${
                      sectorFilter === s ? 'bg-gray-100' : ''
                    }`}
                  >
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: color, boxShadow: `0 0 0 2px ${color}30` }}
                    />
                    <span className="text-sm text-gray-700 font-medium flex-1">{s}</span>
                    <span className="text-xs text-gray-400">{mapped}/{total}</span>
                  </button>
                )
              })}
              <div className="flex items-center gap-2.5 px-2.5 py-1.5">
                <span className="w-3 h-3 rounded-full shrink-0 bg-gray-400" />
                <span className="text-sm text-gray-500">Sin sector</span>
                <span className="text-xs text-gray-400 ml-auto">
                  {filtered.filter((u) => !u.sector && geoResults.get(u.uid)).length}/
                  {filtered.filter((u) => !u.sector).length}
                </span>
              </div>
            </div>
          </div>

          {/* Total footer */}
          <div className="p-3 border-t border-[#D3D1C7]">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Users size={12} />
              <span>{filtered.length} clientes · {withCoords.length} en mapa</span>
            </div>
          </div>
        </aside>

        {/* ── Mapa ── */}
        <div className="flex-1 relative">
          {withCoords.length === 0 && !geocoding && (
            <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
              <div className="bg-white/95 border border-[#D3D1C7] rounded-2xl px-8 py-6 text-center shadow-xl pointer-events-auto max-w-xs">
                <MapPin size={36} className="text-gray-300 mx-auto mb-3" />
                <p className="text-base font-semibold text-gray-900 mb-1">Sin ubicaciones</p>
                <p className="text-sm text-gray-500 mb-4">
                  Geocodificá los clientes para verlos en el mapa
                </p>
                <button
                  onClick={runGeocoding}
                  className="px-5 py-2 bg-accent text-white rounded-xl text-sm font-medium hover:bg-accent/90 transition-colors"
                >
                  Geocodificar ahora
                </button>
              </div>
            </div>
          )}
          <ClientesMap
            clients={filtered}
            geoResults={geoResults}
            selectedUid={selectedUid}
            onSelect={setSelectedUid}
          />
        </div>
      </div>
    </>
  )
}
