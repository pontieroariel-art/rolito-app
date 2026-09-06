-- ============================================================================
-- 09 — Consultas para DESPUÉS de la traza XE del egreso VPR y la transferencia (TestingRH).
-- Correr en SSMS sobre TestingRH, en modo GRILLA (Ctrl+D), y guardar cada resultado con
-- "Guardar resultados como" CSV (;) en docs/tango/sql/muestras-stock-vpr-<fecha>.csv
-- (o pegar el texto en muestras-stock-vpr-<fecha>.txt). Sirve para cerrar las hipótesis del
-- writer movimientoStock.ts (HIPOTESIS_TRAZA): TCOMP_IN_S del egreso, ancho de N_COMP,
-- columnas de la cabecera, CANT_PEND / IMPUESTO_INTERNO_FIJO del renglón, cómo avanza STA17.
-- ============================================================================
USE TestingRH;

-- 1) Los dos comprobantes recién grabados (el VPR y la transferencia), cabecera completa.
SELECT TOP 4 * FROM STA14 WHERE T_COMP IN ('VPR', 'TRA', 'CAR') ORDER BY ID_STA14 DESC;

-- 2) Sus renglones (reemplazar los NCOMP_IN_S / TCOMP_IN_S que salieron arriba).
SELECT s20.* FROM STA20 s20
  JOIN (SELECT TOP 4 ID_STA14 FROM STA14 WHERE T_COMP IN ('VPR', 'TRA', 'CAR') ORDER BY ID_STA14 DESC) u ON u.ID_STA14 = s20.ID_STA14
 ORDER BY s20.ID_STA14 DESC, s20.N_RENGL_S;

-- 3) Saldos del artículo de prueba en los depósitos tocados.
SELECT COD_ARTICU, COD_DEPOSI, COD_UBIC1, CANT_STOCK, ID_STA22, ID_STA11 FROM STA19
 WHERE COD_ARTICU = 'PTHIBOLROLI0010' AND COD_DEPOSI IN ('01', '03');

-- 4) Talonarios de stock (¿avanzó PROXIMO del VPR y del 13?) y el tipo VPR.
SELECT TALONARIO, ID_STA17, DESCRIP, SUCURSAL, PROXIMO FROM STA17 ORDER BY TALONARIO;
SELECT * FROM STA13 WHERE T_COMP IN ('VPR', 'TRA', 'CAR', 'DES');

-- 5) Contadores internos que pudo haber tocado Tango.
SELECT * FROM dbo.INCREMENTAL_VALUE WHERE Tabla IN ('STA14', 'STA17', 'STA19', 'STA20') ORDER BY Tabla, Campo;

-- 6) Tablas satélite que la traza puede mostrar (STA14TY imagen del talonario, partidas, auditoría).
SELECT name FROM sys.tables WHERE name LIKE 'STA14%' OR name LIKE 'STA20%' OR name LIKE 'STA19%' ORDER BY name;

-- 7) Tipos y longitudes de las columnas que escribe el writer (para ajustar varchar(n)).
SELECT t.name AS tabla, c.name AS columna, ty.name AS tipo, c.max_length, c.precision, c.scale, c.is_nullable, c.column_id
  FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id JOIN sys.types ty ON ty.user_type_id = c.user_type_id
 WHERE t.name IN ('STA14', 'STA20', 'STA19', 'STA17', 'STA13')
 ORDER BY t.name, c.column_id;

-- 8) Triggers de esas tablas (qué completan solos: ID_STA13, ID_STA11, ID_STA14, ID_STA22…).
SELECT t.name AS tabla, tr.name AS trigger_name, OBJECT_DEFINITION(tr.object_id) AS definicion
  FROM sys.triggers tr JOIN sys.tables t ON t.object_id = tr.parent_id
 WHERE t.name IN ('STA14', 'STA20', 'STA19', 'STA17')
 ORDER BY t.name, tr.name;
