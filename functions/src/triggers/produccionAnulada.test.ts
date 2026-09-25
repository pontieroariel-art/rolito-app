import { describe, it, expect } from 'vitest'
import { accionAnulacionPallet, avisoPalletAnulado } from './produccionAnulada'

describe('accionAnulacionPallet', () => {
  it('lo que no salió se descarta de la cola', () => {
    expect(accionAnulacionPallet('pendiente')).toBe('descartar')
    expect(accionAnulacionPallet('error')).toBe('descartar')
  })
  it('lo que salió o está saliendo lo anula la oficina', () => {
    expect(accionAnulacionPallet('enviado')).toBe('avisarOficina')
    expect(accionAnulacionPallet('confirmado')).toBe('avisarOficina')
  })
  it('sin item o ya descartado, nada', () => {
    expect(accionAnulacionPallet(null)).toBe('nada')
    expect(accionAnulacionPallet('descartado')).toBe('nada')
  })
})

describe('avisoPalletAnulado', () => {
  it('dice qué pallet, qué comprobante y por qué', () => {
    const a = avisoPalletAnulado({ codigo: 'DT-000012', productoNombre: 'Bolsas 10kg Rolito', unidades: 88, anulacion: { motivo: 'era picado', por: { nombre: 'Osvaldo' } } }, ' 0000100122800')
    expect(a.titulo).toBe('Anular en Tango la producción del pallet DT-000012')
    expect(a.cuerpo).toContain('88 × Bolsas 10kg Rolito')
    expect(a.cuerpo).toContain('comprobante 0000100122800')
    expect(a.cuerpo).toContain('anuló Osvaldo: era picado')
  })
})
