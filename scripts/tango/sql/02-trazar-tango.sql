-- Traza de lo que Tango escribe en SQL Server cuando un operador carga un RECIBO y un
-- REMITO (docs/tango/INTEGRACION.md §20, fase 1). Usa Extended Events, que viene con
-- SQL Server y no frena nada. Correr en SSMS, conectado al servidor de las bases,
-- como un login con permiso ALTER ANY EVENT SESSION (sysadmin sirve).
--
-- Procedimiento (una sola vez, en TestingRH, no en las empresas reales):
--   1. Ejecutar el BLOQUE A (crea y arranca la sesión). Reemplazar TestingRH_DB por el
--      nombre real de la base de TestingRH (ver 01-relevar-esquema.sql, paso 0).
--   2. En Tango, en la empresa TestingRH, cargar A MANO:
--        - un recibo de cobranza a un cliente con deuda, imputando una factura, en efectivo;
--        - un remito de ventas de 1 bolsa a un cliente.
--      Anotar la hora, el cliente, los números que asigna Tango.
--   3. Ejecutar el BLOQUE B (vuelca lo capturado a una tabla y la exporta).
--   4. Ejecutar el BLOQUE C (borra la sesión).
--   5. Mandarme el resultado del BLOQUE B (Guardar resultados como CSV desde SSMS, o
--      copiar la grilla). Con eso armo los INSERT exactos que hace Tango.

-- ───────────────────────────── BLOQUE A: crear y arrancar ─────────────────────────────
IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = 'traza_tango_rolito')
  DROP EVENT SESSION traza_tango_rolito ON SERVER;
GO
CREATE EVENT SESSION traza_tango_rolito ON SERVER
ADD EVENT sqlserver.sql_statement_completed (
  ACTION (sqlserver.client_app_name, sqlserver.database_name, sqlserver.session_id, sqlserver.sql_text)
  WHERE sqlserver.database_name = N'TestingRH_DB'   -- <── nombre real de la base de TestingRH
    AND (sqlserver.like_i_sql_unicode_string(sqlserver.sql_text, N'%INSERT%')
      OR sqlserver.like_i_sql_unicode_string(sqlserver.sql_text, N'%UPDATE%')
      OR sqlserver.like_i_sql_unicode_string(sqlserver.sql_text, N'%DELETE%')
      OR sqlserver.like_i_sql_unicode_string(sqlserver.sql_text, N'%EXEC%'))
),
ADD EVENT sqlserver.rpc_completed (
  ACTION (sqlserver.client_app_name, sqlserver.database_name, sqlserver.session_id, sqlserver.sql_text)
  WHERE sqlserver.database_name = N'TestingRH_DB'   -- <── idem
)
ADD TARGET package0.ring_buffer (SET max_memory = 65536)   -- 64 MB, sobra para dos comprobantes
WITH (MAX_DISPATCH_LATENCY = 5 SECONDS, STARTUP_STATE = OFF);
GO
ALTER EVENT SESSION traza_tango_rolito ON SERVER STATE = START;
GO

-- ───────────────────────────── BLOQUE B: leer lo capturado ────────────────────────────
-- Devuelve una fila por sentencia, en orden, con el texto completo. Tango usa sentencias
-- parametrizadas: en rpc_completed el texto viene con los valores reales.
;WITH datos AS (
  SELECT CAST(t.target_data AS XML) AS x
  FROM sys.dm_xe_sessions s
  JOIN sys.dm_xe_session_targets t ON t.event_session_address = s.address
  WHERE s.name = 'traza_tango_rolito'
)
SELECT
  e.value('@timestamp', 'datetime2')                                           AS momento,
  e.value('@name', 'nvarchar(50)')                                             AS evento,
  e.value('(action[@name="session_id"]/value)[1]', 'int')                      AS sesion,
  e.value('(action[@name="client_app_name"]/value)[1]', 'nvarchar(200)')       AS aplicacion,
  e.value('(data[@name="object_name"]/value)[1]', 'nvarchar(200)')             AS objeto,
  e.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)')               AS sentencia,
  e.value('(action[@name="sql_text"]/value)[1]', 'nvarchar(max)')              AS sql_text
FROM datos CROSS APPLY x.nodes('RingBufferTarget/event') AS n(e)
ORDER BY momento;
GO

-- ───────────────────────────── BLOQUE C: limpiar ──────────────────────────────────────
ALTER EVENT SESSION traza_tango_rolito ON SERVER STATE = STOP;
GO
DROP EVENT SESSION traza_tango_rolito ON SERVER;
GO
