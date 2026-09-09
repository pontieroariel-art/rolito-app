/**
 * diagnosticar-deuda-cliente.mjs — SOLO LEE.
 *
 * Consulta en Tango Connect las dos Live de deudas (vencidas 17953 y a vencer
 * 17955) tal como las lee la sync de saldos (fromDate 01/01/2015, toDate hoy+5
 * años) y además con toDate = hoy, y muestra qué comprobantes devuelve cada una
 * para UN cliente. Sirve para entender por qué un comprobante que Tango muestra
 * en la composición de saldos no llega al cache de la app.
 *
 * Uso (el token es el secret de las functions; así no pasa por el chat):
 *   TANGO_API_TOKEN="$(firebase functions:secrets:access TANGO_API_TOKEN)" node scripts/tango/diagnosticar-deuda-cliente.mjs PA.003
 *
 * Opcionales: TANGO_COMPANY (default 1 = Redonhielo), TANGO_BASE_URL.
 */

const codigo = process.argv[2]
const token = process.env.TANGO_API_TOKEN
const company = process.env.TANGO_COMPANY ?? '1'
const base = process.env.TANGO_BASE_URL ?? 'https://001174-003.connect.axoft.com'
if (!codigo || !token) {
  console.error('Uso: TANGO_API_TOKEN=... node scripts/tango/diagnosticar-deuda-cliente.mjs <COD_GVA14>')
  process.exit(1)
}

const ddMMyyyy = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
const hoy = new Date()
const en5 = new Date(); en5.setFullYear(en5.getFullYear() + 5)

async function live(proceso, desde, hasta) {
  const filas = []
  let i = 0, pages = 1
  do {
    const url = `${base}/Api/GetApiLiveQueryData?process=${proceso}&customQuery=0&fromDate=${encodeURIComponent(desde)}&toDate=${encodeURIComponent(hasta)}&pageSize=500&pageIndex=${i}`
    const r = await fetch(url, { headers: { ApiAuthorization: token, Company: company } })
    if (!r.ok) throw new Error(`HTTP ${r.status} en process ${proceso}: ${(await r.text()).slice(0, 200)}`)
    const data = await r.json()
    const rd = data.resultData ?? data
    const lista = rd.list ?? (Array.isArray(rd) ? rd : data.list ?? [])
    filas.push(...lista)
    pages = Number(rd.totalPages ?? 1)
    i++
  } while (i < pages)
  return filas
}

const esDelCliente = (f) => {
  const campos = [f.COD_GVA14, f.CODIGO_CLIENTE, f.CLIENTE, f.CODIGO, f.COD_CLIENT].map((x) => String(x ?? ''))
  return campos.some((s) => s === codigo || s.startsWith(`${codigo} `) || s.startsWith(`${codigo} -`))
}
const resumen = (f) => `${String(f.TIPO_COMPROBANTE ?? '').padEnd(4)} ${String(f.NRO_COMPROBANTE ?? '').padEnd(16)} emision ${String(f.FECHA_DE_EMISION ?? '').slice(0, 10)}  vto ${String(f.FECHA_DE_VENCIMIENTO ?? '').slice(0, 10)}  pendiente ${f.IMPORTE_PENDIENTE_CTE}  atraso ${f.DIAS_DE_ATRASO ?? ''}`

const variantes = [
  ['como la sync (hasta hoy + 5 años)', '01/01/2015', ddMMyyyy(en5)],
  ['hasta HOY', '01/01/2015', ddMMyyyy(hoy)],
]
for (const [nombre, desde, hasta] of variantes) {
  console.log(`\n══ ${nombre}: fromDate=${desde} toDate=${hasta}`)
  for (const [etiqueta, proceso] of [['VENCIDAS 17953', 17953], ['A VENCER 17955', 17955]]) {
    try {
      const filas = await live(proceso, desde, hasta)
      const mias = filas.filter(esDelCliente)
      console.log(`  ${etiqueta}: ${filas.length} filas en total, ${mias.length} de ${codigo}`)
      if (filas.length && (!mias.length || process.env.MOSTRAR_CAMPOS)) console.log(`    (campos de una fila: ${Object.keys(filas[0]).join(', ')})`)
      for (const f of mias) console.log(`    ${resumen(f)}`)
      // MOSTRAR_CAMPOS=1: la primera fila del cliente completa, para ver qué más trae la Live.
      if (process.env.MOSTRAR_CAMPOS && mias[0]) console.log('    fila completa:', JSON.stringify(mias[0]))
    } catch (e) {
      console.log(`  ${etiqueta}: ERROR ${e.message}`)
    }
  }
}
