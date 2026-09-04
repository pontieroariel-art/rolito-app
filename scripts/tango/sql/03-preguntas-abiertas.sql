-- Consultas de la sección 21.3 de docs/tango/INTEGRACION.md. Solo lectura.
-- Correr en SSMS contra TestingRH con "Results to Text" (Ctrl+T) y guardar la salida
-- completa en docs/tango/sql/respuestas-21.3.txt.
USE TestingRH;
SET NOCOUNT ON;

PRINT '===== (a) columnas IDENTITY =====';
SELECT OBJECT_NAME(object_id) AS tabla, name AS columna
FROM sys.identity_columns
WHERE OBJECT_NAME(object_id) IN ('STA14','STA20','GVA12','GVA07','HISTORIAL_CUENTAS_CORRIENTES',
  'SBA04','SBA05','COMPROBANTE_COTIZACION_SB','ASIENTO_COMPROBANTE_SB','ASIENTO_SB')
ORDER BY tabla;

PRINT '===== (b) INCREMENTAL_VALUE =====';
SELECT * FROM dbo.INCREMENTAL_VALUE ORDER BY Tabla, Campo;

PRINT '===== (c) DIRECCION_ENTREGA del cliente 8465 =====';
SELECT TOP 5 * FROM DIRECCION_ENTREGA WHERE ID_GVA14 = 8465;

PRINT '===== (d1) SBA01 cuentas de tesoreria =====';
SELECT * FROM SBA01 WHERE COD_CTA IN (1120001, 1111000);

PRINT '===== (d2) CUENTA contable =====';
SELECT * FROM CUENTA WHERE ID_CUENTA IN (1062, 601);

PRINT '===== (e) SBA02 tipo de comprobante 11 =====';
SELECT * FROM SBA02 WHERE ID_SBA02 = 11;

PRINT '===== (f) MEDIDA 17 =====';
SELECT * FROM MEDIDA WHERE ID_MEDIDA = 17;

PRINT '===== (h) talonarios de recibos (para elegir el de la app) =====';
SELECT ID_GVA43, TALONARIO, DESCRIPCIO, TIPO_COMP, LETRA, PROX_NUMER, NRO_SUCURS, ACTIVO
FROM GVA43 WHERE TIPO_COMP IN ('REC','R') ORDER BY TIPO_COMP, TALONARIO;
