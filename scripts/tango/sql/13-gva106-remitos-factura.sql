-- Confirmar GVA106 como relación factura ↔ remito (candidatas: GVA106, CTA_RELACION_PEDIDOS_FAC_REM, STA08). SOLO LECTURA.
-- Correr en SSMS contra REDONHIELO_SA con "Results to Text" (Ctrl+T) y guardar la salida en un archivo.
USE REDONHIELO_SA;
SET NOCOUNT ON;
GO

PRINT '===== (a) columnas de GVA106 =====';
SELECT c.name AS columna, t.name AS tipo
FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('GVA106') ORDER BY c.column_id;
GO

PRINT '===== (b) columnas de CTA_RELACION_PEDIDOS_FAC_REM =====';
SELECT c.name AS columna, t.name AS tipo
FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('CTA_RELACION_PEDIDOS_FAC_REM') ORDER BY c.column_id;
GO

PRINT '===== (c) columnas de STA08 =====';
SELECT c.name AS columna, t.name AS tipo
FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('STA08') ORDER BY c.column_id;
GO

PRINT '===== (d) GVA106: cuántas filas hay =====';
SELECT COUNT(*) AS total FROM GVA106;
GO

PRINT '===== (e) GVA106: últimas 10 filas =====';
SELECT TOP 10 * FROM GVA106 ORDER BY ID_GVA106 DESC;
GO

PRINT '===== (f) GVA106 de las facturas de ALGAR desde julio (por N_COMP) =====';
SELECT * FROM GVA106
WHERE N_COMP IN (SELECT N_COMP FROM GVA12 WHERE COD_CLIENT = 'PA.003' AND T_COMP = 'FAC' AND FECHA_EMIS >= '2026-07-01')
ORDER BY N_COMP;
GO

PRINT '===== (g) GVA106 de las facturas de ALGAR desde julio (por ID_GVA12) =====';
SELECT * FROM GVA106
WHERE ID_GVA12 IN (SELECT ID_GVA12 FROM GVA12 WHERE COD_CLIENT = 'PA.003' AND T_COMP = 'FAC' AND FECHA_EMIS >= '2026-07-01')
ORDER BY ID_GVA12;
GO

PRINT '===== (h) GVA106 de los remitos de ALGAR desde julio (por ID_STA14) =====';
SELECT * FROM GVA106
WHERE ID_STA14 IN (SELECT ID_STA14 FROM STA14 WHERE COD_PRO_CL = 'PA.003' AND T_COMP = 'REM' AND FECHA_MOV >= '2026-07-01');
GO

PRINT '===== (i) STA08 de los remitos de ALGAR desde julio =====';
SELECT TOP 20 * FROM STA08
WHERE ID_STA14 IN (SELECT ID_STA14 FROM STA14 WHERE COD_PRO_CL = 'PA.003' AND T_COMP = 'REM' AND FECHA_MOV >= '2026-07-01');
GO

PRINT '===== (j) tipos internos de las facturas de ALGAR: FR vs FC =====';
SELECT ID_GVA12, N_COMP, FECHA_EMIS, TCOMP_IN_V, ESTADO, IMPORTE
FROM GVA12 WHERE COD_CLIENT = 'PA.003' AND T_COMP = 'FAC' AND FECHA_EMIS >= '2026-07-01' ORDER BY FECHA_EMIS;
GO
