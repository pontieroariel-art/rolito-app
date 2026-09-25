import { useEffect, useState } from 'react'
import { BloqueRenglones, CeldasRH, EfectivoCheques, Renglon } from '@/components/tesoreria/plata'
import { detalleDelActa } from '@/services/actaSobreService'
import { reportError } from '@/services/observability'
import { cajonPorEmpresa, seccionesDelActa, type FilaActa, type SeccionActa } from '@/utils/actaComoPantalla'
import { sumaImportes } from '@/utils/medios'
import type { Sobre } from '@/types'

// La liquidación de caja tal cual la vio el cajero, para tesorería (2026-09-24,
// pedido de Ariel: "tendrías que mostrar la misma liquidación que ve caja").
// Mismas tarjetas, mismos bloques y columnas que Liquidación de caja, en
// modo lectura. Los renglones salen del mismo armado que el acta
// (utils/actaComoPantalla.ts), así pantalla, PDF y recepción no divergen.

interface Props { sobre: Sobre; anticipos: Sobre[] }

const partir = (f: FilaActa): { clave: string; texto: string } => {
  const i = f.texto.indexOf('  ')
  return i > 0 ? { clave: f.texto.slice(0, i), texto: f.texto.slice(i + 2) } : { clave: '', texto: f.texto }
}

export default function LiquidacionComoCaja({ sobre, anticipos }: Props) {
  const [secciones, setSecciones] = useState<SeccionActa[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let vivo = true
    setSecciones(null); setError(false)
    detalleDelActa(sobre)
      .then((d) => { if (vivo) setSecciones(seccionesDelActa({ sobre, ventas: d.ventas ?? [], cobranzas: d.cobranzas ?? [], liquidaciones: d.liquidaciones ?? [], anticipos: d.anticipos?.length ? d.anticipos : anticipos })) })
      .catch((err) => { reportError(err, { origen: 'LiquidacionComoCaja', accion: 'detalle de la liquidación' }); if (vivo) setError(true) })
    return () => { vivo = false }
  }, [sobre, anticipos])

  const cajon = cajonPorEmpresa(sobre)
  const cheques = sumaImportes(sobre.sistema.cheques)

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-[#D3D1C7] bg-white p-3 space-y-2">
        <h3 className="text-center text-base font-bold text-gray-900 pb-2 border-b-2 border-[#B8B5A8]">Liquidación de {sobre.firmanteRinde}</h3>
        <EfectivoCheques efectivo={sobre.sistema.efectivo} cheques={cheques} />
        {cajon && (
          <CeldasRH
            redonhielo={cajon.redonhielo.efectivo} rolito={cajon.rolito.efectivo}
            cheques={{ redonhielo: { total: cajon.redonhielo.cheques, cantidad: cajon.redonhielo.nCheques }, rolito: { total: cajon.rolito.cheques, cantidad: cajon.rolito.nCheques } }}
          />
        )}
      </section>

      {error && <p className="text-sm text-red-700">No se pudo leer el detalle de la liquidación. Igual podés contarla con los totales de arriba.</p>}
      {!secciones && !error && <p className="text-sm text-secundario">Cargando el detalle de la liquidación…</p>}
      {secciones?.map((sec) => (
        <div key={sec.titulo} className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-secundario pt-1">{sec.titulo}</h3>
          {sec.bloques.map((b) => (
            <BloqueRenglones key={b.titulo} titulo={b.titulo} cantidad={b.cantidad} total={b.total} redonhielo={b.redonhielo} rolito={b.rolito} resta={b.resta} vacio={b.vacio}>
              {b.filas.map((f, i) => {
                const { clave, texto } = partir(f)
                return f.total != null
                  ? <Renglon key={i} clave={clave} texto={texto} importe={f.total} importePorEmpresa={{ redonhielo: f.redonhielo ?? 0, rolito: f.rolito ?? 0 }} tachado={f.tachado} />
                  : <Renglon key={i} clave={clave} texto={texto} empresa={f.redonhielo != null ? 'redonhielo' : 'rolito'} importe={(f.redonhielo ?? f.rolito) ?? 0} tachado={f.tachado} />
              })}
            </BloqueRenglones>
          ))}
        </div>
      ))}
    </div>
  )
}
