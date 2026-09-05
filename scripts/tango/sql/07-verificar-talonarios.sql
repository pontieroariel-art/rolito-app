-- 07 — Punto 1 del pase a producción (docs/tango/INTEGRACION.md §23): los talonarios de la app.
-- Solo lectura. Correr en SSMS de RHIELOTG (cualquier base; usa nombres de tres partes).
--
-- Paso previo: ver cómo quedaron los de TestingRH (1105 REM y 1106 REC, creados el 2026-09-04)
-- para copiarlos igual desde Tango en REDONHIELO_SA (1106) y en Rolito (1107 y 1108).
PRINT '===== TestingRH: los dos talonarios modelo =====';
SELECT 'TestingRH' AS base, * FROM TestingRH.dbo.GVA43 WHERE TALONARIO IN (1105, 1106) ORDER BY TALONARIO;

-- Después de crearlos en Tango: las tres bases lado a lado. Esperado:
--   REDONHIELO_SA: 1105 REM (ya estaba) y 1106 REC, iguales a TestingRH salvo ID_GVA43
--   Rolito       : 1104/1105 son las facturas A/B de ARCA (no tocar), 1107 REM y 1108 REC
PRINT '===== Las tres bases =====';
SELECT 'TestingRH'     AS base, * FROM TestingRH.dbo.GVA43     WHERE TALONARIO IN (1105, 1106)
UNION ALL
SELECT 'REDONHIELO_SA' AS base, * FROM REDONHIELO_SA.dbo.GVA43 WHERE TALONARIO IN (1105, 1106)
UNION ALL
SELECT 'Rolito'        AS base, * FROM Rolito.dbo.GVA43        WHERE TALONARIO IN (1104, 1105, 1107, 1108)
ORDER BY base, TALONARIO;
