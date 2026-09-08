/**
 * reparar-direccion-entrega-remitos.mjs — completa STA14.ID_DIRECCION_ENTREGA en los
 * remitos que la app escribió por SQL sin dirección de entrega (2026-09-08).
 *
 * Causa: el writer pedía una columna NRO_SUCURSAL que DIRECCION_ENTREGA no tiene,
 * la consulta fallaba en silencio y el remito quedaba con ID_DIRECCION_ENTREGA NULL.
 * Tango entonces no deja facturar desde ese remito ("No hay un domicilio de entrega
 * con el id: 0"). El writer ya está corregido; esto arregla los que ya se grabaron.
 *
 * Se corre EN LA VM (C:\RolitoSync\sql), al lado de bridge-sql.config.json, con el
 * mismo login SQL del bridge:
 *   node reparar-direccion-entrega-remitos.mjs                → dry-run: lista qué haría
 *   node reparar-direccion-entrega-remitos.mjs --commit       → aplica
 *   node reparar-direccion-entrega-remitos.mjs --ids 890479,890481   → solo esos ID_STA14
 *
 * Solo toca remitos (T_COMP = 'REM') con ID_DIRECCION_ENTREGA NULL cuyo cliente tenga
 * al menos una dirección de entrega (toma la habitual). Un remito ya facturado o
 * anulado no se toca.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const mssql = require('mssql')

const COMMIT = process.argv.includes('--commit')
const idsArg = process.argv[process.argv.indexOf('--ids') + 1]
const IDS = process.argv.includes('--ids') && idsArg ? idsArg.split(',').map((x) => Number(x.trim())).filter(Number.isInteger) : null
const EMPRESA = process.argv.includes('--empresa') ? process.argv[process.argv.indexOf('--empresa') + 1] : 'redonhielo'

const texto = readFileSync(path.join(__dirname, 'bridge-sql.config.json'), 'utf8')
const cfg = JSON.parse(texto.charCodeAt(0) === 0xFEFF ? texto.slice(1) : texto)
const database = cfg.sql.bases[EMPRESA]
if (!database) { console.error(`config sql.bases no tiene la empresa "${EMPRESA}"`); process.exit(1) }

const pool = new mssql.ConnectionPool({
  server: cfg.sql.server, database, user: cfg.sql.user, password: cfg.sql.password, port: cfg.sql.port ?? 1433,
  options: { encrypt: cfg.sql.encrypt ?? false, trustServerCertificate: true, enableArithAbort: true, useUTC: false },
})
await pool.connect()

const filtroIds = IDS ? `AND S.ID_STA14 IN (${IDS.join(',')})` : ''
// La dirección habitual del cliente del remito. STA14 guarda el código en COD_PRO_CL
// (y los triggers de Tango completan ID_GVA14); se cruza por código para no depender del id.
const sqlLista = `
  SELECT S.ID_STA14, S.N_COMP, S.FECHA_MOV, S.COD_PRO_CL, S.ID_DIRECCION_ENTREGA, S.ESTADO_MOV, S.USUARIO,
         D.ID_DIRECCION_ENTREGA AS ID_NUEVO, D.DIRECCION, D.LOCALIDAD
  FROM STA14 S
  JOIN GVA14 C ON C.COD_GVA14 = S.COD_PRO_CL
  OUTER APPLY (
    SELECT TOP 1 ID_DIRECCION_ENTREGA, DIRECCION, LOCALIDAD FROM DIRECCION_ENTREGA
    WHERE ID_GVA14 = C.ID_GVA14 ORDER BY CASE WHEN HABITUAL = 'S' THEN 0 ELSE 1 END, ID_DIRECCION_ENTREGA
  ) D
  WHERE S.T_COMP = 'REM' AND S.ID_DIRECCION_ENTREGA IS NULL ${filtroIds}
  ORDER BY S.ID_STA14`
const lista = (await new mssql.Request(pool).query(sqlLista)).recordset
console.log(`${database}: remitos sin dirección de entrega: ${lista.length}`)
for (const r of lista) {
  console.log(`  ${r.ID_STA14} ${String(r.N_COMP).trim()} ${new Date(r.FECHA_MOV).toISOString().slice(0, 10)} ${r.COD_PRO_CL} estado=${r.ESTADO_MOV} usuario=${String(r.USUARIO).trim()} → ${r.ID_NUEVO ? `${r.ID_NUEVO} (${r.DIRECCION}, ${r.LOCALIDAD})` : 'SIN DIRECCIÓN EN LA FICHA: cargarla en Tango'}`)
}
const reparables = lista.filter((r) => r.ID_NUEVO)
if (!COMMIT) { console.log(`dry-run: ${reparables.length} se repararían con --commit`); await pool.close(); process.exit(0) }

const tx = new mssql.Transaction(pool)
await tx.begin(mssql.ISOLATION_LEVEL.READ_COMMITTED)
try {
  let n = 0
  for (const r of reparables) {
    const req = new mssql.Request(tx)
    req.input('ID', mssql.Int, r.ID_STA14); req.input('DIR', mssql.Int, r.ID_NUEVO)
    const res = await req.query(`UPDATE STA14 SET ID_DIRECCION_ENTREGA = @DIR WHERE ID_STA14 = @ID AND ID_DIRECCION_ENTREGA IS NULL`)
    n += res.rowsAffected?.[0] ?? 0
  }
  await tx.commit()
  console.log(`listo: ${n} remitos actualizados`)
} catch (e) {
  await tx.rollback()
  console.error('error, no se cambió nada:', e.message)
  process.exit(1)
}
await pool.close()
