import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { GoogleMap, Marker } from '@react-google-maps/api'
import { ArrowLeft, Search, MapPin, Users, AlertCircle, CheckCircle, Loader2, X } from 'lucide-react'
import Navbar from '../../components/layout/Navbar'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useGoogleMapsLoader } from '../../hooks/useGoogleMapsLoader'
import { getAllUsers, updateUserDocument, approveCoord, rejectCoord } from '../../services/userService'
import { UserProfile, DeliveryAddress } from '../../types'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface SucursalMapItem {
  key:           string          // uid_addrId o uid_main
  uid:           string
  user:          UserProfile
  address:       DeliveryAddress | null
  codigoCliente: string
}

// ── Colores por vendedor ──────────────────────────────────────────────────────

const VENDEDOR_COLORS = [
  '#3B82F6', '#EF4444', '#8B5CF6', '#F97316', '#06B6D4',
  '#EC4899', '#14B8A6', '#6366F1', '#D946EF', '#84CC16',
  '#FB923C', '#34D399', '#A78BFA', '#F59E0B', '#10B981',
]

const VENDEDOR_SIN = '#9CA3AF'
const vendedorColorMap = new Map<string, string>()

function getVendedorColor(codVendedor: string | undefined): string {
  if (!codVendedor) return VENDEDOR_SIN
  if (!vendedorColorMap.has(codVendedor)) {
    vendedorColorMap.set(codVendedor, VENDEDOR_COLORS[vendedorColorMap.size % VENDEDOR_COLORS.length])
  }
  return vendedorColorMap.get(codVendedor)!
}

const ESTADO_RING: Record<string, string> = {
  activo:    '#10B981',
  pendiente: '#F59E0B',
  inactivo:  '#6B7280',
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

function makePin(fillColor: string, ringColor: string, label: string, size = 40) {
  const r        = size / 2 - 2
  const fontSize = label.length <= 3 ? 11 : label.length <= 5 ? 9 : 8
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size + 10}">` +
    `<circle cx="${size/2}" cy="${size/2}" r="${r}" fill="${fillColor}" stroke="${ringColor}" stroke-width="3.5"/>` +
    `<text x="${size/2}" y="${size/2 + fontSize/3}" text-anchor="middle" fill="white" ` +
    `font-size="${fontSize}" font-weight="bold" font-family="Arial,sans-serif">${label}</text>` +
    `<line x1="${size/2}" y1="${size-2}" x2="${size/2}" y2="${size+9}" stroke="${fillColor}" stroke-width="2.5"/>` +
    `</svg>`,
  )
  return {
    url:        `data:image/svg+xml;charset=UTF-8,${svg}`,
    scaledSize: new google.maps.Size(size, size + 10),
    anchor:     new google.maps.Point(size / 2, size + 10),
  }
}

// ── Geocoding cache en memoria ────────────────────────────────────────────────

const geoCache = new Map<string, { lat: number; lng: number } | null>()

// ── Helpers ───────────────────────────────────────────────────────────────────

function sucursalCoords(s: SucursalMapItem): { lat: number; lng: number } | null {
  if (s.address?.lat && s.address?.lng) return { lat: s.address.lat, lng: s.address.lng }
  if (!s.address && s.user.lat && s.user.lng) return { lat: s.user.lat, lng: s.user.lng }
  return null
}

function sucursalAddress(s: SucursalMapItem): string {
  if (s.address?.address) return s.address.address
  return s.user.address ?? ''
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

// ── InfoCard ──────────────────────────────────────────────────────────────────

function InfoCard({ sucursal, onClose }: { sucursal: SucursalMapItem; onClose: () => void }) {
  const u         = sucursal.user
  const vendColor = getVendedorColor(u.codVendedor)
  const ringColor = ESTADO_RING[u.estado] ?? '#9CA3AF'
  const tel       = u.telefono || u.phone || ''
  const addr      = sucursalAddress(sucursal)
  const statusLabel = u.estado === 'activo' ? 'Activo' : u.estado === 'pendiente' ? 'Pendiente' : 'Inactivo'
  const statusBg    = u.estado === 'activo' ? '#d1fae5' : u.estado === 'pendiente' ? '#fef3c7' : '#f3f4f6'
  const statusClr   = u.estado === 'activo' ? '#065f46' : u.estado === 'pendiente' ? '#92400e' : '#6b7280'

  return (
    <div style={{ minWidth: 220, maxWidth: 260, fontFamily: 'sans-serif', fontSize: 13, lineHeight: 1.6, color: '#111' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <div style={{ fontWeight: 700, fontSize: 14, flex: 1, marginRight: 6 }}>{u.razonSocial || u.nombre}</div>
        <button onClick={onClose} style={{ cursor: 'pointer', background: 'none', border: 'none', fontSize: 16, color: '#999', lineHeight: 1, padding: 0 }}>✕</button>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        {u.codVendedor && (
          <span style={{ background: vendColor, color: 'white', fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 99 }}>
            {u.codVendedor}
          </span>
        )}
        <span style={{ background: statusBg, color: statusClr, border: `1.5px solid ${ringColor}`, fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 99 }}>
          {statusLabel}
        </span>
      </div>
      {sucursal.codigoCliente && (
        <div style={{ marginBottom: 3 }}>
          <span style={{ color: '#888', fontSize: 11 }}>Código: </span>
          <span style={{ fontWeight: 600 }}>{sucursal.codigoCliente}</span>
        </div>
      )}
      {u.cuit && (
        <div style={{ marginBottom: 3 }}>
          <span style={{ color: '#888', fontSize: 11 }}>CUIT: </span>
          <span>{u.cuit}</span>
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
      {u.notasContacto && (
        <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid #eee', color: '#666', fontSize: 11 }}>
          {u.notasContacto}
        </div>
      )}
    </div>
  )
}

// ── Panel coordenada pendiente ────────────────────────────────────────────────

function PendingCoordPanel({
  coord, onApprove, onReject,
}: {
  coord:     { lat: number; lng: number; choferNombre: string; timestamp: import('firebase/firestore').Timestamp }
  onApprove: () => Promise<void>
  onReject:  () => Promise<void>
}) {
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null)

  const handle = async (action: 'approve' | 'reject') => {
    setLoading(action)
    try { action === 'approve' ? await onApprove() : await onReject() } finally { setLoading(null) }
  }

  const fecha = coord.timestamp?.toDate?.()?.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) ?? ''

  return (
    <div className="border-t border-orange-100 pt-3">
      <p className="text-xs font-semibold text-orange-600 mb-1">📍 Punto propuesto por chofer</p>
      <p className="text-xs text-gray-500 mb-1">{coord.choferNombre} · {fecha}</p>
      <p className="text-xs text-gray-400 mb-3">{coord.lat.toFixed(6)}, {coord.lng.toFixed(6)}</p>
      <div className="flex gap-2">
        <button
          onClick={() => handle('reject')}
          disabled={loading !== null}
          className="flex-1 text-xs py-2 rounded-lg border border-gray-200 text-gray-500 hover:border-red-300 hover:text-red-500 transition-colors disabled:opacity-50"
        >
          {loading === 'reject' ? '...' : 'Rechazar'}
        </button>
        <button
          onClick={() => handle('approve')}
          disabled={loading !== null}
          className="flex-1 text-xs py-2 rounded-lg bg-orange-500 text-white font-medium hover:bg-orange-600 transition-colors disabled:opacity-50"
        >
          {loading === 'approve' ? '...' : '✓ Confirmar punto'}
        </button>
      </div>
    </div>
  )
}

// ── Componente mapa ───────────────────────────────────────────────────────────

function ClientesMap({
  clients, geoResults, selectedKey, onSelect,
}: {
  clients:     SucursalMapItem[]
  geoResults:  Map<string, { lat: number; lng: number } | null>
  selectedKey: string | null
  onSelect:    (key: string | null) => void
}) {
  const { isLoaded } = useGoogleMapsLoader()
  const mapRef   = useRef<google.maps.Map | null>(null)
  const pinCache = useRef<Map<string, google.maps.Icon>>(new Map())

  const getPin = useCallback((s: SucursalMapItem) => {
    const fillColor = getVendedorColor(s.user.codVendedor)
    const ringColor = ESTADO_RING[s.user.estado] ?? '#9CA3AF'
    const label     = s.codigoCliente?.split('.')[1] ?? s.codigoCliente ?? ''
    const key       = `${fillColor}|${ringColor}|${label}`
    if (!pinCache.current.has(key)) {
      pinCache.current.set(key, makePin(fillColor, ringColor, label))
    }
    return pinCache.current.get(key)!
  }, [])

  useEffect(() => {
    if (!isLoaded || !mapRef.current || geoResults.size === 0) return
    const bounds = new google.maps.LatLngBounds()
    let count = 0
    geoResults.forEach((pt) => {
      if (pt) { bounds.extend(pt); count++ }
    })
    if (count >= 2) mapRef.current.fitBounds(bounds, 60)
    else if (count === 1) {
      geoResults.forEach((pt) => { if (pt) { mapRef.current!.panTo(pt); mapRef.current!.setZoom(14) } })
    }
  }, [isLoaded, geoResults.size]) // eslint-disable-line react-hooks/exhaustive-deps

  const markers = useMemo(() => {
    const list: { s: SucursalMapItem; lat: number; lng: number }[] = []
    for (const s of clients) {
      const pt = geoResults.get(s.key)
      if (pt) list.push({ s, lat: pt.lat, lng: pt.lng })
    }
    return list
  }, [clients, geoResults])

  const pendingPin = useMemo(() => {
    if (!isLoaded) return null
    const svg = encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="46">` +
      `<circle cx="18" cy="18" r="16" fill="#F97316" stroke="#EA580C" stroke-width="3"/>` +
      `<text x="18" y="23" text-anchor="middle" fill="white" font-size="14" font-weight="bold" font-family="Arial">?</text>` +
      `<line x1="18" y1="34" x2="18" y2="45" stroke="#F97316" stroke-width="2.5"/>` +
      `</svg>`
    )
    return {
      url:        `data:image/svg+xml;charset=UTF-8,${svg}`,
      scaledSize: new google.maps.Size(36, 46),
      anchor:     new google.maps.Point(18, 46),
    }
  }, [isLoaded])

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
      {markers.map(({ s, lat, lng }) => (
        <Marker
          key={s.key}
          position={{ lat, lng }}
          icon={getPin(s)}
          zIndex={selectedKey === s.key ? 100 : 1}
          onClick={() => onSelect(s.key)}
        />
      ))}

      {markers
        .filter(({ s }) => s.user.coordPendiente)
        .map(({ s }) => (
          <Marker
            key={`pending-${s.key}`}
            position={{ lat: s.user.coordPendiente!.lat, lng: s.user.coordPendiente!.lng }}
            icon={pendingPin ?? undefined}
            zIndex={200}
            onClick={() => onSelect(s.key)}
          />
        ))}
    </GoogleMap>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function ClientesMapPage() {
  const navigate = useNavigate()
  const [allSucursales, setAllSucursales] = useState<SucursalMapItem[]>([])
  const [loading, setLoading]               = useState(true)
  const [search, setSearch]                 = useState('')
  const [sectorFilter, setSectorFilter]     = useState<string>('all')
  const [estadoFilter, setEstadoFilter]     = useState<string>('all')
  const [vendedorFilter, setVendedorFilter] = useState<string>('all')
  const [soloSinGeo, setSoloSinGeo]         = useState(false)
  const [geoResults, setGeoResults]         = useState<Map<string, { lat: number; lng: number } | null>>(new Map())
  const [geocoding, setGeocoding]           = useState(false)
  const [geoProgress, setGeoProgress]       = useState({ done: 0, total: 0 })
  const [selectedKey, setSelectedKey]       = useState<string | null>(null)
  const geocodingRef = useRef(false)

  useEffect(() => {
    getAllUsers().then((all) => {
      const clientes = all.filter((u) => u.rol === 'cliente')

      // Expandir a una entrada por sucursal
      const sucursales: SucursalMapItem[] = clientes.flatMap((u): SucursalMapItem[] =>
        u.addresses?.length
          ? u.addresses.map((addr) => ({
              key:           `${u.uid}_${addr.id}`,
              uid:           u.uid,
              user:          u,
              address:       addr,
              codigoCliente: addr.id || u.codigoCliente || '',
            }))
          : [{
              key:           u.uid,
              uid:           u.uid,
              user:          u,
              address:       null,
              codigoCliente: u.codigoCliente || '',
            }]
      )
      setAllSucursales(sucursales)

      // Pre-cargar coordenadas ya guardadas en cada dirección
      const initial = new Map<string, { lat: number; lng: number } | null>()
      for (const s of sucursales) {
        const pt = sucursalCoords(s)
        if (pt) { initial.set(s.key, pt); geoCache.set(s.key, pt) }
      }
      setGeoResults(new Map(initial))
      setLoading(false)
    })
  }, [])

  const sectors = useMemo(() => {
    const set = new Set<string>()
    allSucursales.filter((s) => s.user.sector).forEach((s) => set.add(s.user.sector!))
    return Array.from(set).sort()
  }, [allSucursales])

  const vendedores = useMemo(() => {
    const set = new Set<string>()
    allSucursales.filter((s) => s.user.codVendedor).forEach((s) => set.add(s.user.codVendedor!))
    return Array.from(set).sort()
  }, [allSucursales])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return allSucursales.filter((s) => {
      const matchSector   = sectorFilter === 'all' || s.user.sector === sectorFilter
      const matchEstado   = estadoFilter === 'all' || s.user.estado === estadoFilter
      const matchVendedor = vendedorFilter === 'all' || s.user.codVendedor === vendedorFilter
      const matchSinGeo   = !soloSinGeo || !geoResults.get(s.key)
      const matchSearch   = !q ||
        s.user.razonSocial?.toLowerCase().includes(q) ||
        s.user.nombre?.toLowerCase().includes(q) ||
        s.codigoCliente.toLowerCase().includes(q) ||
        s.address?.address?.toLowerCase().includes(q)
      return matchSector && matchEstado && matchVendedor && matchSinGeo && matchSearch
    })
  }, [allSucursales, search, sectorFilter, estadoFilter, vendedorFilter, soloSinGeo, geoResults])

  const withCoords    = filtered.filter((s) => geoResults.get(s.key))
  const withoutCoords = filtered.filter((s) => !geoResults.get(s.key))

  const runGeocoding = useCallback(async () => {
    if (geocodingRef.current) return
    const toGeocode = withoutCoords.filter((s) => {
      const addr = sucursalAddress(s)
      return addr && !geoCache.has(s.key)
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
          (s) =>
            new Promise<void>((resolve) => {
              const addr = sucursalAddress(s)
              geocoder.geocode(
                { address: `${addr}, Argentina`, componentRestrictions: { country: 'AR' } },
                async (results, status) => {
                  const pt =
                    status === 'OK' && results?.[0]
                      ? { lat: results[0].geometry.location.lat(), lng: results[0].geometry.location.lng() }
                      : null
                  geoCache.set(s.key, pt)
                  if (pt) {
                    setGeoResults((prev) => new Map(prev).set(s.key, pt))
                    // Guardar coords en la dirección específica o en el doc raíz
                    if (s.address) {
                      const updatedAddresses = s.user.addresses.map((a) =>
                        a.id === s.address!.id ? { ...a, lat: pt.lat, lng: pt.lng } : a
                      )
                      updateUserDocument(s.uid, { addresses: updatedAddresses }).catch(() => {})
                    } else {
                      updateUserDocument(s.uid, { lat: pt.lat, lng: pt.lng }).catch(() => {})
                    }
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
                placeholder="Buscar por código, razón social, dirección..."
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
                Todos ({allSucursales.length})
              </button>
              {sectors.map((s) => {
                const count = allSucursales.filter((item) => item.user.sector === s).length
                const active = sectorFilter === s
                return (
                  <button
                    key={s}
                    onClick={() => setSectorFilter(active ? 'all' : s)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                      active ? 'bg-gray-900 text-white border-gray-900' : 'border-[#D3D1C7] text-gray-500 hover:border-gray-400'
                    }`}
                  >
                    {s} ({count})
                  </button>
                )
              })}
            </div>
          </div>

          {/* Filtro estado */}
          <div className="px-3 pb-3 border-b border-[#D3D1C7]">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Estado</p>
            <div className="flex flex-wrap gap-1.5">
              {(['all', 'activo', 'pendiente', 'inactivo'] as const).map((e) => {
                const label  = e === 'all' ? 'Todos' : e === 'activo' ? 'Activo' : e === 'pendiente' ? 'Pendiente' : 'Inactivo'
                const active = estadoFilter === e
                const colors = e === 'activo'    ? 'bg-emerald-600 border-emerald-600 text-white'
                             : e === 'pendiente' ? 'bg-amber-500 border-amber-500 text-white'
                             : e === 'inactivo'  ? 'bg-gray-500 border-gray-500 text-white'
                             : 'bg-gray-900 border-gray-900 text-white'
                return (
                  <button
                    key={e}
                    onClick={() => setEstadoFilter(e)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                      active ? colors : 'border-[#D3D1C7] text-gray-500 hover:border-gray-400'
                    }`}
                  >
                    {label}
                    {e !== 'all' && (
                      <span className="ml-1 opacity-75">
                        ({allSucursales.filter((s) => s.user.estado === e).length})
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Filtro vendedor */}
          {vendedores.length > 0 && (
            <div className="px-3 pb-3 border-b border-[#D3D1C7]">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Vendedor</p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setVendedorFilter('all')}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    vendedorFilter === 'all' ? 'bg-gray-900 text-white border-gray-900' : 'border-[#D3D1C7] text-gray-500 hover:border-gray-400'
                  }`}
                >
                  Todos
                </button>
                {vendedores.map((v) => {
                  const count  = allSucursales.filter((s) => s.user.codVendedor === v).length
                  const active = vendedorFilter === v
                  const color  = getVendedorColor(v)
                  return (
                    <button
                      key={v}
                      onClick={() => setVendedorFilter(active ? 'all' : v)}
                      style={active ? { background: color, borderColor: color, color: 'white' } : { borderColor: color + '80', color }}
                      className="px-2.5 py-1 rounded-full text-xs font-medium border transition-colors hover:opacity-80"
                    >
                      {v} <span className="opacity-75">({count})</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Toggle sin geocodificar */}
          <div className="px-3 py-2.5 border-b border-[#D3D1C7]">
            <button
              onClick={() => setSoloSinGeo((v) => !v)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border text-xs font-medium transition-colors ${
                soloSinGeo
                  ? 'bg-amber-50 border-amber-300 text-amber-700'
                  : 'border-[#D3D1C7] text-gray-500 hover:border-gray-400 hover:text-gray-700'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <AlertCircle size={13} />
                Solo sin geocodificar
              </span>
              <span className={`w-4 h-4 rounded border flex items-center justify-center ${
                soloSinGeo ? 'bg-amber-500 border-amber-500 text-white' : 'border-gray-300'
              }`}>
                {soloSinGeo && '✓'}
              </span>
            </button>
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
                  Geocodificar {withoutCoords.length} sucursales
                </button>
              )}
            </div>
          )}

          {/* Leyenda */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Color → Vendedor</p>
              <div className="space-y-1">
                {vendedores.map((v) => {
                  const color  = getVendedorColor(v)
                  const total  = filtered.filter((s) => s.user.codVendedor === v).length
                  const mapped = filtered.filter((s) => s.user.codVendedor === v && geoResults.get(s.key)).length
                  return (
                    <button
                      key={v}
                      onClick={() => setVendedorFilter(vendedorFilter === v ? 'all' : v)}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors hover:bg-gray-50 ${
                        vendedorFilter === v ? 'bg-gray-100' : ''
                      }`}
                    >
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color, boxShadow: `0 0 0 2px ${color}30` }} />
                      <span className="text-sm text-gray-700 font-semibold flex-1">{v}</span>
                      <span className="text-xs text-gray-400">{mapped}/{total}</span>
                    </button>
                  )
                })}
                <div className="flex items-center gap-2.5 px-2.5 py-1.5">
                  <span className="w-3 h-3 rounded-full shrink-0 bg-gray-400" />
                  <span className="text-sm text-gray-500 flex-1">Sin vendedor</span>
                  <span className="text-xs text-gray-400">
                    {filtered.filter((s) => !s.user.codVendedor && geoResults.get(s.key)).length}/
                    {filtered.filter((s) => !s.user.codVendedor).length}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Anillo → Estado</p>
              <div className="space-y-1">
                {[
                  { key: 'activo',    label: 'Activo',    color: '#10B981' },
                  { key: 'pendiente', label: 'Pendiente', color: '#F59E0B' },
                  { key: 'inactivo',  label: 'Inactivo',  color: '#6B7280' },
                ].map(({ key, label, color }) => (
                  <div key={key} className="flex items-center gap-2.5 px-2.5 py-1">
                    <span className="w-3 h-3 rounded-full shrink-0 bg-gray-300" style={{ boxShadow: `0 0 0 2.5px ${color}` }} />
                    <span className="text-sm text-gray-600 flex-1">{label}</span>
                    <span className="text-xs text-gray-400">{filtered.filter((s) => s.user.estado === key).length}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Total footer */}
          <div className="p-3 border-t border-[#D3D1C7]">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Users size={12} />
              <span>{filtered.length} sucursales · {withCoords.length} en mapa</span>
            </div>
          </div>
        </aside>

        {/* ── Mapa ── */}
        <div className="flex-1 relative">

          {/* Panel flotante de sucursal seleccionada */}
          {selectedKey && (() => {
            const s = allSucursales.find((item) => item.key === selectedKey)
            if (!s) return null
            return (
              <div className="absolute top-3 right-3 z-20 w-72 bg-white rounded-2xl shadow-xl border border-[#D3D1C7] p-4 pointer-events-auto space-y-3">
                <InfoCard sucursal={s} onClose={() => setSelectedKey(null)} />

                {s.user.coordPendiente && (
                  <PendingCoordPanel
                    coord={s.user.coordPendiente}
                    onApprove={async () => {
                      await approveCoord(s.uid, s.user.coordPendiente!.lat, s.user.coordPendiente!.lng)
                      setAllSucursales((prev) => prev.map((item) =>
                        item.uid === s.uid
                          ? { ...item, user: { ...item.user, lat: s.user.coordPendiente!.lat, lng: s.user.coordPendiente!.lng, coordPendiente: undefined } }
                          : item
                      ))
                      setGeoResults((prev) => new Map(prev).set(s.key, { lat: s.user.coordPendiente!.lat, lng: s.user.coordPendiente!.lng }))
                    }}
                    onReject={async () => {
                      await rejectCoord(s.uid)
                      setAllSucursales((prev) => prev.map((item) =>
                        item.uid === s.uid ? { ...item, user: { ...item.user, coordPendiente: undefined } } : item
                      ))
                    }}
                  />
                )}
              </div>
            )
          })()}

          {withCoords.length === 0 && !geocoding && (
            <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
              <div className="bg-white/95 border border-[#D3D1C7] rounded-2xl px-8 py-6 text-center shadow-xl pointer-events-auto max-w-xs">
                <MapPin size={36} className="text-gray-300 mx-auto mb-3" />
                <p className="text-base font-semibold text-gray-900 mb-1">Sin ubicaciones</p>
                <p className="text-sm text-gray-500 mb-4">
                  Geocodificá las sucursales para verlas en el mapa
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
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
          />
        </div>
      </div>
    </>
  )
}
