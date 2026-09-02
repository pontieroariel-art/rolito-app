import { describe, it, expect } from 'vitest'
import {
  esCuitValido,
  redondear2,
  calcularImportes,
  validarReceptor,
  construirDetalle,
  percepcionVigente,
  validarVentanaEmision,
  formatearFechaArca,
  ALICUOTA_IVA,
  TIPO_COMPROBANTE,
  TRIBUTO,
} from './comprobante'

describe('esCuitValido', () => {
  it('acepta CUITs reales', () => {
    expect(esCuitValido('30697668973')).toBe(true)   // Redonhielo S.A.
    expect(esCuitValido('30-69766897-3')).toBe(true) // mismo, con guiones
    expect(esCuitValido('30631658810')).toBe(true)   // Axoft Arg. S.A.
  })

  it('rechaza dígito verificador incorrecto', () => {
    // Los dos casos reales que encontró la auditoría sobre la base de producción.
    expect(esCuitValido('20146203111')).toBe(false)
    expect(esCuitValido('23134014955')).toBe(false)
  })

  it('rechaza formatos imposibles', () => {
    expect(esCuitValido('')).toBe(false)
    expect(esCuitValido('123')).toBe(false)
    expect(esCuitValido('00000000000')).toBe(false)
    expect(esCuitValido('11111111111')).toBe(false)
    expect(esCuitValido('12345678901')).toBe(false)  // prefijo 12 no existe
    expect(esCuitValido(null)).toBe(false)
    expect(esCuitValido(undefined)).toBe(false)
  })
})

describe('redondear2 (half even, criterio de ARCA)', () => {
  it('redondea normal cuando no hay empate', () => {
    expect(redondear2(10.126)).toBe(10.13)
    expect(redondear2(10.124)).toBe(10.12)
  })

  it('en empate exacto va al par, no siempre para arriba', () => {
    // Los ejemplos que da el propio manual de ARCA.
    expect(redondear2(10.125)).toBe(10.12)   // el 2 ya es par
    expect(redondear2(10.135)).toBe(10.14)   // el 3 sube al par 4
  })

  it('no devuelve -0', () => {
    expect(Object.is(redondear2(-0.001), -0)).toBe(false)
  })
})

describe('calcularImportes', () => {
  const item = (cantidad: number, precioUnitario: number) => ({
    descripcion: 'Hielo bolsa 3kg',
    cantidad,
    precioUnitario,
  })

  it('con precios netos, suma el IVA encima', () => {
    const r = calcularImportes([item(10, 1000)], { preciosIncluyenIva: false })
    expect(r.ImpNeto).toBe(10000)
    expect(r.ImpIVA).toBe(2100)
    expect(r.ImpTotal).toBe(12100)
    expect(r.Iva).toEqual([{ Id: 5, BaseImp: 10000, Importe: 2100 }])
  })

  it('con precios finales, extrae el IVA de adentro', () => {
    const r = calcularImportes([item(10, 1210)], { preciosIncluyenIva: true })
    expect(r.ImpNeto).toBe(10000)
    expect(r.ImpIVA).toBe(2100)
    expect(r.ImpTotal).toBe(12100)
  })

  it('el total es siempre exactamente neto + IVA (lo que valida ARCA)', () => {
    // Precios feos a propósito, para que el redondeo tenga que trabajar.
    const r = calcularImportes(
      [item(3, 333.33), item(7, 1234.57), item(1, 0.01)],
      { preciosIncluyenIva: false },
    )
    expect(r.ImpTotal).toBe(Number((r.ImpNeto + r.ImpIVA).toFixed(2)))
  })

  it('agrupa por alícuota, no por ítem', () => {
    const r = calcularImportes(
      [
        { descripcion: 'Hielo', cantidad: 1, precioUnitario: 100 },
        { descripcion: 'Hielo picado', cantidad: 1, precioUnitario: 200 },
        { descripcion: 'Agua', cantidad: 1, precioUnitario: 100, alicuotaIva: ALICUOTA_IVA.DIEZ_CINCO },
      ],
      { preciosIncluyenIva: false },
    )
    expect(r.Iva).toHaveLength(2)
    expect(r.Iva.find((i) => i.Id === 5)).toEqual({ Id: 5, BaseImp: 300, Importe: 63 })
    expect(r.Iva.find((i) => i.Id === 4)).toEqual({ Id: 4, BaseImp: 100, Importe: 10.5 })
    expect(r.ImpTotal).toBe(473.5)
  })

  it('rechaza cantidades y precios inválidos en vez de facturar cualquier cosa', () => {
    expect(() => calcularImportes([item(0, 100)], { preciosIncluyenIva: false })).toThrow(/Cantidad/)
    expect(() => calcularImportes([item(-1, 100)], { preciosIncluyenIva: false })).toThrow(/Cantidad/)
    expect(() => calcularImportes([item(1, -5)], { preciosIncluyenIva: false })).toThrow(/Precio/)
    expect(() => calcularImportes([], { preciosIncluyenIva: false })).toThrow(/no tiene ítems/)
  })
})

describe('percepción de IIBB de CABA', () => {
  const item = { descripcion: 'Hielo bolsa 3kg', cantidad: 10, precioUnitario: 1000 }

  // Padrón de septiembre 2026, el mes de la venta de prueba.
  const percepcion = {
    alicuota: 3,
    tributoId: TRIBUTO.PERCEPCION_IIBB,
    descripcion: 'Percepción IIBB CABA',
    vigenciaDesde: new Date('2026-09-01T00:00:00-03:00'),
    vigenciaHasta: new Date('2026-09-30T00:00:00-03:00'),
  }

  it('sin percepción el comprobante no lleva tributos', () => {
    const r = calcularImportes([item], { preciosIncluyenIva: false })
    expect(r.Tributos).toEqual([])
    expect(r.ImpTrib).toBe(0)
    expect(r.ImpTotal).toBe(12100)
  })

  it('calcula la percepción sobre el NETO, no sobre el total', () => {
    const r = calcularImportes([item], { preciosIncluyenIva: false, percepcionIIBB: percepcion })

    expect(r.ImpNeto).toBe(10000)
    expect(r.ImpIVA).toBe(2100)
    // 3% de 10000 (neto), NO de 12100 (que daría 363)
    expect(r.ImpTrib).toBe(300)
    expect(r.Tributos).toEqual([
      { Id: TRIBUTO.PERCEPCION_IIBB, Desc: 'Percepción IIBB CABA', BaseImp: 10000, Alic: 3, Importe: 300 },
    ])
    expect(r.ImpTotal).toBe(12400)
  })

  it('ImpTrib es exactamente la suma de los tributos (validación 10029 de ARCA)', () => {
    const r = calcularImportes(
      [{ descripcion: 'x', cantidad: 7, precioUnitario: 1234.57 }],
      { preciosIncluyenIva: false, percepcionIIBB: { ...percepcion, alicuota: 0.75 } },
    )
    expect(r.ImpTrib).toBe(Number(r.Tributos.reduce((s, t) => s + t.Importe, 0).toFixed(2)))
    expect(r.ImpTotal).toBe(Number((r.ImpNeto + r.ImpIVA + r.ImpTrib).toFixed(2)))
  })

  it('alícuota 0 no genera tributo (cliente en el padrón pero sin percepción)', () => {
    const r = calcularImportes([item], {
      preciosIncluyenIva: false,
      percepcionIIBB: { ...percepcion, alicuota: 0 },
    })
    expect(r.Tributos).toEqual([])
    expect(r.ImpTrib).toBe(0)
  })

  it('funciona con alícuotas chicas del padrón real (0,01%)', () => {
    const r = calcularImportes([item], {
      preciosIncluyenIva: false,
      percepcionIIBB: { ...percepcion, alicuota: 0.01 },
    })
    expect(r.ImpTrib).toBe(1)   // 0,01% de 10000
  })

  // Sin código de tributo, ARCA no responde "falta el Id": devuelve un stack
  // trace de .NET sobre un XML que no pudo deserializar. Pasó en homologación
  // el 2026-09-02 y costó un rato entender qué reclamaba.
  it('exige el código de tributo antes de llegar a ARCA', () => {
    for (const tributoId of [undefined, null, 0, -1, 7.5, '7']) {
      expect(() => calcularImportes([item], {
        preciosIncluyenIva: false,
        percepcionIIBB: { ...percepcion, tributoId: tributoId as number },
      })).toThrow(/código de tributo/)
    }
  })
})

describe('percepcionVigente', () => {
  const p = {
    alicuota: 3,
    tributoId: TRIBUTO.PERCEPCION_IIBB,
    vigenciaDesde: new Date('2026-09-01T00:00:00-03:00'),
    vigenciaHasta: new Date('2026-09-30T00:00:00-03:00'),
  }

  it('acepta una venta dentro del mes del padrón', () => {
    expect(percepcionVigente(p, new Date('2026-09-15T12:00:00-03:00')).vigente).toBe(true)
  })

  it('acepta los bordes del período', () => {
    expect(percepcionVigente(p, new Date('2026-09-01T08:00:00-03:00')).vigente).toBe(true)
    expect(percepcionVigente(p, new Date('2026-09-30T23:00:00-03:00')).vigente).toBe(true)
  })

  it('rechaza un padrón vencido y dice qué hacer', () => {
    const r = percepcionVigente(p, new Date('2026-10-01T12:00:00-03:00'))
    expect(r.vigente).toBe(false)
    if (!r.vigente) expect(r.motivo).toMatch(/padrón de AGIP del mes en curso/)
  })

  it('rechaza un padrón todavía no vigente', () => {
    expect(percepcionVigente(p, new Date('2026-08-31T12:00:00-03:00')).vigente).toBe(false)
  })

  it('una venta de la noche del último día sigue siendo de ese día', () => {
    // 23:00 del 30/9 en Argentina son las 02:00 UTC del 1/10. Comparando en UTC
    // esta venta quedaba fuera de vigencia y se rechazaba mal.
    expect(percepcionVigente(p, new Date('2026-09-30T23:30:00-03:00')).vigente).toBe(true)
    // Y la del primer día tampoco puede adelantarse al mes anterior.
    expect(percepcionVigente(p, new Date('2026-09-01T00:30:00-03:00')).vigente).toBe(true)
  })
})

describe('validarReceptor', () => {
  const base = { razonSocial: 'ACME S.A.', cuit: '30697668973', categoriaIvaTango: 'RI' }

  it('un Responsable Inscripto completo se factura con A', () => {
    const r = validarReceptor(base)
    expect(r.facturable).toBe(true)
    if (r.facturable) {
      expect(r.claseComprobante).toBe('A')
      expect(r.condicion.arcaId).toBe(1)
    }
  })

  it('un consumidor final va con B', () => {
    const r = validarReceptor({ ...base, categoriaIvaTango: 'CF' })
    expect(r.facturable && r.claseComprobante).toBe('B')
  })

  it('bloquea al cliente sin condición de IVA', () => {
    const r = validarReceptor({ ...base, categoriaIvaTango: '' })
    expect(r.facturable).toBe(false)
    if (!r.facturable) expect(r.motivos).toContain('SIN_CONDICION_IVA')
  })

  it('bloquea CUIT ausente o inválido', () => {
    const sinCuit = validarReceptor({ ...base, cuit: '' })
    expect(!sinCuit.facturable && sinCuit.motivos).toContain('SIN_CUIT')

    const malo = validarReceptor({ ...base, cuit: '20146203111' })
    expect(!malo.facturable && malo.motivos).toContain('CUIT_INVALIDO')
  })

  it('bloquea la categoría de exportación, que no aplica a venta en calle', () => {
    const r = validarReceptor({ ...base, categoriaIvaTango: 'EXE' })
    expect(!r.facturable && r.motivos).toContain('CONDICION_IVA_NO_APLICA')
  })

  it('acumula todos los motivos, no solo el primero', () => {
    const r = validarReceptor({ razonSocial: '', cuit: '', categoriaIvaTango: '' })
    expect(!r.facturable && r.motivos).toEqual(
      expect.arrayContaining(['SIN_CONDICION_IVA', 'SIN_CUIT', 'SIN_RAZON_SOCIAL']),
    )
  })
})

describe('validarVentanaEmision', () => {
  it('acepta emitir el mismo día', () => {
    const d = new Date('2026-09-10T12:00:00-03:00')
    expect(validarVentanaEmision(d, d).valida).toBe(true)
  })

  it('acepta hasta 5 días de desfase', () => {
    const venta   = new Date('2026-09-10T12:00:00-03:00')
    const emision = new Date('2026-09-15T12:00:00-03:00')
    expect(validarVentanaEmision(venta, emision).valida).toBe(true)
  })

  it('rechaza más de 5 días', () => {
    const venta   = new Date('2026-09-10T12:00:00-03:00')
    const emision = new Date('2026-09-16T12:00:00-03:00')
    const r = validarVentanaEmision(venta, emision)
    expect(r.valida).toBe(false)
    if (!r.valida) expect(r.motivo).toMatch(/6 días/)
  })

  it('rechaza cruzar el cierre de mes aunque entre en los 5 días', () => {
    const venta   = new Date('2026-09-29T12:00:00-03:00')
    const emision = new Date('2026-10-01T12:00:00-03:00')
    const r = validarVentanaEmision(venta, emision)
    expect(r.valida).toBe(false)
    if (!r.valida) expect(r.motivo).toMatch(/mes de presentación/)
  })

  it('usa el calendario argentino, no el del servidor (que corre en UTC)', () => {
    // Venta 23:30 del 30/9 AR = 02:30 UTC del 1/10. Emitida a la mañana
    // siguiente, sigue siendo del mismo mes: no debe rechazarse por cierre.
    const venta   = new Date('2026-09-30T23:30:00-03:00')
    const emision = new Date('2026-09-30T23:50:00-03:00')
    expect(validarVentanaEmision(venta, emision).valida).toBe(true)
  })
})

describe('construirDetalle', () => {
  const datos = {
    receptor: { razonSocial: 'ACME S.A.', cuit: '30-69766897-3', categoriaIvaTango: 'RI' },
    items: [{ descripcion: 'Hielo bolsa 3kg', cantidad: 10, precioUnitario: 1000 }],
    fechaVenta: new Date('2026-09-10T15:30:00-03:00'),
    numeroComprobante: 42,
  }

  it('arma un detalle completo y coherente para factura A', () => {
    const { detalle, cbteTipo } = construirDetalle(datos, { preciosIncluyenIva: false })

    expect(cbteTipo).toBe(TIPO_COMPROBANTE.FACTURA_A)
    expect(detalle.DocTipo).toBe(80)
    expect(detalle.DocNro).toBe(30697668973)     // el CUIT viaja sin guiones, como número
    expect(detalle.CondicionIVAReceptorId).toBe(1)
    expect(detalle.CbteDesde).toBe(42)
    expect(detalle.CbteHasta).toBe(42)
    expect(detalle.CbteFch).toBe('20260910')
    expect(detalle.MonId).toBe('PES')
    expect(detalle.MonCotiz).toBe(1)
    expect(detalle.ImpTotal).toBe(12100)
    expect(detalle.ImpNeto + detalle.ImpIVA).toBe(detalle.ImpTotal)
  })

  it('se niega a armar el comprobante si el cliente no está en condiciones', () => {
    expect(() =>
      construirDetalle(
        { ...datos, receptor: { ...datos.receptor, categoriaIvaTango: '' } },
        { preciosIncluyenIva: false },
      ),
    ).toThrow(/no facturable/)
  })

  it('incluye la percepción de IIBB en el detalle', () => {
    const { detalle } = construirDetalle(datos, {
      preciosIncluyenIva: false,
      percepcionIIBB: {
        alicuota: 3,
        tributoId: TRIBUTO.PERCEPCION_IIBB,
        vigenciaDesde: new Date('2026-09-01T00:00:00-03:00'),
        vigenciaHasta: new Date('2026-09-30T00:00:00-03:00'),
      },
    })
    expect(detalle.ImpTrib).toBe(300)
    expect(detalle.Tributos).toHaveLength(1)
    expect(detalle.ImpTotal).toBe(12400)
  })

  it('se niega a facturar con un padrón de IIBB vencido', () => {
    // La venta es del 10/9 y la alícuota es del padrón de agosto: usarla
    // facturaría mal sin que nada falle. Mejor frenar.
    expect(() =>
      construirDetalle(datos, {
        preciosIncluyenIva: false,
        percepcionIIBB: {
          alicuota: 3,
          tributoId: TRIBUTO.PERCEPCION_IIBB,
          vigenciaDesde: new Date('2026-08-01T00:00:00-03:00'),
          vigenciaHasta: new Date('2026-08-31T00:00:00-03:00'),
        },
      }),
    ).toThrow(/padrón de AGIP del mes en curso/)
  })
})

describe('formatearFechaArca', () => {
  it('usa la fecha de Argentina, no UTC', () => {
    // 21:30 en Argentina del 10/9 es 00:30 UTC del 11/9. El comprobante es del 10.
    expect(formatearFechaArca(new Date('2026-09-10T21:30:00-03:00'))).toBe('20260910')
  })
})
