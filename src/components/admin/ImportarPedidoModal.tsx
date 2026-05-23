import { useState, useRef, ChangeEvent, DragEvent } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import LoadingSpinner from '../ui/LoadingSpinner'
import { extractPdfText, parsePedido } from '../../utils/parsePdf'
import { createOrderExterno } from '../../services/orderService'

interface Props {
  open:    boolean
  onClose: () => void
}

type Step = 'upload' | 'review'

export default function ImportarPedidoModal({ open, onClose }: Props) {
  const [step,    setStep]    = useState<Step>('upload')
  const [loading, setLoading] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  const [clientName,    setClientName]    = useState('')
  const [clientAddress, setClientAddress] = useState('')
  const [numeroOC,      setNumeroOC]      = useState('')
  const [deliveryDate,  setDeliveryDate]  = useState('')
  const [horaEntrega,   setHoraEntrega]   = useState('')
  const [products,      setProducts]      = useState<Array<{ name: string; quantity: number }>>([])
  const [notes,         setNotes]         = useState('')

  const fileRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setStep('upload')
    setError('')
    setLoading(false)
    setSaving(false)
    setClientName('')
    setClientAddress('')
    setNumeroOC('')
    setDeliveryDate('')
    setHoraEntrega('')
    setProducts([])
    setNotes('')
  }

  const handleClose = () => { reset(); onClose() }

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
      if (!result) {
        setError('No se pudo detectar el formato. Asegurate de que sea una orden de compra de Rolito o Carrefour.')
        setLoading(false)
        return
      }
      setClientName(result.clientName)
      setClientAddress(result.clientAddress)
      setNumeroOC(result.numeroOC)
      setDeliveryDate(result.deliveryDate)
      setHoraEntrega(result.horaEntrega)
      setProducts(result.products)
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
    if (!clientName.trim())   { setError('Ingresá el nombre del cliente'); return }
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
      })
      handleClose()
    } catch (err) {
      console.error(err)
      setError('Error al guardar el pedido')
    }
    setSaving(false)
  }

  const inputClass = 'w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent'

  return (
    <Modal open={open} onClose={handleClose} title="Importar pedido desde PDF">

      {step === 'upload' && (
        <div className="space-y-4">
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-border hover:border-accent/60 rounded-xl p-10 text-center cursor-pointer transition-colors select-none"
          >
            <p className="text-4xl mb-3">📄</p>
            <p className="text-sm font-medium">Arrastrá el PDF acá o hacé click para seleccionar</p>
            <p className="text-xs text-muted mt-1">Formatos compatibles: orden de compra propia · Carrefour (Planexware)</p>
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
            <div className="flex items-center justify-center gap-3 text-muted text-sm py-2">
              <LoadingSpinner />
              <span>Procesando PDF…</span>
            </div>
          )}
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-4">
          <div className="bg-success/10 border border-success/30 rounded-lg px-3 py-2 text-xs text-success">
            PDF procesado. Revisá los datos y corregí si es necesario.
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted mb-1 block">Número de OC</label>
              <input value={numeroOC} onChange={(e) => setNumeroOC(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="text-xs text-muted mb-1 block">Cliente / Local *</label>
              <input value={clientName} onChange={(e) => setClientName(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="text-xs text-muted mb-1 block">Dirección de entrega *</label>
              <input value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} className={inputClass} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted mb-1 block">Fecha de entrega *</label>
                <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">Hora de entrega</label>
                <input type="time" value={horaEntrega} onChange={(e) => setHoraEntrega(e.target.value)} className={inputClass} />
              </div>
            </div>

            <div>
              <label className="text-xs text-muted mb-1 block">Productos *</label>
              <div className="space-y-2">
                {products.map((p, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      value={p.name}
                      onChange={(e) => {
                        const upd = [...products]
                        upd[i] = { ...upd[i], name: e.target.value }
                        setProducts(upd)
                      }}
                      className="flex-1 bg-bg border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    <input
                      type="number"
                      min={1}
                      value={p.quantity}
                      onChange={(e) => {
                        const upd = [...products]
                        upd[i] = { ...upd[i], quantity: parseInt(e.target.value) || 0 }
                        setProducts(upd)
                      }}
                      className="w-24 bg-bg border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent text-right"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-muted mb-1 block">Notas internas</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted resize-none focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

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
