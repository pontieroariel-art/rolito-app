-- ¿Dónde queda el renglón "OC xxxxxx" que facturación tipea debajo del último
-- artículo, y las observaciones de la factura? (2026-09-21)
--
-- La oficina no usa las leyendas: escribe la orden de compra como un renglón de
-- texto del cuerpo de la factura y en "observaciones". Para que el lector de
-- comprobantes (scripts/tango/comprobantes-sync.mjs) la traiga, hay que saber en
-- qué tabla y columna quedan esas dos cosas. Correr en SSMS con el número de una
-- factura reciente hecha por la oficina CON orden de compra. Pegar los resultados
-- completos (una grilla por bloque; cada bloque corre por separado, así un error
-- en uno no frena a los demás).

USE REDONHIELO_SA;
GO

-- 1. Renglones del cuerpo (GVA53), TODAS las columnas: el renglón de texto tiene
--    que aparecer acá (con COD_ARTICU vacío o especial) o en la tabla del punto 2.
DECLARE @N_COMP varchar(20) = 'A0010100283346';   -- <- cambiar por una factura de la oficina con OC
SELECT * FROM GVA53 WHERE T_COMP = 'FAC' AND N_COMP = @N_COMP ORDER BY N_RENGL_V;
GO

-- 2. Textos ligados al comprobante (GVA55 se borra junto con el remito al anularlo).
DECLARE @N_COMP varchar(20) = 'A0010100283346';
SELECT * FROM GVA55 WHERE N_COMP = @N_COMP;
GO

-- 3. Columnas de GVA12, GVA53 y GVA55 que huelen a texto libre.
SELECT t.name AS tabla, c.name AS columna, ty.name AS tipo, c.max_length
FROM sys.columns c
JOIN sys.tables t ON t.object_id = c.object_id
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
WHERE t.name IN ('GVA12', 'GVA53', 'GVA55')
  AND (c.name LIKE '%OBSERV%' OR c.name LIKE '%DESC%' OR c.name LIKE '%LEYENDA%' OR c.name LIKE '%TEXTO%' OR c.name LIKE '%COMENT%' OR ty.name IN ('text', 'ntext'))
ORDER BY t.name, c.column_id;
GO

-- 4. Tablas de ventas que tienen una columna de observaciones (donde sea que Tango
--    guarde las de la factura) y qué dicen para esta factura.
DECLARE @N_COMP varchar(20) = 'A0010100283346';
DECLARE @sql nvarchar(max) = N'';
SELECT @sql += N'SELECT ''' + t.name + N''' AS tabla, ''' + c.name + N''' AS columna, CAST(' + QUOTENAME(c.name) + N' AS varchar(400)) AS valor FROM ' + QUOTENAME(t.name)
  + N' WHERE N_COMP = @n UNION ALL '
FROM sys.columns c
JOIN sys.tables t ON t.object_id = c.object_id
WHERE t.name LIKE 'GVA%' AND c.name LIKE '%OBSERV%'
  AND EXISTS (SELECT 1 FROM sys.columns c2 WHERE c2.object_id = t.object_id AND c2.name = 'N_COMP');
IF LEN(@sql) > 0
BEGIN
  SET @sql = LEFT(@sql, LEN(@sql) - LEN(' UNION ALL '));
  EXEC sp_executesql @sql, N'@n varchar(20)', @n = @N_COMP;
END
ELSE SELECT 'ninguna tabla GVA* con N_COMP tiene columna OBSERV*' AS aviso;
GO

-- 5. Búsqueda a fuerza bruta: cualquier tabla GVA* con esa factura y una columna de
--    texto que contenga 'OC', por si el renglón de texto está en otro lado.
DECLARE @N_COMP varchar(20) = 'A0010100283346';
DECLARE @sql nvarchar(max) = N'';
SELECT @sql += N'SELECT ''' + t.name + N''' AS tabla, ''' + c.name + N''' AS columna, CAST(' + QUOTENAME(c.name) + N' AS varchar(400)) AS valor FROM ' + QUOTENAME(t.name)
  + N' WHERE N_COMP = @n AND CAST(' + QUOTENAME(c.name) + N' AS varchar(400)) LIKE ''%OC%'' UNION ALL '
FROM sys.columns c
JOIN sys.tables t ON t.object_id = c.object_id
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
WHERE t.name LIKE 'GVA%' AND ty.name IN ('varchar', 'char', 'nvarchar', 'nchar', 'text')
  AND EXISTS (SELECT 1 FROM sys.columns c2 WHERE c2.object_id = t.object_id AND c2.name = 'N_COMP');
IF LEN(@sql) > 0
BEGIN
  SET @sql = LEFT(@sql, LEN(@sql) - LEN(' UNION ALL '));
  EXEC sp_executesql @sql, N'@n varchar(20)', @n = @N_COMP;
END
GO
