@echo off
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
  echo.
  echo   [서랍] 처음 실행이라 필요한 파일을 내려받습니다. 좀 걸릴 수 있어요.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   설치에 실패했습니다. Node.js가 설치되어 있는지 확인해 주세요.
    echo   https://nodejs.org
    echo.
    pause
    exit /b 1
  )
)

if not exist "node_modules\electron\dist\서랍.exe" call npm run brand

start "" "node_modules\electron\dist\서랍.exe"
