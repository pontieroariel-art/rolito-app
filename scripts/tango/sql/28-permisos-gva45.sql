-- Permiso para que el bridge escriba la orden de compra del remito de la app
-- como renglón de texto (GVA45), igual que lo tipea facturación (2026-09-21).
-- Correr en SSMS como sa, sobre REDONHIELO_SA. El bridge ya tenía DELETE (para
-- anular el remito); le falta INSERT. STA20 ya lo tenía por los renglones.

USE REDONHIELO_SA;
GO

GRANT INSERT ON GVA45 TO rolito_bridge;
GRANT SELECT ON GVA45 TO rolito_bridge;
GO

-- Control: tiene que listar INSERT, SELECT y DELETE sobre GVA45.
SELECT p.permission_name, p.state_desc
FROM sys.database_permissions p
JOIN sys.database_principals u ON u.principal_id = p.grantee_principal_id
WHERE u.name = 'rolito_bridge' AND p.major_id = OBJECT_ID('GVA45');
GO
