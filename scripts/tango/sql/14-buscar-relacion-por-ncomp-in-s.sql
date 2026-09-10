-- Buscar la relación factura ↔ remito por el número interno de stock del remito (NCOMP_IN_S). SOLO LECTURA.
-- Correr en SSMS contra REDONHIELO_SA con "Results to Text" (Ctrl+T) y guardar la salida en un archivo.
USE REDONHIELO_SA;
SET NOCOUNT ON;
GO

PRINT '===== (a) tablas de usuario con columna NCOMP_IN_S (fuera de STA14/STA20) =====';
SELECT OBJECT_NAME(c.object_id) AS tabla,
       STUFF((SELECT ', ' + c2.name FROM sys.columns c2 WHERE c2.object_id = c.object_id ORDER BY c2.column_id FOR XML PATH('')), 1, 2, '') AS columnas
FROM sys.columns c
WHERE c.name = 'NCOMP_IN_S' AND OBJECTPROPERTY(c.object_id, 'IsUserTable') = 1
  AND OBJECT_NAME(c.object_id) NOT IN ('STA14', 'STA20')
ORDER BY tabla;
GO

PRINT '===== (b) en cada una de esas tablas, filas de los remitos de ALGAR (NCOMP_IN_S 00407576, 00407131, 00405647, 00404788) =====';
DECLARE @t sysname, @sql nvarchar(max);
DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
  SELECT OBJECT_NAME(c.object_id)
  FROM sys.columns c
  WHERE c.name = 'NCOMP_IN_S' AND OBJECTPROPERTY(c.object_id, 'IsUserTable') = 1
    AND OBJECT_NAME(c.object_id) NOT IN ('STA14', 'STA20')
    AND OBJECT_NAME(c.object_id) NOT LIKE '%AxTsDeleted%' AND OBJECT_NAME(c.object_id) NOT LIKE '%AxBACKUP%';
OPEN cur;
FETCH NEXT FROM cur INTO @t;
WHILE @@FETCH_STATUS = 0
BEGIN
  PRINT '--- ' + @t + ' ---';
  SET @sql = N'SELECT TOP 20 * FROM ' + QUOTENAME(@t) + N' WHERE NCOMP_IN_S IN (''00407576'', ''00407131'', ''00405647'', ''00404788'')';
  BEGIN TRY EXEC sp_executesql @sql; END TRY BEGIN CATCH PRINT '   error: ' + ERROR_MESSAGE(); END CATCH;
  FETCH NEXT FROM cur INTO @t;
END
CLOSE cur; DEALLOCATE cur;
GO

PRINT '===== (c) tablas con columna NCOMP_IN_V (número interno de la factura) que no sean GVA12/GVA53 =====';
SELECT OBJECT_NAME(c.object_id) AS tabla,
       STUFF((SELECT ', ' + c2.name FROM sys.columns c2 WHERE c2.object_id = c.object_id ORDER BY c2.column_id FOR XML PATH('')), 1, 2, '') AS columnas
FROM sys.columns c
WHERE c.name = 'NCOMP_IN_V' AND OBJECTPROPERTY(c.object_id, 'IsUserTable') = 1
  AND OBJECT_NAME(c.object_id) NOT IN ('GVA12', 'GVA53')
ORDER BY tabla;
GO

PRINT '===== (d) número interno de las facturas de ALGAR (NCOMP_IN_V), para cruzar =====';
SELECT ID_GVA12, N_COMP, TCOMP_IN_V, NCOMP_IN_V, FECHA_EMIS, ESTADO
FROM GVA12 WHERE COD_CLIENT = 'PA.003' AND T_COMP = 'FAC' AND FECHA_EMIS >= '2026-07-01' ORDER BY FECHA_EMIS;
GO

PRINT '===== (e) renglones del remito R0000100482053 (ID_STA14 890223): columnas de facturación =====';
SELECT ID_STA20, N_RENGL_S, COD_ARTICU, CANTIDAD, CANT_FACTU, CANT_PEND, DCTO_FACTU, NCOMP_IN_S, TCOMP_IN_S
FROM STA20 WHERE ID_STA14 = 890223;
GO
