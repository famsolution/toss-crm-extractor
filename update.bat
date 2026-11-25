@echo off
chcp 65001 >nul
setlocal
title 상담 도우미 업데이트
rem ─────────────────────────────────────────────────────────────
rem  이 파일이 있는 폴더(= 확장 프로그램 폴더)에 최신 버전 파일을 덮어씁니다.
rem  저장한 비번·고객정보는 크롬 안에 있으므로 지워지지 않습니다.
rem ─────────────────────────────────────────────────────────────
set "DIR=%~dp0"
set "URL=https://github.com/famsolution/toss-crm-extractor/releases/latest/download/sangdam-helper.zip"
set "WORK=%TEMP%\tce_update"

if not exist "%DIR%manifest.json" (
  echo [!] 이 파일은 확장 프로그램 폴더 안에서 실행해야 합니다. ^(manifest.json 이 있는 폴더^)
  pause & exit /b 1
)

if exist "%DIR%.git" (
  echo 개발용 폴더^(git^)입니다 — git pull 로 최신 버전을 받습니다...
  git -C "%DIR%." pull --ff-only
  goto done
)

echo.
echo  [1/3] 최신 버전을 내려받는 중...
if exist "%WORK%" rmdir /s /q "%WORK%"
mkdir "%WORK%" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri '%URL%' -OutFile '%WORK%\new.zip'; Expand-Archive -Force -Path '%WORK%\new.zip' -DestinationPath '%WORK%\x'"
if errorlevel 1 (
  echo [!] 내려받기에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 실행해 주세요.
  pause & exit /b 1
)
if not exist "%WORK%\x\manifest.json" (
  echo [!] 받은 파일이 올바르지 않습니다. 잠시 뒤 다시 실행해 주세요.
  pause & exit /b 1
)

echo  [2/3] 설치 폴더에 덮어쓰는 중...
robocopy "%WORK%\x" "%DIR%." /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo [!] 파일을 덮어쓰지 못했습니다. 이 폴더를 연 다른 프로그램을 닫고 다시 실행해 주세요.
  pause & exit /b 1
)
rmdir /s /q "%WORK%" >nul 2>&1

:done
echo  [3/3] 완료!
echo.
echo  이제 크롬에서 확장 프로그램 아이콘을 눌러 초록색 띠의 [적용] 을 누르세요.
echo  ^(또는 chrome://extensions 에서 상담 도우미의 새로고침 버튼^)
echo.
pause
