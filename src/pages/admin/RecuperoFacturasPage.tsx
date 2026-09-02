// Recupero de las facturas impagas anteriores al cambio de sistema: los PDF
// con el formato viejo se perdieron al dejar Bluesoft, pero los datos siguen
// en Tango. Acá se cargan los PDF "en blanco" que emite Tango (datos sin
// diseño), se completa el CAE a mano y sale el comprobante con el formato de
// siempre. Ver docs/tango/INTEGRACION.md §10.
//
// Es una herramienta de una campaña puntual: cuando el recupero termine, esta
// pantalla y su ruta se pueden borrar.
import { useCallback, useRef, useState } from 'react'
import { Upload, FileText, AlertTriangle, Check, Trash2 } from 'lucide-react'
import { extractPdfItems } from '@/utils/parsePdf'
import { parsearFacturaTango, verificarFactura } from '@/utils/facturaTango'
import { generateFacturaPdf, FacturaPdfData } from '@/utils/facturaPdf'

interface Item {
  id:       string
  archivo:  string
  factura?: FacturaPdfData
  avisos:   string[]
  error?:   string
  cae:      string
  caeVto:   string      // YYYY-MM-DD
  generando?: boolean
}

const money = (n: number) =>
  n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const claveDe = (f: FacturaPdfData) =>
  `${String(f.puntoVenta).padStart(5, '0')}-${String(f.numero).padStart(8, '0')}`

const CLAVE_CAES = 'rolito-recupero-caes'

function caesGuardados(): Record<string, { cae: string; caeVto: string }> {
  try { return JSON.parse(localStorage.getItem(CLAVE_CAES) ?? '{}') } catch { return {} }
}

// Los CAE tipeados sobreviven a un refresh: son 100 y pico de números de 14
// dígitos copiados a mano, perderlos a mitad de camino duele.
function guardarCae(clave: string, cae: string, caeVto: string) {
  try {
    const todos = caesGuardados()
    todos[clave] = { cae, caeVto }
    localStorage.setItem(CLAVE_CAES, JSON.stringify(todos))
  } catch { /* modo privado: se sigue trabajando sin recordar */ }
}

const caeValido = (i: Item) => /^\d{14}$/.test(i.cae) && !!i.caeVto
const listo = (i: Item) => !!i.factura && caeValido(i)

export default function RecuperoFacturasPage() {
  const [items, setItems] = useState<Item[]>([])
  const [arrastrando, setArrastrando] = useState(false)
  const [generandoTodas, setGenerandoTodas] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const cargar = useCallback(async (archivos: FileList | File[] | null) => {
    if (!archivos) return
    const pdfs = [...archivos].filter(
      (a) => a.type === 'application/pdf' || a.name.toLowerCase().endsWith('.pdf'),
    )
    if (pdfs.length === 0) return

    const guardados = caesGuardados()
    const nuevos: Item[] = []

    for (const archivo of pdfs) {
      try {
        const factura = parsearFacturaTango(await extractPdfItems(archivo))
        const previo = guardados[claveDe(factura)]
        nuevos.push({
          id: claveDe(factura),
          archivo: archivo.name,
          factura,
          avisos: verificarFactura(factura),
          cae: previo?.cae ?? '',
          caeVto: previo?.caeVto ?? '',
        })
      } catch (err) {
        nuevos.push({
          id: `error-${archivo.name}-${nuevos.length}`,
          archivo: archivo.name,
          avisos: [],
          error: err instanceof Error ? err.message : String(err),
          cae: '', caeVto: '',
        })
      }
    }

    setItems((previos) => {
      // Si el mismo comprobante se carga dos veces, gana el último.
      const ids = new Set(nuevos.map((n) => n.id))
      return [...previos.filter((p) => !ids.has(p.id)), ...nuevos]
        .sort((a, b) => Number(!!a.error) - Number(!!b.error) || a.id.localeCompare(b.id))
    })
  }, [])

  const editar = (id: string, campo: 'cae' | 'caeVto', valor: string) => {
    setItems((previos) => previos.map((i) => {
      if (i.id !== id) return i
      const actualizado = { ...i, [campo]: campo === 'cae' ? valor.replace(/\D/g, '').slice(0, 14) : valor }
      if (caeValido(actualizado)) guardarCae(id, actualizado.cae, actualizado.caeVto)
      return actualizado
    }))
  }

  const generar = async (item: Item) => {
    if (!item.factura || !caeValido(item)) return
    setItems((p) => p.map((i) => (i.id === item.id ? { ...i, generando: true } : i)))
    try {
      await generateFacturaPdf({
        ...item.factura,
        cae: item.cae,
        caeVto: new Date(
          Number(item.caeVto.slice(0, 4)),
          Number(item.caeVto.slice(5, 7)) - 1,
          Number(item.caeVto.slice(8, 10)),
        ),
      })
    } finally {
      setItems((p) => p.map((i) => (i.id === item.id ? { ...i, generando: false } : i)))
    }
  }

  const generarTodas = async () => {
    setGenerandoTodas(true)
    try {
      for (const item of items.filter(listo)) await generar(item)
    } finally {
      setGenerandoTodas(false)
    }
  }

  const cantidadListas = items.filter(listo).length

  return (
    <div className="min-h-screen bg-[#F8F7F2] p-4 sm:p-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Recupero de facturas</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Convierte las facturas que salen de Tango sin diseño al formato de siempre.
            Cargá los PDF, completá el CAE de cada una y descargalas.
          </p>
          <p className="mt-2 text-xs text-gray-500">
            Los PDF no se suben a ningún lado: se leen y se generan en esta computadora.
          </p>
        </header>

        {/* Zona de carga */}
        <div
          onDragOver={(e) => { e.preventDefault(); setArrastrando(true) }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastrando(false); cargar(e.dataTransfer.files) }}
          className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed bg-white p-8 text-center transition-colors ${
            arrastrando ? 'border-[#1D9E75] bg-[#F0F8F5]' : 'border-[#D3D1C7]'
          }`}
        >
          <Upload className="h-7 w-7 text-gray-400" />
          <p className="text-sm text-gray-600">Arrastrá acá los PDF de las facturas, tal como los baja Tango</p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-lg bg-[#1D9E75] px-4 py-2 text-sm font-semibold text-white hover:bg-[#178760]"
          >
            Elegir archivos
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={(e) => { cargar(e.target.files); e.target.value = '' }}
          />
        </div>

        {/* Acciones */}
        {items.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold text-gray-800">
              {items.length} {items.length === 1 ? 'factura' : 'facturas'}
            </h2>
            <span className="text-sm text-gray-500">{cantidadListas} con CAE</span>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={() => setItems([])}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                <Trash2 className="h-4 w-4" /> Vaciar lista
              </button>
              <button
                type="button"
                disabled={cantidadListas === 0 || generandoTodas}
                onClick={generarTodas}
                className="rounded-lg border border-[#D3D1C7] bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:border-gray-400 disabled:opacity-40"
              >
                {generandoTodas ? 'Generando…' : `Generar ${cantidadListas > 1 ? `las ${cantidadListas}` : 'todas'}`}
              </button>
            </div>
          </div>
        )}

        {/* Lista */}
        <div className="mt-3 flex flex-col gap-2.5">
          {items.map((item) => {
            if (item.error) {
              return (
                <div key={item.id} className="rounded-xl border border-red-300 bg-red-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-red-800">
                    <AlertTriangle className="h-4 w-4" /> {item.archivo}
                  </div>
                  <p className="mt-1 text-sm text-red-700">{item.error}</p>
                </div>
              )
            }

            const f = item.factura!
            const ok = listo(item)

            return (
              <div
                key={item.id}
                className={`grid gap-5 rounded-xl border bg-white p-4 shadow-sm md:grid-cols-[minmax(0,1fr)_280px] ${
                  ok ? 'border-[#1D9E75]' : 'border-[#E4E2D9]'
                }`}
              >
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span className="font-mono text-[15px] font-semibold text-gray-900">{item.id}</span>
                    <span className="text-sm text-gray-500">
                      {f.fechaEmision.toLocaleDateString('es-AR')}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      ok ? 'bg-[#E8F4EF] text-[#146E51]' : 'bg-amber-50 text-amber-700'
                    }`}>
                      {ok ? 'Lista' : 'Falta el CAE'}
                    </span>
                  </div>

                  <div className="font-semibold text-gray-800">
                    {f.cliente.razonSocial}
                    <span className="ml-2 font-mono text-xs font-normal text-gray-500">{f.cliente.cuit}</span>
                  </div>

                  <div className="rounded-lg bg-[#F2F1EA] p-2.5 text-xs text-gray-600">
                    {f.renglones.map((r, n) => (
                      <div key={n} className="flex gap-3">
                        <span className="w-12 shrink-0 text-right font-mono tabular-nums text-gray-400">
                          {money(r.cantidad)}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{r.descripcion}</span>
                        <span className="font-mono tabular-nums text-gray-800">{money(r.importe)}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-4 text-xs text-gray-600">
                    <span>Neto <b className="font-mono tabular-nums text-gray-900">{money(f.totales.netoGravado)}</b></span>
                    <span>IVA {f.totales.ivaAlic}% <b className="font-mono tabular-nums text-gray-900">{money(f.totales.iva)}</b></span>
                    <span>Total <b className="font-mono text-sm tabular-nums text-gray-900">{money(f.totales.total)}</b></span>
                  </div>

                  {item.avisos.map((aviso, n) => (
                    <div key={n} className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {aviso}
                    </div>
                  ))}
                </div>

                <div className="flex flex-col gap-3 md:border-l md:border-[#E4E2D9] md:pl-5">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">CAE</span>
                    <input
                      value={item.cae}
                      onChange={(e) => editar(item.id, 'cae', e.target.value)}
                      inputMode="numeric"
                      maxLength={14}
                      placeholder="14 dígitos"
                      className="rounded-lg border border-[#D3D1C7] px-3 py-2 font-mono text-sm tracking-wide text-gray-900 focus:border-[#1D9E75] focus:outline-none focus:ring-1 focus:ring-[#1D9E75]"
                    />
                    <span className={`text-[11px] tabular-nums ${
                      item.cae.length > 0 && item.cae.length < 14 ? 'text-red-600' : 'text-gray-400'
                    }`}>
                      {item.cae.length}/14
                    </span>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                      Vencimiento del CAE
                    </span>
                    <input
                      type="date"
                      value={item.caeVto}
                      onChange={(e) => editar(item.id, 'caeVto', e.target.value)}
                      className="rounded-lg border border-[#D3D1C7] px-3 py-2 text-sm text-gray-900 focus:border-[#1D9E75] focus:outline-none focus:ring-1 focus:ring-[#1D9E75]"
                    />
                  </label>

                  <button
                    type="button"
                    disabled={!ok || item.generando}
                    onClick={() => generar(item)}
                    className="flex items-center justify-center gap-1.5 rounded-lg bg-[#1D9E75] px-4 py-2 text-sm font-semibold text-white hover:bg-[#178760] disabled:opacity-40"
                  >
                    {item.generando
                      ? 'Generando…'
                      : <><FileText className="h-4 w-4" /> Generar factura</>}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {items.length === 0 && (
          <p className="mt-8 text-center text-sm text-gray-400">
            Todavía no cargaste ninguna factura.
          </p>
        )}

        <footer className="mt-10 flex flex-col gap-1.5 border-t border-[#E4E2D9] pt-5 text-xs text-gray-500">
          <span>
            <b className="text-gray-700">El CAE se escribe tal cual figura en Tango</b>, sin espacios ni
            guiones: son 14 dígitos. Alimenta el código de barras y el QR del pie, así que un dígito
            cambiado invalida el comprobante.
          </span>
          <span className="flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5" />
            Son reimpresiones de comprobantes que ARCA ya autorizó: no se emite ni se solicita nada nuevo.
          </span>
        </footer>
      </div>
    </div>
  )
}
