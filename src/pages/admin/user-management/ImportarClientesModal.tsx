import { useRef, useState } from 'react'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import { createClienteImportado } from '../../../services/userService'
import { ClientePreview, parseExcelFile } from './importarClientesExcel'

export function ImportarClientesModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const fileRef                         = useRef<HTMLInputElement>(null)
  const [step, setStep]                 = useState<'pick' | 'preview' | 'importing' | 'done'>('pick')
  const [clientes, setClientes]         = useState<ClientePreview[]>([])
  const [parseError, setParseError]     = useState('')
  const [progress, setProgress]         = useState(0)
  const [total, setTotal]               = useState(0)
  const [created, setCreated]           = useState(0)
  const [skipped, setSkipped]           = useState(0)
  const [errors, setErrors]             = useState<string[]>([])
  const abortRef                        = useRef(false)

  const handleFile = async (file: File) => {
    setParseError('')
    try {
      const parsed = await parseExcelFile(file)
      setClientes(parsed)
      setStep('preview')
    } catch {
      setParseError('No se pudo leer el archivo. Verificá que sea un Excel válido (.xlsx).')
    }
  }

  const handleImport = async () => {
    abortRef.current = false
    setStep('importing')
    setProgress(0)
    setTotal(clientes.length)
    setCreated(0)
    setSkipped(0)
    setErrors([])

    let ok = 0, skip = 0
    const errs: string[] = []

    for (let i = 0; i < clientes.length; i++) {
      if (abortRef.current) break
      const c = clientes[i]
      try {
        await createClienteImportado({
          email:         c.email,
          password:      c.cuitDigits,
          razonSocial:   c.razonSocial,
          cuit:          c.cuit,
          telefono:      c.telefono,
          notasContacto: c.notasContacto,
          emailContacto: c.emailContacto,
          codigoCliente: c.codigoCliente,
          fechaAlta:     c.fechaAlta,
          addresses:     c.addresses,
        })
        ok++
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code
        if (code === 'auth/email-already-in-use') {
          skip++
        } else {
          errs.push(`${c.razonSocial} (${c.cuit}): ${(err as Error).message ?? 'Error desconocido'}`)
        }
      }
      setProgress(i + 1)
      setCreated(ok)
      setSkipped(skip)
      setErrors([...errs])
    }

    setStep('done')
  }

  const synCount  = clientes.filter((c) => !c.emailContacto).length
  const branchCount = clientes.reduce((sum, c) => sum + c.sucursales, 0)

  return (
    <Modal open wide onClose={step === 'importing' ? () => {} : onClose} title="Importar clientes desde Excel">
      {step === 'pick' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Seleccioná el archivo Excel con la nómina de clientes. Se crearán cuentas agrupadas por CUIT.
          </p>
          {parseError && <p className="text-sm text-red-400">{parseError}</p>}
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
            }}
          />
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-[#D3D1C7] rounded-xl p-10 text-center cursor-pointer hover:border-accent transition-colors"
          >
            <p className="text-gray-500 text-sm">Hacé clic para seleccionar el archivo .xlsx</p>
          </div>
          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-accent">{clientes.length.toLocaleString('es-AR')}</p>
              <p className="text-xs text-gray-500 mt-1">Cuentas a crear</p>
            </div>
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-white">{branchCount.toLocaleString('es-AR')}</p>
              <p className="text-xs text-gray-500 mt-1">Sucursales totales</p>
            </div>
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-amber-400">{synCount.toLocaleString('es-AR')}</p>
              <p className="text-xs text-gray-500 mt-1">Sin email real</p>
            </div>
          </div>

          <div className="bg-white border border-[#D3D1C7] rounded-xl p-3 text-xs text-gray-500 space-y-1">
            <p>• Todos los clientes ingresan con <span className="text-gray-900">CUIT + contraseña</span> (CUIT sin guiones)</p>
            <p>• El email del Excel se guarda solo como dato de contacto</p>
            <p>• {synCount.toLocaleString('es-AR')} clientes sin email de contacto registrado</p>
            <p>• Las cuentas ya existentes se omiten automáticamente</p>
          </div>

          <div className="max-h-48 overflow-y-auto border border-[#D3D1C7] rounded-xl">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-[#D3D1C7]">
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Razón social</th>
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">CUIT</th>
                  <th className="text-center px-3 py-2 text-gray-500 font-medium">Suc.</th>
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Email contacto</th>
                </tr>
              </thead>
              <tbody>
                {clientes.slice(0, 200).map((c) => (
                  <tr key={c.cuit} className="border-b border-[#D3D1C7]/50 hover:bg-white/5">
                    <td className="px-3 py-1.5 text-white truncate max-w-[160px]">{c.razonSocial || '—'}</td>
                    <td className="px-3 py-1.5 text-white font-mono">{c.cuit}</td>
                    <td className="px-3 py-1.5 text-center text-white">{c.sucursales}</td>
                    <td className="px-3 py-1.5 font-mono truncate max-w-[160px]">
                      {c.emailContacto
                        ? <span className="text-gray-900">{c.emailContacto}</span>
                        : <span className="text-gray-500 italic">sin email</span>}
                    </td>
                  </tr>
                ))}
                {clientes.length > 200 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-2 text-center text-gray-500 italic">
                      … y {(clientes.length - 200).toLocaleString('es-AR')} más
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep('pick')} className="flex-1">Volver</Button>
            <Button onClick={handleImport} className="flex-1">
              Importar {clientes.length.toLocaleString('es-AR')} cuentas
            </Button>
          </div>
        </div>
      )}

      {step === 'importing' && (
        <div className="space-y-5 py-2">
          <p className="text-sm text-gray-500 text-center">
            Creando cuentas… no cierres esta ventana.
          </p>
          <div className="w-full bg-white rounded-full h-3 overflow-hidden border border-[#D3D1C7]">
            <div
              className="bg-accent h-full transition-all duration-200"
              style={{ width: `${total > 0 ? (progress / total) * 100 : 0}%` }}
            />
          </div>
          <p className="text-center text-sm text-white">
            {progress.toLocaleString('es-AR')} / {total.toLocaleString('es-AR')}
            {' · '}
            <span className="text-green-400">{created} ok</span>
            {skipped > 0 && <span className="text-amber-400"> · {skipped} existentes</span>}
            {errors.length > 0 && <span className="text-red-400"> · {errors.length} errores</span>}
          </p>
        </div>
      )}

      {step === 'done' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-green-400">{created.toLocaleString('es-AR')}</p>
              <p className="text-xs text-gray-500 mt-1">Creadas</p>
            </div>
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-amber-400">{skipped.toLocaleString('es-AR')}</p>
              <p className="text-xs text-gray-500 mt-1">Ya existían</p>
            </div>
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-red-400">{errors.length.toLocaleString('es-AR')}</p>
              <p className="text-xs text-gray-500 mt-1">Errores</p>
            </div>
          </div>

          {errors.length > 0 && (
            <div className="max-h-36 overflow-y-auto bg-white border border-red-900/40 rounded-xl p-3 space-y-1">
              {errors.map((e, i) => (
                <p key={i} className="text-xs text-red-400 font-mono">{e}</p>
              ))}
            </div>
          )}

          <Button onClick={onDone} className="w-full">Cerrar y actualizar lista</Button>
        </div>
      )}
    </Modal>
  )
}
