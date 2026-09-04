-- Login SQL dedicado para el servicio bridge-sql.mjs (docs/tango/INTEGRACION.md §20.1).
-- Correr UNA vez como sa. Reemplazar la contraseña antes de ejecutar y guardarla solo en
-- C:\RolitoSync\sql\bridge-sql.config.json (nunca en el repo ni en el chat).
-- Permisos: lectura de toda la base (los writers leen clientes, artículos, stock, talonarios,
-- cuentas) y escritura solo en las tablas que tocan el remito y el recibo.
USE master;
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'rolito_bridge')
  CREATE LOGIN rolito_bridge WITH PASSWORD = 'CAMBIAR-ESTA-CONTRASENA', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF, DEFAULT_DATABASE = TestingRH;
GO

-- Repetir este bloque por base: TestingRH ahora; REDONHIELO_SA y Rolito cuando pase a producción.
USE TestingRH;
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
-- Contadores
GRANT UPDATE ON dbo.INCREMENTAL_VALUE TO rolito_bridge;
GO
