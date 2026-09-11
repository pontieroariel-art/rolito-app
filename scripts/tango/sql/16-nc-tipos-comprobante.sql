-- 16 · Nota de crédito por el Facturador: por qué Redonhielo rechaza CDE / N/C (2026-09-10)
-- Correr en SSMS contra REDONHIELO_SA (solo lecturas). Objetivo: ver cómo está definido el
-- tipo de comprobante "nota de crédito" en esta empresa, qué talonarios tiene, y cómo quedó
-- grabada la NC que la oficina cargó A MANO (para compararla con lo que manda la app).
--
-- Contexto: el readme del Facturador (TangoSoftware/TangoDeltaApi, comprobantesregistracion)
-- admite codigoTipoComprobante en {FAC, CDE, CIN, DIN, N/D, CDC, DDC, CDP, NDM, AJD, AJC}.
-- Redonhielo responde "(78038) CDE no existe" y con 'N/C' "(78023) Items no puede ser vacío",
-- con y sin ítems. Hipótesis: los códigos son los de la tabla de tipos de comprobante de la
-- empresa (Redonhielo es una instalación migrada con códigos propios).

-- (a) ¿En qué tablas vive un código de tipo de comprobante? (buscar la tabla maestra)
SELECT TABLE_NAME, COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE COLUMN_NAME IN ('T_COMP', 'COD_COMPROB', 'TIPO_COMP', 'COD_TIPO_COMP')
ORDER BY TABLE_NAME;

-- (b) Tipos de comprobante usados en ventas (categorías reales de GVA12)
SELECT T_COMP, COUNT(*) AS cantidad, MIN(FECHA_EMIS) AS desde, MAX(FECHA_EMIS) AS hasta
FROM GVA12 GROUP BY T_COMP ORDER BY T_COMP;

-- (c) Talonarios de nota de crédito (los que creó Ariel: 1001 = NC A, 1003 = NC B) y de factura
SELECT TALONARIO, T_COMP, DESCRIPCIO, PROXIMO, SUCURSAL, *
FROM GVA43
WHERE TALONARIO IN (1000, 1001, 1002, 1003) OR T_COMP LIKE 'N/%' OR T_COMP IN ('CDE', 'CIN', 'CDC', 'CDP')
ORDER BY TALONARIO;

-- (d) La NC cargada a mano (la más reciente): cabecera completa
SELECT TOP 3 * FROM GVA12 WHERE T_COMP = 'N/C' ORDER BY ID_GVA12 DESC;

-- (e) Sus renglones (¿tiene ítems o es "por importe"?)
SELECT r.* FROM GVA53 r
WHERE r.T_COMP = 'N/C' AND r.N_COMP = (SELECT TOP 1 N_COMP FROM GVA12 WHERE T_COMP = 'N/C' ORDER BY ID_GVA12 DESC);

-- (f) Cómo quedó imputada contra la factura (gva07) y qué hizo con la factura
SELECT TOP 5 * FROM gva07
WHERE T_COMP_CAN = 'N/C' ORDER BY ID_GVA07 DESC;

-- (g) Motivos de nota de crédito (la app manda codigoMotivo 4 "anulación de fact. electrónica")
SELECT TABLE_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE COLUMN_NAME LIKE '%MOTIVO%' GROUP BY TABLE_NAME;

-- (h) Si existe una tabla maestra de tipos (resultado de (a)), listarla entera. Ejemplo:
-- SELECT * FROM <tabla> ORDER BY 1;
