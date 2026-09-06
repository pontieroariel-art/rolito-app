// Verifica que las consultas Live de composición de deuda (17953 = deudas
// vencidas, 17955 = deudas a vencer) respondan en CADA empresa de Tango por
// Tango Connect, antes de prender la sync de saldos por empresa (2026-09-06).
// Es solo lectura. Imprime cuántas filas y qué columnas devuelve cada una y,
// si se pasa --cliente=<COD>, las filas de ese cliente (para ver el ID_GVA14
// que tiene en cada empresa).
//
//   $env:TANGO_TOKEN='<token de desarrollador>'; node scripts/tango/verificar-live-empresas.mjs
//   node scripts/tango/verificar-live-empresas.mjs --companies=1,3 --cliente=FC.280
//
// Los ids de proceso se pueden pisar con --vencidas=N --avencer=N (si en Rolito
// difieren, van a config/tango.saldos.porEmpresa.rolito).

const BASE = process.env.TANGO_BASE_URL ?? 'https://001174-003.connect.axoft.com'
const TOKEN = process.env.TANGO_TOKEN
if (!TOKEN) { console.error('Falta el token: $env:TANGO_TOKEN'); process.exit(1) }

const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d }
const companies = arg('companies', '1,3').split(',').map(Number)
const procesos = { vencidas: Number(arg('vencidas', 17953)), aVencer: Number(arg('avencer', 17955)) }
const cliente = arg('cliente', '')

const ddMMyyyy = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
const hasta = new Date(); hasta.setFullYear(hasta.getFullYear() + 5)

async function live(company, proceso) {
  const out = []
  let i = 0, pages = 1
  do {
    const url = `${BASE}/Api/GetApiLiveQueryData?process=${proceso}&customQuery=0&fromDate=01/01/2015&toDate=${ddMMyyyy(hasta)}&pageSize=500&pageIndex=${i}`
    const r = await fetch(url, { headers: { ApiAuthorization: TOKEN, Company: String(company) } })
    if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`)
    const data = await r.json()
    const rd = data.resultData ?? data
    const lista = rd.list ?? (Array.isArray(rd) ? rd : [])
    out.push(...lista)
    pages = Number(rd.totalPages ?? 1)
    i++
  } while (i < pages)
  return out
}

for (const company of companies) {
  console.log(`\n=== Company ${company} ===`)
  for (const [nombre, proceso] of Object.entries(procesos)) {
    try {
      const filas = await live(company, proceso)
      const clientes = new Set(filas.map((f) => f.ID_GVA14)).size
      console.log(`  ${nombre} (process ${proceso}): ${filas.length} filas, ${clientes} clientes. Columnas: ${Object.keys(filas[0] ?? {}).join(', ') || '(sin filas)'}`)
      if (cliente) {
        const mias = filas.filter((f) => String(f.CLIENTE ?? '').startsWith(`${cliente} `))
        for (const f of mias) console.log(`    ${f.CLIENTE} → ID_GVA14 ${f.ID_GVA14} · ${f.TIPO_COMPROBANTE} ${f.NRO_COMPROBANTE} · pendiente ${f.IMPORTE_PENDIENTE_CTE}`)
        if (!mias.length) console.log(`    (sin filas de ${cliente})`)
      }
    } catch (e) {
      console.log(`  ${nombre} (process ${proceso}): ERROR ${e.message}`)
    }
  }
}
