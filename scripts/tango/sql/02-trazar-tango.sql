-- Traza de lo que Tango escribe en SQL Server cuando un operador carga un RECIBO y un
-- REMITO (docs/tango/INTEGRACION.md §20, fase 1). Extended Events, no frena nada.
-- Correr en SSMS conectado a RHIELOTG como sa (o un login con ALTER ANY EVENT SESSION).
--
-- Lecciones de la primera corrida (2026-09-03): Tango ("Axoft Software") ejecuta casi todo
-- como sentencias preparadas (sp_prepare / sp_execute), así que el texto del INSERT NO está
-- en `sql_text` (que solo dice "exec sp_execute 12,...") sino en el campo `statement` del
-- evento. Y el ring_buffer corta en 1000 eventos por defecto. Por eso: filtro sobre
-- `statement`, evento sp_statement_completed para lo que corre dentro de procedimientos, y
-- destino en ARCHIVO. Y OJO: la pantalla Cobranzas NO se identifica como 'Axoft Software' (el
-- remito sí): no filtrar por client_app_name, solo por base.
--
-- Procedimiento (TestingRH, nunca en las empresas reales):
--   A) crear y arrancar  →  B) cargar a mano UN recibo y UN remito en Tango (TestingRH)
--   →  C) leer a una tabla y exportar CSV  →  D) borrar la sesión.

-- ───────────────────────────── BLOQUE A: crear y arrancar ─────────────────────────────
IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = 'traza_tango_rolito')
  DROP EVENT SESSION traza_tango_rolito ON SERVER;
GO
CREATE EVENT SESSION traza_tango_rolito ON SERVER
ADD EVENT sqlserver.sql_statement_completed (
  ACTION (sqlserver.client_app_name, sqlserver.database_name, sqlserver.session_id)
  WHERE sqlserver.database_name = N'TestingRH'
    AND (sqlserver.like_i_sql_unicode_string([statement], N'%INSERT%')
      OR sqlserver.like_i_sql_unicode_string([statement], N'%UPDATE%')
      OR sqlserver.like_i_sql_unicode_string([statement], N'%DELETE%'))
),
ADD EVENT sqlserver.sp_statement_completed (
  ACTION (sqlserver.client_app_name, sqlserver.database_name, sqlserver.session_id)
  WHERE sqlserver.database_name = N'TestingRH'
    AND (sqlserver.like_i_sql_unicode_string([statement], N'%INSERT%')
      OR sqlserver.like_i_sql_unicode_string([statement], N'%UPDATE%')
      OR sqlserver.like_i_sql_unicode_string([statement], N'%DELETE%'))
),
ADD EVENT sqlserver.rpc_completed (
  ACTION (sqlserver.client_app_name, sqlserver.database_name, sqlserver.session_id)
  WHERE sqlserver.database_name = N'TestingRH'
    AND (sqlserver.like_i_sql_unicode_string([statement], N'%INSERT%')
      OR sqlserver.like_i_sql_unicode_string([statement], N'%UPDATE%')
      OR sqlserver.like_i_sql_unicode_string([statement], N'%DELETE%')
      OR sqlserver.like_i_sql_unicode_string([statement], N'%sp_prepare%')
      OR sqlserver.like_i_sql_unicode_string([statement], N'%sp_prepexec%'))
)
ADD TARGET package0.event_file (SET filename = N'C:\Temp\traza_tango_rolito.xel', max_file_size = 100, max_rollover_files = 2)
WITH (MAX_DISPATCH_LATENCY = 3 SECONDS, STARTUP_STATE = OFF);
GO
ALTER EVENT SESSION traza_tango_rolito ON SERVER STATE = START;
GO
-- (si falla por la carpeta: crear C:\Temp en el servidor, o cambiar la ruta)

-- ───────────────────────────── BLOQUE C: leer lo capturado ────────────────────────────
IF OBJECT_ID('tempdb..#xe') IS NOT NULL DROP TABLE #xe;
SELECT CAST(event_data AS XML) AS x
INTO #xe
FROM sys.fn_xe_file_target_read_file('C:\Temp\traza_tango_rolito*.xel', NULL, NULL, NULL);

SELECT
  x.value('(event/@timestamp)[1]', 'datetime2')                                   AS momento,
  x.value('(event/@name)[1]', 'nvarchar(50)')                                     AS evento,
  x.value('(event/action[@name="session_id"]/value)[1]', 'int')                   AS sesion,
  x.value('(event/data[@name="object_name"]/value)[1]', 'nvarchar(200)')          AS objeto,
  x.value('(event/data[@name="statement"]/value)[1]', 'nvarchar(max)')            AS sentencia
FROM #xe
ORDER BY momento;
-- Guardar la grilla como CSV (clic derecho → Guardar resultados como...).

-- ───────────────────────────── BLOQUE D: limpiar ──────────────────────────────────────
ALTER EVENT SESSION traza_tango_rolito ON SERVER STATE = STOP;
GO
DROP EVENT SESSION traza_tango_rolito ON SERVER;
GO
