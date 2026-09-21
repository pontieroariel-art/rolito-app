-- 21 · Qué toca Tango cuando la oficina ANULA un recibo de cobranzas (2026-09-15).
-- Objetivo: que la app anule en Tango sola el recibo que el cobrador anuló en la app con
-- autorización (decisión de Ariel 15/09: "que la app lo anule en Tango sola"). Para escribirlo
-- por SQL hay que ver exactamente qué filas cambia Tango en cuenta corriente (GVA12 del recibo,
-- gva07 imputaciones, GVA46 vencimientos, HISTORIAL_CUENTAS_CORRIENTES, GVA14 saldo), en
-- tesorería (SBA04 cabecera, SBA05 renglones, SBA14 cheques en cartera) y lo que no conozcamos.
-- Dos capturas complementarias: FOTO antes / después (bloques 1 y 3) + Extended Events durante
-- la anulación (2 y 4).
--
-- Correr en SSMS de RHIELOTG conectado a REDONHIELO_SA (sa o login con ALTER ANY EVENT SESSION).
-- Recibo a usar: X0110600000168 (RS-000168 de la app, Matías Vinjoy, COMBUSTIBLES SAN MARTIN
-- OR.235, cheque Banco Nación 00005746 por $200.000 imputado parcial a FAC A0010100282609;
-- hay que anularlo de verdad porque el número de cheque estaba mal).
--
-- VIGENTE al 2026-09-20: ese recibo SIGUE pendiente de anular en Tango (estado IMP, cinco
-- días después de aprobada la anulación). Se traza mientras se hace el trabajo que ya se
-- debe. El otro que sirve es X0110600000197 (RS-000197, LUZARDO HNOS., estado CTA).
-- OJO con la empresa: el punto de venta dice la base. 01106 → REDONHIELO_SA · 01108 → Rolito
-- (el de FERRANTE, X0110800000169, ya está anulado: ése no sirve).
--
-- Orden:  1) FOTO ANTES  →  2) arrancar la traza  →  anular el recibo EN TANGO como siempre
--         →  3) FOTO DESPUÉS  →  4) leer la traza y guardar como CSV  →  5) limpiar.
--
-- QUÉ MANDARME (cuatro archivos):
--   · foto-antes.csv    — las grillas del paso 1
--   · foto-despues.csv  — las mismas del paso 3
--   · traza.csv         — la grilla del paso 4
--   · la HORA EXACTA en que se anuló en Tango (si otro está cargando comprobantes al
--     mismo tiempo, sus sentencias también caen en la traza y hay que separarlas)

USE REDONHIELO_SA;
GO
DECLARE @recibo char(14) = 'X0110600000168';
DECLARE @nro    varchar(20) = '00000168';

-- ───────────────────────── 1) FOTO ANTES ─────────────────────────
-- (repetir estas mismas consultas en el paso 3 y comparar)
PRINT '== GVA12 recibo (cuenta corriente) ==';
SELECT * FROM GVA12 WHERE T_COMP = 'REC' AND N_COMP = @recibo;
PRINT '== GVA12 factura imputada ==';
SELECT * FROM GVA12 WHERE T_COMP = 'FAC' AND N_COMP = 'A0010100282609';
PRINT '== gva07 imputaciones del recibo ==';
SELECT * FROM gva07 WHERE (T_COMP_CAN = 'REC' AND N_COMP_CAN = @recibo) OR (T_COMP = 'REC' AND N_COMP = @recibo);
PRINT '== GVA46 vencimientos de la factura ==';
SELECT * FROM GVA46 WHERE T_COMP = 'FAC' AND N_COMP = 'A0010100282609';
PRINT '== HISTORIAL_CUENTAS_CORRIENTES del recibo ==';
SELECT * FROM HISTORIAL_CUENTAS_CORRIENTES WHERE N_COMP = @recibo OR N_COMP_CAN = @recibo;
PRINT '== GVA14 saldo del cliente ==';
SELECT COD_CLIENT, RAZON_SOCI, SALDO_CC, SALDO_CC_U FROM GVA14 WHERE COD_CLIENT = 'OR.235';
PRINT '== SBA04 tesorería cabecera ==';
SELECT * FROM SBA04 WHERE COD_COMP = 'REC' AND N_COMP LIKE '%' + @nro;
PRINT '== SBA05 tesorería renglones ==';
SELECT r.* FROM SBA05 r JOIN SBA04 c ON c.ID_SBA04 = r.ID_SBA04 WHERE c.COD_COMP = 'REC' AND c.N_COMP LIKE '%' + @nro;
PRINT '== SBA14 cheque en cartera ==';
SELECT * FROM SBA14 WHERE N_CHEQUE = '00005746' OR N_COMP LIKE '%' + @nro;
PRINT '== P_COBRANZAESTADOSVENTAS (si existe) ==';
IF OBJECT_ID('P_COBRANZAESTADOSVENTAS') IS NOT NULL SELECT TOP 20 * FROM P_COBRANZAESTADOSVENTAS WHERE N_COMP = @recibo;
GO

-- ───────────────────────── 2) ARRANCAR LA TRAZA ─────────────────────────
IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = 'traza_anulacion_recibo')
  DROP EVENT SESSION traza_anulacion_recibo ON SERVER;
GO
CREATE EVENT SESSION traza_anulacion_recibo ON SERVER
ADD EVENT sqlserver.sql_statement_completed (
  ACTION (sqlserver.client_app_name, sqlserver.database_name, sqlserver.session_id)
  WHERE sqlserver.database_name = N'REDONHIELO_SA'
    AND (sqlserver.like_i_sql_unicode_string([statement], N'%INSERT%')
      OR sqlserver.like_i_sql_unicode_string([statement], N'%UPDATE%')
      OR sqlserver.like_i_sql_unicode_string([statement], N'%DELETE%'))
),
ADD EVENT sqlserver.sp_statement_completed (
  ACTION (sqlserver.client_app_name, sqlserver.database_name, sqlserver.session_id)
  WHERE sqlserver.database_name = N'REDONHIELO_SA'
    AND (sqlserver.like_i_sql_unicode_string([statement], N'%INSERT%')
      OR sqlserver.like_i_sql_unicode_string([statement], N'%UPDATE%')
      OR sqlserver.like_i_sql_unicode_string([statement], N'%DELETE%'))
),
ADD EVENT sqlserver.rpc_completed (
  ACTION (sqlserver.client_app_name, sqlserver.database_name, sqlserver.session_id)
  WHERE sqlserver.database_name = N'REDONHIELO_SA'
    AND (sqlserver.like_i_sql_unicode_string([statement], N'%INSERT%')
      OR sqlserver.like_i_sql_unicode_string([statement], N'%UPDATE%')
      OR sqlserver.like_i_sql_unicode_string([statement], N'%DELETE%')
      OR sqlserver.like_i_sql_unicode_string([statement], N'%sp_prepare%')
      OR sqlserver.like_i_sql_unicode_string([statement], N'%sp_prepexec%'))
)
ADD TARGET package0.event_file (SET filename = N'C:\Temp\traza_anulacion_recibo.xel', max_file_size = 100, max_rollover_files = 2)
WITH (MAX_DISPATCH_LATENCY = 3 SECONDS, STARTUP_STATE = OFF);
GO
ALTER EVENT SESSION traza_anulacion_recibo ON SERVER STATE = START;
GO
-- >>> AHORA: en Tango (Ventas → Cuentas corrientes → Anulación de recibos, o como lo haga la
-- >>> oficina) anular el X 01106-00000168. Anotar la HORA exacta. Después seguir con el paso 3.
-- (Ojo: es la base real. La traza no frena nada ni cambia nada; solo mira. Si otra persona
--  carga comprobantes al mismo tiempo, esos también aparecen: por eso importa la hora exacta.)

-- ───────────────────────── 3) FOTO DESPUÉS ─────────────────────────
-- Repetir el bloque 1 tal cual (mismo @recibo) y guardar las grillas.

-- ───────────────────────── 4) LEER LA TRAZA ─────────────────────────
IF OBJECT_ID('tempdb..#xe') IS NOT NULL DROP TABLE #xe;
SELECT CAST(event_data AS XML) AS x
INTO #xe
FROM sys.fn_xe_file_target_read_file('C:\Temp\traza_anulacion_recibo*.xel', NULL, NULL, NULL);
SELECT
  x.value('(event/@timestamp)[1]', 'datetime2')                                   AS momento,
  x.value('(event/@name)[1]', 'nvarchar(50)')                                     AS evento,
  x.value('(event/action[@name="session_id"]/value)[1]', 'int')                   AS sesion,
  x.value('(event/action[@name="client_app_name"]/value)[1]', 'nvarchar(100)')    AS programa,
  x.value('(event/data[@name="object_name"]/value)[1]', 'nvarchar(200)')          AS objeto,
  x.value('(event/data[@name="statement"]/value)[1]', 'nvarchar(max)')            AS sentencia
FROM #xe
ORDER BY momento;
-- Guardar la grilla como CSV (clic derecho → Guardar resultados como...).

-- ───────────────────────── 5) LIMPIAR ─────────────────────────
ALTER EVENT SESSION traza_anulacion_recibo ON SERVER STATE = STOP;
GO
DROP EVENT SESSION traza_anulacion_recibo ON SERVER;
GO
