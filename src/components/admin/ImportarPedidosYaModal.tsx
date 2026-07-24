import { useRef, useState } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import MultiDatePicker from './MultiDatePicker'
import { parsePedidosYaExcel, PedidoYaRow } from '../../utils/parsePedidosYaExcel'
import { createOrderExterno, findActiveOrdersInRange } from '../../services/orderService'
import { getUserDocument } from '../../services/userService'
import { DELIVERY_HERO_CLIENT_ID } from '../../utils/constants'
import { DeliveryAddress, Order, UserProfile } from '../../types'

// Producto fijo: los pedidos de Pedidos Ya siempre son de este producto —
// la planilla que baja el administrativo no trae columna de producto.
const PEDIDOS_YA_PRODUCTO = { id: 'bolsa_2kg', name: 'Hielo bolsa 2kg' }

interface ReviewRow extends PedidoYaRow {
  addrId:       string      // '' si no matcheó ninguna sucursal
  matchError?:  string
  // Solo el "código no encontrado" se puede arreglar eligiendo la sucursal a
  // mano — un parseError (OC/cantidad/fecha inválida) no se resuelve así.
  recoverable?: boolean
  dupOC?:       boolean
  dupSameDay?:  boolean
  included:     boolean
  // Días extra además de la fecha que trae el Excel — para tiendas que en
  // realidad piden todos los días pero el Excel solo trae una fila.
  diasAdicionales: string[]
}

interface Props {
  open:    boolean
  onClose: () => void
}

function normalizeAddress(s: string): string {
  return s.trim().toLowerCase()
}

function computeWarnings(addr: DeliveryAddress | undefined, fechaEntrega: string, oc: string, existing: Order[]) {
  const dupOC      = !!oc && existing.some((o) => (o.numeroOC ?? '').trim() === oc.trim())
  const dupSameDay = !!addr && existing.some((o) => {
    const orderDateStr = o.date?.toDate ? o.date.toDate().toISOString().split('T')[0] : ''
    return orderDateStr === fechaEntrega && normalizeAddress(o.clientAddress) === normalizeAddress(addr.address)
  })
  return { dupOC, dupSameDay }
}

function buildReviewRow(row: PedidoYaRow, deliveryHero: UserProfile, existing: Order[]): ReviewRow {
  if (row.parseError) {
    return { ...row, addrId: '', matchError: row.parseError, included: false, diasAdicionales: [] }
  }
  const addr = deliveryHero.addresses.find((a) => a.id === row.codigo)
  if (!addr) {
    return { ...row, addrId: '', matchError: 'Código no encontrado — elegí la sucursal manualmente', recoverable: true, included: false, diasAdicionales: [] }
  }
  const { dupOC, dupSameDay } = computeWarnings(addr, row.fechaEntrega, row.oc, existing)
  return { ...row, addrId: addr.id, dupOC, dupSameDay, included: !dupOC && !dupSameDay, diasAdicionales: [] }
}

export default function ImportarPedidosYaModal({ open, onClose }: Props) {
  const [step,         setStep]         = useState<'pick' | 'preview' | 'importing' | 'done'>('pick')
  const [loading,      setLoading]      = useState(false)
  const [loadError,    setLoadError]    = useState('')
  const [deliveryHero, setDeliveryHero] = useState<UserProfile | null>(null)
  const [existing,     setExisting]     = useState<Order[]>([])
  const [rows,         setRows]         = useState<ReviewRow[]>([])

  const [progress, setProgress] = useState(0)
  const [total,    setTotal]    = useState(0)
  const [created,  setCreated]  = useState(0)
  const [errors,   setErrors]   = useState<string[]>([])

  const [datePickerRowIdx, setDatePickerRowIdx] = useState<number | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setStep('pick')
    setLoading(false)
    setLoadError('')
    setDeliveryHero(null)
    setExisting([])
    setRows([])
    setProgress(0)
    setTotal(0)
    setCreated(0)
    setErrors([])
  }

  const handleClose = () => { reset(); onClose() }

  const handleFile = async (file: File) => {
    setLoading(true)
    setLoadError('')
    try {
      const [parsed, cliente] = await Promise.all([
        parsePedidosYaExcel(file),
        getUserDocument(DELIVERY_HERO_CLIENT_ID),
      ])

      if (!cliente) {
        setLoadError('No se encontró el cliente de Pedidos Ya (Delivery Hero) en el sistema.')
        setLoading(false)
        return
      }
      if (parsed.length === 0) {
        setLoadError('El archivo no tiene filas para cargar.')
        setLoading(false)
        return
      }

      const fechas = parsed.map((r) => r.fechaEntrega).filter(Boolean).sort()
      const existingOrders = fechas.length > 0
        ? await findActiveOrdersInRange(DELIVERY_HERO_CLIENT_ID, fechas[0], fechas[fechas.length - 1])
        : []

      setDeliveryHero(cliente)
      setExisting(existingOrders)
      setRows(parsed.map((r) => buildReviewRow(r, cliente, existingOrders)))
      setStep('preview')
    } catch (err) {
      console.error(err)
      setLoadError('No se pudo leer el archivo. Verificá que sea un Excel válido (.xlsx).')
    }
    setLoading(false)
  }

  const updateRow = (idx: number, patch: Partial<ReviewRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  const handlePickAddr = (idx: number, addrId: string) => {
    if (!deliveryHero) return
    const addr = deliveryHero.addresses.find((a) => a.id === addrId)
    if (!addr) return
    const row = rows[idx]
    const { dupOC, dupSameDay } = computeWarnings(addr, row.fechaEntrega, row.oc, existing)
    updateRow(idx, { addrId, matchError: undefined, dupOC, dupSameDay, included: !dupOC && !dupSameDay })
  }

  const includedRows = rows.filter((r) => r.included && r.addrId)
  const totalPedidosAImportar = includedRows.reduce((sum, r) => sum + 1 + r.diasAdicionales.length, 0)

  const handleImport = async () => {
    if (!deliveryHero) return
    setStep('importing')

    const tareas = includedRows.flatMap((row) => {
      const addr   = deliveryHero.addresses.find((a) => a.id === row.addrId)
      const fechas = [row.fechaEntrega, ...row.diasAdicionales]
      return fechas.map((fecha) => ({ row, addr, fecha }))
    })

    setProgress(0)
    setTotal(tareas.length)
    setCreated(0)
    setErrors([])

    let ok = 0
    const errs: string[] = []

    for (let i = 0; i < tareas.length; i++) {
      const { row, addr, fecha } = tareas[i]
      try {
        if (!addr) throw new Error('Sucursal no resuelta')
        await createOrderExterno({
          clientId:      deliveryHero.uid,
          clientEmail:   deliveryHero.email,
          clientName:    addr.nombre || deliveryHero.razonSocial || deliveryHero.nombre,
          clientAddress: addr.address,
          clientPhone:   deliveryHero.telefono || deliveryHero.phone,
          products:      [{ name: PEDIDOS_YA_PRODUCTO.name, quantity: row.cantidad, productoId: PEDIDOS_YA_PRODUCTO.id }],
          date:          fecha,
          numeroOC:      row.oc,
        })
        ok++
      } catch (err) {
        errs.push(`OC ${row.oc} (${fecha}): ${(err as Error).message ?? 'Error desconocido'}`)
      }
      setProgress(i + 1)
      setCreated(ok)
      setErrors([...errs])
    }

    setStep('done')
  }

  const matchedCount  = rows.filter((r) => !r.matchError).length
  const errorCount    = rows.filter((r) => r.matchError).length
  const warningCount  = rows.filter((r) => !r.matchError && (r.dupOC || r.dupSameDay)).length

  return (
    <Modal open={open} onClose={step === 'importing' ? () => {} : handleClose} title="Cargar pedidos Pedidos Ya desde Excel" variant="light" wide>

      {step === 'pick' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Subí la planilla con las columnas <b>OC</b>, <b>CANTIDAD</b>, <b>TIENDA</b>, <b>CODIGO</b> y <b>FECHA ENTREGA</b>.
            El código de sucursal debe coincidir con el de la base de Pedidos Ya.
          </p>
          {loadError && <p className="text-red-600 text-sm">{loadError}</p>}
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
              e.target.value = ''
            }}
          />
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-[#D3D1C7] hover:border-accent/60 bg-[#F1EFE8] rounded-xl p-10 text-center cursor-pointer transition-colors select-none"
          >
            <p className="text-4xl mb-3">📊</p>
            <p className="text-sm font-medium text-gray-700">
              {loading ? 'Procesando…' : 'Hacé clic para seleccionar el archivo .xlsx'}
            </p>
          </div>
          <div className="flex justify-end">
            <Button variant="outline" onClick={handleClose}>Cancelar</Button>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-2">
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-3 text-center">
              <p className="text-xl font-bold text-gray-900">{rows.length}</p>
              <p className="text-xs text-gray-500">Filas</p>
            </div>
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-3 text-center">
              <p className="text-xl font-bold text-accent">{matchedCount}</p>
              <p className="text-xs text-gray-500">Matcheadas</p>
            </div>
            <div className="bg-white border border-amber-200 rounded-xl p-3 text-center">
              <p className="text-xl font-bold text-amber-600">{warningCount}</p>
              <p className="text-xs text-gray-500">Con advertencia</p>
            </div>
            <div className="bg-white border border-red-200 rounded-xl p-3 text-center">
              <p className="text-xl font-bold text-red-600">{errorCount}</p>
              <p className="text-xs text-gray-500">Con error</p>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto border border-[#D3D1C7] rounded-xl">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white border-b border-[#D3D1C7]">
                <tr>
                  <th className="text-center px-2 py-2 text-gray-500 font-medium">Cargar</th>
                  <th className="text-left px-2 py-2 text-gray-500 font-medium">OC</th>
                  <th className="text-left px-2 py-2 text-gray-500 font-medium">Tienda</th>
                  <th className="text-left px-2 py-2 text-gray-500 font-medium">Sucursal</th>
                  <th className="text-center px-2 py-2 text-gray-500 font-medium">Cant.</th>
                  <th className="text-center px-2 py-2 text-gray-500 font-medium">Fecha</th>
                  <th className="text-left px-2 py-2 text-gray-500 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const addr = deliveryHero?.addresses.find((a) => a.id === r.addrId)
                  return (
                    <tr key={idx} className="border-b border-[#ECEAE3] hover:bg-[#F8F7F2]">
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={r.included}
                          disabled={!r.addrId}
                          onChange={(e) => updateRow(idx, { included: e.target.checked })}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-gray-900 font-mono">{r.oc || '—'}</td>
                      <td className="px-2 py-1.5 text-gray-600 truncate max-w-[140px]">{r.tienda || '—'}</td>
                      <td className="px-2 py-1.5 text-gray-900 max-w-[200px]">
                        {addr
                          ? <span className="truncate block">{addr.nombre}</span>
                          : r.recoverable && deliveryHero && (
                            <select
                              value=""
                              onChange={(e) => handlePickAddr(idx, e.target.value)}
                              className="w-full bg-white border border-[#D3D1C7] rounded px-1 py-1 text-xs"
                            >
                              <option value="">— Elegir sucursal —</option>
                              {deliveryHero.addresses.map((a) => (
                                <option key={a.id} value={a.id}>{a.nombre}</option>
                              ))}
                            </select>
                          )}
                      </td>
                      <td className="px-2 py-1.5 text-center text-gray-900">{r.cantidad || '—'}</td>
                      <td className="px-2 py-1.5 text-center text-gray-600">
                        {r.matchError || !r.fechaEntrega ? (
                          r.fechaEntrega || '—'
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDatePickerRowIdx(idx)}
                            className="text-accent hover:underline"
                            title="Repetir esta fila en más días"
                          >
                            {r.fechaEntrega}
                            {r.diasAdicionales.length > 0 && ` +${r.diasAdicionales.length}`}
                          </button>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {r.matchError && (
                          <span className="text-red-600">{r.matchError}</span>
                        )}
                        {!r.matchError && r.dupOC && (
                          <span className="text-amber-600 block">⚠ OC ya cargada</span>
                        )}
                        {!r.matchError && r.dupSameDay && (
                          <span className="text-amber-600 block">⚠ Ya hay pedido esa fecha/sucursal</span>
                        )}
                        {!r.matchError && !r.dupOC && !r.dupSameDay && (
                          <span className="text-accent">✓ OK</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={handleClose} className="flex-1">Cancelar</Button>
            <Button onClick={handleImport} disabled={includedRows.length === 0} className="flex-1">
              Cargar {totalPedidosAImportar} pedido{totalPedidosAImportar === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      )}

      {datePickerRowIdx !== null && (() => {
        const row  = rows[datePickerRowIdx]
        const addr = deliveryHero?.addresses.find((a) => a.id === row.addrId)
        const existingForRow = addr
          ? new Set(
              existing
                .filter((o) => o.clientAddress.trim().toLowerCase() === addr.address.trim().toLowerCase())
                .map((o) => (o.date?.toDate ? o.date.toDate().toISOString().split('T')[0] : ''))
                .filter(Boolean),
            )
          : undefined
        const selected = new Set([row.fechaEntrega, ...row.diasAdicionales])
        return (
          <Modal open onClose={() => setDatePickerRowIdx(null)} title={`Días para OC ${row.oc || '—'}`} variant="light">
            <p className="text-sm text-gray-600 mb-3">
              Sumá días extra si esta tienda pide más seguido de lo que trae el Excel.
            </p>
            <MultiDatePicker
              selected={selected}
              onChange={(next) => {
                const idx = datePickerRowIdx
                updateRow(idx, { diasAdicionales: [...next].filter((d) => d !== row.fechaEntrega) })
              }}
              existingDates={existingForRow}
              minDate={row.fechaEntrega}
            />
            <Button onClick={() => setDatePickerRowIdx(null)} className="w-full mt-4">Listo</Button>
          </Modal>
        )
      })()}

      {step === 'importing' && (
        <div className="space-y-5 py-2">
          <p className="text-sm text-gray-500 text-center">Creando pedidos… no cierres esta ventana.</p>
          <div className="w-full bg-[#F1EFE8] rounded-full h-3 overflow-hidden border border-[#D3D1C7]">
            <div
              className="bg-accent h-full transition-all duration-200"
              style={{ width: `${total > 0 ? (progress / total) * 100 : 0}%` }}
            />
          </div>
          <p className="text-center text-sm text-gray-700">
            {progress} / {total}
            {' · '}
            <span className="text-accent">{created} ok</span>
            {errors.length > 0 && <span className="text-red-600"> · {errors.length} errores</span>}
          </p>
        </div>
      )}

      {step === 'done' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-accent">{created}</p>
              <p className="text-xs text-gray-500 mt-1">Pedidos creados</p>
            </div>
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-red-600">{errors.length}</p>
              <p className="text-xs text-gray-500 mt-1">Errores</p>
            </div>
          </div>

          {errors.length > 0 && (
            <div className="max-h-36 overflow-y-auto bg-white border border-red-200 rounded-xl p-3 space-y-1">
              {errors.map((e, i) => (
                <p key={i} className="text-xs text-red-600 font-mono">{e}</p>
              ))}
            </div>
          )}

          <Button onClick={handleClose} className="w-full">Cerrar</Button>
        </div>
      )}
    </Modal>
  )
}
