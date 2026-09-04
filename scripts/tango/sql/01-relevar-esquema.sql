-- Relevamiento del esquema de Tango para el proyecto "remitos y recibos por SQL Server"
-- (docs/tango/INTEGRACION.md §20). Correr en SQL Server Management Studio contra la
-- base de TestingRH (Company 5). Solo lectura: no modifica nada.
--
-- Paso 0: ¿qué bases hay y cuál es cuál? (Tango nombra las bases por empresa)
SELECT name, create_date, state_desc FROM sys.databases ORDER BY name;

-- Paso 1: tablas candidatas. Tango Gestión (Ventas = GVA*, Tesorería = SBA*, Stock = STA*).
-- Las que nos importan para un RECIBO y un REMITO, según lo relevado por la API:
--   GVA12  comprobantes de ventas (facturas, NC/ND, recibos: ID_GVA12 es el id que devuelven
--          las consultas Live de deudas y GetApiLiveQueryData 17943)
--   GVA13  renglones de comprobantes de ventas (artículos)
--   GVA14  clientes (ID_GVA14 / COD_GVA14)
--   GVA43  talonarios (numeración: el remito R 1105 y el talonario de recibos)
--   GVA20 / GVA30 / GVA47  cuenta corriente e imputaciones (a confirmar con la traza)
--   SBA01 / SBA04  movimientos de tesorería y su detalle (a confirmar con la traza)
--   STA14 / STA20  remitos de ventas y sus renglones (a confirmar)
--   STA11 artículos, STA22 depósitos, STA19 saldos de stock por depósito
SELECT t.name AS tabla, COUNT(c.column_id) AS columnas
FROM sys.tables t JOIN sys.columns c ON c.object_id = t.object_id
WHERE t.name LIKE 'GVA1[234]%' OR t.name LIKE 'GVA2%' OR t.name LIKE 'GVA3%' OR t.name LIKE 'GVA4[37]%'
   OR t.name LIKE 'SBA0%' OR t.name LIKE 'STA1[1349]%' OR t.name LIKE 'STA2[02]%'
GROUP BY t.name ORDER BY t.name;

-- Paso 2: columnas de las tablas clave (para armar los INSERT después de la traza).
SELECT t.name AS tabla, c.column_id, c.name AS columna, ty.name AS tipo, c.max_length, c.is_nullable, c.is_identity
FROM sys.tables t
JOIN sys.columns c ON c.object_id = t.object_id
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
WHERE t.name IN ('GVA12', 'GVA13', 'GVA20', 'GVA30', 'GVA43', 'GVA47', 'SBA01', 'SBA04', 'STA14', 'STA20')
ORDER BY t.name, c.column_id;

-- Paso 3: triggers y procedimientos que Tango tenga sobre esas tablas (si Tango mantiene
-- saldos por trigger, un INSERT nuestro los dispara solo; si lo hace la aplicación, hay
-- que replicarlo a mano).
SELECT OBJECT_NAME(parent_id) AS tabla, name AS trigger_name, is_disabled
FROM sys.triggers WHERE parent_id IN (SELECT object_id FROM sys.tables WHERE name IN ('GVA12','GVA13','GVA20','GVA30','GVA47','SBA01','SBA04','STA14','STA20'))
ORDER BY tabla, name;

-- Paso 4: el último recibo y el último remito cargados a mano en esta base, para ver un
-- ejemplo real de cada uno (ajustar T_COMP si difiere: 'REC' recibo, 'REM' remito).
SELECT TOP 5 * FROM GVA12 WHERE T_COMP = 'REC' ORDER BY ID_GVA12 DESC;
SELECT TOP 5 * FROM GVA12 WHERE T_COMP = 'REM' ORDER BY ID_GVA12 DESC;

-- Paso 5: talonarios (numeración): el remito R del punto de venta 1105 y los de recibos.
SELECT * FROM GVA43 WHERE T_COMP IN ('REM', 'REC') ORDER BY TALONARIO;
