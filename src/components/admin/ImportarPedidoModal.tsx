import { useState, useRef, ChangeEvent, DragEvent } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import LoadingSpinner from '../ui/LoadingSpinner'
import { extractPdfText, parsePedido } from '../../utils/parsePdf'
import { PRODUCTS } from '../../utils/constants'
import { createOrderExterno } from '../../services/orderService'
import { useSucursales, SucursalItem } from '../../hooks/useSucursales'
import { getPrimaryAddress } from '../../types'

interface Props {
  open:    boolean
  onClose: () => void
}

type Step = 'client' | 'upload' | 'review'

export default function ImportarPedidoModal({ open, onClose }: Props) {
  const [step,    setStep]    = useState<Step>('client')
  const [loading, setLoading] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  // Paso 1 — cliente
  const [busqueda,          setBusqueda]          = useState('')
  const [selectedKey,       setSelectedKey]       = useState('')   // SucursalItem.key
  const { sucursales, isLoading: loadingClientes } = useSucursales()

  // Paso 3 — datos del pedido
  const [clientName,    setClientName]    = useState('')
  const [clientAddress, setClientAddress] = useState('')
  const [numeroOC,      setNumeroOC]      = useState('')
  const [deliveryDate,  setDeliveryDate]  = useState('')
  const [horaEntrega,   setHoraEntrega]   = useState('')
  const [products,      setProducts]      = useState<Array<{ name: string; quantity: number }>>([])
  const [notes,         setNotes]         = useState('')

  const fileRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setStep('client')
    setError('')
    setLoading(false)
    setSaving(false)
    setSelectedKey('')
    setBusqueda('')
    setClientName('')
    setClientAddress('')
    setNumeroOC('')
    setDeliveryDate('')
    setHoraEntrega('')
    setProducts([])
    setNotes('')
  }

  const handleClose = () => { reset(); onClose() }

  const selectedItem: SucursalItem | null = sucursales.find((s) => s.key === selectedKey) ?? null
  const selectedCliente = selectedItem?.user ?? null
  const selectedAddress = selectedCliente?.addresses?.find((a) => a.id === selectedItem?.addrId) ?? null

  const flatFiltered = busqueda.trim()
    ? sucursales.filter((s) => {
        const q = busqueda.toLowerCase()
        return (
          s.label.toLowerCase().includes(q) ||
          (s.user.cuit || '').toLowerCase().includes(q) ||
          (s.user.codigoCliente || '').toLowerCase().includes(q) ||
          s.address.toLowerCase().includes(q)
        )
      })
    : sucursales

  const handleContinueToUpload = () => {
    if (!selectedKey) { setError('Seleccioná un cliente'); return }
    setError('')
    setStep('upload')
  }

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Solo se aceptan archivos PDF')
      return
    }
    setLoading(true)
    setError('')
    try {
      const text   = await extractPdfText(file)
      const result = parsePedido(text)

      // Nombre del cliente: siempre de la sucursal seleccionada
      const nombre = selectedItem
        ? selectedItem.label
        : (result?.clientName ?? '')
      setClientName(nombre)

      // Dirección: del PDF si viene, sino la sucursal seleccionada, sino la principal
      const chosenAddr = selectedAddress ?? (selectedCliente ? getPrimaryAddress(selectedCliente) : null)
      setClientAddress(result?.clientAddress || chosenAddr?.address || '')

      setNumeroOC(result?.numeroOC ?? '')
      setDeliveryDate(result?.deliveryDate ?? '')
      setHoraEntrega(result?.horaEntrega ?? '')
      setProducts(result?.products ?? [])
      setStep('review')
    } catch (err) {
      console.error(err)
      setError('Error al procesar el PDF. Intentá con otro archivo.')
    }
    setLoading(false)
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const handleConfirm = async () => {
    if (!clientName.trim())    { setError('Ingresá el nombre del cliente'); return }
    if (!clientAddress.trim()) { setError('Ingresá la dirección de entrega'); return }
    if (!deliveryDate)         { setError('Ingresá la fecha de entrega'); return }
    if (products.length === 0) { setError('El pedido no tiene productos'); return }
    setSaving(true)
    setError('')
    try {
      await createOrderExterno({
        clientName:    clientName.trim(),
        clientAddress: clientAddress.trim(),
        products:      products.map((p) => ({ name: p.name, quantity: p.quantity })),
        date:          deliveryDate,
        notes:         notes.trim(),
        numeroOC:      numeroOC.trim(),
        horaEntrega:   horaEntrega.trim(),
        clientId:      selectedCliente?.uid,
        clientEmail:   selectedCliente?.email,
        clientPhone:   selectedCliente?.telefono || selectedCliente?.phone,
      })
      handleClose()
    } catch (err) {
      console.error(err)
      setError('Error al guardar el pedido')
    }
    setSaving(false)
  }

  const inputClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

  return (
    <Modal open={open} onClose={handleClose} title="Importar pedido desde PDF" variant="light">

      {/* Paso 1 — Selección de cliente */}
      {step === 'client' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-600">¿Para qué cliente es este pedido?</p>

          <input
            autoFocus
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o código..."
            className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-accent"
          />

          {loadingClientes ? (
            <div className="flex justify-center py-10"><LoadingSpinner /></div>
          ) : (
            <ul className="border border-[#D3D1C7] rounded-lg overflow-y-auto max-h-72 divide-y divide-[#ECEAE3]">
              {flatFiltered.map((s) => {
                const isActive = s.key === selectedKey
                return (
                  <li
                    key={s.key}
                    onClick={() => setSelectedKey(s.key)}
                    className={`flex items-start gap-2 px-3 py-2.5 cursor-pointer text-sm transition-colors ${
                      isActive
                        ? 'bg-[#E8F5F0] text-accent font-medium'
                        : 'hover:bg-[#F0EEE7] text-gray-900'
                    }`}
                  >
                    {s.addrId && (
                      <span className="text-xs text-gray-400 shrink-0 mt-0.5">[{s.addrId}]</span>
                    )}
                    <span className="flex-1 min-w-0">
                      <span className="block truncate">{s.label}</span>
                      {s.address && (
                        <span className="block text-xs text-gray-500 truncate">{s.address}</span>
                      )}
                    </span>
                    {isActive && <span className="text-accent shrink-0 mt-0.5">✓</span>}
                  </li>
                )
              })}
              {flatFiltered.length === 0 && (
                <li className="px-3 py-4 text-sm text-gray-400 text-center">Sin resultados</li>
              )}
            </ul>
          )}

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <Button onClick={handleContinueToUpload} className="w-full text-sm" disabled={loadingClientes || !selectedKey}>
            Continuar →
          </Button>
        </div>
      )}

      {/* Paso 2 — Subir PDF */}
      {step === 'upload' && (
        <div className="space-y-4">
          {selectedItem && (
            <div className="bg-[#E8F5F0] border border-accent/30 rounded-lg px-3 py-2 text-sm text-accent font-medium">
              {selectedItem.label}
              {selectedItem.address && <span className="text-xs text-accent/70 ml-2">{selectedItem.address}</span>}
            </div>
          )}

          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-[#D3D1C7] hover:border-accent/60 bg-[#F1EFE8] rounded-xl p-10 text-center cursor-pointer transition-colors select-none"
          >
            <p className="text-4xl mb-3">📄</p>
            <p className="text-sm font-medium text-gray-700">Arrastrá el PDF acá o hacé click para seleccionar</p>
            <p className="text-xs text-gray-500 mt-1">Formatos: Carrefour · Josimar · Coto (Planexware) · Jumbo / Cencosud</p>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const file = e.target.files?.[0]
                if (file) handleFile(file)
                e.target.value = ''
              }}
            />
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-3 text-gray-500 text-sm py-2">
              <LoadingSpinner />
              <span>Procesando PDF…</span>
            </div>
          )}
          {error && <p className="text-red-600 text-sm">{error}</p>}

          <button
            onClick={() => { setError(''); setStep('client') }}
            className="text-sm text-gray-500 hover:text-gray-700 underline"
          >
            ← Cambiar cliente
          </button>
        </div>
      )}

      {/* Paso 3 — Revisión */}
      {step === 'review' && (
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-xs text-green-700">
            PDF procesado. Revisá los datos y corregí si es necesario.
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Número de OC</label>
              <input value={numeroOC} onChange={(e) => setNumeroOC(e.target.value)} className={inputClass} />
            </div>

            <div>
              <label className="text-xs text-gray-500 mb-1 block">Cliente</label>
              <div className="w-full bg-[#F1EFE8] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-700">
                {clientName}
                {selectedCliente && (
                  <span className="ml-2 text-xs text-accent font-medium">✓ vinculado</span>
                )}
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-500 mb-1 block">Dirección de entrega *</label>
              {(selectedCliente?.addresses?.length ?? 0) > 1 && (
                <select
                  value={selectedItem?.addrId ?? ''}
                  onChange={(e) => {
                    const addr = selectedCliente!.addresses.find((a) => a.id === e.target.value)
                    if (addr) {
                      const newKey = `${selectedCliente!.uid}_${addr.id}`
                      setSelectedKey(newKey)
                      setClientAddress(addr.address)
                    }
                  }}
                  className="w-full mb-1 bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {selectedCliente!.addresses.map((a) => (
                    <option key={a.id} value={a.id}>{a.nombre} — {a.address}</option>
                  ))}
                </select>
              )}
              <input value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} className={inputClass} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Fecha de entrega *</label>
                <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Hora de entrega</label>
                <input type="time" value={horaEntrega} onChange={(e) => setHoraEntrega(e.target.value)} className={inputClass} />
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-500 mb-1 block">Productos *</label>
              <div className="space-y-2">
                {products.map((p, i) => {
                  const enCatalogo = PRODUCTS.some((c) => c.name === p.name)
                  return (
                    <div key={i} className="flex gap-2">
                      <div className="flex-1 flex flex-col gap-1">
                        <select
                          value={enCatalogo ? p.name : ''}
                          onChange={(e) => {
                            const upd = [...products]
                            upd[i] = { ...upd[i], name: e.target.value }
                            setProducts(upd)
                          }}
                          className="w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
                        >
                          <option value="">— Seleccioná un producto —</option>
                          {PRODUCTS.map((c) => (
                            <option key={c.id} value={c.name}>{c.name}</option>
                          ))}
                        </select>
                        {!enCatalogo && p.name && (
                          <p className="text-xs text-amber-600">PDF dice: "{p.name}" — seleccioná el producto correcto</p>
                        )}
                      </div>
                      <input
                        type="number"
                        min={1}
                        value={p.quantity}
                        onChange={(e) => {
                          const upd = [...products]
                          upd[i] = { ...upd[i], quantity: parseInt(e.target.value) || 0 }
                          setProducts(upd)
                        }}
                        className="w-24 bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent text-right"
                      />
                    </div>
                  )
                })}
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-500 mb-1 block">Notas internas</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 resize-none focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setStep('upload'); setError('') }} className="flex-1 text-sm">
              ← Volver
            </Button>
            <Button onClick={handleConfirm} loading={saving} className="flex-1 text-sm">
              Crear pedido
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
