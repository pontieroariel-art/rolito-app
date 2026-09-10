// Lógica PURA del lector de comprobantes de Tango (bridge-sync-comprobantes.mjs):
// de las filas de SQL Server (GVA12/GVA53 facturas, STA14/STA20 remitos, GVA54
// relación factura ↔ remito, GVA43 talonarios, GVA01/GVA23/GVA14 referencias)
// a los documentos que lee la app:
//
//   tangoComprobantes/{empresa}_{codigo}      índice por código de cliente: facturas y
//                                             remitos de los últimos meses, livianos
//   tangoComprobanteDetalle/{empresa}_{tipo}_{numero}  todo lo que hace falta para
//                                             regenerar el PDF (renglones, CAE, cliente)
//
// Sin Firebase ni mssql acá: se testea con vitest (comprobantes-tango.test.mjs).

export const MESES_HISTORIAL = 13   // el índice guarda 13 meses; la app muestra 12

/** 'A0010100282787' → { letra: 'A', puntoVenta: 101, nro: 282787 }; null si no tiene ese formato. */
export function parsearNumeroTango(n) {
  const m = /^([A-Z])(\d{5})(\d{8})$/.exec(String(n ?? '').trim().toUpperCase())
  return m ? { letra: m[1], puntoVenta: Number(m[2]), nro: Number(m[3]) } : null
}

/** T_COMP de Tango → tipo corto de la app ('N/C' → 'NC'). */
export const tipoCorto = (tComp) => String(tComp ?? '').replace('/', '').trim().toUpperCase()

export const claveFactura = (tipo, numero) => `${tipoCorto(tipo)}_${String(numero).trim().toUpperCase()}`

// Código de tipo de comprobante de ARCA según letra y tipo (para el QR).
const CBTE_TIPO = {
  FAC: { A: 1, B: 6, C: 11 },
  ND:  { A: 2, B: 7, C: 12 },
  NC:  { A: 3, B: 8, C: 13 },
}
export const cbteTipoDe = (tipo, letra) => CBTE_TIPO[tipoCorto(tipo)]?.[letra] ?? null

export const CATEGORIAS_IVA = {
  RI: 'IVA Responsable Inscripto',
  CF: 'Consumidor Final',
  EX: 'IVA Exento',
  MT: 'Responsable Monotributo',
  NR: 'IVA no Responsable',
  NC: 'IVA no Categorizado',
}

export const iso = (d) => {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const num = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0 }
const txt = (v) => String(v ?? '').trim()
const fechaValida = (d) => d instanceof Date && d.getFullYear() > 1900

/** Huella corta y estable de un objeto (djb2 sobre el JSON con claves ordenadas). */
export function huella(obj) {
  const s = JSON.stringify(obj, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v)
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/** Datos del cliente para imprimir, con lo que GVA14 tenga (las columnas se prueban al leer). */
export function clienteDe(fila, catIva, condVenta, vendedor) {
  return {
    codigo:         txt(fila?.COD_GVA14),
    razonSocial:    txt(fila?.RAZON_SOCI),
    cuit:           txt(fila?.CUIT),
    domicilio:      txt(fila?.DOMICILIO),
    localidad:      txt(fila?.LOCALIDAD),
    cp:             txt(fila?.C_POSTAL),
    provincia:      txt(fila?.COD_PROVIN),
    condicionIva:   CATEGORIAS_IVA[txt(catIva)] ?? txt(catIva),
    condicionVenta: txt(condVenta),
    vendedor:       txt(vendedor),
  }
}

/**
 * Facturas / NC / ND: filas de GVA12, renglones de GVA53 (con DESCRIPCIO de STA11)
 * y relación GVA54 ya resuelta a { 'FAC_A…': ['R…', …] }.
 * Devuelve { resumen: { codigo: { clave: resumen } }, detalles: [ { id, doc } ] }.
 */
export function mapearFacturas({ empresa, facturas, renglones, remitosPorFactura, clientes, condiciones, vendedores }) {
  const renglonesPor = new Map()
  for (const r of renglones) {
    const k = claveFactura(r.T_COMP, r.N_COMP)
    if (!renglonesPor.has(k)) renglonesPor.set(k, [])
    renglonesPor.get(k).push(r)
  }
  const resumen = {}
  const detalles = []
  for (const f of facturas) {
    const tipo = tipoCorto(f.T_COMP)
    const numero = txt(f.N_COMP).toUpperCase()
    const clave = claveFactura(tipo, numero)
    const codigo = txt(f.COD_CLIENT)
    if (!codigo || !numero) continue
    const p = parsearNumeroTango(numero)
    const remitos = remitosPorFactura[clave] ?? []
    const fecha = iso(f.FECHA_EMIS)
    const total = num(f.IMPORTE)
    const gravado = num(f.IMPORTE_GR), exento = num(f.IMPORTE_EX), iva = num(f.IMPORTE_IV), internos = num(f.IMPORTE_IN)
    const otros = Math.max(0, num(total - gravado - exento - iva - internos))
    const rens = (renglonesPor.get(clave) ?? [])
      .sort((a, b) => Number(a.N_RENGL_V) - Number(b.N_RENGL_V))
      .map((r) => ({
        codigo:         txt(r.COD_ARTICU),
        descripcion:    txt(r.DESCRIPCIO) || txt(r.COD_ARTICU),
        cantidad:       num(r.CANTIDAD),
        precioUnitario: num(r.PRECIO_NET),
        dtoPct:         num(r.PORC_DTO),
        ivaPct:         num(r.PORC_IVA),
        importe:        num(r.IMP_NETO_P),
      }))
    const ivaAlic = rens.find((r) => r.ivaPct > 0)?.ivaPct ?? (gravado > 0 ? num((iva / gravado) * 100) : 0)
    const cliente = clienteDe(clientes[codigo], f.CAT_IVA, condiciones[String(f.COND_VTA)], vendedores[txt(f.COD_VENDED)] ?? txt(f.COD_VENDED))
    const cae = txt(f.CAICAE)
    const detalle = {
      empresa, tipo, numero, codigo, fecha,
      letra:      p?.letra ?? numero.charAt(0),
      puntoVenta: p?.puntoVenta ?? 0,
      nro:        p?.nro ?? 0,
      cbteTipo:   p ? cbteTipoDe(tipo, p.letra) : null,
      estado:     txt(f.ESTADO),
      ...(fechaValida(f.FECHA_ANU) ? { fechaAnulacion: iso(f.FECHA_ANU) } : {}),
      cliente,
      renglones:  rens,
      totales:    { gravado, exento, iva, ivaAlic, internos, otros, total },
      cae,
      caeVto:     cae ? iso(f.CAICAE_VTO) : '',
      remitos,
    }
    const h = huella(detalle)
    if (!resumen[codigo]) resumen[codigo] = {}
    resumen[codigo][clave] = {
      tipo, numero, fecha, importe: total, estado: detalle.estado,
      ...(typeof f.ID_GVA12 === 'number' ? { idGva12: f.ID_GVA12 } : {}),
      ...(remitos.length ? { remitos } : {}),
      h,
    }
    detalles.push({ id: `${empresa}_${tipo}_${numero}`, doc: detalle, h })
  }
  return { resumen, detalles }
}

/**
 * Remitos: filas de STA14, renglones de STA20 (con DESCRIPCIO) y la relación inversa
 * { 'R…': ['A…', …] } (números de factura). Talonarios: { TALONARIO: { CAI, FECHA_VTO } }.
 */
export function mapearRemitos({ empresa, remitos, renglones, facturasPorRemito, talonarios, clientes, condiciones }) {
  const renglonesPor = new Map()
  for (const r of renglones) {
    const k = Number(r.ID_STA14)
    if (!renglonesPor.has(k)) renglonesPor.set(k, [])
    renglonesPor.get(k).push(r)
  }
  const resumen = {}
  const detalles = []
  for (const s of remitos) {
    const numero = txt(s.N_COMP).toUpperCase()
    const codigo = txt(s.COD_PRO_CL)
    if (!codigo || !numero) continue
    const rens = (renglonesPor.get(Number(s.ID_STA14)) ?? [])
      .sort((a, b) => Number(a.N_RENGL_S) - Number(b.N_RENGL_S))
      .map((r) => ({ codigo: txt(r.COD_ARTICU), descripcion: txt(r.DESCRIPCIO) || txt(r.COD_ARTICU), cantidad: num(r.CANTIDAD) }))
    const bultos = num(rens.reduce((acc, r) => acc + r.cantidad, 0))
    const tal = talonarios[String(Number(s.TALONARIO))]
    const facturas = facturasPorRemito[numero] ?? []
    const estado = txt(s.ESTADO_MOV)
    const fecha = iso(s.FECHA_MOV)
    const detalle = {
      empresa, tipo: 'REM', numero, codigo, fecha, estado,
      ...(fechaValida(s.FECHA_ANU) ? { fechaAnulacion: iso(s.FECHA_ANU) } : {}),
      cliente:   clienteDe(clientes[codigo], clientes[codigo]?.CAT_IVA ?? clientes[codigo]?.IVA, condiciones[String(s.COND_VTA)] ?? '', ''),
      renglones: rens,
      bultos,
      talonario: {
        numero: Number(s.TALONARIO) || 0,
        ...(tal?.CAI ? { cai: txt(tal.CAI) } : {}),
        ...(tal?.FECHA_VTO && fechaValida(tal.FECHA_VTO) ? { vencimiento: iso(tal.FECHA_VTO) } : {}),
        ...(tal?.DESCRIP ? { descripcion: txt(tal.DESCRIP) } : {}),
      },
      usuario:  txt(s.USUARIO),
      facturas,
    }
    const h = huella(detalle)
    if (!resumen[codigo]) resumen[codigo] = {}
    resumen[codigo][numero] = {
      fecha, estado, bultos,
      ...(typeof s.ID_STA14 === 'number' ? { idSta14: s.ID_STA14 } : {}),
      ...(facturas.length ? { facturas } : {}),
      h,
    }
    detalles.push({ id: `${empresa}_REM_${numero}`, doc: detalle, h })
  }
  return { resumen, detalles }
}

/** Filas de GVA54 (T_COMP_V, N_COMP, REMITO) → { 'FAC_A…': ['R…'] } y { 'R…': ['A…'] }. */
export function relacionDeFilas(filas) {
  const porFactura = {}
  const porRemito = {}
  for (const r of filas) {
    const kf = claveFactura(r.T_COMP_V, r.N_COMP)
    const rem = txt(r.REMITO).toUpperCase()
    const fac = txt(r.N_COMP).toUpperCase()
    if (!rem || !fac) continue
    if (!porFactura[kf]) porFactura[kf] = []
    if (!porFactura[kf].includes(rem)) porFactura[kf].push(rem)
    if (!porRemito[rem]) porRemito[rem] = []
    if (!porRemito[rem].includes(fac)) porRemito[rem].push(fac)
  }
  return { porFactura, porRemito }
}

/**
 * Qué cambió respecto de la corrida anterior. `cache` = { codigo: { facturas: { clave: {h, fecha} },
 * remitos: { numero: {h, fecha} } } }. Devuelve, por código, solo las entradas nuevas o distintas,
 * y la lista de ids de detalle a escribir.
 */
export function diferencias(cache, resumenFacturas, resumenRemitos, detalles) {
  const porCodigo = {}
  const cambiadas = new Set()
  const marcar = (codigo, seccion, clave, entrada) => {
    const previo = cache?.[codigo]?.[seccion]?.[clave]
    if (previo?.h === entrada.h) return
    if (!porCodigo[codigo]) porCodigo[codigo] = { facturas: {}, remitos: {} }
    porCodigo[codigo][seccion][clave] = entrada
    cambiadas.add(entrada.h)
  }
  for (const [codigo, entradas] of Object.entries(resumenFacturas)) for (const [clave, e] of Object.entries(entradas)) marcar(codigo, 'facturas', clave, e)
  for (const [codigo, entradas] of Object.entries(resumenRemitos)) for (const [numero, e] of Object.entries(entradas)) marcar(codigo, 'remitos', numero, e)
  const detallesAEscribir = detalles.filter((d) => cambiadas.has(d.h))
  return { porCodigo, detallesAEscribir }
}

/** Entradas del cache más viejas que `limiteIso` (yyyy-mm-dd): se borran del índice. */
export function aPodar(cache, limiteIso) {
  const out = {}
  for (const [codigo, secciones] of Object.entries(cache ?? {})) {
    for (const seccion of ['facturas', 'remitos']) {
      for (const [clave, e] of Object.entries(secciones?.[seccion] ?? {})) {
        if (e.fecha && e.fecha < limiteIso) {
          if (!out[codigo]) out[codigo] = { facturas: [], remitos: [] }
          out[codigo][seccion].push(clave)
        }
      }
    }
  }
  return out
}

/** Cache nuevo = cache viejo + cambios − podados. */
export function actualizarCache(cache, porCodigo, podados) {
  const out = JSON.parse(JSON.stringify(cache ?? {}))
  for (const [codigo, secciones] of Object.entries(porCodigo)) {
    if (!out[codigo]) out[codigo] = { facturas: {}, remitos: {} }
    for (const seccion of ['facturas', 'remitos']) {
      if (!out[codigo][seccion]) out[codigo][seccion] = {}
      for (const [clave, e] of Object.entries(secciones[seccion])) out[codigo][seccion][clave] = { h: e.h, fecha: e.fecha }
    }
  }
  for (const [codigo, secciones] of Object.entries(podados)) {
    for (const seccion of ['facturas', 'remitos']) for (const clave of secciones[seccion]) delete out[codigo]?.[seccion]?.[clave]
  }
  return out
}

export const restarMeses = (d, meses) => new Date(d.getFullYear(), d.getMonth() - meses, d.getDate())
export const restarDias = (d, dias) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - dias)
