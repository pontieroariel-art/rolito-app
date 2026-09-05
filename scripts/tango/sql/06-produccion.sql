-- ============================================================================
-- 06 — Pasar la fase A (remitos y recibos por SQL) a PRODUCCIÓN.
-- Correr en SSMS del servidor RHIELOTG como sa (o un login sysadmin), bloque por bloque.
-- docs/tango/INTEGRACION.md §23. Idempotente: se puede volver a correr entero.
--
-- ANTES de este script, desde Tango (no por SQL) tienen que existir los talonarios:
--   REDONHIELO_SA : 1105 REM "Remito R App Rolito" (ya existía) y 1106 REC X "Recibos App Rolito"
--   Rolito        : 1107 REM y 1108 REC X (en Rolito 1104/1105 ya son las facturas A/B de ARCA)
-- Se crean igual que los de TestingRH del 2026-09-04 (Archivos > Carga inicial > Talonarios):
--   tipo de comprobante REM / REC, letra R / X, sucursal = punto de venta (01105/01106/01107/01108),
--   numeración desde 1, "Edita número: No", sin autoimpresor para REC.
-- El bloque D de abajo verifica que estén.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A) Contraseña larga para el login del servicio (reemplazar antes de correr;
--    la misma va en C:\RolitoSync\sql\bridge-sql.config.json → sql.password).
--    Nunca guardar la contraseña en el repo ni en el chat.
-- ---------------------------------------------------------------------------
USE master;
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'rolito_bridge')
  CREATE LOGIN rolito_bridge WITH PASSWORD = 'CAMBIAR-POR-UNA-CONTRASENA-LARGA', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF, DEFAULT_DATABASE = REDONHIELO_SA;
ELSE
  ALTER LOGIN rolito_bridge WITH PASSWORD = 'CAMBIAR-POR-UNA-CONTRASENA-LARGA', DEFAULT_DATABASE = REDONHIELO_SA;
GO

-- ---------------------------------------------------------------------------
-- B) Permisos en REDONHIELO_SA (mismos del script 05, que solo se corrió en TestingRH)
-- ---------------------------------------------------------------------------
USE REDONHIELO_SA;
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'rolito_bridge')
  CREATE USER rolito_bridge FOR LOGIN rolito_bridge;
ALTER ROLE db_datareader ADD MEMBER rolito_bridge;
-- Remito de ventas
GRANT INSERT ON STA14 TO rolito_bridge;
GRANT INSERT ON STA20 TO rolito_bridge;
GRANT INSERT ON STA14TY TO rolito_bridge;
GRANT UPDATE ON STA19 TO rolito_bridge;
-- Recibo de cobranza
GRANT INSERT ON GVA12 TO rolito_bridge;
GRANT INSERT ON GVA07 TO rolito_bridge;
GRANT INSERT ON GVA12TY TO rolito_bridge;
GRANT INSERT ON HISTORIAL_CUENTAS_CORRIENTES TO rolito_bridge;
GRANT UPDATE ON GVA14 TO rolito_bridge;
GRANT UPDATE ON GVA16 TO rolito_bridge;
GRANT UPDATE ON GVA46 TO rolito_bridge;
GRANT INSERT ON SBA04 TO rolito_bridge;
GRANT INSERT ON SBA05 TO rolito_bridge;
GRANT UPDATE ON SBA01 TO rolito_bridge;
GRANT INSERT ON COMPROBANTE_COTIZACION_SB TO rolito_bridge;
GRANT INSERT ON ASIENTO_COMPROBANTE_SB TO rolito_bridge;
GRANT INSERT ON ASIENTO_SB TO rolito_bridge;
-- Contadores y secuencias (Delta 6: ids por SEQUENCE, script 04)
GRANT UPDATE ON dbo.INCREMENTAL_VALUE TO rolito_bridge;
GRANT UPDATE ON OBJECT::dbo.SEQUENCE_HISTORIAL_CUENTAS_CORRIENTES TO rolito_bridge;
GRANT UPDATE ON OBJECT::dbo.SEQUENCE_COMPROBANTE_COTIZACION_SB TO rolito_bridge;
GRANT UPDATE ON OBJECT::dbo.SEQUENCE_ASIENTO_COMPROBANTE_SB TO rolito_bridge;
GRANT UPDATE ON OBJECT::dbo.SEQUENCE_ASIENTO_SB TO rolito_bridge;
GO

-- ---------------------------------------------------------------------------
-- C) Permisos en Rolito (mismo bloque). Si la base se llama distinto, cambiar el USE.
-- ---------------------------------------------------------------------------
USE Rolito;
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'rolito_bridge')
  CREATE USER rolito_bridge FOR LOGIN rolito_bridge;
ALTER ROLE db_datareader ADD MEMBER rolito_bridge;
GRANT INSERT ON STA14 TO rolito_bridge;
GRANT INSERT ON STA20 TO rolito_bridge;
GRANT INSERT ON STA14TY TO rolito_bridge;
GRANT UPDATE ON STA19 TO rolito_bridge;
GRANT INSERT ON GVA12 TO rolito_bridge;
GRANT INSERT ON GVA07 TO rolito_bridge;
GRANT INSERT ON GVA12TY TO rolito_bridge;
GRANT INSERT ON HISTORIAL_CUENTAS_CORRIENTES TO rolito_bridge;
GRANT UPDATE ON GVA14 TO rolito_bridge;
GRANT UPDATE ON GVA16 TO rolito_bridge;
GRANT UPDATE ON GVA46 TO rolito_bridge;
GRANT INSERT ON SBA04 TO rolito_bridge;
GRANT INSERT ON SBA05 TO rolito_bridge;
GRANT UPDATE ON SBA01 TO rolito_bridge;
GRANT INSERT ON COMPROBANTE_COTIZACION_SB TO rolito_bridge;
GRANT INSERT ON ASIENTO_COMPROBANTE_SB TO rolito_bridge;
GRANT INSERT ON ASIENTO_SB TO rolito_bridge;
GRANT UPDATE ON dbo.INCREMENTAL_VALUE TO rolito_bridge;
GRANT UPDATE ON OBJECT::dbo.SEQUENCE_HISTORIAL_CUENTAS_CORRIENTES TO rolito_bridge;
GRANT UPDATE ON OBJECT::dbo.SEQUENCE_COMPROBANTE_COTIZACION_SB TO rolito_bridge;
GRANT UPDATE ON OBJECT::dbo.SEQUENCE_ASIENTO_COMPROBANTE_SB TO rolito_bridge;
GRANT UPDATE ON OBJECT::dbo.SEQUENCE_ASIENTO_SB TO rolito_bridge;
GO

-- ---------------------------------------------------------------------------
-- D) VERIFICACIÓN (solo lectura). Pegar la salida en el chat.
--    Esperado por base: talonarios de la app presentes, 4 secuencias, depósitos 98 y 99,
--    ningún artículo CAMBIO* con stock, cuentas 1111000/1113003/1120001, vendedor AD, SBA02 11.
-- ---------------------------------------------------------------------------
USE REDONHIELO_SA;
PRINT '===== REDONHIELO_SA: talonarios de la app (esperado 1105 REM y 1106 REC) =====';
SELECT ID_GVA43, TALONARIO, COMPROB, DESCRIP, TIPO, SUCURSAL, NRO_DESDE, NRO_HASTA, TIPO_TALONARIO FROM GVA43 WHERE TALONARIO IN (1105, 1106, 1107, 1108) ORDER BY TALONARIO;
PRINT '===== REDONHIELO_SA: secuencias (esperado 4) =====';
SELECT name, current_value FROM sys.sequences WHERE name LIKE 'SEQUENCE_%' ORDER BY name;
PRINT '===== REDONHIELO_SA: depósitos 98/99 =====';
SELECT * FROM STA22 WHERE COD_STA22 IN ('98', '99');
PRINT '===== REDONHIELO_SA: saldos de stock de artículos CAMBIO* (esperado 0 filas) =====';
SELECT COD_ARTICU, COD_DEPOSI, CANT_STOCK FROM STA19 WHERE COD_ARTICU LIKE 'CAMBIO%';
PRINT '===== REDONHIELO_SA: cuentas de tesorería del recibo =====';
SELECT ID_SBA01, COD_CTA, DESCRIPCIO FROM SBA01 WHERE COD_CTA IN (1111000, 1113003, 1120001);
SELECT * FROM GVA23 WHERE COD_VENDED = 'AD';
SELECT * FROM SBA02 WHERE ID_SBA02 = 11;
PRINT '===== REDONHIELO_SA: permisos efectivos de rolito_bridge =====';
EXECUTE AS USER = 'rolito_bridge';
SELECT entity_name, permission_name FROM fn_my_permissions('STA14', 'OBJECT') WHERE permission_name = 'INSERT'
UNION ALL SELECT entity_name, permission_name FROM fn_my_permissions('GVA12', 'OBJECT') WHERE permission_name = 'INSERT'
UNION ALL SELECT entity_name, permission_name FROM fn_my_permissions('dbo.SEQUENCE_ASIENTO_SB', 'OBJECT') WHERE permission_name = 'UPDATE';
REVERT;
GO

USE Rolito;
PRINT '===== Rolito: talonarios de la app (esperado 1107 REM y 1108 REC) =====';
SELECT ID_GVA43, TALONARIO, COMPROB, DESCRIP, TIPO, SUCURSAL, NRO_DESDE, NRO_HASTA, TIPO_TALONARIO FROM GVA43 WHERE TALONARIO IN (1104, 1105, 1106, 1107, 1108) ORDER BY TALONARIO;
PRINT '===== Rolito: secuencias (esperado 4) =====';
SELECT name, current_value FROM sys.sequences WHERE name LIKE 'SEQUENCE_%' ORDER BY name;
PRINT '===== Rolito: depósitos 98/99 =====';
SELECT * FROM STA22 WHERE COD_STA22 IN ('98', '99');
PRINT '===== Rolito: saldos de stock de artículos CAMBIO* (esperado 0 filas) =====';
SELECT COD_ARTICU, COD_DEPOSI, CANT_STOCK FROM STA19 WHERE COD_ARTICU LIKE 'CAMBIO%';
PRINT '===== Rolito: cuentas de tesorería del recibo =====';
SELECT ID_SBA01, COD_CTA, DESCRIPCIO FROM SBA01 WHERE COD_CTA IN (1111000, 1113003, 1120001);
SELECT * FROM GVA23 WHERE COD_VENDED = 'AD';
SELECT * FROM SBA02 WHERE ID_SBA02 = 11;
PRINT '===== Rolito: permisos efectivos de rolito_bridge =====';
EXECUTE AS USER = 'rolito_bridge';
SELECT entity_name, permission_name FROM fn_my_permissions('STA14', 'OBJECT') WHERE permission_name = 'INSERT'
UNION ALL SELECT entity_name, permission_name FROM fn_my_permissions('GVA12', 'OBJECT') WHERE permission_name = 'INSERT'
UNION ALL SELECT entity_name, permission_name FROM fn_my_permissions('dbo.SEQUENCE_ASIENTO_SB', 'OBJECT') WHERE permission_name = 'UPDATE';
REVERT;
GO
