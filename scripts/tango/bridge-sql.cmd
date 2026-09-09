@echo off
rem Arranque del servicio bridge-sql en el servidor de Tango (RHIELOTG), instalado en C:\RolitoSync\sql.
rem Lo ejecuta la tarea programada "RolitoBridgeSql" (al iniciar el equipo, como SYSTEM):
rem   schtasks /Create /TN "RolitoBridgeSql" /SC ONSTART /RU SYSTEM /RL HIGHEST /F /TR "C:\RolitoSync\sql\bridge-sql.cmd"
rem OJO: schtasks crea la tarea con el limite por defecto de 72 h de ejecucion y el
rem Task Scheduler la mata a los 3 dias (paso el 2026-09-08 23:19: "Ultimo resultado 267014",
rem sin node.exe y la cola frenada hasta la manana siguiente). Despues de crearla, sacar el limite:
rem   powershell -c "$t = Get-ScheduledTask -TaskName RolitoBridgeSql; $t.Settings.ExecutionTimeLimit = 'PT0S'; Set-ScheduledTask -InputObject $t"
rem   (verificar: schtasks /Query /TN RolitoBridgeSql /V /FO LIST | findstr Eliminar  ->  "Deshabilitado", no "72:00:00")
rem Si node se cae, espera 30 s y lo vuelve a levantar. Log: C:\RolitoSync\sql\bridge-sql.log
cd /d C:\RolitoSync\sql
:loop
"C:\Program Files\nodejs\node.exe" bridge-sql.mjs
timeout /t 30 /nobreak >nul
goto loop
