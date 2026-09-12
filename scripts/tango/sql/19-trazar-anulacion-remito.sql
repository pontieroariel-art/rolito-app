-- 19 · Qué toca Tango cuando la oficina ANULA un remito de ventas (2026-09-12).
-- Objetivo: que la app anule en Tango sola el remito que el chofer anuló en la app
-- (hoy lo hace la oficina a mano). Para escribirlo por SQL necesitamos ver exactamente
-- qué filas cambia Tango: cabecera (STA14), renglones (STA20), saldos del depósito
-- (STA19) y lo que sea que no conozcamos. Dos capturas complementarias:
--   FOTO antes / después (bloques 1 y 3)  +  Extended Events durante la anulación (2 y 4).
--
-- Correr en SSMS de RHIELOTG conectado a REDONHIELO_SA (sa o login con ALTER ANY EVENT SESSION).
-- Remito a usar: R0110500000425 (Morinigo, DON SATUR, anulado en la app el 12/09).
--
-- Orden:  1) FOTO ANTES  →  2) arrancar la traza  →  anular el remito EN TANGO como siempre
--         →  3) FOTO DESPUÉS  →  4) leer la traza y guardar como CSV  →  5) limpiar.
-- Mandar a Claude: las dos fotos (1 y 3) y el CSV de la traza (4).

USE REDONHIELO_SA;
GO
DECLARE @remito char(13) = 'R0110500000425';

-- ───────────────────────── 1) FOTO ANTES ─────────────────────────
-- (repetir estas mismas consultas en el paso 3 y comparar)
PRINT '== STA14 cabecera ==';
SELECT * FROM STA14 WHERE N_COMP = @remito OR N_REMITO = @remito;
PRINT '== STA20 renglones ==';
SELECT r.* FROM STA20 r JOIN STA14 c ON c.ID_STA14 = r.ID_STA14 WHERE c.N_COMP = @remito OR c.N_REMITO = @remito;
PRINT '== STA19 saldos del depósito del remito, artículos del remito ==';
SELECT s.* FROM STA19 s
WHERE s.COD_DEPOSI IN (SELECT COD_DEPOSI FROM STA14 WHERE N_COMP = @remito OR N_REMITO = @remito)
  AND s.COD_ARTICU IN (SELECT r.COD_ARTICU FROM STA20 r JOIN STA14 c ON c.ID_STA14 = r.ID_STA14 WHERE c.N_COMP = @remito OR c.N_REMITO = @remito);
PRINT '== GVA21 / relación remito-factura (si existe) ==';
SELECT * FROM GVA21 WHERE N_REMITO = @remito;
GO

-- ───────────────────────── 2) ARRANCAR LA TRAZA ─────────────────────────
IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = 'traza_anulacion_remito')
  DROP EVENT SESSION traza_anulacion_remito ON SERVER;
GO
CREATE EVENT SESSION traza_anulacion_remito ON SERVER
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
ADD TARGET package0.event_file (SET filename = N'C:\Temp\traza_anulacion_remito.xel', max_file_size = 100, max_rollover_files = 2)
WITH (MAX_DISPATCH_LATENCY = 3 SECONDS, STARTUP_STATE = OFF);
GO
ALTER EVENT SESSION traza_anulacion_remito ON SERVER STATE = START;
GO
-- >>> AHORA: en Tango (Ventas → Remitos → Anulación de remitos, o como lo haga la oficina)
-- >>> anular el R 0110500000425. Después seguir con el paso 3.
-- (Ojo: es la base real. La traza no frena nada ni cambia nada; solo mira. Si otra
--  persona carga comprobantes al mismo tiempo, esos también aparecen: por eso importa
--  la hora exacta de la anulación.)

-- ───────────────────────── 3) FOTO DESPUÉS ─────────────────────────
-- Repetir el bloque 1 tal cual (mismo @remito) y guardar las cuatro grillas.

-- ───────────────────────── 4) LEER LA TRAZA ─────────────────────────
IF OBJECT_ID('tempdb..#xe') IS NOT NULL DROP TABLE #xe;
SELECT CAST(event_data AS XML) AS x
INTO #xe
FROM sys.fn_xe_file_target_read_file('C:\Temp\traza_anulacion_remito*.xel', NULL, NULL, NULL);
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
ALTER EVENT SESSION traza_anulacion_remito ON SERVER STATE = STOP;
GO
DROP EVENT SESSION traza_anulacion_remito ON SERVER;
GO
