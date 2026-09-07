-- 10-transferencias.sql — fase B del stock: remito de carga (CAR planta → camión) y
-- descarga (DES camión → planta) escritos por el bridge en REDONHIELO.
-- Correr en SSMS como sysadmin, sobre REDONHIELO_SA (y TestingRH si se prueba ahí).
-- docs/tango/INTEGRACION.md §29.

USE REDONHIELO_SA;   -- o TestingRH
GO

-- 1. Permiso nuevo: el bridge crea la fila de saldo (STA19) cuando un depósito
--    todavía no tiene el artículo (camión tercerizado en su primera carga).
GRANT INSERT ON STA19 TO rolito_bridge;
GO

-- 2. Verificaciones (solo lectura). Todo tiene que dar filas:
--    a) tipos CAR y DES existen y son transferencias (T_MOVIM = 'T') con talonario 13
SELECT ID_STA13, T_COMP, T_MOVIM, TALONARIO FROM STA13 WHERE T_COMP IN ('CAR', 'DES', 'TRA');
--    b) talonario 13 "TRASLADO ENTRE DEPOSITOS": sucursal y próximo número (el writer lo avanza)
SELECT TALONARIO, DESCRIP, SUCURSAL, PROXIMO FROM STA17 WHERE TALONARIO = 13;
--    c) permisos del login del bridge sobre las tablas de stock
EXECUTE AS USER = 'rolito_bridge';
SELECT HAS_PERMS_BY_NAME('dbo.STA14', 'OBJECT', 'INSERT') AS ins_sta14,
       HAS_PERMS_BY_NAME('dbo.STA20', 'OBJECT', 'INSERT') AS ins_sta20,
       HAS_PERMS_BY_NAME('dbo.STA19', 'OBJECT', 'UPDATE') AS upd_sta19,
       HAS_PERMS_BY_NAME('dbo.STA19', 'OBJECT', 'INSERT') AS ins_sta19,
       HAS_PERMS_BY_NAME('dbo.STA17', 'OBJECT', 'UPDATE') AS upd_sta17;
REVERT;
GO

-- 3. Saldos actuales de los productos de la app por depósito (planta 01/02 y camiones).
--    Los camiones sin fila se crean solos en la primera carga; los que están en negativo
--    son los que vendieron (VPR / remitos) sin carga previa: se corrigen con el
--    inventario inicial (AJU desde Tango) el día del corte.
SELECT s.COD_DEPOSI, d.NOMBRE_SUC, s.COD_ARTICU, s.CANT_STOCK
FROM STA19 s LEFT JOIN STA22 d ON d.COD_SUCURS = s.COD_DEPOSI
WHERE s.COD_ARTICU IN ('PTHIBOLROLI0002', 'PTHIBOLROLI0003', 'PTHIBOLROLI0010', 'PTHIBOLESCA0010', 'PTHIBOLPICA0010', 'PTHIBARRA', 'PTADDES001', 'PTADDES006', 'PTPLENBI005')
  AND s.COD_UBIC1 = '' AND s.COD_UBIC2 = '' AND s.COD_UBIC3 = ''
ORDER BY s.COD_DEPOSI, s.COD_ARTICU;
GO

-- 4. Después de la primera carga real: el CAR grabado por la app (LEYENDA1 = ROLITO:RC:<id>)
SELECT TOP 5 ID_STA14, T_COMP, N_COMP, NCOMP_IN_S, FECHA_MOV, LEYENDA1, LEYENDA2, USUARIO
FROM STA14 WHERE T_COMP IN ('CAR', 'DES') AND LEYENDA1 LIKE 'ROLITO:%' ORDER BY ID_STA14 DESC;
SELECT ID_STA20, TIPO_MOV, COD_DEPOSI, DEPOSI_DDE, COD_ARTICU, CANTIDAD, N_RENGL_S
FROM STA20 WHERE ID_STA14 = (SELECT MAX(ID_STA14) FROM STA14 WHERE T_COMP IN ('CAR', 'DES') AND LEYENDA1 LIKE 'ROLITO:%');
GO
