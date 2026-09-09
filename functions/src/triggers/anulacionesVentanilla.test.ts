import { describe, expect, it } from 'vitest'
import { transicionAnulacion } from '../services/arca/anulacionVentanilla'
import { avisoSolicitud } from './anulacionesVentanilla'

describe('transicionAnulacion', () => {
  const t = (a: string | undefined, d: string | undefined) => transicionAnulacion(a ? { estado: a } : undefined, d ? { estado: d } : undefined)

  it('pendiente → aprobada emite; error → aprobada vuelve a intentar', () => {
    expect(t('pendiente', 'aprobada')).toBe('emitir')
    expect(t('error', 'aprobada')).toBe('emitir')
  })
  it('pendiente → rechazada rechaza; rechazada → pendiente vuelve a avisar', () => {
    expect(t('pendiente', 'rechazada')).toBe('rechazar')
    expect(t('rechazada', 'pendiente')).toBe('resolicitar')
  })
  it('las escrituras del propio server y los cambios sin estado no disparan nada', () => {
    expect(t('aprobada', 'emitida')).toBeNull()
    expect(t('aprobada', 'error')).toBeNull()
    expect(t('aprobada', 'aprobada')).toBeNull()
    expect(t('emitida', 'aprobada')).toBeNull()
    expect(t(undefined, 'aprobada')).toBeNull()
  })
})

describe('avisoSolicitud', () => {
  it('arma el aviso con cliente, total, motivo y quién pidió', () => {
    const { titulo, cuerpo } = avisoSolicitud(
      { ventaId: 'v1', estado: 'pendiente', motivo: 'Cliente equivocado', nota: 'era la sucursal 2', solicitadoPor: { uid: 'c1', nombre: 'Nico' } },
      { clienteNombre: 'ACME S.A.', total: 12300 },
    )
    expect(titulo).toBe('Anulación de factura por autorizar')
    expect(cuerpo).toContain('ACME S.A.'); expect(cuerpo).toContain('12.300,00'); expect(cuerpo).toContain('Cliente equivocado'); expect(cuerpo).toContain('era la sucursal 2'); expect(cuerpo).toContain('Nico')
  })
})
