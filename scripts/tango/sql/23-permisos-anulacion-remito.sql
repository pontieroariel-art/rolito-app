-- 23-permisos-anulacion-remito.sql — lo que le falta al bridge para ANULAR un remito (2026-09-20).
-- Correr en SSMS como sysadmin sobre REDONHIELO_SA.
-- Ver docs/tango/ANULACION-REMITO-receta.md.
--
-- Por qué: hasta hoy todos los writers del bridge solo INSERTAN o ACTUALIZAN.
-- Anular un remito es el primero que BORRA filas — así lo hace Tango: los
-- renglones del movimiento y lo que cuelga de ellos se eliminan, y la cabecera
-- queda con ESTADO_MOV = 'A'. El dry-run del 20/09 rebotó con
-- "The DELETE permission was denied on the object 'STA09'", que es exactamente
-- para lo que sirve un dry-run.
--
-- Solo REDONHIELO_SA: el remito R del camión es de esa empresa.

USE REDONHIELO_SA;
GO

-- 1. Los siete DELETE de la secuencia, en el orden en que los hace Tango.
GRANT DELETE ON STA09  TO rolito_bridge;   -- por renglón
GRANT DELETE ON STA07  TO rolito_bridge;   -- por renglón (series / partidas)
GRANT DELETE ON GVA106 TO rolito_bridge;   -- por renglón
GRANT DELETE ON GVA54  TO rolito_bridge;   -- por renglón (relación remito ↔ factura)
GRANT DELETE ON STA20  TO rolito_bridge;   -- los renglones del movimiento, juntos
GRANT DELETE ON GVA45  TO rolito_bridge;
GRANT DELETE ON GVA55  TO rolito_bridge;
-- Y marcar la cabecera como anulada. INSERT ya lo tenía (emite remitos); UPDATE no.
GRANT UPDATE ON STA14  TO rolito_bridge;
GO

-- 2. Verificación: los siete tienen que dar 1, y de paso se confirma que
--    seguimos SIN permiso de borrar la cabecera (STA14), que es a propósito —
--    el remito anulado no se elimina, se vacía.
EXECUTE AS USER = 'rolito_bridge';
SELECT HAS_PERMS_BY_NAME('dbo.STA09',  'OBJECT', 'DELETE') AS del_sta09,
       HAS_PERMS_BY_NAME('dbo.STA07',  'OBJECT', 'DELETE') AS del_sta07,
       HAS_PERMS_BY_NAME('dbo.GVA106', 'OBJECT', 'DELETE') AS del_gva106,
       HAS_PERMS_BY_NAME('dbo.GVA54',  'OBJECT', 'DELETE') AS del_gva54,
       HAS_PERMS_BY_NAME('dbo.STA20',  'OBJECT', 'DELETE') AS del_sta20,
       HAS_PERMS_BY_NAME('dbo.GVA45',  'OBJECT', 'DELETE') AS del_gva45,
       HAS_PERMS_BY_NAME('dbo.GVA55',  'OBJECT', 'DELETE') AS del_gva55,
       HAS_PERMS_BY_NAME('dbo.STA14',  'OBJECT', 'UPDATE') AS upd_sta14,
       HAS_PERMS_BY_NAME('dbo.STA14',  'OBJECT', 'DELETE') AS del_sta14_debe_ser_0;
REVERT;
GO
