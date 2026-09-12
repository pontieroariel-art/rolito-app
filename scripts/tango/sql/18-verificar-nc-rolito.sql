-- 18 · Verificar lo que hay que tener en Tango para la nota de crédito de la app (2026-09-12).
-- Solo lecturas. Correr en SSMS de RHIELOTG contra la base Rolito (y repetir contra
-- REDONHIELO_SA cambiando los números de talonario: 1001/1003 y las facturas 1000/1002).
--
-- Esperado en Rolito:
--   (a) talonarios 1109 (NC letra A) y 1110 (NC letra B), T_COMP 'NC', punto de venta 01104,
--       manuales, próximo 1, iguales al 1104/1105 salvo el tipo de comprobante y la letra
--   (b) el tipo de comprobante 'NC' existe en ventas (GVA43 lo referencia) y en tesorería
--   (c) existe el motivo de nota de crédito 4

-- (a) Talonarios de la app: facturas X de promo (1104/1105) y NC nuevas (1109/1110), lado a lado
SELECT TALONARIO, T_COMP, DESCRIPCIO, PROXIMO, SUCURSAL, *
FROM GVA43
WHERE TALONARIO IN (1104, 1105, 1109, 1110)
ORDER BY TALONARIO;

-- (b) Tipos de comprobante en tesorería: tiene que aparecer 'NC' junto a 'C/E' y 'FAC'.
--     La tabla maestra de tesorería se busca por sus columnas, por si el nombre cambia entre versiones.
SELECT TABLE_NAME, COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE COLUMN_NAME IN ('T_COMP', 'COD_COMPROB', 'TIPO_COMP') AND TABLE_NAME LIKE 'SBA%'
ORDER BY TABLE_NAME;
-- Cuando sepas cuál es (suele ser SBA03), listá los tipos:
-- SELECT * FROM SBA03 WHERE T_COMP IN ('NC', 'C/E', 'FAC', 'N/C') ORDER BY T_COMP;

-- (c) Motivos de nota de crédito: buscar la tabla por su columna de motivo y listarla
SELECT TABLE_NAME, COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE COLUMN_NAME LIKE '%MOTIVO%' AND TABLE_NAME LIKE 'GVA%'
ORDER BY TABLE_NAME;
-- Ejemplo, si la tabla es GVA108 / GVAxx: SELECT * FROM GVAxx ORDER BY 1;
