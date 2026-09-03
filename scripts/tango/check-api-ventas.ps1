# check-api-ventas.ps1
#
# Corre EN EL SERVER de Tango (PowerShell, sin instalar nada). Verifica en un
# minuto lo que hace falta para mandar remitos/facturas desde la app:
#   1. que el token sirve (Clientes, process 2117 - siempre licenciado)
#   2. que la API de Ventas esta habilitada (Pedidos, process 19845)
#   3. que el Facturador responde (POST /FacturadorVenta/registrar)
#   4. que numeros de empresa (header Company) responden, con la cantidad de
#      clientes de cada una: TestingRH es la que tiene pocos clientes; Redonhielo
#      (1) y Rolito (3) tienen miles. Asi se saca el numero de TestingRH sin
#      mirar la URL.
#
# Uso:  editar $Token y correr  .\check-api-ventas.ps1
#
# El $uri se arma con "+" a proposito (ver export-clientes-tango.ps1: el parser
# de PowerShell se come "$Var?..." dentro de un string interpolado).

$Token   = "PEGA_ACA_TU_TOKEN_DE_DESARROLLADOR"
$BaseUrl = "http://rhielotg:17000"
$Empresas = 1..6

if ($Token -eq "PEGA_ACA_TU_TOKEN_DE_DESARROLLADOR") {
  Write-Host "Edita el script primero: reemplaza `$Token con tu token real de Tango." -ForegroundColor Red
  exit 1
}

function Probar($nombre, $company, $metodo, $uri, $body) {
  $headers = @{ ApiAuthorization = $Token; Company = "$company" }
  try {
    if ($metodo -eq "POST") {
      $r = Invoke-WebRequest -Uri $uri -Method Post -Headers $headers -ContentType "application/json" -Body $body -UseBasicParsing -TimeoutSec 30
    } else {
      $r = Invoke-WebRequest -Uri $uri -Method Get -Headers $headers -UseBasicParsing -TimeoutSec 30
    }
    $json = $null
    try { $json = $r.Content | ConvertFrom-Json } catch {}
    return @{ ok = $true; status = [int]$r.StatusCode; json = $json; raw = $r.Content }
  } catch {
    $status = 0; $raw = ""
    if ($_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode
      try { $sr = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream()); $raw = $sr.ReadToEnd() } catch {}
    } else { $raw = $_.Exception.Message }
    return @{ ok = $false; status = $status; raw = $raw }
  }
}

Write-Host ""
Write-Host "== 1. Token (Clientes, process 2117, Company 1)" -ForegroundColor Cyan
$r = Probar "clientes" 1 "GET" ($BaseUrl + "/Api/Get?process=2117&pageSize=1&pageIndex=0&view=")
if ($r.ok -and $r.json.succeeded) { Write-Host ("   OK - " + $r.json.resultData.totalCount + " clientes en Redonhielo") -ForegroundColor Green }
else { Write-Host ("   FALLO (HTTP " + $r.status + "): " + $r.raw.Substring(0, [Math]::Min(300, $r.raw.Length))) -ForegroundColor Red; Write-Host "   Si es 401: el token vencio o esta mal pegado."; exit 1 }

Write-Host ""
Write-Host "== 2. API de Ventas (Pedidos, process 19845, Company 1)" -ForegroundColor Cyan
$r = Probar "pedidos" 1 "GET" ($BaseUrl + "/Api/Get?process=19845&pageSize=1&pageIndex=0&view=")
if ($r.ok -and $r.json.succeeded) { Write-Host ("   HABILITADA - " + $r.json.resultData.totalCount + " pedidos existentes") -ForegroundColor Green }
else { Write-Host ("   NO responde (HTTP " + $r.status + "): " + $r.raw.Substring(0, [Math]::Min(300, $r.raw.Length))) -ForegroundColor Yellow; Write-Host "   Si es 401/403 con el token OK del paso 1: 'Transacciones Tango Ventas' sigue sin habilitar en la licencia." }

Write-Host ""
Write-Host "== 3. Facturador (POST /FacturadorVenta/registrar con [] vacio, Company 1)" -ForegroundColor Cyan
$r = Probar "facturador" 1 "POST" ($BaseUrl + "/FacturadorVenta/registrar") "[]"
Write-Host ("   HTTP " + $r.status + ": " + ($r.raw -replace "\s+", " ").Substring(0, [Math]::Min(300, ($r.raw -replace "\s+", " ").Length)))
Write-Host "   (Cualquier respuesta JSON del facturador = endpoint vivo. 404 = no esta expuesto en este server.)"

Write-Host ""
Write-Host "== 4. Empresas (header Company) y cantidad de clientes de cada una" -ForegroundColor Cyan
foreach ($c in $Empresas) {
  $r = Probar "empresa" $c "GET" ($BaseUrl + "/Api/Get?process=2117&pageSize=1&pageIndex=0&view=")
  if ($r.ok -and $r.json.succeeded) {
    $primero = ""
    if ($r.json.resultData.list.Count -gt 0) { $primero = $r.json.resultData.list[0].RAZON_SOCI }
    Write-Host ("   Company " + $c + ": " + $r.json.resultData.totalCount + " clientes   (primer cliente: " + $primero + ")") -ForegroundColor Green
  } else {
    Write-Host ("   Company " + $c + ": no responde (HTTP " + $r.status + ")") -ForegroundColor DarkGray
  }
}
Write-Host ""
Write-Host "Redonhielo = 1 y Rolito = 3 (confirmado). TestingRH es la que tiene POCOS clientes (o el nombre de prueba como primer cliente)." -ForegroundColor Cyan
