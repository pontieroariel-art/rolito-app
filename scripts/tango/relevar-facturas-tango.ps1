# relevar-facturas-tango.ps1
#
# Corre DENTRO de la red donde vive Tango (la VM por RDP). Hermano de
# export-tablas-tango.ps1, pero apunta a las consultas LIVE (las de
# Ventas -> Consultas), no a los ABMs -- ver docs/tango/INTEGRACION.md 6.1 bis.
#
# Para que sirve: para reimprimir las facturas viejas (las que emitia Bluesoft)
# con el formato de la app hacen falta los RENGLONES y el CAE, que la
# composicion de saldos (17953 / 17955) no trae. Este script releva la consulta
# de facturas de venta: baja su definicion de columnas y unas filas reales para
# ver que campos hay antes de escribir el sync.
#
# Uso:
#   1. En Tango: Ventas -> Consultas -> Facturas (o "Comprobantes de
#      facturacion"). Boton Apertura -> API. Ahi arriba figura el numero de
#      "process" de esa consulta. Anotalo.
#   2. Abri PowerShell en el servidor.
#   3. .\relevar-facturas-tango.ps1 -Process <NUMERO> -Token <TU_TOKEN>
#      (opcional: -Numero A0010100173697 para traer una factura puntual)
#   4. Te quedan los JSON en el Escritorio (tango-facturas\). Copialos al repo.
#
# Ojo con el armado del $uri: se concatena con "+" a proposito, NO se
# interpola (ver el comentario largo en export-clientes-tango.ps1).

param(
  [Parameter(Mandatory = $true)][int]$Process,
  [Parameter(Mandatory = $true)][string]$Token,
  [string]$Company  = "1",              # 1 = Redonhielo. Para Rolito, el otro valor.
  [string]$BaseUrl  = "http://rhielotg:17000",
  [string]$FromDate = "01/01/2024",     # dd/MM/yyyy -- con yyyy-MM-dd tira error de DateTime
  [string]$ToDate   = "20/08/2026",     # el corte que nos interesa
  [string]$Numero   = "",               # opcional: filtrar una factura puntual
  [int]$PageSize    = 5
)

$headers = @{
  "ApiAuthorization" = $Token
  "Company"          = $Company
}

$OutDir = "$env:USERPROFILE\Desktop\tango-facturas"
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

# ---- 1. Definicion de columnas -------------------------------------------
# Devuelve las ~N columnas disponibles de la consulta. Aca se ve si existen
# los campos que buscamos: renglones/detalle, CAE, CAE_VTO, FECHA_DE_EMISION,
# ID_GVA21, punto de venta, neto/IVA/total.
Write-Host ""
Write-Host "== GetColumnDefinition -- process=$Process" -ForegroundColor Cyan
$uriCols = $BaseUrl + "/Api/GetColumnDefinition" + "?process=" + $Process + "&sortAlphabetically=false"
try {
  $cols = Invoke-RestMethod -Uri $uriCols -Headers $headers -Method Get
  $archivoCols = Join-Path $OutDir "columnas-$Process.json"
  $cols | ConvertTo-Json -Depth 8 | Out-File -FilePath $archivoCols -Encoding utf8
  Write-Host "  -> $archivoCols" -ForegroundColor Green

  # Resaltar los campos que deciden si se puede reimprimir la factura.
  $texto = $cols | ConvertTo-Json -Depth 8
  foreach ($clave in @("CAE", "RENGLON", "DETALLE", "ARTICULO", "CANTIDAD", "PRECIO", "EMISION", "NETO", "IVA", "TOTAL", "GVA21", "PUNTO")) {
    $hit = ([regex]::Matches($texto, '"[^"]*' + $clave + '[^"]*"') | ForEach-Object { $_.Value } | Sort-Object -Unique) -join ", "
    if ($hit) { Write-Host ("  {0,-10} {1}" -f $clave, $hit) -ForegroundColor Yellow }
  }
} catch {
  Write-Host "  Error: $_" -ForegroundColor Red
  Write-Host "  DEBUG uri=[$uriCols]" -ForegroundColor Yellow
}

# ---- 2. Filas de muestra --------------------------------------------------
# customQuery=0 es obligatorio (flag numerico, no acepta vacio ni 1=1).
Write-Host ""
Write-Host "== GetApiLiveQueryData -- $FromDate a $ToDate" -ForegroundColor Cyan
$uriData = $BaseUrl + "/Api/GetApiLiveQueryData" `
  + "?process=" + $Process `
  + "&customQuery=0" `
  + "&fromDate=" + $FromDate `
  + "&toDate=" + $ToDate `
  + "&pageSize=" + $PageSize `
  + "&pageIndex=0"

try {
  $resp = Invoke-RestMethod -Uri $uriData -Headers $headers -Method Get
  if (-not $resp.succeeded) {
    Write-Host "  La API respondio succeeded=false: $($resp.message)" -ForegroundColor Red
  } else {
    Write-Host "  totalCount=$($resp.resultData.totalCount) totalPages=$($resp.resultData.totalPages)"
    $archivoData = Join-Path $OutDir "muestra-$Process.json"
    $resp.resultData.list | ConvertTo-Json -Depth 8 | Out-File -FilePath $archivoData -Encoding utf8
    Write-Host "  -> $archivoData" -ForegroundColor Green
    # Los campos del diseno por defecto suelen ser MENOS que los de la
    # definicion de columnas -- por eso se imprimen los de la fila real.
    if ($resp.resultData.list.Count -gt 0) {
      Write-Host "  Campos de la fila real:" -ForegroundColor Yellow
      $resp.resultData.list[0].PSObject.Properties.Name | ForEach-Object { Write-Host "    $_" }
    }
  }
} catch {
  Write-Host "  Error: $_" -ForegroundColor Red
  Write-Host "  DEBUG uri=[$uriData]" -ForegroundColor Yellow
}

# ---- 3. Una factura puntual (opcional) ------------------------------------
if ($Numero -ne "") {
  Write-Host ""
  Write-Host "== Factura puntual $Numero" -ForegroundColor Cyan
  $uriUna = $BaseUrl + "/Api/GetApiLiveQueryData" `
    + "?process=" + $Process `
    + "&customQuery=NRO_COMPROBANTE = '" + $Numero + "'" `
    + "&fromDate=" + $FromDate `
    + "&toDate=" + $ToDate `
    + "&pageSize=50&pageIndex=0"
  try {
    $una = Invoke-RestMethod -Uri $uriUna -Headers $headers -Method Get
    $archivoUna = Join-Path $OutDir "factura-$Numero.json"
    $una | ConvertTo-Json -Depth 10 | Out-File -FilePath $archivoUna -Encoding utf8
    Write-Host "  -> $archivoUna ($($una.resultData.totalCount) filas)" -ForegroundColor Green
    Write-Host "  Si devuelve UNA fila, la consulta es de cabecera (sin renglones)." -ForegroundColor Yellow
    Write-Host "  Si devuelve VARIAS (una por articulo), tiene el detalle: es la que sirve." -ForegroundColor Yellow
  } catch {
    Write-Host "  Error (puede ser que customQuery solo acepte 0 en esta consulta): $_" -ForegroundColor Red
    Write-Host "  DEBUG uri=[$uriUna]" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "Listo. Carpeta: $OutDir" -ForegroundColor Green
Write-Host "Copiala al repo (scripts/tango/) y avisame que campos aparecieron."
