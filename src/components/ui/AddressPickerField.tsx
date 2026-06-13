// Shared address picker: autocomplete dropdown (Google Maps JS API) + draggable map marker
// Uses google.maps.places — requires the 'places' library to be loaded (useGoogleMapsLoader)

import { useState, useEffect, useRef, useId, ChangeEvent, KeyboardEvent } from 'react'
import { GoogleMap, Marker } from '@react-google-maps/api'
import { MapPin } from 'lucide-react'

// ── Map style ─────────────────────────────────────────────────────────────────

export const DARK_MAP_OPTIONS: google.maps.MapOptions = {
  disableDefaultUI: true,
  zoomControl:      true,
  gestureHandling:  'greedy',
  styles: [
    { elementType: 'geometry',           stylers: [{ color: '#0A1628' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#0A1628' }] },
    { elementType: 'labels.text.fill',   stylers: [{ color: '#74a0c8' }] },
    { featureType: 'road',         elementType: 'geometry', stylers: [{ color: '#1E3A5F' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#163868' }] },
    { featureType: 'water',        elementType: 'geometry', stylers: [{ color: '#05101e' }] },
    { featureType: 'poi',          elementType: 'geometry', stylers: [{ color: '#0e1f38' }] },
  ],
}

// ── AddressAutocomplete ───────────────────────────────────────────────────────
// Combobox accesible: role="combobox", role="listbox", teclado (↑↓ Enter Esc)

export function AddressAutocomplete({
  onSelect,
  initialValue = '',
}: {
  onSelect:      (address: string, lat: number, lng: number) => void
  initialValue?: string
}) {
  const listboxId   = useId()
  const [input,       setInput]       = useState(initialValue)
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompletePrediction[]>([])
  const [loading,     setLoading]     = useState(false)
  const [open,        setOpen]        = useState(false)
  const [focusedIdx,  setFocusedIdx]  = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  // PlacesService requiere un elemento DOM como contenedor (no visible)
  const phantomRef  = useRef<HTMLDivElement>(null)

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInput(value)
    setFocusedIdx(-1)
    setOpen(true)
    clearTimeout(debounceRef.current)

    if (value.length < 3) { setSuggestions([]); return }

    debounceRef.current = setTimeout(() => {
      if (!window.google?.maps?.places) return
      setLoading(true)
      const svc = new google.maps.places.AutocompleteService()
      svc.getPlacePredictions(
        { input: value, componentRestrictions: { country: 'ar' }, types: ['address'] },
        (predictions, status) => {
          setLoading(false)
          setSuggestions(
            status === google.maps.places.PlacesServiceStatus.OK ? (predictions ?? []) : [],
          )
        },
      )
    }, 300)
  }

  const handleSelect = (prediction: google.maps.places.AutocompletePrediction) => {
    setInput(prediction.description)
    setOpen(false)
    setSuggestions([])
    setFocusedIdx(-1)
    if (!phantomRef.current || !window.google?.maps?.places) return
    setLoading(true)
    const svc = new google.maps.places.PlacesService(phantomRef.current)
    svc.getDetails(
      { placeId: prediction.place_id, fields: ['formatted_address', 'geometry'] },
      (place, status) => {
        setLoading(false)
        if (status === google.maps.places.PlacesServiceStatus.OK && place?.geometry?.location) {
          onSelect(
            place.formatted_address ?? prediction.description,
            place.geometry.location.lat(),
            place.geometry.location.lng(),
          )
        }
      },
    )
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setFocusedIdx((i) => Math.min(i + 1, suggestions.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setFocusedIdx((i) => Math.max(i - 1, -1))
        break
      case 'Enter':
        e.preventDefault()
        if (focusedIdx >= 0 && focusedIdx < suggestions.length) {
          handleSelect(suggestions[focusedIdx])
        }
        break
      case 'Escape':
        setOpen(false)
        setFocusedIdx(-1)
        break
    }
  }

  useEffect(() => () => clearTimeout(debounceRef.current), [])

  const isExpanded = open && suggestions.length > 0

  return (
    <div className="relative">
      {/* Contenedor fantasma requerido por PlacesService */}
      <div ref={phantomRef} style={{ display: 'none' }} />

      <input
        type="text"
        role="combobox"
        aria-expanded={isExpanded}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-activedescendant={focusedIdx >= 0 ? `${listboxId}-opt-${focusedIdx}` : undefined}
        value={input}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => { setOpen(false); setFocusedIdx(-1) }, 150)}
        onFocus={() => { if (suggestions.length > 0) setOpen(true) }}
        placeholder="Ingresá la dirección..."
        autoComplete="off"
        className="bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 w-full focus:outline-none focus:ring-2 focus:ring-accent transition-colors pr-8"
      />
      {loading && (
        <span
          aria-hidden="true"
          className="absolute right-3 top-2.5 w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin"
        />
      )}
      {isExpanded && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-50 w-full bg-white border border-[#D3D1C7] rounded-xl mt-1 shadow-2xl overflow-hidden"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.place_id}
              id={`${listboxId}-opt-${i}`}
              role="option"
              aria-selected={focusedIdx === i}
              onMouseDown={() => handleSelect(s)}
              className={`px-3 py-2.5 cursor-pointer border-b border-[#D3D1C7]/50 last:border-0 ${
                focusedIdx === i ? 'bg-accent/10' : 'hover:bg-[#F8F7F2]'
              }`}
            >
              <p className="text-sm text-white font-medium leading-tight">
                {s.structured_formatting.main_text}
              </p>
              {s.structured_formatting.secondary_text && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {s.structured_formatting.secondary_text}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── AddressMapPicker ──────────────────────────────────────────────────────────
// Mapa con pin arrastrable + geocodificación inversa al soltar

export function AddressMapPicker({
  lat,
  lng,
  onLocationChange,
  height = 260,
}: {
  lat:              number
  lng:              number
  onLocationChange: (address: string, lat: number, lng: number) => void
  height?:          number
}) {
  const [dragging, setDragging] = useState(false)
  const [pos,      setPos]      = useState({ lat, lng })

  useEffect(() => { setPos({ lat, lng }) }, [lat, lng])

  const handleDragEnd = (e: google.maps.MapMouseEvent) => {
    if (!e.latLng) return
    const newLat = e.latLng.lat()
    const newLng = e.latLng.lng()
    setPos({ lat: newLat, lng: newLng })
    setDragging(false)
    const geocoder = new google.maps.Geocoder()
    geocoder.geocode({ location: { lat: newLat, lng: newLng } }, (results, status) => {
      const address = status === 'OK' && results?.[0]
        ? results[0].formatted_address
        : `${newLat.toFixed(6)}, ${newLng.toFixed(6)}`
      onLocationChange(address, newLat, newLng)
    })
  }

  return (
    <div className="space-y-1.5">
      <div className="rounded-xl overflow-hidden border border-accent/30" style={{ height }}>
        <GoogleMap
          mapContainerStyle={{ width: '100%', height: '100%' }}
          center={pos}
          zoom={16}
          options={DARK_MAP_OPTIONS}
        >
          <Marker
            position={pos}
            draggable
            onDragStart={() => setDragging(true)}
            onDragEnd={handleDragEnd}
            animation={dragging ? undefined : google.maps.Animation.DROP}
          />
        </GoogleMap>
      </div>
      <p className="text-xs text-gray-500 flex items-center gap-1">
        <MapPin size={10} className="shrink-0" />
        Arrastrá el pin para ajustar la ubicación exacta
      </p>
    </div>
  )
}

// ── AddressMapMini ────────────────────────────────────────────────────────────
// Vista de solo lectura (sin draggable)

export function AddressMapMini({ lat, lng }: { lat: number; lng: number }) {
  return (
    <div className="rounded-xl overflow-hidden border border-[#D3D1C7]" style={{ height: 120 }}>
      <GoogleMap
        mapContainerStyle={{ width: '100%', height: '100%' }}
        center={{ lat, lng }}
        zoom={15}
        options={{ ...DARK_MAP_OPTIONS, gestureHandling: 'none', zoomControl: false }}
      >
        <Marker position={{ lat, lng }} />
      </GoogleMap>
    </div>
  )
}
