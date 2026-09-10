-- Relación remito → factura en Tango (composición de saldos con remitos, 2026-09-09). SOLO LECTURA.
-- Correr en SSMS contra REDONHIELO_SA (producción, no escribe nada) con "Results to Text" (Ctrl+T)
-- y pegar la salida completa en el chat o guardarla en docs/tango/sql/respuestas-11.txt.
-- Cada bloque va separado con GO: si uno falla por una columna que no existe, los demás corren igual.
USE REDONHIELO_SA;
SET NOCOUNT ON;
GO

PRINT '===== (a) tablas con alguna columna que hable de remito =====';
SELECT OBJECT_NAME(c.object_id) AS tabla, c.name AS columna, t.name AS tipo
FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
WHERE (c.name LIKE '%REMITO%' OR c.name LIKE '%STA14%' OR c.name LIKE '%REM%')
  AND OBJECTPROPERTY(c.object_id, 'IsUserTable') = 1
ORDER BY tabla, columna;
GO

PRINT '===== (b) columnas de GVA53 (renglones de facturas) =====';
SELECT c.name AS columna, t.name AS tipo
FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('GVA53') ORDER BY c.column_id;
GO

PRINT '===== (c) facturas de ALGAR (PA.003) desde 2026-07-01 =====';
SELECT ID_GVA12, T_COMP, N_COMP, FECHA_EMIS, IMPORTE, ESTADO
FROM GVA12 WHERE COD_CLIENT = 'PA.003' AND T_COMP IN ('FAC','N/C','N/D') AND FECHA_EMIS >= '2026-07-01'
ORDER BY FECHA_EMIS;
GO

PRINT '===== (d) remitos de ALGAR desde 2026-07-01 (STA14) =====';
SELECT ID_STA14, T_COMP, N_COMP, N_REMITO, FECHA_MOV, ESTADO_MOV, COD_PRO_CL, TALONARIO
FROM STA14 WHERE COD_PRO_CL = 'PA.003' AND T_COMP = 'REM' AND FECHA_MOV >= '2026-07-01'
ORDER BY FECHA_MOV;
GO

PRINT '===== (e) renglones de las facturas de ALGAR (GVA53 por T_COMP + N_COMP): ¿traen el remito? =====';
SELECT TOP 40 r.*
FROM GVA53 r
WHERE r.T_COMP = 'FAC' AND r.N_COMP IN (SELECT N_COMP FROM GVA12 WHERE COD_CLIENT = 'PA.003' AND T_COMP = 'FAC' AND FECHA_EMIS >= '2026-07-01')
ORDER BY r.N_COMP;
GO

PRINT '===== (f) renglones de los remitos de ALGAR (STA20): ¿apuntan a la factura? =====';
SELECT TOP 40 s.N_COMP AS remito, s.FECHA_MOV, r.*
FROM STA14 s JOIN STA20 r ON r.ID_STA14 = s.ID_STA14
WHERE s.COD_PRO_CL = 'PA.003' AND s.T_COMP = 'REM' AND s.FECHA_MOV >= '2026-07-01'
ORDER BY s.FECHA_MOV;
GO

PRINT '===== (g) un remito de la app ya facturado (si hay): estado =====';
SELECT TOP 5 ID_STA14, N_COMP, FECHA_MOV, ESTADO_MOV, COD_PRO_CL
FROM STA14 WHERE T_COMP = 'REM' AND N_COMP LIKE 'R01105%' AND ESTADO_MOV <> 'P'
ORDER BY FECHA_MOV DESC;
GO

PRINT '===== (h) cabecera completa de UN remito facturado de ALGAR, para ver todas sus columnas =====';
SELECT TOP 1 * FROM STA14 WHERE COD_PRO_CL = 'PA.003' AND T_COMP = 'REM' AND FECHA_MOV >= '2026-07-01' ORDER BY FECHA_MOV DESC;
GO
