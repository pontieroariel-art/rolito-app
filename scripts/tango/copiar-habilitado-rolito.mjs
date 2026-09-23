// Copia la inhabilitación de clientes de la base de REDONHIELO a la de ROLITO
// (2026-09-23, decisión de Ariel: "los inhabilitados que valen son los de
// Redonhielo; solo los inhabilitados de Redonhielo que también estén en Rolito").
//
// Lee las dos bases por Tango Connect, empareja por COD_GVA14 (las dos usan los
// mismos códigos; los pocos que no coinciden se prueban por CUIT) y arma el SQL
// para inhabilitar en Rolito los que están inhabilitados en Redonhielo y
// habilitados en Rolito. NO habilita a nadie.
//
// Por qué SQL y no la API: `Api/Update?process=2117` acepta el objeto completo
// del cliente pero ese objeto (GetById) no trae el campo de habilitación, que
// solo aparece en la lista (`Api/Get`); el Update lo ignora (probado el 23/09
// con 092435: "HABILITADO=undefined después del Update"). La columna de GVA14 se
// toca por SQL en SSMS sobre la base de Rolito, con verificación antes y después.
//
//   TANGO_API_TOKEN=$(firebase functions:secrets:access TANGO_API_TOKEN) \
//     node scripts/tango/copiar-habilitado-rolito.mjs
//   → lista los cambios y deja Escritorio/inhabilitar-rolito-<fecha>.sql
import { writeFileSync } from 'fs'
import { createRequire } from 'module'
import os from 'os'
import path from 'path'

const require = createRequire(import.meta.url)
const { TangoClient } = require('../../functions/lib/services/tango/client.js')

const token = process.env.TANGO_API_TOKEN
if (!token) { console.error('Falta TANGO_API_TOKEN (firebase functions:secrets:access TANGO_API_TOKEN)'); process.exit(1) }

const COMPANY = { redonhielo: 1, rolito: 3 }
const PROCESO_CLIENTES = 2117
const tango = new TangoClient({ baseUrl: 'https://001174-003.connect.axoft.com', token, timeoutMs: 120_000 })

const habilitado = (c) => !(c.HABILITADO === false || c.HABILITADO === 0 || c.HABILITADO === 'N')
const cuitDe = (c) => String(c.CUIT ?? '').replace(/\D/g, '')

console.log('Leyendo las dos bases…')
const [rh, ro] = await Promise.all([tango.getAll(COMPANY.redonhielo, PROCESO_CLIENTES, 500), tango.getAll(COMPANY.rolito, PROCESO_CLIENTES, 500)])
const rhPorCodigo = new Map(rh.map((c) => [String(c.COD_GVA14), c]))
const rhPorCuit = new Map(rh.filter((c) => cuitDe(c).length === 11 && cuitDe(c) !== '00000000000').map((c) => [cuitDe(c), c]))

const aInhabilitar = [], inversos = [], sinPar = []
for (const r of ro) {
  const h = rhPorCodigo.get(String(r.COD_GVA14)) ?? rhPorCuit.get(cuitDe(r))
  if (!h) { sinPar.push(r); continue }
  if (!habilitado(h) && habilitado(r)) aInhabilitar.push(r)
  else if (habilitado(h) && !habilitado(r)) inversos.push(r)
}
console.log(`Redonhielo ${rh.length} clientes (${rh.filter((c) => !habilitado(c)).length} inhabilitados) · Rolito ${ro.length} (${ro.filter((c) => !habilitado(c)).length} inhabilitados) · Rolito sin par en Redonhielo: ${sinPar.length}`)
console.log(`A INHABILITAR en Rolito (inhabilitados en Redonhielo): ${aInhabilitar.length}`)
console.log(`Inversos (habilitados en Redonhielo, inhabilitados en Rolito): ${inversos.length} → no se tocan`)
for (const c of aInhabilitar) console.log(`  ${String(c.COD_GVA14).padEnd(8)} ${String(c.RAZON_SOCI ?? '').slice(0, 44).padEnd(44)} ID_GVA14 ${c.ID_GVA14}`)

const ids = aInhabilitar.map((c) => Number(c.ID_GVA14)).filter(Number.isInteger)
const fecha = new Date().toISOString().slice(0, 10)
const sql = `-- Inhabilitar en ROLITO los clientes inhabilitados en REDONHIELO (${aInhabilitar.length} clientes)
-- Generado el ${fecha} por scripts/tango/copiar-habilitado-rolito.mjs a partir de Tango Connect.
-- Correr en SSMS sobre la base de ROLITO (no en REDONHIELO_SA). Cada bloque por separado.

-- BLOQUE A: qué columna es. Tiene que aparecer UNA columna de GVA14 con "HABIL" en el nombre.
SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'GVA14' AND COLUMN_NAME LIKE '%HABIL%';

-- BLOQUE B: los ${aInhabilitar.length} clientes como están hoy (todos tienen que venir habilitados).
SELECT ID_GVA14, COD_GVA14, RAZON_SOCI, HABILITADO FROM GVA14 WHERE ID_GVA14 IN (${ids.join(', ')}) ORDER BY COD_GVA14;

-- BLOQUE C: el cambio, en una transacción que se deshace sola si la cantidad no es la esperada.
BEGIN TRAN;
UPDATE GVA14 SET HABILITADO = 0 WHERE ID_GVA14 IN (${ids.join(', ')}) AND HABILITADO = 1;
IF @@ROWCOUNT = ${aInhabilitar.length}
  BEGIN COMMIT; PRINT 'OK: ${aInhabilitar.length} clientes inhabilitados en Rolito'; END
ELSE
  BEGIN ROLLBACK; PRINT 'NO SE APLICÓ: la cantidad de filas no coincide, revisar el bloque B'; END

-- BLOQUE D: verificación (tienen que venir todos en 0).
SELECT COD_GVA14, RAZON_SOCI, HABILITADO FROM GVA14 WHERE ID_GVA14 IN (${ids.join(', ')}) ORDER BY COD_GVA14;
`
const archivo = path.join(os.homedir(), 'Desktop', `inhabilitar-rolito-${fecha}.sql`)
writeFileSync(archivo, sql, 'utf8')
console.log(`\nSQL para SSMS (base Rolito) en ${archivo}`)
process.exit(0)
