-- ¿Dónde guarda Tango la ORDEN DE COMPRA del cliente en una factura? (2026-09-21)
--
-- Las facturas hechas en Tango por la oficina salen sin O/C cuando la app las
-- regenera en PDF, porque el lector (scripts/tango/comprobantes-sync.mjs) solo
-- lee de GVA12 los campos de cabecera y no sabe en qué columna está la O/C. Las
-- de la app van en LEYENDA_5 del Facturador ("O. compra: ..."); las de la
-- oficina pueden ir en una columna propia o en otra leyenda. Este script lo
-- muestra para que el lector lea la columna correcta.
--
-- Correr en SSMS sobre REDONHIELO_SA (y Rolito si hace falta). Pegar los tres
-- resultados. Si sabés el número de una factura reciente CON orden de compra,
-- ponelo en @N_COMP (formato Tango, 'A0010100282930') para verla en el tercero.

DECLARE @N_COMP varchar(20) = NULL;   -- ej. 'A0010100282930'

-- 1. Columnas de la cabecera (GVA12) y del pedido (GVA21) que huelen a O/C o leyenda.
SELECT t.name AS tabla, c.name AS columna, ty.name AS tipo, c.max_length
FROM sys.columns c
JOIN sys.tables t ON t.object_id = c.object_id
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
WHERE t.name IN ('GVA12', 'GVA21')
  AND (c.name LIKE '%OC%' OR c.name LIKE '%ORDEN%' OR c.name LIKE '%LEYENDA%' OR c.name LIKE '%O_C%' OR c.name LIKE '%PEDIDO%')
ORDER BY t.name, c.column_id;

-- 2. Las últimas 15 facturas con lo que traen en leyendas (y NRO_PEDIDO si existe:
--    si esta consulta falla por una columna inexistente, borrala de la lista).
SELECT TOP 15 T_COMP, N_COMP, FECHA_EMIS, COD_CLIENT, COD_VENDED,
       LEYENDA_1, LEYENDA_2, LEYENDA_3, LEYENDA_4, LEYENDA_5
FROM GVA12
WHERE T_COMP = 'FAC'
ORDER BY FECHA_EMIS DESC, N_COMP DESC;

-- 3. Una factura puntual, columna por columna (para encontrar la O/C a ojo).
IF @N_COMP IS NOT NULL
  SELECT * FROM GVA12 WHERE N_COMP = @N_COMP;
