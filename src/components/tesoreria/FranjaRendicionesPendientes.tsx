import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { subscribeAvisoRendiciones, type AvisoRendiciones } from '@/services/tesoreriaConfigService'

// La franja del aviso de rendiciones pendientes (2026-09-23): lo que el server
// juntó a las 6, 13 o 18 (viajes sin liquidar, sobres sin contar, cajas de otro
// día sin cerrar). Va arriba de Mi turno, Sobres y Plata del día. Si no hay
// nada pendiente, no se ve. Nunca frena nada.
export default function FranjaRendicionesPendientes({ compacta = false, linkAbiertas = '/tesoreria/liquidaciones/abiertas' }: { compacta?: boolean; linkAbiertas?: string }) {
  const [aviso, setAviso] = useState<AvisoRendiciones | null>(null)
  useEffect(() => subscribeAvisoRendiciones(setAviso), [])
  if (!aviso || !aviso.total) return null
  const dm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`
  const hora = aviso.generadoEn?.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
  const partes: string[] = []
  if (aviso.viajes.length) partes.push(`${aviso.viajes.length} ${aviso.viajes.length === 1 ? 'viaje sin liquidar' : 'viajes sin liquidar'}${compacta ? '' : ` (${aviso.viajes.slice(0, 4).map((v) => `${v.nombre} ${dm(v.fecha)}`).join(', ')}${aviso.viajes.length > 4 ? '…' : ''})`}`)
  if (aviso.sobres.length) partes.push(`${aviso.sobres.length} ${aviso.sobres.length === 1 ? 'sobre sin contar' : 'sobres sin contar'}${compacta ? '' : ` (${aviso.sobres.slice(0, 4).map((s) => `${s.codigo} de ${s.nombre}`).join(', ')}${aviso.sobres.length > 4 ? '…' : ''})`}`)
  if (aviso.cajas.length) partes.push(`${aviso.cajas.length} ${aviso.cajas.length === 1 ? 'caja de otro día sin cerrar' : 'cajas de otro día sin cerrar'} (${aviso.cajas.map((c) => `${c.nombre} ${dm(c.fecha)}`).join(', ')})`)
  return (
    <p className="rounded-xl border border-[#F6D68B] bg-[#FEF3C7] px-4 py-2.5 text-sm text-[#8A5203] flex items-start gap-2">
      <AlertTriangle size={16} className="shrink-0 mt-0.5" />
      <span>
        <b>Rendiciones pendientes{hora ? ` · aviso de las ${hora}` : ''}:</b> {partes.join(' · ')}.{' '}
        <Link to={linkAbiertas} className="underline">Ver liquidaciones abiertas</Link>
      </span>
    </p>
  )
}
