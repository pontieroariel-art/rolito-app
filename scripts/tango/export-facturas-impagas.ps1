# export-facturas-impagas.ps1
#
# Corre DENTRO del servidor de Tango (por RDP): la API http://rhielotg:17000
# solo resuelve en esa red. Baja TODO lo necesario para reimprimir las facturas
# impagas emitidas hasta el 20/08/2026 (ver docs/tango/INTEGRACION.md seccion 10).
#
# Deja tres JSON en el Escritorio (carpeta tango-recupero\):
#   deudas.json     - comprobantes pendientes de cobro (17953 vencidas + 17955 a vencer)
#   renglones.json  - el detalle articulo por articulo (17943)
#   clientes.json   - CUIT, domicilio y condicion de IVA (ABM de clientes, 2117)
#
# El armado del PDF NO pasa por aca: eso lo hace despues, en la notebook,
#   node scripts/tango/generar-facturas-pdf.mjs
#
# Uso:
#   .\export-facturas-impagas.ps1 -Token "TU_TOKEN_DE_DESARROLLADOR"
#
# Ojo con el armado de las $uri: se concatenan con "+" a proposito, NO se
# interpolan (ver el comentario largo en export-clientes-tango.ps1).

param(
  [Parameter(Mandatory = $true)][string]$Token,
  [string]$Company  = "1",                # 1 = Redonhielo
  [string]$BaseUrl  = "http://rhielotg:17000",
  [string]$Desde    = "01/01/2023",       # dd/MM/yyyy -- arranque del barrido de renglones
  [string]$Hasta    = "20/08/2026",       # el corte que pidio Ariel
  [int]$PageSize    = 500
)

$headers = @{ ApiAuthorization = $Token; Company = $Company }
$OutDir  = "$env:USERPROFILE\Desktop\tango-recupero"
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

# Trae una consulta Live completa, pagina por pagina.
function Get-ConsultaLive {
  param([int]$Process, [string]$FromDate, [string]$ToDate, [string]$Etiqueta)

  Write-Host ""
  Write-Host "== $Etiqueta (process $Process) -- $FromDate a $ToDate" -ForegroundColor Cyan

  $todos = @()
  $pageIndex = 0
  $totalPages = 1

  do {
    $uri = $BaseUrl + "/Api/GetApiLiveQueryData" `
      + "?process=" + $Process `
      + "&customQuery=0" `
      + "&fromDate=" + $FromDate `
      + "&toDate=" + $ToDate `
      + "&pageSize=" + $PageSize `
      + "&pageIndex=" + $pageIndex

    try {
      $resp = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
    } catch {
      Write-Host "  Error en la pagina $pageIndex : $_" -ForegroundColor Red
      Write-Host "  DEBUG uri=[$uri]" -ForegroundColor Yellow
      return $null
    }

    if (-not $resp.succeeded) {
      Write-Host "  La API respondio succeeded=false: $($resp.message)" -ForegroundColor Red
      return $null
    }

    $totalPages = $resp.resultData.totalPages
    $todos += $resp.resultData.list
    Write-Host "  pagina $($pageIndex + 1)/$totalPages -- $($todos.Count) filas"
    $pageIndex++
    Start-Sleep -Milliseconds 300   # no golpear el server sin respiro
  } while ($pageIndex -lt $totalPages)

  return $todos
}

# ── 1. Las deudas: que comprobantes siguen impagos ──────────────────────────
# Se piden completas (sin recortar por fecha): el filtro por emision <= 20/08 se
# aplica despues, con la FECHA_DE_EMISION que trae el detalle (17953/17955 no la
# incluyen en su diseno por defecto).
$vencidas = Get-ConsultaLive -Process 17953 -FromDate "01/01/2015" -ToDate "31/12/2030" -Etiqueta "Deudas vencidas"
$aVencer  = Get-ConsultaLive -Process 17955 -FromDate "01/01/2015" -ToDate "31/12/2030" -Etiqueta "Deudas a vencer"

if ($null -eq $vencidas -or $null -eq $aVencer) {
  Write-Host "`nFallo la bajada de deudas -- no tiene sentido seguir." -ForegroundColor Red
  exit 1
}

$deudas = @($vencidas) + @($aVencer)
$deudas | ConvertTo-Json -Depth 6 | Out-File (Join-Path $OutDir "deudas.json") -Encoding utf8
Write-Host "  -> deudas.json ($($deudas.Count) comprobantes impagos)" -ForegroundColor Green

# ── 2. Los renglones ────────────────────────────────────────────────────────
# Se baja el rango entero y se filtra despues contra la lista de impagos: la
# consulta no acepta filtrar por "pendiente de cobro".
$renglones = Get-ConsultaLive -Process 17943 -FromDate $Desde -ToDate $Hasta -Etiqueta "Detalle de comprobantes"
if ($null -eq $renglones) {
  Write-Host "`nFallo la bajada de renglones." -ForegroundColor Red
  exit 1
}
$renglones | ConvertTo-Json -Depth 6 | Out-File (Join-Path $OutDir "renglones.json") -Encoding utf8
Write-Host "  -> renglones.json ($($renglones.Count) filas)" -ForegroundColor Green

# ── 3. Los clientes ─────────────────────────────────────────────────────────
# Del ABM (Api/Get), no de una consulta Live: es de donde salen CUIT, domicilio
# y condicion de IVA, que ninguna de las dos consultas anteriores trae.
Write-Host ""
Write-Host "== Clientes (ABM, process 2117)" -ForegroundColor Cyan
$clientes = @()
$pageIndex = 0
$totalPages = 1
do {
  $uri = $BaseUrl + "/Api/Get" + "?process=2117" + "&pageSize=200" + "&pageIndex=" + $pageIndex + "&view="
  try {
    $resp = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
  } catch {
    Write-Host "  Error en la pagina $pageIndex : $_" -ForegroundColor Red
    break
  }
  if (-not $resp.succeeded) { Write-Host "  succeeded=false: $($resp.message)" -ForegroundColor Red; break }
  $totalPages = $resp.resultData.totalPages
  $clientes += $resp.resultData.list
  Write-Host "  pagina $($pageIndex + 1)/$totalPages -- $($clientes.Count) filas"
  $pageIndex++
  Start-Sleep -Milliseconds 300
} while ($pageIndex -lt $totalPages)

$clientes | ConvertTo-Json -Depth 6 | Out-File (Join-Path $OutDir "clientes.json") -Encoding utf8
Write-Host "  -> clientes.json ($($clientes.Count) clientes)" -ForegroundColor Green

Write-Host ""
Write-Host "===== LISTO =====" -ForegroundColor Green
Write-Host "Carpeta: $OutDir"
Write-Host "Copiala a la notebook, a scripts\tango\tango-recupero\ del repo."
