-- ============================================================================
-- 20 — Trazar el ingreso de PRODUCCIÓN (PDT) que la oficina carga a mano en Tango
-- (2026-09-14), para que la app lo grabe igual desde los pallets de la tablet
-- (Fase C de docs/tango/STOCK_REPARTO.md: produccionPallets → PDT → depósito 01/02).
--
-- Correr en SSMS sobre REDONHIELO_SA (producción), en modo GRILLA (Ctrl+D),
-- y guardar cada resultado con "Guardar resultados como" CSV (;) en
-- docs/tango/sql/muestras-pdt-<fecha>.csv (o pegar el texto). Son SOLO SELECT:
-- no modifica nada.
--
-- Qué quiero saber con esto (misma lógica que el writer movimientoStock.ts):
--   - el tipo PDT en STA13: TCOMP_IN_S (¿'IS'? ¿'IN'?), talonario de STOCK asociado,
--     si mueve stock, si es ingreso (E) y si lleva depósito en cabecera o por renglón;
--   - el talonario de stock del PDT en STA17 (código, sucursal, PROXIMO) — OJO: es un
--     talonario de STOCK, no el talonario de remito R (00025) que usa el reparto;
--   - cómo quedan STA14 (cabecera) y STA20 (renglones) de los últimos PDT cargados a
--     mano: depósito 01, cantidades en bolsas, unidad, LEYENDAs, USUARIO;
--   - qué avanza en STA19 (saldo por artículo/depósito) y en STA17.PROXIMO.
-- ============================================================================
USE REDONHIELO_SA;

-- 1) El tipo de comprobante PDT (y sus vecinos, por comparación).
SELECT * FROM STA13 WHERE T_COMP IN ('PDT', 'PRO', 'CAR', 'DES', 'VPR') ORDER BY T_COMP;

-- 2) Talonarios de stock: cuál es el del PDT (STA13.TALONARIO = STA17.TALONARIO).
SELECT TALONARIO, ID_STA17, DESCRIP, SUCURSAL, PROXIMO FROM STA17 ORDER BY TALONARIO;

-- 3) Los últimos 5 PDT cargados a mano: cabecera completa.
SELECT TOP 5 * FROM STA14 WHERE T_COMP = 'PDT' ORDER BY ID_STA14 DESC;

-- 4) Sus renglones (artículo, depósito, cantidad, E/S, unidad).
SELECT s20.* FROM STA20 s20
  JOIN (SELECT TOP 5 ID_STA14 FROM STA14 WHERE T_COMP = 'PDT' ORDER BY ID_STA14 DESC) u ON u.ID_STA14 = s20.ID_STA14
 ORDER BY s20.ID_STA14 DESC, s20.N_RENGL_S;

-- 5) Cuántos PDT hay por mes en el último año (para dimensionar y ver si son diarios o por turno).
SELECT CONVERT(char(7), FECHA_MOV, 120) AS mes, COUNT(*) AS comprobantes, SUM(1) AS filas
  FROM STA14 WHERE T_COMP = 'PDT' AND FECHA_MOV >= DATEADD(month, -12, GETDATE())
 GROUP BY CONVERT(char(7), FECHA_MOV, 120) ORDER BY mes;

-- 6) Artículos que entran por PDT (para mapearlos a los 7 productos de la tablet).
SELECT s20.COD_ARTICU, a.DESCRIPCIO, s20.COD_DEPOSI, COUNT(*) AS renglones, SUM(s20.CANTIDAD) AS cantidad
  FROM STA20 s20 JOIN STA14 s14 ON s14.ID_STA14 = s20.ID_STA14 LEFT JOIN STA11 a ON a.COD_ARTICU = s20.COD_ARTICU
 WHERE s14.T_COMP = 'PDT' AND s14.FECHA_MOV >= DATEADD(month, -3, GETDATE())
 GROUP BY s20.COD_ARTICU, a.DESCRIPCIO, s20.COD_DEPOSI ORDER BY cantidad DESC;

-- 7) Saldo actual de los artículos de hielo en el depósito 01 (para comparar después de la prueba).
SELECT COD_ARTICU, COD_DEPOSI, CANT_STOCK FROM STA19 WHERE COD_DEPOSI IN ('01', '02') AND COD_ARTICU LIKE 'PTHI%' ORDER BY COD_DEPOSI, COD_ARTICU;

-- 8) Tablas satélite que un PDT pudo haber tocado además de STA14/STA20/STA19 (imagen del talonario, partidas).
SELECT TOP 5 * FROM STA14TY WHERE ID_STA14 IN (SELECT TOP 5 ID_STA14 FROM STA14 WHERE T_COMP = 'PDT' ORDER BY ID_STA14 DESC);
