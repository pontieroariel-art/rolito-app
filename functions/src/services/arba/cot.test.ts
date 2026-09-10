import { describe, expect, it } from 'vitest'
import { armarArchivoCot, campo, centesimos, codigoUnicoComprobante, fechaValidez, nombreArchivoCot, parsearRespuestaCot, type CotConfig, type CotSolicitud } from './cot'

const cfg: CotConfig = {
  habilitado: true, ambiente: 'produccion', cuit: '30-69766897-3', razonSocial: 'REDONHIELO S A',
  respaldo: { codigoComprobante: '091', prefijo: 25 }, transportista: { cuit: '30697668973' },
  plantas: {
    torcuato: { codigoPlanta: '001', puerta: '001', domicilio: { calle: 'RUTA PANAMERICANA KM 25.700', numero: 0, cp: '1611', localidad: 'DON TORCUATO', provincia: 'B' }, recorrido: { tipo: 'M', localidad: 'DON TORCUATO', ruta: 'PANAMERICANA' } },
    merlo:    { codigoPlanta: '002', puerta: '001', domicilio: { calle: 'PRESIDENTE PERON', numero: 26875, cp: '1722', localidad: 'MERLO', provincia: 'B' }, recorrido: { tipo: 'M', localidad: 'MERLO', ruta: 'RUTA 205' } },
  },
  productos: {
    bolsa_2kg:    { pesoKg: 2, codigoArba: '220190', descripcion: 'BOLSA ROLITO 2KG' },
    bolsa_3kg:    { pesoKg: 3, codigoArba: '220190', descripcion: 'BOLSA ROLITO 3KG' },
    bolsa_10kg:   { pesoKg: 10, codigoArba: '220190', descripcion: 'BOLSA ROLITO 10KG' },
    escamas_10kg: { pesoKg: 10, codigoArba: '220190', descripcion: 'BOLSA ESCAMA 10KG' },
  },
}
// El COT real 3163824478 del 10/12/2025 desde Merlo (ejemplo de Ariel).
const remito = {
  plantaId: 'merlo', fechaEmision: new Date(2025, 11, 10, 7, 24),
  items: [
    { productoId: 'bolsa_2kg', nombre: 'Hielo bolsa 2kg', cantidad: 1840 },
    { productoId: 'bolsa_3kg', nombre: 'Hielo bolsa 3kg', cantidad: 1260 },
    { productoId: 'bolsa_10kg', nombre: 'Hielo bolsa 10kg', cantidad: 140 },
    { productoId: 'escamas_10kg', nombre: 'Hielo en escamas 10kg', cantidad: 20 },
  ],
}
const sol: CotSolicitud = {
  destino: { tipo: 'cliente', clienteUid: 'u1', razonSocial: 'RAFITA S.A.', cuit: '30-71018593-6', consumidorFinal: true,
    domicilio: { calle: 'DEL CARMEN Y URUGUAY', numero: 1, cp: '7221', localidad: 'KILOMETRO 88 (APEADERO FCGB)', provincia: 'B' } },
  respaldo: { codigoComprobante: '091', prefijo: 25, numero: 58680, importe: 1_800_000 },
  patente: 'AG028YN',
  recorrido: { tipo: 'M', localidad: 'MERLO', ruta: 'RUTA 205' },
  fechaSalida: '2025-12-10', horaSalida: '07:30',
}

describe('archivo TXT del COT', () => {
  it('helpers: texto sin acentos ni pipes, centésimos, código único y nombre del archivo', () => {
    expect(campo(' Cañuelas | Güemes\n', 40)).toBe('CAÑUELAS GUEMES')
    expect(centesimos(3680)).toBe('368000')
    expect(centesimos(1_800_000)).toBe('180000000')
    expect(codigoUnicoComprobante('091', 25, 58680)).toBe('0910002500058680')
    expect(nombreArchivoCot('30-69766897-3', cfg.plantas.merlo, new Date(2025, 11, 10), 7)).toBe('TB_30697668973_002001_20251210_000007.txt')
  })

  it('arma el remito del ejemplo real: 9.060 kg, 4 productos, destinatario y respaldo', () => {
    const a = armarArchivoCot(remito, sol, cfg, 1)
    expect(a.kg).toBe(9060)
    expect(a.productos).toBe(4)
    expect(a.lineas[0]).toBe('01|30697668973')
    expect(a.lineas[a.lineas.length - 1]).toBe('04|1')
    expect(a.contenido.endsWith('\r\n')).toBe(true)
    expect(a.contenido.split('\r\n')).toHaveLength(8)   // 01 + 02 + 4×03 + 04 + vacío final
    const r = a.lineas[1].split('|')
    expect(r.slice(0, 12)).toEqual(['02', '20251210', '0910002500058680', '20251210', '0730', 'E', '1', '', '', '30710185936', 'RAFITA S.A.', '0'])
    // Destino: calle, número, comple, piso, dto, barrio, cp, localidad, provincia
    expect(r.slice(12, 21)).toEqual(['DEL CARMEN Y URUGUAY', '1', '', '', '', '', '7221', 'KILOMETRO 88 (APEADERO FCGB)', 'B'])
    expect(r.slice(21, 26)).toEqual(['', 'NO', '30697668973', 'REDONHIELO S A', '0'])
    // Origen: la planta de Merlo
    expect(r.slice(26, 35)).toEqual(['PRESIDENTE PERON', '26875', '', '', '', '', '1722', 'MERLO', 'B'])
    expect(r.slice(35)).toEqual(['30697668973', 'M', 'MERLO', '', 'RUTA 205', 'AG028YN', '', '0', '180000000'])
    expect(r).toHaveLength(44)
    expect(a.lineas[2]).toBe('03|220190|1|368000|BOLSA_2KG|BOLSA ROLITO 2KG|KILOGRAMOS|368000')
    expect(a.lineas[5]).toBe('03|220190|1|20000|ESCAMAS_10KG|BOLSA ESCAMA 10KG|KILOGRAMOS|20000')
  })

  it('traslado entre plantas: destinatario la propia empresa, domicilio de la otra planta, importe 0', () => {
    const a = armarArchivoCot({ ...remito, plantaId: 'torcuato' }, { ...sol, destino: { tipo: 'planta', plantaId: 'merlo' }, respaldo: { ...sol.respaldo, importe: 0 } }, cfg, 2)
    const r = a.lineas[1].split('|')
    expect(r.slice(6, 12)).toEqual(['0', '', '', '30697668973', 'REDONHIELO S A', '0'])
    expect(r.slice(12, 21)).toEqual(['PRESIDENTE PERON', '26875', '', '', '', '', '1722', 'MERLO', 'B'])
    expect(r.slice(26, 35)).toEqual(['RUTA PANAMERICANA KM 25.700', '0', 'S/N', '', '', '', '1611', 'DON TORCUATO', 'B'])
    expect(r[r.length - 1]).toBe('0')
    expect(a.nombre).toBe('TB_30697668973_001001_20251210_000002.txt')
  })

  it('falla claro si falta el peso de un producto o el CUIT', () => {
    expect(() => armarArchivoCot({ ...remito, items: [{ productoId: 'barra', nombre: 'Barra de hielo', cantidad: 5 }] }, sol, cfg, 1)).toThrow(/Falta el peso por unidad/)
    expect(() => armarArchivoCot(remito, sol, { ...cfg, cuit: '123' }, 1)).toThrow(/11 dígitos/)
  })
})

describe('respuesta del web service', () => {
  it('TBError (credenciales / formato) → error legible', () => {
    const r = parsearRespuestaCot(`<?xml version='1.0' encoding='ISO-8859-1'?><TBError><tipoError>DATO</tipoError><codigoError>45</codigoError><mensajeError>No hay registro 02= REMITO.</mensajeError></TBError>`)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('ARBA (DATO 45): No hay registro 02= REMITO.')
  })

  it('remito procesado con COT', () => {
    const r = parsearRespuestaCot(`<validacionesRemitos><cuitEmpresa>30697668973</cuitEmpresa><nombreArchivo>TB_x.txt</nombreArchivo><codigoIntegridad>abc</codigoIntegridad>
      <remito><numeroUnico>0910002500058680</numeroUnico><procesado>SI</procesado><cot>3163824478</cot></remito></validacionesRemitos>`)
    expect(r).toMatchObject({ ok: true, cot: '3163824478', numeroUnico: '0910002500058680', procesado: 'SI', codigoIntegridad: 'abc' })
  })

  it('remito rechazado con errores', () => {
    const r = parsearRespuestaCot(`<validacionesRemitos><remito><numeroUnico>0910002500058680</numeroUnico><procesado>NO</procesado>
      <errores><error><codigo>32</codigo><descripcion>El código de producto no existe</descripcion></error><error><codigo>40</codigo><descripcion>Patente inválida</descripcion></error></errores></remito></validacionesRemitos>`)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('(32) El código de producto no existe | (40) Patente inválida')
    expect(r.detalle).toHaveLength(2)
  })

  it('validez del COT: el día siguiente a la salida', () => {
    expect(fechaValidez('2025-12-10')).toBe('2025-12-11')
    expect(fechaValidez('2026-12-31')).toBe('2027-01-01')
  })
})
