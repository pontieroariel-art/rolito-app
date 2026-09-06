-- ============================================================================
-- 08 — Movimientos de STOCK por SQL (egreso VPR por venta promo; fase B: CAR/DES).
-- Correr en SSMS del servidor RHIELOTG como sa (o un login sysadmin), bloque por bloque.
-- docs/tango/INTEGRACION.md §24. Idempotente: se puede volver a correr entero.
--
-- ANTES de este script, desde Tango (módulo STOCK, no Ventas) tienen que existir en
-- cada base (TestingRH para probar, REDONHIELO_SA para producción; en Rolito NO hace
-- falta: Rolito no lleva stock):
--   1. Talonario de stock (Stock > Archivos > Carga inicial > Talonarios):
--      descripción "VENTA PROMO APP ROLITO", sucursal 900, numeración desde 1,
--      "Edita número: No", sin autoimpresor. Código 900 (el código es el que va en la config).
--   2. Tipo de comprobante (Stock > Archivos > Carga inicial > Tipos de comprobante):
--      código VPR, descripción "VENTA PROMO (APP ROLITO)", movimiento EGRESO, afecta
--      stock Sí, sin valorizar, talonario asociado = el del punto 1.
-- El bloque C verifica que estén y muestra el ID_STA17 para config/tango.sql.stock.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A) Permisos en REDONHIELO_SA (los de remito ya los dio el 06: INSERT STA14/STA20,
--    UPDATE STA19, UPDATE INCREMENTAL_VALUE). Lo nuevo es numerar con el talonario
--    de stock: STA17.PROXIMO.
-- ---------------------------------------------------------------------------
USE REDONHIELO_SA;
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'rolito_bridge')
    CREATE USER rolito_bridge FOR LOGIN rolito_bridge;
GRANT SELECT ON STA13 TO rolito_bridge;
GRANT SELECT ON STA17 TO rolito_bridge;
GRANT UPDATE ON STA17 TO rolito_bridge;
GRANT INSERT ON STA14 TO rolito_bridge;
GRANT INSERT ON STA20 TO rolito_bridge;
GRANT UPDATE ON STA19 TO rolito_bridge;
GRANT UPDATE ON dbo.INCREMENTAL_VALUE TO rolito_bridge;
GO

-- ---------------------------------------------------------------------------
-- B) Lo mismo en TestingRH (para la prueba con --dry-run / --solo antes de prod).
-- ---------------------------------------------------------------------------
USE TestingRH;
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'rolito_bridge')
    CREATE USER rolito_bridge FOR LOGIN rolito_bridge;
GRANT SELECT ON STA13 TO rolito_bridge;
GRANT SELECT ON STA17 TO rolito_bridge;
GRANT UPDATE ON STA17 TO rolito_bridge;
GRANT INSERT ON STA14 TO rolito_bridge;
GRANT INSERT ON STA20 TO rolito_bridge;
GRANT UPDATE ON STA19 TO rolito_bridge;
GRANT UPDATE ON dbo.INCREMENTAL_VALUE TO rolito_bridge;
GO

-- ---------------------------------------------------------------------------
-- C) Verificación (correr en cada base, cambiando el USE). Tiene que salir:
--    - una fila VPR en STA13 con T_MOVIM 'S' (egreso) y TALONARIO 900
--    - el talonario "VENTA PROMO APP ROLITO" en STA17 con SUCURSAL 900 y PROXIMO 1
--    - permisos efectivos del bridge todos en 1
-- ---------------------------------------------------------------------------
USE REDONHIELO_SA;
SELECT T_COMP, DESCRIPCIO, T_MOVIM, TALONARIO, ID_STA13 FROM STA13 WHERE T_COMP IN ('VPR', 'CAR', 'DES', 'TRA') ORDER BY T_COMP;
SELECT TALONARIO, ID_STA17, DESCRIP, SUCURSAL, PROXIMO FROM STA17 ORDER BY TALONARIO;
EXECUTE AS USER = 'rolito_bridge';
SELECT
    HAS_PERMS_BY_NAME('dbo.STA17', 'OBJECT', 'UPDATE') AS upd_sta17,
    HAS_PERMS_BY_NAME('dbo.STA17', 'OBJECT', 'SELECT') AS sel_sta17,
    HAS_PERMS_BY_NAME('dbo.STA13', 'OBJECT', 'SELECT') AS sel_sta13,
    HAS_PERMS_BY_NAME('dbo.STA14', 'OBJECT', 'INSERT') AS ins_sta14,
    HAS_PERMS_BY_NAME('dbo.STA20', 'OBJECT', 'INSERT') AS ins_sta20,
    HAS_PERMS_BY_NAME('dbo.STA19', 'OBJECT', 'UPDATE') AS upd_sta19,
    HAS_PERMS_BY_NAME('dbo.INCREMENTAL_VALUE', 'OBJECT', 'UPDATE') AS upd_incremental;
REVERT;
GO

-- ---------------------------------------------------------------------------
-- D) Después de la primera prueba real: ver el egreso grabado por la app.
-- ---------------------------------------------------------------------------
-- SELECT TOP 5 ID_STA14, T_COMP, N_COMP, NCOMP_IN_S, TCOMP_IN_S, TALONARIO, COD_DEPOSI, COD_PRO_CL, FECHA_MOV, LEYENDA1, LEYENDA2, USUARIO
--   FROM STA14 WHERE T_COMP = 'VPR' ORDER BY ID_STA14 DESC;
-- SELECT COD_ARTICU, COD_DEPOSI, TIPO_MOV, CANTIDAD, CANT_PEND, NCOMP_IN_S, ID_STA14
--   FROM STA20 WHERE TCOMP_IN_S = '<tcompInS del VPR>' AND NCOMP_IN_S = '<NCOMP_IN_S de arriba>';
-- SELECT COD_ARTICU, COD_DEPOSI, CANT_STOCK FROM STA19 WHERE COD_DEPOSI = '<depósito del camión>' AND COD_UBIC1 = '';
