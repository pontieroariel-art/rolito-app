@echo off
rem Arranque del servicio bridge-sql en el servidor de Tango (RHIELOTG), instalado en C:\RolitoSync\sql.
rem Lo ejecuta la tarea programada "RolitoBridgeSql" (al iniciar el equipo, como SYSTEM):
rem   schtasks /Create /TN "RolitoBridgeSql" /SC ONSTART /RU SYSTEM /RL HIGHEST /F /TR "C:\RolitoSync\sql\bridge-sql.cmd"
rem Si node se cae, espera 30 s y lo vuelve a levantar. Log: C:\RolitoSync\sql\bridge-sql.log
cd /d C:\RolitoSync\sql
:loop
"C:\Program Files\nodejs\node.exe" bridge-sql.mjs
timeout /t 30 /nobreak >nul
goto loop
