import { useEffect, useMemo, useState } from 'react'
import { FileSignature, Refrigerator, Wrench } from 'lucide-react'
import { Plegable } from '@/components/ui/Plegable'
import Modal from '@/components/ui/Modal'
import PedirServiceForm from '@/components/heladeras/PedirServiceForm'
import RenovarComodatoModal from '@/components/heladeras/RenovarComodatoModal'
import { useAuth } from '@/context/AuthContext'
import { subscribeHeladerasPorCliente } from '@/services/heladeraService'
import { tsToDate } from '@/utils/helpers'
import type { Heladera, UserProfile } from '@/types'

const DIAS_AVISO = 30

// Estado del comodato de una heladera para la calle: sin firmar, vencido, por
// vencer (30 días) o vigente. Los tres primeros habilitan "Firmar comodato".
export function estadoComodato(h: Pick<Heladera, 'comodatoFirmadoEl' | 'comodatoVenceEl'>, hoy = new Date()): { etiqueta: string; firmar: boolean; alerta: boolean } {
  if (!h.comodatoFirmadoEl) return { etiqueta: 'Comodato sin firmar', firmar: true, alerta: true }
  const vence = h.comodatoVenceEl ? tsToDate(h.comodatoVenceEl) : null
  if (!vence) return { etiqueta: 'Comodato firmado, sin vencimiento', firmar: false, alerta: false }
  const dias = Math.ceil((vence.getTime() - hoy.getTime()) / 86_400_000)
  const fecha = vence.toLocaleDateString('es-AR')
  if (dias < 0) return { etiqueta: `Comodato vencido el ${fecha}`, firmar: true, alerta: true }
  if (dias <= DIAS_AVISO) return { etiqueta: `Comodato vence el ${fecha} (${dias} ${dias === 1 ? 'día' : 'días'})`, firmar: true, alerta: true }
  return { etiqueta: `Comodato vigente hasta el ${fecha}`, firmar: false, alerta: false }
}

// Heladeras que el cliente tiene en comodato, con Pedir service (ticket al
// encargado, con foto) y Firmar comodato (renovación firmada en el celular).
export default function SeccionHeladeras({ c }: { c: UserProfile }) {
  const { user } = useAuth()
  const actor = useMemo(() => (user ? { uid: user.uid, nombre: user.nombre } : null), [user])
  const [heladeras, setHeladeras] = useState<Heladera[] | null>(null)
  const [service, setService] = useState<Heladera | null>(null)
  const [firmar, setFirmar] = useState<Heladera | null>(null)
  const [aviso, setAviso] = useState('')

  useEffect(() => subscribeHeladerasPorCliente(c.uid, setHeladeras), [c.uid])

  const ordenadas = useMemo(() => (heladeras ?? []).slice().sort((a, b) => a.codigoInterno.localeCompare(b.codigoInterno)), [heladeras])
  const conAlerta = ordenadas.filter((h) => estadoComodato(h).alerta).length

  const chip = heladeras === null ? null : ordenadas.length === 0
    ? <span className="text-xs text-gray-400">ninguna</span>
    : <span className={`text-xs font-semibold rounded-full px-2 py-0.5 border ${conAlerta ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-gray-600 bg-gray-50 border-[#D3D1C7]'}`}>{ordenadas.length}{conAlerta ? ` · ${conAlerta} a firmar` : ''}</span>

  return (
    <Plegable titulo="Heladeras" abiertoInicial extra={chip}>
      {heladeras === null ? (
        <p className="text-sm text-gray-500">Cargando heladeras…</p>
      ) : ordenadas.length === 0 ? (
        <p className="text-sm text-gray-500">Este cliente no tiene heladeras en comodato.</p>
      ) : (
        <div className="space-y-3">
          {aviso && <p className="text-xs text-accent bg-accent/10 border border-accent/30 rounded-lg px-3 py-2">{aviso}</p>}
          {ordenadas.map((h) => {
            const est = estadoComodato(h)
            return (
              <div key={h.id} className="rounded-xl border border-[#D3D1C7] p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <Refrigerator size={18} className="text-gray-400 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900">{h.codigoInterno} <span className="font-normal text-gray-500">· {h.modelo}</span></p>
                    {h.clienteAsignadoDireccion && <p className="text-xs text-gray-500 truncate">{h.clienteAsignadoDireccion}</p>}
                    <p className={`text-xs ${est.alerta ? 'text-amber-700 font-medium' : 'text-gray-500'}`}>
                      {est.etiqueta}{h.comodatoNumero ? ` · contrato Nº ${h.comodatoNumero}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setService(h)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-accent text-accent bg-white px-3 py-2 text-sm font-medium active:scale-[0.98]">
                    <Wrench size={15} /> Pedir service
                  </button>
                  {est.firmar && (
                    <button type="button" onClick={() => setFirmar(h)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent text-white px-3 py-2 text-sm font-medium active:scale-[0.98]">
                      <FileSignature size={15} /> Firmar comodato
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {service && actor && (
        <Modal open onClose={() => setService(null)} title="Pedir service" variant="light">
          <PedirServiceForm heladera={service} actor={actor} origen="supervisor"
            onCancel={() => setService(null)}
            onCreado={(t) => { setService(null); setAviso(`Pedido Nº ${t.numero} enviado al encargado de heladeras.`) }} />
        </Modal>
      )}
      {firmar && actor && (
        <RenovarComodatoModal heladera={firmar} actor={actor} compartir
          onClose={(renovado) => { setFirmar(null); if (renovado) setAviso(`Comodato de ${firmar.codigoInterno} firmado. El contrato se compartió con el cliente.`) }} />
      )}
    </Plegable>
  )
}
