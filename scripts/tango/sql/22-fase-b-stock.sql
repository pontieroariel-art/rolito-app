-- 22-fase-b-stock.sql — Fase B del stock (docs/tango/INTEGRACION.md §36, 2026-09-17)
-- Correr en SSMS sobre la base de REDONHIELO (la única que lleva stock) con un usuario de lectura.
-- No modifica nada. Cada bloque va en su propio batch (GO) para que uno que falle no tape a los otros.
-- v2 (22:05): STA13 no tiene TCOMP_IN_S (la transferencia es T_MOVIM = 'T'), los depósitos son STA22
-- (no STA10) y STA11 no tiene LLEVA_STOCK: se piden las columnas por INFORMATION_SCHEMA.
-- Con el resultado se cargan los tres tipos nuevos en la app:
--   node scripts/tango/configurar-stock-tango.mjs --tipo merma            tipo=transferencia tComp=<A> tcompInS=TI talonario=<B> depositoDestino=99 habilitado=false
--   node scripts/tango/configurar-stock-tango.mjs --tipo diferencia       tipo=transferencia tComp=<C> tcompInS=TI talonario=<D> depositoDestino=98 habilitado=false
--   node scripts/tango/configurar-stock-tango.mjs --tipo cambioVentanilla tipo=transferencia tComp=<A> tcompInS=TI talonario=<B> depositoDestino=99 habilitado=false

-- ---------------------------------------------------------------------------
-- A) TODOS los tipos de comprobante de stock. Las transferencias son T_MOVIM = 'T'.
--    Buscamos el de la merma (camión → 99) y el de la diferencia (camión → 98).
--    En la traza del 05/09 había MER "DESCARGA Y MERMA" (talonario 4), CAM (6) y AJU (5).
-- ---------------------------------------------------------------------------
SELECT T_COMP, DESCRIPCIO, T_MOVIM, TALONARIO, ID_STA13
  FROM STA13
 ORDER BY T_MOVIM, T_COMP;
GO

-- B) Los talonarios de stock: el de cada tipo tiene que existir acá y tener PROXIMO.
SELECT TALONARIO, ID_STA17, DESCRIP, SUCURSAL, PROXIMO
  FROM STA17
 ORDER BY TALONARIO;
GO

-- C) Los depósitos (STA22). Tienen que estar 99 MERMA EN CAMIONES y 98 DIFERENCIAS DE REPARTO.
SELECT *
  FROM STA22
 ORDER BY 1;
GO

-- D1) Qué columna de STA11 dice si el artículo lleva stock (el nombre cambia según la versión).
SELECT COLUMN_NAME, DATA_TYPE
  FROM INFORMATION_SCHEMA.COLUMNS
 WHERE TABLE_NAME = 'STA11' AND (COLUMN_NAME LIKE '%STOCK%' OR COLUMN_NAME LIKE '%LLEVA%')
 ORDER BY COLUMN_NAME;
GO

-- D2) Los artículos CAMBIO*: deberían quedar como "no lleva stock" para que el cambio de la
--     venta no descuente dos veces (la bolsa real ya va al 99 como merma).
SELECT *
  FROM STA11
 WHERE COD_ARTICU LIKE 'CAMBIO%' OR DESCRIPCIO LIKE '%CAMBIO%'
 ORDER BY COD_ARTICU;
GO

-- E) Control: movimientos que ya hay hacia 98 / 99 y con qué tipo de comprobante se hicieron.
SELECT r.COD_DEPOSI, c.T_COMP, COUNT(*) AS renglones, MIN(c.FECHA_MOV) AS desde, MAX(c.FECHA_MOV) AS hasta
  FROM STA20 r JOIN STA14 c ON c.ID_STA14 = r.ID_STA14
 WHERE r.COD_DEPOSI IN ('98', '99')
 GROUP BY r.COD_DEPOSI, c.T_COMP
 ORDER BY r.COD_DEPOSI, c.T_COMP;
GO
