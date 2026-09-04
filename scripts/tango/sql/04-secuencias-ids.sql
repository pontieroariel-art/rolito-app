-- Seguimiento de la consulta (a) de §21.3: HISTORIAL_CUENTAS_CORRIENTES, COMPROBANTE_COTIZACION_SB,
-- ASIENTO_COMPROBANTE_SB y ASIENTO_SB NO son IDENTITY y no están en INCREMENTAL_VALUE.
-- ¿De dónde saca Tango esos ids? Si hay una SEQUENCE o un DEFAULT, el writer tiene que usarla
-- (MAX+1 chocaría con Tango más adelante). Solo lectura.
USE TestingRH;
SET NOCOUNT ON;

PRINT '===== (i) secuencias de la base =====';
SELECT name, current_value, increment FROM sys.sequences ORDER BY name;

PRINT '===== (j) defaults de las columnas ID de las 4 tablas =====';
SELECT OBJECT_NAME(c.object_id) AS tabla, c.name AS columna, dc.definition AS default_def
FROM sys.columns c
LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
WHERE OBJECT_NAME(c.object_id) IN ('HISTORIAL_CUENTAS_CORRIENTES','COMPROBANTE_COTIZACION_SB','ASIENTO_COMPROBANTE_SB','ASIENTO_SB')
  AND c.name LIKE 'ID[_]%'
ORDER BY tabla, columna;

PRINT '===== (k) triggers de esas tablas =====';
SELECT OBJECT_NAME(parent_id) AS tabla, name AS trigger_name
FROM sys.triggers
WHERE OBJECT_NAME(parent_id) IN ('HISTORIAL_CUENTAS_CORRIENTES','COMPROBANTE_COTIZACION_SB','ASIENTO_COMPROBANTE_SB','ASIENTO_SB')
ORDER BY tabla;

PRINT '===== (l) maximos actuales =====';
SELECT 'HISTORIAL_CUENTAS_CORRIENTES' t, MAX(ID_HISTORIAL) m FROM HISTORIAL_CUENTAS_CORRIENTES
UNION ALL SELECT 'COMPROBANTE_COTIZACION_SB', MAX(ID_COMPROBANTE_COTIZACION_SB) FROM COMPROBANTE_COTIZACION_SB
UNION ALL SELECT 'ASIENTO_COMPROBANTE_SB', MAX(ID_ASIENTO_COMPROBANTE_SB) FROM ASIENTO_COMPROBANTE_SB
UNION ALL SELECT 'ASIENTO_SB', MAX(ID_ASIENTO_SB) FROM ASIENTO_SB;

PRINT '===== (m) talonarios de la app (deberian existir 1105 REM y uno REC) =====';
SELECT ID_GVA43, TALONARIO, COMPROB, DESCRIP, TIPO, SUCURSAL, NRO_DESDE, NRO_HASTA, TIPO_TALONARIO
FROM GVA43 WHERE TALONARIO >= 1000 OR DESCRIP LIKE '%ROLITO%' OR DESCRIP LIKE '%APP%' ORDER BY TALONARIO;
