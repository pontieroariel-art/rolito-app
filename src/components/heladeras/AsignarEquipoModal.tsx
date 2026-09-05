import { useState, useRef, useMemo } from 'react'
import { coincideBusqueda, normalizarBusqueda } from '@/utils/busqueda'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import SignaturePad, { SignaturePadHandle } from './SignaturePad'
import { useClientesActivos } from '../../hooks/useClientesActivos'
import { asignarHeladera, Actor } from '../../services/asignacionHeladeraService'
import { generateContratoComodato, generateOrdenEntrega } from '../../utils/pdf'
import { DeliveryAddress, Heladera, UserProfile, getPrimaryAddress } from '../../types'
import { tsToDate } from '../../utils/helpers'

// Entra por dos caminos: desde una heladera puntual (Equipos/Detalle, `heladera`
// ya viene fijo, se busca el cliente) o desde un cliente puntual (Asignación
// de equipos, `clienteFijo` ya viene fijo, se elige la heladera entre las
// `heladerasDisponibles`). Solo uno de los dos debe venir sin resolver.
export default function AsignarEquipoModal({
  heladera: heladeraFija,
  clienteFijo,
  heladerasDisponibles = [],
  actor,
  onClose,
}: {
  heladera?: Heladera
  clienteFijo?: UserProfile
  heladerasDisponibles?: Heladera[]
  actor:    Actor
  onClose:  () => void
}) {
  const { clientes } = useClientesActivos()
  const [busqueda,          setBusqueda]          = useState('')
  const [clienteElegido,    setClienteElegido]    = useState<UserProfile | null>(clienteFijo ?? null)
  const [heladeraElegida,   setHeladeraElegida]   = useState<Heladera | null>(heladeraFija ?? null)
  const [direccionElegida,  setDireccionElegida]  = useState<DeliveryAddress | null>(null)
  const [firmanteNombre,   setFirmanteNombre]     = useState('')
  const [firmanteCargo,    setFirmanteCargo]      = useState('')
  const [compresor,        setCompresor]          = useState('')
  const [saving,            setSaving]            = useState(false)
  const [error,             setError]             = useState('')
  const padRef = useRef<SignaturePadHandle>(null)

  // Clientes con una sola sucursal no piden elegir — se usa esa directo. Con
  // más de una (grupos empresarios: YPF, cadenas, etc.) hay que preguntar,
  // si no la heladera queda asignada al cliente sin saber a qué sucursal va.
  const direcciones = clienteElegido?.addresses ?? []
  const necesitaElegirDireccion = direcciones.length > 1 && !direccionElegida
  const direccionResuelta = direccionElegida ?? (direcciones.length === 1 ? direcciones[0] : null)

  const resultadosCliente = useMemo(() => {
    if (clienteFijo) return []
    if (!normalizarBusqueda(busqueda)) return []
    return clientes
      .filter((c) => coincideBusqueda(busqueda, c.razonSocial, c.nombreContacto, c.cuit, c.codigoCliente))
      .slice(0, 8)
  }, [clientes, busqueda, clienteFijo])

  const handleSubmit = async () => {
    if (!clienteElegido)  { setError('Elegí un cliente'); return }
    if (!heladeraElegida) { setError('Elegí una heladera'); return }
    if (necesitaElegirDireccion) { setError('Elegí a qué sucursal va'); return }
    if (!firmanteNombre.trim() || !firmanteCargo.trim()) { setError('Completá nombre y cargo de quién firma'); return }
    const firma = padRef.current?.toDataURL()
    if (!firma) { setError('Falta la firma del cliente'); return }
    setSaving(true)
    setError('')
    try {
      const firmante = { nombre: firmanteNombre.trim(), cargo: firmanteCargo.trim() }
      const asignacion = await asignarHeladera(
        heladeraElegida.id,
        { id: clienteElegido.uid, nombre: clienteElegido.razonSocial },
        actor,
        firma,
        direccionResuelta ? { id: direccionResuelta.id, address: direccionResuelta.address } : undefined,
        firmante,
        compresor.trim() || undefined,
      )
      const direccion = direccionResuelta?.address || getPrimaryAddress(clienteElegido)?.address || clienteElegido.address || ''
      await generateContratoComodato({
        numero:   asignacion.numero,
        fecha:    asignacion.fecha.toDate(),
        heladera: { modelo: heladeraElegida.modelo, numeroSerie: heladeraElegida.numeroSerie },
        cliente:  { razonSocial: clienteElegido.razonSocial, cuit: clienteElegido.cuit, direccion },
        firmante,
        firmaDataUrl: firma,
      })
      await generateOrdenEntrega({
        numero:   asignacion.numero,
        fecha:    asignacion.fecha.toDate(),
        heladera: {
          codigoInterno: heladeraElegida.codigoInterno, modelo: heladeraElegida.modelo,
          numeroSerie: heladeraElegida.numeroSerie, color: 'Blanco/Verde',
          fabricacion: tsToDate(heladeraElegida.fechaIngreso), compresor: compresor.trim() || null,
        },
        cliente: {
          razonSocial: clienteElegido.razonSocial, codigoCliente: clienteElegido.codigoCliente ?? '',
          cuit: clienteElegido.cuit, direccion,
          lat: direccionResuelta?.lat ?? clienteElegido.lat, lng: direccionResuelta?.lng ?? clienteElegido.lng,
        },
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo asignar. Intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={heladeraFija ? `Asignar ${heladeraFija.codigoInterno}` : 'Asignar heladera'} wide>
      <div className="space-y-4">

        {/* Heladera: fija o a elegir */}
        {!heladeraFija && (
          !heladeraElegida ? (
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Heladera disponible</label>
              {heladerasDisponibles.length === 0 ? (
                <p className="text-xs text-amber-600">No hay heladeras disponibles para asignar en este momento.</p>
              ) : (
                <div className="border border-[#D3D1C7] rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
                  {heladerasDisponibles.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => setHeladeraElegida(h)}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors"
                    >
                      <p className="text-sm font-medium text-gray-900">{h.codigoInterno}</p>
                      <p className="text-xs text-gray-500">{h.modelo} · serie {h.numeroSerie}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg p-3 flex justify-between items-center">
              <div>
                <p className="text-sm font-medium text-gray-900">{heladeraElegida.codigoInterno}</p>
                <p className="text-xs text-gray-500">{heladeraElegida.modelo} · serie {heladeraElegida.numeroSerie}</p>
              </div>
              <button type="button" onClick={() => setHeladeraElegida(null)} className="text-xs text-gray-500 hover:text-accent">
                Cambiar
              </button>
            </div>
          )
        )}

        {/* Cliente: fijo o a elegir */}
        {!clienteFijo && (
          !clienteElegido ? (
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Cliente</label>
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar por razón social, contacto o CUIT…"
                className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
              />
              {resultadosCliente.length > 0 && (
                <div className="border border-[#D3D1C7] rounded-lg mt-1.5 divide-y divide-gray-100 max-h-56 overflow-y-auto">
                  {resultadosCliente.map((c) => (
                    <button
                      key={c.uid}
                      type="button"
                      onClick={() => { setClienteElegido(c); setBusqueda('') }}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors"
                    >
                      <p className="text-sm font-medium text-gray-900">{c.razonSocial}</p>
                      <p className="text-xs text-gray-500">CUIT {c.cuit}{c.nombreContacto ? ` · ${c.nombreContacto}` : ''}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg p-3 flex justify-between items-center">
              <div>
                <p className="text-sm font-medium text-gray-900">{clienteElegido.razonSocial}</p>
                <p className="text-xs text-gray-500">CUIT {clienteElegido.cuit}</p>
              </div>
              <button
                type="button"
                onClick={() => { setClienteElegido(null); setDireccionElegida(null) }}
                className="text-xs text-gray-500 hover:text-accent"
              >
                Cambiar
              </button>
            </div>
          )
        )}

        {/* Sucursal: solo se pregunta si el cliente tiene más de una */}
        {clienteElegido && direcciones.length > 1 && (
          !direccionElegida ? (
            <div>
              <label className="text-xs text-gray-500 mb-1 block">¿A qué sucursal va?</label>
              <div className="border border-[#D3D1C7] rounded-lg divide-y divide-gray-100 max-h-56 overflow-y-auto">
                {direcciones.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setDireccionElegida(a)}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors"
                  >
                    <p className="text-sm font-medium text-gray-900">{a.nombre || a.id}</p>
                    <p className="text-xs text-gray-500">{a.address}</p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg p-3 flex justify-between items-center">
              <div>
                <p className="text-sm font-medium text-gray-900">{direccionElegida.nombre || direccionElegida.id}</p>
                <p className="text-xs text-gray-500">{direccionElegida.address}</p>
              </div>
              <button type="button" onClick={() => setDireccionElegida(null)} className="text-xs text-gray-500 hover:text-accent">
                Cambiar
              </button>
            </div>
          )
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Nombre de quien firma</label>
            <input
              value={firmanteNombre}
              onChange={(e) => setFirmanteNombre(e.target.value)}
              className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Cargo</label>
            <input
              value={firmanteCargo}
              onChange={(e) => setFirmanteCargo(e.target.value)}
              placeholder="Encargado, dueño, gerente…"
              className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">N° de compresor (opcional)</label>
          <input
            value={compresor}
            onChange={(e) => setCompresor(e.target.value)}
            className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">Firma del cliente</label>
          <SignaturePad ref={padRef} />
        </div>

        {error && <p className="text-red-500 text-xs">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button onClick={handleSubmit} loading={saving} className="flex-1">Asignar y firmar comodato</Button>
        </div>
      </div>
    </Modal>
  )
}
