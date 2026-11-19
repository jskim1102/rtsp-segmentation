@echo off
rem Double-click to install or update rtsp-segmentation on Windows.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
set "setupResult=%errorlevel%"
pause
exit /b %setupResult%
