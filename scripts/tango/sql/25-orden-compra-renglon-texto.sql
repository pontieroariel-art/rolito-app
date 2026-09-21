-- ¿Dónde queda el renglón "OC xxxxxx" que facturación tipea debajo del último
-- artículo, y las observaciones de la factura? (2026-09-21)
--
-- La oficina no usa las leyendas: escribe la orden de compra como un renglón de
-- texto del cuerpo de la factura y en "observaciones". Para que el lector de
-- comprobantes (scripts/tango/comprobantes-sync.mjs) la traiga, hay que saber en
-- qué tabla y columna quedan esas dos cosas. Correr en SSMS sobre REDONHIELO_SA
-- con el número de una factura reciente hecha por la oficina CON orden de compra.
-- Pegar los resultados completos.

USE REDONHIELO_SA;
GO

DECLARE @N_COMP varchar(20) = 'A0010100283346';   -- <- cambiar por una factura de la oficina con OC

-- 1. Renglones del cuerpo (GVA53), TODAS las columnas: el renglón de texto tiene
--    que aparecer acá (con COD_ARTICU vacío o especial) o en la tabla del punto 2.
SELECT * FROM GVA53 WHERE T_COMP = 'FAC' AND N_COMP = @N_COMP ORDER BY N_RENGL_V;

-- 2. Textos por renglón / descripciones adicionales (GVA55 se borra junto con el
--    remito al anularlo, así que guarda texto ligado al comprobante).
SELECT * FROM GVA55 WHERE N_COMP = @N_COMP;

-- 3. Columnas de GVA12, GVA53 y GVA55 que huelen a texto libre.
SELECT t.name AS tabla, c.name AS columna, ty.name AS tipo, c.max_length
FROM sys.columns c
JOIN sys.tables t ON t.object_id = c.object_id
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
WHERE t.name IN ('GVA12', 'GVA53', 'GVA55')
  AND (c.name LIKE '%OBSERV%' OR c.name LIKE '%DESC%' OR c.name LIKE '%LEYENDA%' OR c.name LIKE '%TEXTO%' OR c.name LIKE '%COMENT%' OR ty.name IN ('text', 'ntext'))
ORDER BY t.name, c.column_id;

-- 4. Observaciones de la cabecera de esa factura (si la columna se llama distinto,
--    el punto 3 lo dice; ajustar y volver a correr).
SELECT T_COMP, N_COMP, OBSERVACIO FROM GVA12 WHERE N_COMP = @N_COMP;

-- 5. Cualquier tabla GVA* que tenga una fila con ese N_COMP y una columna de texto
--    que contenga 'OC ' : búsqueda a fuerza bruta, por si está en otro lado.
DECLARE @sql nvarchar(max) = N'';
SELECT @sql += N'SELECT ''' + t.name + N''' AS tabla, ''' + c.name + N''' AS columna, CAST(' + QUOTENAME(c.name) + N' AS varchar(200)) AS valor FROM ' + QUOTENAME(t.name)
  + N' WHERE N_COMP = @n AND CAST(' + QUOTENAME(c.name) + N' AS varchar(200)) LIKE ''%OC%'' UNION ALL '
FROM sys.columns c
JOIN sys.tables t ON t.object_id = c.object_id
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
WHERE t.name LIKE 'GVA%' AND ty.name IN ('varchar', 'char', 'nvarchar', 'text')
  AND EXISTS (SELECT 1 FROM sys.columns c2 WHERE c2.object_id = t.object_id AND c2.name = 'N_COMP');
IF LEN(@sql) > 0
BEGIN
  SET @sql = LEFT(@sql, LEN(@sql) - LEN(' UNION ALL '));
  EXEC sp_executesql @sql, N'@n varchar(20)', @n = @N_COMP;
END
