-- ¿Se puede regenerar la factura y el remito de Tango desde SQL? (CAE, renglones, artículos, percepciones). SOLO LECTURA.
-- Correr en SSMS contra REDONHIELO_SA con "Results to Text" (Ctrl+T) y guardar la salida en un archivo.
USE REDONHIELO_SA;
SET NOCOUNT ON;
GO

PRINT '===== (a) columnas de GVA12 (cabecera de facturas) =====';
SELECT c.name AS columna, t.name AS tipo
FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('GVA12') ORDER BY c.column_id;
GO

PRINT '===== (b) cabecera completa de la factura A0010100282787 de ALGAR =====';
SELECT * FROM GVA12 WHERE T_COMP = 'FAC' AND N_COMP = 'A0010100282787';
GO

PRINT '===== (c) tablas con columna CAE / CAI (dónde guarda Tango la autorización de ARCA) =====';
SELECT OBJECT_NAME(c.object_id) AS tabla, c.name AS columna
FROM sys.columns c
WHERE (c.name LIKE '%CAE%' OR c.name LIKE '%CAI%') AND OBJECTPROPERTY(c.object_id, 'IsUserTable') = 1
  AND OBJECT_NAME(c.object_id) NOT LIKE 'TMP%' AND OBJECT_NAME(c.object_id) NOT LIKE '%AxBACKUP%'
ORDER BY tabla, columna;
GO

PRINT '===== (d) GVA12DE (datos electrónicos) de esa factura, si existe =====';
SELECT * FROM GVA12DE WHERE N_COMP = 'A0010100282787';
GO

PRINT '===== (e) renglones de esa factura con la descripción del artículo =====';
SELECT r.N_RENGL_V, r.COD_ARTICU, a.DESCRIPCIO, a.DESC_ADIC, r.CANTIDAD, r.PRECIO_NET, r.PORC_DTO, r.PORC_IVA, r.IMP_NETO_P, r.IMPORTE_GRAVADO, r.IMPORTE_EXENTO
FROM GVA53 r LEFT JOIN STA11 a ON a.COD_ARTICU = r.COD_ARTICU
WHERE r.T_COMP = 'FAC' AND r.N_COMP = 'A0010100282787' ORDER BY r.N_RENGL_V;
GO

PRINT '===== (f) percepciones / impuestos de esa factura (GVA47) =====';
SELECT * FROM GVA47 WHERE T_COMP = 'FAC' AND N_COMP = 'A0010100282787';
GO

PRINT '===== (g) renglones del remito R0000100482053 con descripción =====';
SELECT r.N_RENGL_S, r.COD_ARTICU, a.DESCRIPCIO, r.CANTIDAD, r.PRECIO_REM, r.COD_DEPOSI
FROM STA20 r LEFT JOIN STA11 a ON a.COD_ARTICU = r.COD_ARTICU
WHERE r.ID_STA14 = 890223 ORDER BY r.N_RENGL_S;
GO

PRINT '===== (h) talonarios de remitos 15 y 362: ¿tienen CAI? (GVA43) =====';
SELECT * FROM GVA43 WHERE ID_GVA43 IN (15, 362) OR TALONARIO IN (15, 362);
GO

PRINT '===== (i) dirección y datos fiscales del cliente PA.003 (GVA14) =====';
SELECT COD_GVA14, RAZON_SOCI, NOM_COM, DOMICILIO, LOCALIDAD, C_POSTAL, COD_PROVIN, CUIT, IVA, COND_VTA FROM GVA14 WHERE COD_GVA14 = 'PA.003';
GO

PRINT '===== (j) volumen 12 meses: facturas y remitos por mes =====';
SELECT CONVERT(char(7), FECHA_EMIS, 120) AS mes, COUNT(*) AS facturas FROM GVA12 WHERE T_COMP IN ('FAC','N/C','N/D') AND FECHA_EMIS >= '2025-09-01' GROUP BY CONVERT(char(7), FECHA_EMIS, 120) ORDER BY mes;
GO
SELECT CONVERT(char(7), FECHA_MOV, 120) AS mes, COUNT(*) AS remitos FROM STA14 WHERE T_COMP = 'REM' AND FECHA_MOV >= '2025-09-01' GROUP BY CONVERT(char(7), FECHA_MOV, 120) ORDER BY mes;
GO
