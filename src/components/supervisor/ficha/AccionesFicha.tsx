import { useState } from 'react'
import { Link } from 'react-router-dom'
import { HandCoins, MapPin, MessageCircle, Phone, X } from 'lucide-react'
import { CLASE_MORA } from '@/components/supervisor/ChipMora'
import { direccionPrincipal, urlLlamar, urlMapa, urlWhatsApp } from '@/utils/contacto'
import { plantillasWhatsApp } from '@/utils/plantillasWhatsApp'
import { atrasoMaximo } from '@/utils/composicionSaldos'
import { formatoARS } from '@/utils/money'
import { nivelMora } from '@/utils/mora'
import { esDatoViejo, haceCuanto } from '@/utils/tiempo'
import { estaVinculadoATango } from '@/utils/tangoEmpresas'
import { useAlertasMora } from '@/hooks/useAlertasMora'
import type { SaldoEnVivo } from '@/hooks/useSaldoClienteEnVivo'
import type { UserProfile } from '@/types'

/**
 * BARRA DE ACCIONES DE LA FICHA (2026-09-13) — lo que el supervisor hace parado
 * en la puerta del cliente: cobrar, llamar, mandar un WhatsApp o pedir cómo llegar.
 *
 * Va FIJA ABAJO (decisión de Ariel probando la maqueta en el celular): arriba se
 * ve mejor pero es lo más lejos del pulgar, y estas cuatro cosas se tocan con el
 * teléfono en una mano. El estado de la deuda —atraso y qué tan viejo es el saldo
 * de Tango— queda arriba, porque es lo que hay que LEER antes de decidir.
 *
 * El saldo llega por prop: `useSaldoClienteEnVivo` dispara una consulta a Tango
 * por montaje, así que se llama UNA vez en la página y se reparte. Nunca llamarlo
 * de nuevo acá.
 */

export function EstadoDeuda({ saldoEnVivo }: { saldoEnVivo: SaldoEnVivo }) {
  const alertas = useAlertasMora()
  const { saldo, cargando } = saldoEnVivo
  if (cargando || !saldo || saldo.saldoTotal <= 0) return null
  const atraso = atrasoMaximo(saldo.comprobantes)
  const nivel = nivelMora(saldo.saldoTotal, atraso, alertas)
  const viejo = esDatoViejo(saldo.actualizadoEn)
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 border ${CLASE_MORA[nivel]}`}>
        {atraso > 0 ? `${atraso} ${atraso === 1 ? 'día' : 'días'} de atraso` : 'Al día'}
      </span>
      <span className={`text-xs truncate ${viejo ? 'text-amber-700 font-medium' : 'text-secundario'}`}>
        Saldo de Tango {haceCuanto(saldo.actualizadoEn) || 'en caché'}
      </span>
    </div>
  )
}

const BTN = 'flex-1 h-11 inline-flex items-center justify-center gap-1.5 rounded-lg border text-sm font-medium active:scale-[0.98] transition-transform'
const BTN_ON = `${BTN} border-accent text-accent bg-white`
const BTN_OFF = `${BTN} border-[#D3D1C7] text-inerte bg-gray-50 pointer-events-none`

export default function AccionesFicha({
  c, saldoEnVivo, supervisor,
}: {
  c: UserProfile
  saldoEnVivo: SaldoEnVivo
  supervisor: { nombre?: string } | null
}) {
  const [wa, setWa] = useState(false)
  const telefono = c.telefono || c.phone
  const llamar = urlLlamar(telefono)
  const destino = direccionPrincipal(c)
  const mapa = destino ? urlMapa(destino) : null
  const { saldo, cargando } = saldoEnVivo
  const total = saldo?.saldoTotal ?? 0
  const puedeCobrar = estaVinculadoATango(c) && total > 0

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-[#D3D1C7] pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-md mx-auto p-3 space-y-2">
          {cargando ? (
            <div className="h-11 rounded-lg border border-[#D3D1C7] bg-gray-50 flex items-center justify-center text-sm text-secundario">
              Cargando saldo…
            </div>
          ) : puedeCobrar ? (
            <Link to={`/supervisor/cobrar?cliente=${c.uid}`}
              className="w-full h-11 flex items-center justify-center gap-2 rounded-lg bg-accent text-white text-sm font-semibold active:scale-[0.99] transition-transform">
              <HandCoins size={16} /> Cobrar <span className="tabular-nums">{formatoARS(total)}</span>
            </Link>
          ) : (
            <p className="text-sm text-accent font-medium text-center py-2">
              {estaVinculadoATango(c) ? 'Sin deuda en Tango' : 'Cliente sin cuenta corriente en Tango'}
            </p>
          )}
          <div className="flex gap-2">
            <a href={llamar ?? undefined} className={llamar ? BTN_ON : BTN_OFF} aria-disabled={!llamar}>
              <Phone size={15} /> Llamar
            </a>
            <button type="button" onClick={() => setWa(true)} disabled={!telefono} className={telefono ? BTN_ON : BTN_OFF}>
              <MessageCircle size={15} /> WhatsApp
            </button>
            {/* Sin domicilio cargado no se ofrece: abriría un mapa vacío. */}
            {mapa && (
              <a href={mapa} target="_blank" rel="noopener noreferrer" className={BTN_ON}>
                <MapPin size={15} /> Cómo llegar
              </a>
            )}
          </div>
        </div>
      </div>

      {wa && <HojaWhatsApp c={c} telefono={telefono} supervisor={supervisor} onCerrar={() => setWa(false)} />}
    </>
  )
}

/** Mensajes prearmados: el supervisor elige y el chat se abre escrito. */
function HojaWhatsApp({
  c, telefono, supervisor, onCerrar,
}: {
  c: UserProfile; telefono: string | undefined; supervisor: { nombre?: string } | null; onCerrar: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onCerrar} role="presentation">
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative w-full max-w-md mx-auto bg-white rounded-t-2xl p-4 space-y-2 pb-[calc(1rem+env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Mensaje de WhatsApp">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-gray-900 truncate" title={c.razonSocial}>WhatsApp a {c.razonSocial}</p>
          <button type="button" onClick={onCerrar} aria-label="Cerrar"
            className="w-11 h-11 shrink-0 flex items-center justify-center text-secundario">
            <X size={20} />
          </button>
        </div>
        {plantillasWhatsApp(c, supervisor).map((p) => (
          <a key={p.id} href={urlWhatsApp(telefono, p.texto || undefined) ?? undefined}
            target="_blank" rel="noopener noreferrer" onClick={onCerrar}
            className="block rounded-xl border border-[#D3D1C7] px-3 py-3 active:bg-[#F8F7F2]">
            <p className="text-sm font-medium text-gray-900">{p.label}</p>
            {p.texto && <p className="text-xs text-secundario mt-0.5 line-clamp-2">{p.texto}</p>}
          </a>
        ))}
      </div>
    </div>
  )
}
