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

/**
 * T_COMP de Tango → tipo corto de la app ('N/C' → 'NC', 'C/E' → 'CE'). Se queda solo con
 * letras y números: el tipo es parte del id del detalle (`{empresa}_{tipo}_{numero}`) y una
 * barra ahí partiría el path de Firestore.
 */
export const tipoCorto = (tComp) => String(tComp ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

export const claveFactura = (tipo, numero) => `${tipoCorto(tipo)}_${String(numero).trim().toUpperCase()}`

/**
 * Qué ES el comprobante, según la clase interna que le pone Tango (GVA12.TCOMP_IN_V):
 * FC factura, CC crédito, DC débito, RC recibo. Es la única fuente confiable — los importes
 * de GVA12 son todos positivos y cada empresa inventa sus propios T_COMP (Redonhielo usa 16:
 * C/E, CDP, NCB, CFC, CDV, CIN, NC, NCT, CEF y CAR son todos créditos; DEB, N/D, DIN y D/B,
 * débitos). Leyéndola, un código nuevo queda bien clasificado sin tocar la app.
 * El fallback por T_COMP es para los comprobantes viejos del índice, que se escribieron
 * antes de que el lector trajera esta columna.
 */
const CLASE_TANGO = { FC: 'factura', CC: 'credito', DC: 'debito', RC: 'recibo' }
const FAMILIA_POR_TIPO = { FAC: 'factura', NC: 'credito', ND: 'debito', REC: 'recibo' }
export function familiaDe(tcompIn, tipo) {
  const clase = CLASE_TANGO[String(tcompIn ?? '').trim().toUpperCase()]
  return clase ?? FAMILIA_POR_TIPO[tipoCorto(tipo)] ?? 'otro'
}

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
/**
 * Orden de compra del cliente en una factura de Tango (2026-09-21). Primero la
 * columna propia si la empresa la usa (`columnaOrdenCompra`), si no la leyenda
 * que la nombra: la app escribe "O. compra: 4521" en la leyenda 5 y la oficina
 * suele tipear "OC 4521" / "Orden de compra 4521" en alguna de las cinco.
 */
export function ordenCompraDe(f, columnaOrdenCompra, sep = '_', otrosTextos = []) {
  return ordenesCompraDe(f, columnaOrdenCompra, sep, otrosTextos).join(', ')
}

/**
 * TODAS las órdenes de compra de un comprobante, en orden y sin repetir: la
 * columna propia, las leyendas y los textos que se le pasen (renglones de
 * GVA45, observaciones). Facturación a veces carga varias en una factura, en
 * renglones distintos o en uno solo separadas por coma (Ariel, 21/09).
 */
export function ordenesCompraDe(f, columnaOrdenCompra, sep = '_', otrosTextos = []) {
  const vistas = new Set()
  const todas = []
  const sumar = (oc) => { const k = oc.toUpperCase(); if (oc && !vistas.has(k)) { vistas.add(k); todas.push(oc) } }
  if (columnaOrdenCompra) sumar(txt(f[columnaOrdenCompra]))
  for (const t of [...leyendasDe(f, sep), ...otrosTextos]) for (const oc of extraerOcs(t)) sumar(oc)
  return todas
}

const OC_PREFIJO = String.raw`(?:o\.?\s*(?:de\s*)?compra|orden(?:es)?\s+de\s+compra|o\s*\/\s*c|oc)\s*[:.#-]?\s*(?:n[º°o]?s?\.?\s*)?`

/**
 * Las órdenes de compra dentro de un texto. Si el texto ES la orden ("O. compra:
 * 4521-B", "OC4501977102", "Orden de compra Nº 778", "OC 123, 456 y 789") se toma
 * todo lo que sigue, partido por coma, punto y coma, barra o " y "; si la nombra
 * en el medio de una frase, cada token que sigue a la palabra.
 */
export function extraerOcs(texto) {
  const t = txt(texto)
  if (!t) return []
  const entero = new RegExp(String.raw`^\s*${OC_PREFIJO}(.+?)\s*$`, 'i').exec(t)
  if (entero?.[1]) return entero[1].split(/\s*[,;/]\s*|\s+y\s+/i).map((x) => x.trim()).filter(Boolean)
  const enFrase = new RegExp(String.raw`(?:^|[\s(,;])${OC_PREFIJO}([A-Za-z0-9][\w\-/.]*)`, 'gi')
  return [...t.matchAll(enFrase)].map((m) => m[1]).filter(Boolean)
}

/** La primera orden de compra de un texto, o ''. */
export const extraerOc = (texto) => extraerOcs(texto)[0] ?? ''

/**
 * Leyendas por renglón de GVA45 (T_COMP, N_COMP, DESC, ORDEN opcional) →
 * { 'FAC_A…' | 'REM_R…': ['OC4501977102', …] } en el orden del comprobante.
 */
export function textosPorComprobante(filas = []) {
  const m = new Map()
  const ordenadas = [...filas].sort((a, b) => Number(a.ORDEN ?? 0) - Number(b.ORDEN ?? 0))
  for (const f of ordenadas) {
    const texto = txt(f.DESC)
    if (!texto) continue
    const k = `${txt(f.T_COMP)}_${txt(f.N_COMP).toUpperCase()}`
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(texto)
  }
  return m
}

/**
 * Las cinco leyendas de la cabecera, sin las vacías. En GVA12 (facturas) las
 * columnas son LEYENDA_1..5; en STA14 (remitos) LEYENDA1..5, sin guión.
 */
export const leyendasDe = (f, sep = '_') => [1, 2, 3, 4, 5].map((i) => txt(f[`LEYENDA${sep}${i}`])).filter(Boolean)

/**
 * Saldo a favor del cliente (2026-09-24, pedido de Ariel: "la composición no
 * muestra los montos a cuenta"): un recibo o una NC con ESTADO 'CTA' es plata
 * que Tango tiene sin imputar. Lo disponible es IMPORTE − Σ gva07.IMPORT_CAN
 * (lo que ya se aplicó después). `aplicadoPorId` trae esa suma por ID_GVA12.
 */
export const ESTADO_A_CUENTA = 'CTA'
export function pendienteACuenta(f, aplicadoPorId = {}) {
  if (txt(f.ESTADO) !== ESTADO_A_CUENTA) return null
  const disponible = num(num(f.IMPORTE) - num(aplicadoPorId[f.ID_GVA12] ?? 0))
  return disponible > 0 ? disponible : 0
}

export function mapearFacturas({ empresa, facturas, renglones, remitosPorFactura, clientes, condiciones, vendedores, columnaOrdenCompra = null, textos = [], aplicadoPorId = {} }) {
  const textosPor = textosPorComprobante(textos)
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
      // Un renglón sin artículo ni importe es el hueco de un renglón de texto
      // (el texto está en GVA45): no es mercadería y en el PDF salía en blanco.
      .filter((r) => txt(r.COD_ARTICU) || num(r.IMP_NETO_P) !== 0 || num(r.CANTIDAD) !== 0)
      .map((r) => ({
        codigo:         txt(r.COD_ARTICU),
        descripcion:    txt(r.DESCRIPCIO) || txt(r.COD_ARTICU),
        cantidad:       num(r.CANTIDAD),
        precioUnitario: num(r.PRECIO_NET),
        dtoPct:         num(r.PORC_DTO),
        ivaPct:         num(r.PORC_IVA),
        importe:        num(r.IMP_NETO_P),
        ...(txt(r.OBSERVACIONES) ? { nota: txt(r.OBSERVACIONES) } : {}),
      }))
    const ivaAlic = rens.find((r) => r.ivaPct > 0)?.ivaPct ?? (gravado > 0 ? num((iva / gravado) * 100) : 0)
    const cliente = clienteDe(clientes[codigo], f.CAT_IVA, condiciones[String(f.COND_VTA)], vendedores[txt(f.COD_VENDED)] ?? txt(f.COD_VENDED))
    const cae = txt(f.CAICAE)
    const familia = familiaDe(f.TCOMP_IN_V, tipo)
    const leyendas = leyendasDe(f)
    // Renglones de texto (GVA45) y textos de cabecera: de ahí salen las órdenes
    // de compra de la oficina ("OC4501977102" bajo el último artículo).
    const notas = textosPor.get(`${txt(f.T_COMP)}_${numero}`) ?? []
    const observaciones = [f.DESCRIPCION_FACTURA, f.OBSERVAC, f.OBS_COMERC, f.LEYENDA].map(txt).filter(Boolean)
    const ordenCompra = ordenCompraDe(f, columnaOrdenCompra, '_', [...notas, ...rens.map((r) => r.nota ?? ''), ...observaciones])
    const pendiente = pendienteACuenta(f, aplicadoPorId)
    const detalle = {
      empresa, tipo, familia, numero, codigo, fecha,
      letra:      p?.letra ?? numero.charAt(0),
      puntoVenta: p?.puntoVenta ?? 0,
      nro:        p?.nro ?? 0,
      cbteTipo:   p ? cbteTipoDe(tipo, p.letra) : null,
      estado:     txt(f.ESTADO),
      // Va en el detalle para que la huella cambie cuando se aplica parte del saldo.
      ...(pendiente != null ? { pendiente } : {}),
      ...(fechaValida(f.FECHA_ANU) ? { fechaAnulacion: iso(f.FECHA_ANU) } : {}),
      cliente,
      renglones:  rens,
      totales:    { gravado, exento, iva, ivaAlic, internos, otros, total },
      cae,
      caeVto:     cae ? iso(f.CAICAE_VTO) : '',
      remitos,
      ...(leyendas.length ? { leyendas } : {}),
      ...(notas.length ? { notas } : {}),
      ...(observaciones.length ? { observaciones } : {}),
      ...(ordenCompra ? { ordenCompra } : {}),
    }
    const h = huella(detalle)
    if (!resumen[codigo]) resumen[codigo] = {}
    resumen[codigo][clave] = {
      tipo, familia, numero, fecha, importe: total, estado: detalle.estado,
      ...(typeof f.ID_GVA12 === 'number' ? { idGva12: f.ID_GVA12 } : {}),
      ...(remitos.length ? { remitos } : {}),
      ...(pendiente != null ? { pendiente } : {}),
      h,
    }
    detalles.push({ id: `${empresa}_${tipo}_${numero}`, doc: detalle, h })
  }
  return { resumen, detalles, aCuenta: aCuentaPorCodigo(resumen) }
}

/**
 * Resumen del saldo a favor por código de cliente, para el doc del índice
 * (`tangoComprobantes.aCuenta`): la sync de saldos lo suma como líneas
 * negativas en la composición y así el cliente que solo tiene plata a favor
 * también aparece (la Live de deudas de Tango no lo trae).
 */
/** Filas crudas de GVA12 con ESTADO 'CTA' (sin ventana de fechas) → aCuenta por código. */
export function aCuentaDeFilas(filas, aplicadoPorId = {}) {
  const resumen = {}
  for (const f of filas) {
    const tipo = tipoCorto(f.T_COMP), numero = txt(f.N_COMP).toUpperCase(), codigo = txt(f.COD_CLIENT)
    if (!codigo || !numero) continue
    const pendiente = pendienteACuenta(f, aplicadoPorId)
    if (pendiente == null) continue
    if (!resumen[codigo]) resumen[codigo] = {}
    resumen[codigo][claveFactura(tipo, numero)] = {
      tipo, familia: familiaDe(f.TCOMP_IN_V, tipo), numero, fecha: iso(f.FECHA_EMIS), importe: num(f.IMPORTE), estado: txt(f.ESTADO),
      ...(typeof f.ID_GVA12 === 'number' ? { idGva12: f.ID_GVA12 } : {}), pendiente,
    }
  }
  return aCuentaPorCodigo(resumen)
}

export function aCuentaPorCodigo(resumen) {
  const out = {}
  for (const [codigo, entradas] of Object.entries(resumen)) {
    const items = Object.values(entradas)
      .filter((e) => (e.familia === 'recibo' || e.familia === 'credito') && e.estado === ESTADO_A_CUENTA && (e.pendiente ?? 0) > 0)
      .map((e) => ({ tipo: e.tipo, numero: e.numero, fecha: e.fecha, importe: e.importe, pendiente: e.pendiente, ...(e.idGva12 != null ? { idGva12: e.idGva12 } : {}) }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
    out[codigo] = { total: num(items.reduce((s, i) => s + i.pendiente, 0)), items }
  }
  return out
}

/**
 * Remitos: filas de STA14, renglones de STA20 (con DESCRIPCIO) y la relación inversa
 * { 'R…': ['A…', …] } (números de factura). Talonarios: { TALONARIO: { CAI, FECHA_VTO } }.
 */
export function mapearRemitos({ empresa, remitos, renglones, facturasPorRemito, talonarios, clientes, condiciones, textos = [] }) {
  const textosPor = textosPorComprobante(textos)
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
    // Orden de compra (2026-09-21): la app la escribe en LEYENDA4 del remito
    // ("O. compra: …", functions/services/tango/sql/remito.ts).
    const leyendas = leyendasDe(s, '')
    const notas = textosPor.get(`REM_${numero}`) ?? []
    const ordenCompra = ordenCompraDe(s, null, '', notas)
    const detalle = {
      empresa, tipo: 'REM', numero, codigo, fecha, estado,
      ...(leyendas.length ? { leyendas } : {}),
      ...(notas.length ? { notas } : {}),
      ...(ordenCompra ? { ordenCompra } : {}),
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

/**
 * Secciones `facturas` / `remitos` del doc de índice para un `set(..., { merge: true })`:
 * las entradas que cambiaron más las podadas marcadas con `borrar` (deleteField). Una sección
 * SIN nada se omite del todo (2026-09-15): con merge, un mapa vacío `{}` no es "no toques
 * nada" sino "reemplazá el mapa por vacío", y así se borraron las facturas de 179 clientes a
 * los que solo les había cambiado un remito.
 */
export function seccionesIndice(cambios, poda, borrar) {
  const out = {}
  for (const seccion of ['facturas', 'remitos']) {
    const entradas = { ...(cambios?.[seccion] ?? {}) }
    for (const clave of poda?.[seccion] ?? []) entradas[clave] = borrar()
    if (Object.keys(entradas).length) out[seccion] = entradas
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
