/**
 * columnas-live.mjs — SOLO LEE.
 *
 * Muestra qué columnas devuelve de verdad la API para una consulta Live
 * (GetColumnDefinition + las claves de la primera fila de GetApiLiveQueryData)
 * y, opcionalmente, las filas de un cliente. Sirve para relevar una consulta
 * nueva (ej. Ventas → Consultas → Remitos → "Consulta") antes de usarla en la sync.
 *
 * Uso (el token es el secret de las functions; así no pasa por el chat):
 *   TANGO_API_TOKEN="$(firebase functions:secrets:access TANGO_API_TOKEN)" node scripts/tango/columnas-live.mjs <process> [COD_GVA14]
 *
 * Opcionales: TANGO_COMPANY (default 1 = Redonhielo), TANGO_BASE_URL,
 *   DESDE=dd/MM/yyyy (default hoy − 60 días), HASTA=dd/MM/yyyy (default hoy),
 *   FILAS=N (cuántas filas completas imprimir, default 3),
 *   CONTAR=COL1,COL2 (cuenta valores distintos de esas columnas en todas las filas),
 *   PREFIJO=R01105 (además, filas cuyo NRO_COMPROBANTE empieza así).
 */

const proceso = process.argv[2]
const codigo = process.argv[3]
const token = process.env.TANGO_API_TOKEN
const company = process.env.TANGO_COMPANY ?? '1'
const base = process.env.TANGO_BASE_URL ?? 'https://001174-003.connect.axoft.com'
if (!proceso || !token) {
  console.error('Uso: TANGO_API_TOKEN=... node scripts/tango/columnas-live.mjs <process> [COD_GVA14]')
  process.exit(1)
}

const ddMMyyyy = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
const hoy = new Date()
const hace60 = new Date(); hace60.setDate(hace60.getDate() - 60)
const desde = process.env.DESDE ?? ddMMyyyy(hace60)
const hasta = process.env.HASTA ?? ddMMyyyy(hoy)
const maxFilas = Number(process.env.FILAS ?? 3)
const headers = { ApiAuthorization: token, Company: company }

async function columnas() {
  const r = await fetch(`${base}/Api/GetColumnDefinition?process=${proceso}&sortAlphabetically=false`, { headers })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

async function live() {
  const filas = []
  let i = 0, pages = 1
  do {
    const url = `${base}/Api/GetApiLiveQueryData?process=${proceso}&customQuery=0&fromDate=${encodeURIComponent(desde)}&toDate=${encodeURIComponent(hasta)}&pageSize=500&pageIndex=${i}`
    const r = await fetch(url, { headers })
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
    const data = await r.json()
    const rd = data.resultData ?? data
    const lista = rd.list ?? (Array.isArray(rd) ? rd : data.list ?? [])
    filas.push(...lista)
    pages = Number(rd.totalPages ?? 1)
    i++
  } while (i < pages && i < 40)
  return filas
}

const esDelCliente = (f) => {
  if (!codigo) return true
  return Object.values(f).some((v) => {
    const s = String(v ?? '')
    return s === codigo || s.startsWith(`${codigo} `) || s.startsWith(`${codigo} -`)
  })
}

console.log(`Process ${proceso} · empresa ${company} · ${desde} → ${hasta}`)
try {
  const def = await columnas()
  const lista = Array.isArray(def) ? def : def.resultData ?? def.list ?? def
  console.log('\n══ GetColumnDefinition:')
  if (Array.isArray(lista)) for (const c of lista) console.log(`  ${JSON.stringify(c)}`)
  else console.log(`  ${JSON.stringify(lista).slice(0, 2000)}`)
} catch (e) {
  console.log(`\n══ GetColumnDefinition: ERROR ${e.message}`)
}

try {
  const filas = await live()
  const mias = filas.filter(esDelCliente)
  console.log(`\n══ GetApiLiveQueryData: ${filas.length} filas${codigo ? `, ${mias.length} de ${codigo}` : ''}`)
  if (filas[0]) console.log(`  campos reales: ${Object.keys(filas[0]).join(', ')}`)
  for (const f of mias.slice(0, maxFilas)) console.log(`  ${JSON.stringify(f)}`)
  for (const col of (process.env.CONTAR ?? '').split(',').filter(Boolean)) {
    const conteo = new Map()
    for (const f of filas) { const k = String(f[col] ?? 'null'); conteo.set(k, (conteo.get(k) ?? 0) + 1) }
    console.log(`  ${col}: ${[...conteo].map(([k, n]) => `${k}=${n}`).join('  ')}`)
  }
  if (process.env.PREFIJO) {
    const conPrefijo = filas.filter((f) => String(f.NRO_COMPROBANTE ?? '').startsWith(process.env.PREFIJO))
    console.log(`  con prefijo ${process.env.PREFIJO}: ${conPrefijo.length}`)
    for (const f of conPrefijo.slice(0, maxFilas)) console.log(`  ${JSON.stringify(f)}`)
  }
} catch (e) {
  console.log(`\n══ GetApiLiveQueryData: ERROR ${e.message}`)
}
