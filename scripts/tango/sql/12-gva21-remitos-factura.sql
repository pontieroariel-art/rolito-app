-- Confirmar la tabla que relaciona factura ↔ remito (candidatas: GVA21 y REFERENCIA_REMITO). SOLO LECTURA.
-- Correr en SSMS contra REDONHIELO_SA con "Results to Text" (Ctrl+T) y pegar la salida en el chat.
USE REDONHIELO_SA;
SET NOCOUNT ON;
GO

PRINT '===== (a) columnas de GVA21 =====';
SELECT c.name AS columna, t.name AS tipo
FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('GVA21') ORDER BY c.column_id;
GO

PRINT '===== (b) columnas de REFERENCIA_REMITO =====';
SELECT c.name AS columna, t.name AS tipo
FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('REFERENCIA_REMITO') ORDER BY c.column_id;
GO

PRINT '===== (c) GVA21 de las facturas de ALGAR desde julio (por N_COMP) =====';
SELECT * FROM GVA21
WHERE N_COMP IN (SELECT N_COMP FROM GVA12 WHERE COD_CLIENT = 'PA.003' AND T_COMP = 'FAC' AND FECHA_EMIS >= '2026-07-01')
ORDER BY N_COMP;
GO

PRINT '===== (d) GVA21 de los remitos de ALGAR desde julio (por N_REMITO) =====';
SELECT * FROM GVA21
WHERE N_REMITO IN (SELECT N_COMP FROM STA14 WHERE COD_PRO_CL = 'PA.003' AND T_COMP = 'REM' AND FECHA_MOV >= '2026-07-01')
ORDER BY N_REMITO;
GO

PRINT '===== (e) REFERENCIA_REMITO de los remitos de ALGAR desde julio =====';
SELECT * FROM REFERENCIA_REMITO
WHERE ID_STA14 IN (SELECT ID_STA14 FROM STA14 WHERE COD_PRO_CL = 'PA.003' AND T_COMP = 'REM' AND FECHA_MOV >= '2026-07-01');
GO

PRINT '===== (f) últimas 10 filas de GVA21, para ver cómo se ve una fila reciente =====';
SELECT TOP 10 * FROM GVA21 ORDER BY ID_GVA21 DESC;
GO

PRINT '===== (g) cuántas filas tiene GVA21 en total y cuántas con fecha de este año (para dimensionar el lector) =====';
SELECT COUNT(*) AS total FROM GVA21;
GO
SELECT COUNT(*) AS este_anio FROM GVA21 WHERE FECHA_REM >= '2025-09-01';
GO
