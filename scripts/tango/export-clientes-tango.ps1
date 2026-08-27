# export-clientes-tango.ps1
#
# Corre DENTRO de la red donde vive Tango (la VM por RDP) -- la API de Tango
# (http://rhielotg:17000) solo se puede pegar desde ahi adentro, no desde
# afuera. Trae TODOS los clientes via la API de Plataforma (proceso 2117) y
# los guarda en un JSON en el Escritorio.
#
# Uso:
#   1. Abri PowerShell en el servidor (no hace falta instalar nada mas).
#   2. Edita la linea Token de abajo con tu token de desarrollador (Tango
#      -> menu de usuario -> Desarrollador -> Generar).
#   3. .\export-clientes-tango.ps1
#   4. Te queda un archivo clientes-tango.json en el Escritorio.
#
# Nota (2026-08-26): la version anterior armaba el $uri interpolando
# "$BaseUrl?process=$Process&..." dentro de un string entre comillas
# dobles. Eso NO es un problema de encoding/caracteres invisibles como se
# penso al principio -- es que en PowerShell, cuando un $variable va
# pegado directo a un "?" (o a otro caracter no alfanumerico) dentro de
# un string interpolado, el parser puede comerse el nombre de la
# variable siguiente entera (busca una variable literal "BaseUrl?process",
# no existe, y da vacio). Por eso el $uri armado perdia pedazos enteros.
# Solucion: armar el $uri concatenando con "+", sin interpolacion, para
# no depender de este detalle raro del parser. Si igual falla, el bloque
# catch de abajo imprime el $uri exacto y su longitud para poder verlo.

$Token   = "PEGA_ACA_TU_TOKEN_DE_DESARROLLADOR"
$Company = "1"
$BaseUrl = "http://rhielotg:17000/Api/Get"
$Process = 2117          # Clientes
$PageSize = 200          # moderado, para no recargar el server de golpe
$OutFile = "$env:USERPROFILE\Desktop\clientes-tango.json"

if ($Token -eq "PEGA_ACA_TU_TOKEN_DE_DESARROLLADOR") {
  Write-Host "Edita el script primero: reemplaza `$Token con tu token real de Tango." -ForegroundColor Red
  exit 1
}

$headers = @{
  "ApiAuthorization" = $Token
  "Company"          = $Company
}

$todos = @()
$pageIndex = 0
$totalPages = 1

Write-Host "Descargando clientes de Tango (pageSize=$PageSize)..."

do {
  $uri = $BaseUrl + "?process=" + $Process + "&pageSize=" + $PageSize + "&pageIndex=" + $pageIndex + "&view="

  try {
    $resp = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
  } catch {
    Write-Host "Error en la pagina $pageIndex : $_" -ForegroundColor Red
    Write-Host "DEBUG uri=[$uri] length=$($uri.Length)" -ForegroundColor Yellow
    $codes = ($uri.ToCharArray() | ForEach-Object { [int]$_ }) -join ","
    Write-Host "DEBUG codepoints=$codes" -ForegroundColor Yellow
    break
  }

  if (-not $resp.succeeded) {
    Write-Host "La API respondio succeeded=false en la pagina $pageIndex : $($resp.message)" -ForegroundColor Red
    break
  }

  $totalPages = $resp.resultData.totalPages
  $lista = $resp.resultData.list

  # Solo los campos que nos importan para cruzar/mapear -- no hace falta
  # llevarse los ~80 campos completos de cada cliente.
  $recorte = $lista | ForEach-Object {
    [PSCustomObject]@{
      idGva14       = $_.ID_GVA14
      codGva14      = $_.COD_GVA14
      razonSocial   = $_.RAZON_SOCI
      nombreCom     = $_.NOM_COM
      cuit          = $_.CUIT
      email         = $_.E_MAIL
      telefono1     = $_.TELEFONO_1
      telefono2     = $_.TELEFONO_2
      habilitado    = $_.HABILITADO
      domicilio     = $_.DOMICILIO
      localidad     = $_.LOCALIDAD
      codigoPostal  = $_.C_POSTAL
      provincia     = $_.GVA18_DESCRIPCION
      categoriaIva  = $_.COD_CATEGORIA_IVA
      condicionVta  = $_.GVA01_DESC_COND
      listaPrecios  = $_.GVA10_NOMBRE_LIS
      nroListaPrecios = $_.GVA10_NRO_DE_LIS
      vendedor      = $_.GVA23_DESCRIPCION
      fechaAlta     = $_.FECHA_ALTA
    }
  }

  $todos += $recorte
  Write-Host "  pagina $($pageIndex + 1)/$totalPages -- $($todos.Count) clientes acumulados"
  $pageIndex++
  Start-Sleep -Milliseconds 400   # no golpear el server sin respiro
} while ($pageIndex -lt $totalPages)

$todos | ConvertTo-Json -Depth 5 | Out-File -FilePath $OutFile -Encoding utf8
Write-Host ""
Write-Host "Listo -- $($todos.Count) clientes guardados en:" -ForegroundColor Green
Write-Host $OutFile
