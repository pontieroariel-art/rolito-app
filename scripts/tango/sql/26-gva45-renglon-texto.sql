-- Forma de GVA45 (leyendas por renglón) para que el bridge escriba la O/C del
-- remito de la app como renglón de texto, igual que lo tipea facturación
-- (2026-09-21). Pegar las cuatro grillas completas (pestaña Resultados).

USE REDONHIELO_SA;
GO

-- 1. Columnas de GVA45: nombre, tipo, largo, si admite NULL, si es identity, y su default.
SELECT c.column_id, c.name AS columna, ty.name AS tipo, c.max_length, c.precision, c.scale,
       c.is_nullable, c.is_identity, d.definition AS valor_default
FROM sys.columns c
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
LEFT JOIN sys.default_constraints d ON d.object_id = c.default_object_id
WHERE c.object_id = OBJECT_ID('GVA45')
ORDER BY c.column_id;
GO

-- 2. Las filas de GVA45 de la factura trazada, con todas las columnas.
SELECT * FROM GVA45 WHERE T_COMP = 'FAC' AND N_COMP = 'A0010100283346';
GO

-- 3. Cómo quedan los renglones de texto en un REMITO cargado por la oficina:
--    las últimas 10 filas de GVA45 de remitos, con todas las columnas.
SELECT TOP 10 * FROM GVA45 WHERE T_COMP = 'REM' ORDER BY N_COMP DESC;
GO

-- 4. Para el remito más reciente de esos, sus renglones en STA20: ¿tiene un
--    renglón "hueco" sin artículo (como la factura en GVA53) o solo los productos?
DECLARE @rem varchar(20) = (SELECT TOP 1 N_COMP FROM GVA45 WHERE T_COMP = 'REM' ORDER BY N_COMP DESC);
SELECT @rem AS remito;
SELECT s.ID_STA14, s.N_COMP, s.TALONARIO, r.N_RENGL_S, r.COD_ARTICU, r.CANTIDAD
FROM STA14 s JOIN STA20 r ON r.ID_STA14 = s.ID_STA14
WHERE s.T_COMP = 'REM' AND s.N_COMP = @rem
ORDER BY r.N_RENGL_S;
GO

-- 5. Índices y claves de GVA45 (para no chocar con una clave única al insertar).
SELECT i.name AS indice, i.is_unique, i.is_primary_key, STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS columnas
FROM sys.indexes i
JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE i.object_id = OBJECT_ID('GVA45')
GROUP BY i.name, i.is_unique, i.is_primary_key;
GO
