import { BookOpen, Download, ExternalLink } from 'lucide-react'
import PageHeader from '@/components/common/PageHeader'

// Manuales de caja, de tesorería y de producción (2026-09-24 / 26, pedido de Ariel: "una pestaña
// en cada panel, un manual para cada uno"). El contenido vive en
// public/manuales/{caja,tesoreria}.html (con sus capturas en img/) y el mismo
// texto en PDF al lado. Acá solo se muestra adentro de la app; el PDF se
// descarga con un clic explícito (nada se baja solo).
const MANUALES = {
  caja:      { titulo: 'Manual de caja',      bajada: 'Tu turno, la liquidación de choferes y cobradores, y cómo cerrás y entregás tu Liquidación de caja.' },
  tesoreria: { titulo: 'Manual de tesorería', bajada: 'Dónde está la plata hoy, cómo recibís las liquidaciones en mano y cómo las contás y validás.' },
  produccion: { titulo: 'Manual de producción', bajada: 'Preparar las tablets, cargar pallets, el parte de máquinas y el panel del encargado.' },
  muelle:    { titulo: 'Manual del muelle',   bajada: 'Entregar los camiones, llamar la ventanilla y contar la vuelta: sana, rota, merma y diferencia del chofer.' },
} as const

export default function ManualPage({ manual }: { manual: keyof typeof MANUALES }) {
  const m = MANUALES[manual]
  const html = `/manuales/${manual}.html`
  const pdf = `/manuales/${manual}.pdf`
  const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-[#D3D1C7] bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:border-accent hover:text-accent'
  return (
    <main className="max-w-5xl mx-auto p-4 space-y-4 pb-10">
      <PageHeader
        titulo={m.titulo}
        icono={<BookOpen size={22} />}
        contexto={m.bajada}
        acciones={<>
          <a href={pdf} download className={btn}><Download size={15} /> Descargar PDF</a>
          <a href={html} target="_blank" rel="noreferrer" className={btn}><ExternalLink size={15} /> Abrir en otra pestaña</a>
        </>}
      />
      <div className="rounded-2xl border border-[#D3D1C7] bg-white overflow-hidden">
        <iframe title={m.titulo} src={html} className="w-full border-0" style={{ height: 'calc(100vh - 190px)', minHeight: 600 }} />
      </div>
    </main>
  )
}
