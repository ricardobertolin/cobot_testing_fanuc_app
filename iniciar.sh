#!/usr/bin/env bash
# ============================================================
#  FANUC LR Mate 200iC - pendant e digital twin
#
#  Versao macOS / Linux do iniciar.bat. Rode com:
#
#      bash iniciar.sh
#
#  Ele procura o Python, baixa o projeto se ainda nao estiver aqui do lado,
#  resolve o numpy, sobe o servidor e abre a tela no navegador.
#
#  Funciona dos dois jeitos: sozinho, baixado da pagina do GitHub para a
#  pasta de Downloads, ou de dentro do projeto ja descompactado.
# ============================================================

set -u

PROJETO="cobot_testing_fanuc_app"
SERVIDOR="servidor_fanuc.py"
ZIP="https://github.com/ricardobertolin/${PROJETO}/archive/refs/heads/main.zip"
PAGINA="http://localhost:8081/pendant_dt"

cd "$(dirname "$0")"

echo
echo "  FANUC LR Mate 200iC - pendant e digital twin"
echo "  -------------------------------------------"
echo

morrer() { echo; echo "  [X] $*"; echo; exit 1; }

# ---------- 1. Python ----------

PY=""
for tentativa in python3 python; do
  if command -v "$tentativa" >/dev/null 2>&1 && "$tentativa" -c 'import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)' 2>/dev/null; then
    PY="$tentativa"
    break
  fi
done

if [ -z "$PY" ]; then
  morrer "Nao achei o Python 3 neste computador.
      Instale em https://www.python.org/downloads/ (ou pelo gerenciador
      de pacotes da sua distribuicao) e rode este arquivo de novo."
fi
echo "  [ok] Python encontrado: $($PY --version 2>&1)"

# ---------- 2. projeto ----------

if [ ! -f "$SERVIDOR" ]; then
  DESTINO="${PROJETO}-main"

  if [ ! -f "$DESTINO/$SERVIDOR" ]; then
    echo "  [..] baixando o projeto do GitHub (uns 20 MB)..."
    command -v curl >/dev/null 2>&1 || morrer "curl nao esta instalado. Baixe o ZIP na mao: $ZIP"
    curl -fsSL -o "${PROJETO}.zip" "$ZIP" || morrer "nao consegui baixar. Confira a internet."

    echo "  [..] descompactando..."
    if command -v unzip >/dev/null 2>&1; then
      unzip -q -o "${PROJETO}.zip" || morrer "nao consegui descompactar o ZIP."
    else
      # Sem unzip, o proprio Python resolve.
      "$PY" -m zipfile -e "${PROJETO}.zip" . || morrer "nao consegui descompactar o ZIP."
    fi
    rm -f "${PROJETO}.zip"
  fi

  cd "$DESTINO" || morrer "a pasta $DESTINO nao apareceu."
  [ -f "$SERVIDOR" ] || morrer "o $SERVIDOR nao apareceu. Apague $DESTINO e rode de novo."
fi

echo "  [ok] Projeto na pasta: $(pwd)"

# ---------- 3. numpy ----------

if ! "$PY" -c 'import numpy' >/dev/null 2>&1; then
  echo "  [..] instalando o numpy, uma vez so (pode demorar um pouco)..."

  if ! "$PY" -m pip install --user --disable-pip-version-check numpy >/dev/null 2>&1; then
    # Python de sistema recente recusa instalar fora de um ambiente virtual
    # (o tal do "externally-managed-environment"). Entao criamos um.
    echo "  [..] o Python do sistema nao aceita instalar direto; criando um ambiente proprio..."
    "$PY" -m venv .venv || morrer "nao consegui criar o ambiente virtual.
      No Debian/Ubuntu talvez falte:  sudo apt install python3-venv"
    if [ -x ".venv/bin/python" ]; then
      PY=".venv/bin/python"
    else
      PY=".venv/Scripts/python.exe"     # Git Bash no Windows
    fi
    "$PY" -m pip install --disable-pip-version-check numpy || morrer "a instalacao do numpy falhou."
  fi
fi
echo "  [ok] numpy pronto."

# ---------- 4. servidor + navegador ----------

echo
echo "  Abrindo $PAGINA em instantes."
echo "  Deixe ESTE terminal aberto. Para encerrar, Ctrl+C."
echo

abrir() {
  # O navegador espera o servidor carregar as malhas antes de bater na porta.
  sleep 5
  if command -v open >/dev/null 2>&1; then
    open "$PAGINA"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$PAGINA" >/dev/null 2>&1
  else
    echo "  (abra no navegador: $PAGINA)"
  fi
}
abrir &

exec "$PY" "$SERVIDOR"
