# export-tablas-tango.ps1
#
# Corre DENTRO de la red donde vive Tango (la VM por RDP) -- la API de Tango
# (http://rhielotg:17000) solo se puede pegar desde ahi adentro, no desde
# afuera. Hermano de export-clientes-tango.ps1, pero en vez de una sola tabla
# baja TODAS las tablas de referencia que hacen falta para armar el JSON de
# un pedido (ver docs/tango/INTEGRACION.md seccion 6.2).
#
# Los "process" salen del codigo C# oficial del repo de Axoft
# (github.com/TangoSoftware/TangoDeltaApi, constante ProcessId de cada
# *Services.cs). Dos de ellos ya estaban confirmados en vivo contra este
# mismo server -- Clientes=2117 y Pedidos=19845 -- lo que valida el resto.
#
# Uso:
#   1. Abri PowerShell en el servidor (no hace falta instalar nada).
#   2. Edita la linea Token de abajo con tu token de desarrollador (Tango
#      -> menu de usuario -> Desarrollador -> Generar).
#   3. .\export-tablas-tango.ps1
#   4. Te queda una carpeta tango-tablas\ en el Escritorio con un JSON por
#      tabla. Copiala al repo (scripts/tango/) para correr el cruce.
#
# Ojo con el armado del $uri: se concatena con "+" a proposito, NO se
# interpola. Ver el comentario largo en export-clientes-tango.ps1 -- en
# PowerShell un $variable pegado a un "?" adentro de un string con comillas
# dobles hace que el parser se coma el nombre de la variable siguiente.

$Token   = "PEGA_ACA_TU_TOKEN_DE_DESARROLLADOR"
$Company = "1"                 # 1 = Redonhielo. Para Rolito hay que repetir con el otro valor.
$BaseUrl = "http://rhielotg:17000/Api/Get"
$OutDir  = "$env:USERPROFILE\Desktop\tango-tablas"

if ($Token -eq "PEGA_ACA_TU_TOKEN_DE_DESARROLLADOR") {
  Write-Host "Edita el script primero: reemplaza `$Token con tu token real de Tango." -ForegroundColor Red
  exit 1
}

# process -> nombre de archivo. Articulos es la tabla grande (paginada);
# el resto son tablas chicas de referencia, entran en una o dos paginas.
$tablas = @(
  @{ Process = 87;   Nombre = "articulos";    Desc = "Articulos (ID_STA11)" },
  @{ Process = 2941; Nombre = "depositos";    Desc = "Depositos de stock (ID_STA22) -- los camiones" },
  @{ Process = 2497; Nombre = "condiciones";  Desc = "Condiciones de venta (ID_GVA01)" },
  @{ Process = 984;  Nombre = "listas";       Desc = "Listas de precios (ID_GVA10)" },
  @{ Process = 952;  Nombre = "vendedores";   Desc = "Vendedores (ID_GVA23)" },
  @{ Process = 960;  Nombre = "transportes";  Desc = "Transportes (ID_GVA24)" },
  @{ Process = 1660; Nombre = "monedas";      Desc = "Monedas (ID_MONEDA)" },
  @{ Process = 326;  Nombre = "clasificacion";Desc = "Clasificacion de comprobantes (ID_GVA81)" },
  # Muestra chica de clientes con TODOS los campos. El export anterior
  # (export-clientes-tango.ps1) recortaba a los campos del cruce, asi que no
  # sabemos si el registro trae la alicuota de percepcion de IIBB del padron de
  # CABA que se importa mes a mes. Con 5 filas completas alcanza para verlo.
  @{ Process = 2117; Nombre = "clientes-muestra"; Desc = "Clientes: muestra COMPLETA (para ver campos de IIBB)"; Paginas = 1; PageSize = 5 }
)

$headers = @{
  "ApiAuthorization" = $Token
  "Company"          = $Company
}

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

$PageSizeDefault = 200
$resumen = @()

foreach ($tabla in $tablas) {
  $process = $tabla.Process
  $nombre  = $tabla.Nombre
  # Una tabla puede pedir su propio tamano de pagina y limitar cuantas baja
  # (util para traer una muestra chica en vez de miles de filas).
  $PageSize = if ($tabla.PageSize) { $tabla.PageSize } else { $PageSizeDefault }
  $maxPaginas = if ($tabla.Paginas) { $tabla.Paginas } else { [int]::MaxValue }

  Write-Host ""
  Write-Host "== $($tabla.Desc) -- process=$process" -ForegroundColor Cyan

  $todos = @()
  $pageIndex = 0
  $totalPages = 1
  $fallo = $false

  do {
    $uri = $BaseUrl + "?process=" + $process + "&pageSize=" + $PageSize + "&pageIndex=" + $pageIndex + "&view="

    try {
      $resp = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
    } catch {
      Write-Host "  Error en la pagina $pageIndex : $_" -ForegroundColor Red
      Write-Host "  DEBUG uri=[$uri]" -ForegroundColor Yellow
      $fallo = $true
      break
    }

    if (-not $resp.succeeded) {
      Write-Host "  La API respondio succeeded=false: $($resp.message)" -ForegroundColor Red
      $fallo = $true
      break
    }

    $totalPages = $resp.resultData.totalPages
    $todos += $resp.resultData.list
    Write-Host "  pagina $($pageIndex + 1)/$totalPages -- $($todos.Count) filas acumuladas"
    $pageIndex++
    Start-Sleep -Milliseconds 400   # no golpear el server sin respiro
  } while (($pageIndex -lt $totalPages) -and ($pageIndex -lt $maxPaginas))

  if ($fallo) {
    $resumen += "  $nombre : FALLO (ver error arriba)"
    continue
  }

  # Se guardan las filas COMPLETAS a proposito: de estas tablas chicas todavia
  # no conocemos los nombres exactos de los campos, asi que conviene ver el
  # esquema entero una vez y despues recortar.
  $archivo = Join-Path $OutDir "$nombre.json"
  $todos | ConvertTo-Json -Depth 6 | Out-File -FilePath $archivo -Encoding utf8
  Write-Host "  -> $archivo" -ForegroundColor Green
  $resumen += "  $nombre : $($todos.Count) filas"
}

Write-Host ""
Write-Host "===== RESUMEN =====" -ForegroundColor Green
$resumen | ForEach-Object { Write-Host $_ }
Write-Host ""
Write-Host "Carpeta: $OutDir"
Write-Host "Copiala a scripts/tango/ del repo y despues corre:"
Write-Host "  node scripts/tango/cruce-articulos.mjs"
