-- 17 · Nota de crédito por el Facturador, segunda tanda (2026-09-10). Solo lecturas, REDONHIELO_SA.
-- Primera tanda (16): los talonarios 1001/1003 de la app son GVA43.COMPROB = 'CRE' (no CDE ni N/C)
-- y en GVA12 los tipos usados son propios (NCB 2868, NCT 135, NC1, NC, N/C solo 1 en 2024, CDP, CIN...).
-- Hipótesis: codigoTipoComprobante del Facturador = código de GVA45 (tipos de comprobante de ventas).
-- Correr con Ctrl+T (resultados a texto) y pegar todo.

-- (1) Tipos de comprobante de ventas: código, descripción y a qué clase pertenecen
SELECT * FROM GVA45 ORDER BY T_COMP;

-- (2) La NC A 01104-00000001 que se cargó a mano (o cualquier comprobante de hoy que no sea factura ni recibo)
SELECT TOP 5 ID_GVA12, T_COMP, N_COMP, FECHA_EMIS, TALONARIO, COD_CLIENT, IMPORTE, ESTADO, TCOMP_IN_V, NCOMP_IN_V, AFEC_STK, CANC_COMP, COD_VENDED
FROM GVA12
WHERE N_COMP LIKE '%0110400000001%'
   OR (FECHA_EMIS >= '2026-09-09' AND T_COMP NOT IN ('FAC', 'REC'))
ORDER BY ID_GVA12 DESC;

-- (3) Renglones del comprobante más reciente de (2)
SELECT TOP 20 r.*
FROM GVA53 r
WHERE r.N_COMP = (SELECT TOP 1 N_COMP FROM GVA12 WHERE N_COMP LIKE '%0110400000001%' OR (FECHA_EMIS >= '2026-09-09' AND T_COMP NOT IN ('FAC','REC')) ORDER BY ID_GVA12 DESC)
  AND r.T_COMP = (SELECT TOP 1 T_COMP FROM GVA12 WHERE N_COMP LIKE '%0110400000001%' OR (FECHA_EMIS >= '2026-09-09' AND T_COMP NOT IN ('FAC','REC')) ORDER BY ID_GVA12 DESC);

-- (4) Cómo se imputó contra la factura (cualquier NC de los últimos 30 días)
SELECT TOP 10 ID_GVA07, T_COMP, N_COMP, T_COMP_CAN, N_COMP_CAN, IMPORT_CAN, F_COMP_CAN
FROM gva07
WHERE T_COMP_CAN IN (SELECT T_COMP FROM GVA45) AND T_COMP_CAN NOT IN ('REC')
ORDER BY ID_GVA07 DESC;

-- (5) Motivos de nota de crédito (perfil del Facturador)
SELECT * FROM AXV_PERFIL_NOTA_CREDITO;

-- (6) Las últimas 5 NC tipo NCB / NCT: talonario y número, para ver con qué talonario las hace la oficina
SELECT TOP 5 ID_GVA12, T_COMP, N_COMP, FECHA_EMIS, TALONARIO, COD_CLIENT, IMPORTE
FROM GVA12 WHERE T_COMP IN ('NCB', 'NCT', 'NC1', 'NC') ORDER BY ID_GVA12 DESC;
