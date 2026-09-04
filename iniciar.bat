@echo off
rem ============================================================
rem  FANUC LR Mate 200iC - pendant e digital twin
rem
rem  Dois cliques e pronto. Este arquivo:
rem
rem    1. procura o Python;
rem    2. baixa o projeto, se ele ainda nao estiver aqui do lado;
rem    3. instala o numpy, se faltar;
rem    4. sobe o servidor e abre a tela no navegador.
rem
rem  Funciona dos dois jeitos: sozinho, baixado da pagina do GitHub para a
rem  pasta de Downloads, ou de dentro do projeto ja descompactado. A
rem  diferenca e so o passo 2.
rem
rem  Sem acento neste arquivo de proposito: o console do Windows abre em
rem  codepage antiga e acento vira sujeira na tela.
rem ============================================================

setlocal
cd /d "%~dp0"

set "PROJETO=cobot_testing_fanuc_app"
set "SERVIDOR=servidor_fanuc.py"
set "ZIP=https://github.com/ricardobertolin/%PROJETO%/archive/refs/heads/main.zip"
set "PAGINA=http://localhost:8081/pendant_dt"

echo.
echo   FANUC LR Mate 200iC - pendant e digital twin
echo   -------------------------------------------
echo.

rem ---------- 1. Python ----------

set "PY="
py -3 -c "import sys" >nul 2>&1
if not errorlevel 1 set "PY=py -3"
if defined PY goto :temPython

python -c "import sys" >nul 2>&1
if not errorlevel 1 set "PY=python"

:temPython
if not defined PY goto :semPython
echo   [ok] Python encontrado.

rem ---------- 2. projeto ----------

if exist "%SERVIDOR%" goto :temProjeto

set "DESTINO=%~dp0%PROJETO%-main"
if exist "%DESTINO%\%SERVIDOR%" goto :entrar

echo   [..] baixando o projeto do GitHub (uns 20 MB)...
set "ARQUIVO=%TEMP%\%PROJETO%.zip"

curl -L --fail -o "%ARQUIVO%" "%ZIP%" 2>nul
if not errorlevel 1 goto :descompactar
rem Windows antigo, sem curl: cai para o PowerShell.
powershell -NoProfile -Command "try{[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;Invoke-WebRequest -Uri '%ZIP%' -OutFile '%ARQUIVO%'}catch{exit 1}"
if errorlevel 1 goto :semRede

:descompactar
echo   [..] descompactando...
tar -xf "%ARQUIVO%" -C "%~dp0" 2>nul
if not errorlevel 1 goto :entrar
powershell -NoProfile -Command "try{Expand-Archive -Path '%ARQUIVO%' -DestinationPath '%~dp0' -Force}catch{exit 1}"
if errorlevel 1 goto :semZip

:entrar
cd /d "%DESTINO%"
if not exist "%SERVIDOR%" goto :semArquivo

:temProjeto
echo   [ok] Projeto na pasta: %CD%

rem ---------- 3. numpy ----------

%PY% -c "import numpy" >nul 2>&1
if not errorlevel 1 goto :temNumpy
echo   [..] instalando o numpy, uma vez so...
%PY% -m pip install --disable-pip-version-check numpy
if errorlevel 1 goto :semNumpy

:temNumpy
echo   [ok] numpy pronto.

rem ---------- 4. servidor + navegador ----------

echo.
echo   Abrindo %PAGINA% em instantes.
echo   Deixe ESTA janela aberta. Para encerrar, Ctrl+C.
echo.

rem O navegador espera o servidor carregar as malhas antes de bater na porta.
start "" /min cmd /c "timeout /t 5 /nobreak >nul & start %PAGINA%"

%PY% "%SERVIDOR%"
goto :fim

rem ============================================================
rem  Saidas com erro. Cada uma diz o que fazer, e nenhuma fecha a
rem  janela sozinha: quem deu dois cliques precisa ler a mensagem.
rem ============================================================

:semPython
echo   [X] Nao achei o Python neste computador.
echo.
echo       Instale em https://www.python.org/downloads/
echo       No instalador, MARQUE a caixa "Add Python to PATH".
echo       Depois rode este arquivo de novo.
echo.
start "" https://www.python.org/downloads/
goto :fim

:semRede
echo   [X] Nao consegui baixar o projeto.
echo       Confira a internet, ou baixe o ZIP na mao:
echo       %ZIP%
goto :fim

:semZip
echo   [X] Baixou, mas nao consegui descompactar.
echo       Descompacte na mao o arquivo:
echo       %ARQUIVO%
goto :fim

:semArquivo
echo   [X] O %SERVIDOR% nao apareceu depois de descompactar.
echo       Apague a pasta %PROJETO%-main e rode este arquivo de novo.
goto :fim

:semNumpy
echo   [X] A instalacao do numpy falhou.
echo       Tente na mao, nesta janela:  %PY% -m pip install numpy
goto :fim

:fim
echo.
pause
endlocal
