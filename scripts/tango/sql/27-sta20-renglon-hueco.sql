-- El renglón "hueco" que Tango deja en STA20 cuando un remito lleva un renglón
-- de texto (2026-09-21): todas las columnas del renglón con artículo y del hueco,
-- para que el bridge escriba el hueco igual que Tango. Remito R0110500000126
-- (ID_STA14 890847): renglón 1 = PTHIBOLROLI0002 x 235, renglones 2-4 = huecos.

USE REDONHIELO_SA;
GO

-- 1. Los cuatro renglones, todas las columnas.
SELECT * FROM STA20 WHERE ID_STA14 = 890847 ORDER BY N_RENGL_S;
GO

-- 2. Columnas de STA20 que NO admiten NULL y no tienen default (las que el
--    bridge tiene que mandar sí o sí), y las identity.
SELECT c.column_id, c.name AS columna, ty.name AS tipo, c.max_length, c.is_nullable, c.is_identity, d.definition AS valor_default
FROM sys.columns c
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
LEFT JOIN sys.default_constraints d ON d.object_id = c.default_object_id
WHERE c.object_id = OBJECT_ID('STA20')
ORDER BY c.column_id;
GO

-- 3. La cabecera de ese remito: ¿hay un contador de renglones que incluya los huecos?
SELECT * FROM STA14 WHERE ID_STA14 = 890847;
GO
