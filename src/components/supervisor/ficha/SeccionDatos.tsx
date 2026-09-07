import { Plegable } from '@/components/ui/Plegable'
import { codigosTangoResumen, listaTangoResumen } from '@/pages/admin/user-management/listaTango'
import type { UserProfile } from '@/types'

function Fila({ label, valor }: { label: string; valor?: string | null }) {
  if (!valor) return null
  return (
    <div className="flex justify-between gap-3 py-1.5 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-500 shrink-0">{label}</span>
      <span className="text-sm text-gray-900 text-right break-words min-w-0">{valor}</span>
    </div>
  )
}

// Datos comerciales y fiscales del cliente, solo lectura (se editan desde
// Usuarios en el backoffice o en Tango).
export default function SeccionDatos({ c }: { c: UserProfile }) {
  const fiscal = [c.domicilioTango, c.localidadTango, c.provinciaTango].filter(Boolean).join(', ')
  return (
    <Plegable titulo="Datos" abiertoInicial>
      <Fila label="Razón social" valor={c.razonSocial} />
      <Fila label="Contacto" valor={c.nombreContacto} />
      <Fila label="CUIT" valor={c.cuit || (c.sinCuit ? 'Sin CUIT (solo promo)' : '')} />
      <Fila label="Condición IVA" valor={c.categoriaIvaTangoDesc ?? c.categoriaIvaTango} />
      <Fila label="Condición de venta" valor={c.condicionVenta} />
      <Fila label="Códigos Tango" valor={codigosTangoResumen(c) || 'Sin vínculo con Tango'} />
      <Fila label="Lista de precios" valor={listaTangoResumen(c)} />
      <Fila label="Domicilio fiscal" valor={fiscal} />
      <Fila label="Sector" valor={c.sector} />
      <Fila label="Vendedor" valor={c.codVendedor} />
      <Fila label="Visita" valor={c.esVisita ? (c.frecuenciaVisita ?? 'sí') : ''} />
      {c.notasContacto && (
        <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">Notas internas</p>
          <p className="text-sm text-amber-900 whitespace-pre-wrap">{c.notasContacto}</p>
        </div>
      )}
    </Plegable>
  )
}
