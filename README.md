# cobot_testing_fanuc_app

Pendant e digital twin do FANUC LR Mate 200iC no navegador. É a versão web
do [`cobot_testing_app`](https://github.com/ricardobertolin/cobot_testing_app)
extraída para rodar sozinha: um processo Python serve as páginas, e o cliente
é qualquer navegador na mesma rede, incluindo o iPad da célula.

Robô do laboratório com controlador R-30iA Mate. Alcance 704 mm, 6 eixos,
5 kg de carga. Não é colaborativo: não tem detecção de contato e não para
sozinho se a ferramenta encostar.

## Rodar

Quem só quer usar, sem mexer em terminal: em
[ricardobertolin.github.io/cobot_testing_fanuc_app](https://ricardobertolin.github.io/cobot_testing_fanuc_app/)
baixe o `iniciar.bat` (Windows) ou o `iniciar.sh` (macOS e Linux) e dê dois
cliques. Ele acha o Python, baixa este repositório, resolve o numpy, sobe o
servidor e abre a tela sozinho. Na mão:

```
pip install numpy
python servidor_fanuc.py
```

Ele imprime o endereço da máquina na rede. No iPad, no mesmo Wi-Fi:

```
http://<ip-do-pc>:8081/pendant_dt     a tela e o 3D na mesma página
http://<ip-do-pc>:8081/pendant        só a tela POSITION do iPendant
http://<ip-do-pc>:8081/twin           só o robô do CAD em 3D
```

No iPad o `/pendant_dt` é o que vale, porque lá não dá para pôr duas janelas
lado a lado. Em tela larga fica controles à esquerda e 3D à direita, em
retrato empilha, com o 3D embaixo. As outras duas continuam existindo para
quem tem dois monitores, ou para deixar o twin numa TV e a tela num tablet.

No Safari, Compartilhar → Adicionar à Tela de Início, e abre em tela cheia
com ícone próprio.

As teclas de jog seguem o COORD, como no pendant de verdade: em JOINT as seis
linhas de junta aceitam toque e as de WORLD ficam esmaecidas, e no WORLD e no
TOOL é o contrário.

## Os arquivos

| Arquivo | O que é |
|---|---|
| `servidor_fanuc.py` | O servidor. HTTP, Server-Sent Events e as rotas de malha. É o que se roda. |
| `modelo_fanuc.py` | Cinemática por produto de exponenciais e as malhas do CAD. Roda sozinho como autoteste das cotas. |
| `pendant_fanuc.py` | O pendant de desktop, de onde o servidor tira as constantes de jog, os overrides e as poses guardadas. Importar não abre janela: a janela só nasce no `main()` dele. |
| `preparar_cad_step.py` | Regera o cache de malhas a partir de um STEP de montagem, articulando o braço até a pose zero. Só é preciso se você quiser refazer as malhas. |
| `web/` | As páginas: `pendant.html`, `twin.html` e `pendant_dt.html`. Sem framework e sem CDN. |
| `malhas/` | O cache de malhas já gerado, uns 0,5 MB. Vai versionado aqui de propósito, para o repositório abrir e rodar sem o CAD original por perto. |

## Dependências

Só `numpy`. Todo o resto é biblioteca padrão: o HTTP é o `http.server`, o
estado desce por Server-Sent Events, que é uma resposta HTTP que não termina,
e o 3D é WebGL2 puro. Nada de FastAPI, nada de three.js, nada de CDN, por
duas razões: a página precisa abrir numa rede isolada de célula, sem
internet, e menos peça instalada é menos coisa para quebrar meses depois.

O preço é não ter WebSocket. Para este uso não faz falta: o fluxo pesado é só
de descida e o SSE resolve, e a subida são os toques de jog, que são eventos
esparsos e cabem num POST.

O `tkinter` precisa estar disponível, porque o `pendant_fanuc.py` importa ele
no topo. Vem junto do Python no Windows e no macOS. Em Linux enxuto, sem
pacote de servidor gráfico, pode ser preciso instalar (`python3-tk`), mesmo
que nenhuma janela vá abrir.

O `vedo` e o `pillow` da versão de desktop não são usados aqui, e o VTK só
entra se você for regerar o cache de malhas.

## Isto não move o robô

O R-30iA não tem interface aberta de jog nem de stream de posição, e jog de
verdade precisa do dispositivo de habilitação de três posições, que uma
página web não tem. A pose que aparece na tela sai da cinemática do Python,
sempre.

Movimento remoto no R-30iA passa por UOP, que é I/O físico ou fieldbus, e um
pacote TCP não aciona nenhum daqueles sinais. Não é omissão do software, é o
que o controlador oferece. É por isso que aqui não existe o `--comandar` que
o servidor do UR5 tem.

### O jog é tecla presa, não clique

Se a página fechar, o Wi-Fi cair ou o dedo sair da tela sem o evento de
soltar chegar, a junta ficaria girando sozinha para sempre. Por isso a página
renova o pedido de jog a cada 200 ms e o servidor para sozinho se passar meio
segundo sem renovação. É simulação e ninguém se machuca, mas jog sem prazo de
validade é um hábito ruim de carregar para perto de robô.

## O indicador de conexão

Toda página traz uma pílula na barra de cima dizendo em que pé está o enlace
com o controlador:

```
python servidor_fanuc.py --robo 192.168.0.20
```

| Pílula | Cor | O que houve |
|---|---|---|
| `SIMULAÇÃO` | cinza | rodando sem `--robo`, nenhum controlador envolvido |
| `CONTROLADOR NA REDE` | verde | responde em FTP e/ou no servidor web |
| `SEM CONEXÃO` | vermelho | não respondeu em nenhuma das duas portas |
| `SEM SERVIDOR` | vermelho | a página perdeu o Python |

**Aqui "conectado" quer dizer menos do que no UR5, e a tela diz isso.** No
UR5 dá para perguntar ao dashboard se o robô pode mover, e a resposta é sobre
o robô. O R-30iA não tem canal equivalente. O que dá para saber daqui é se o
controlador responde na rede, e nada sobre a pose dele.

Por isso o rótulo é `CONTROLADOR NA REDE` e não `CONECTADO`, e o detalhe
repete que a pose na tela continua simulada. Verde aqui não significa que o
3D está mostrando o robô de verdade, significa que dá para mandar o `.LS` por
FTP, que é a pergunta que o fluxo offline faz de verdade.

São duas portas porque falham por motivos diferentes: a 21 é o FTP, por onde
o `.LS` sobe, e a 80 é o servidor web do iPendant, que pode estar
desabilitado nas opções sem que a rede tenha problema algum.

## Ethernet

Endereço fixo dos dois lados, mesma sub-rede, cabo direto ou switch.

**No robô**, pelo teach pendant:

```
MENU → SETUP → F1 [TYPE] → Host Comm → TCP/IP
```

Preencha, com o cursor em `Port#1`. Os valores abaixo são exemplo: use a
faixa da sua célula, e o importante é que PC e robô fiquem na mesma.

```
Robot name       LRMATE
IP address       192.168.0.20
Subnet Mask      255.255.255.0
Router IP        0.0.0.0        (em rede isolada não precisa)
```

Mudança de IP só vale depois de **cold start**: `FCTN` → `START (COLD)`, ou
desliga e liga. Reiniciar sem cold start deixa o controlador com o endereço
antigo, e o sintoma é ping que não responde depois de "já ter configurado".

**No PC**, endereço fixo na mesma faixa:

```
IP               192.168.0.10
Máscara          255.255.255.0
Gateway          em branco
```

Confira com `ping 192.168.0.20` e abrindo `http://192.168.0.20/` no
navegador. O controlador tem servidor web próprio e já serve páginas de
diagnóstico do iPendant, sem instalar nada. Se o ping passa e a página não
abre, o servidor web está desabilitado nas opções, mas a rede está boa.

## Se o 3D ficar em "carregando malhas do CAD..." para sempre

Quase sempre é **aba demais aberta no mesmo endereço**, e não o servidor.

O `/estado` é uma resposta HTTP que nunca termina, e o navegador só abre 6
conexões por endereço. Cada aba visível segura uma delas enquanto estiver na
tela, então a partir da sétima não sobra conexão nem para baixar a malha.
Feche as outras abas e recarregue. A página avisa isso na tela depois de
alguns segundos, em vez de ficar pendurada calada.

Abas em segundo plano não contam: elas fecham o fluxo de estado e devolvem a
conexão, reabrindo quando voltam para a frente. Dispositivos diferentes
também não brigam entre si, porque o limite é por navegador.

## O CAD

O cache em `malhas/` já vem pronto, então nada abaixo é necessário para rodar.

Para refazer a partir dos `.obj` por peça, que o modelo espera em
`~/Documentos/_FACULDADE/_GRADUAÇÃO/_TCC/TCC_LASVII_2/Robots/FANUC/3D PARTS/fanuc_parts`
ou no caminho que estiver na variável de ambiente `FANUC_CAD`:

```
pip install vedo
python modelo_fanuc.py --preparar
```

O original tem 101 MB. O `modelo_fanuc.py` simplifica cada peça, coloca no
referencial do robô e grava em `malhas/`, que fica com menos de 1 MB.

Se o que você tem é um **STEP de montagem** baixado de um portal de CAD, ele
vem numa pose qualquer e com as peças agrupadas por submontagem, e aí o
caminho é outro:

```
pip install cascadio trimesh scipy fast-simplification
python preparar_cad_step.py LR_Mate_200iC.STEP
```

Ele acha os eixos de junta pelos anéis de contato entre elos vizinhos,
articula o braço até a pose zero e grava o mesmo `malhas/fanuc_elo*.npz`.
Antes de gravar qualquer coisa ele imprime as distâncias entre eixos vizinhos
medidas no STEP ao lado das do modelo, pela mesma fórmula dos dois lados: se
o STEP veio em milímetro sem conversão, o erro de mil vezes aparece ali.

Para conferir a geometria:

```
python modelo_fanuc.py
```

As cotas da cadeia foram tiradas do desenho dimensional do catálogo e
conferidas uma a uma contra o CAD, e fecham no milímetro: 330 da base ao eixo
de J2, 75 de recuo até J2, 300 de braço, 75 até o eixo do antebraço, 320 de
antebraço e 80 até a face do flange. O alcance sai por consequência em
703.7 mm, contra os 704 mm publicados.

## A interação J2-J3

Esta é a parte que faz cinemática de FANUC dar errado para quem vem de UR. O
ângulo de J3 que o pendant mostra não é medido em relação ao braço, e sim em
relação à horizontal: jogando só J2, o valor de J3 na tela não muda e o
antebraço mantém a inclinação no espaço. Numa cadeia serial isso vira uma
soma, e o ângulo que entra no modelo é `J3 + J2`. Está em `ACOPLAMENTO_J23`,
no `modelo_fanuc.py`, e o autoteste verifica que jogar J2 sozinho não gira o
antebraço.

## Sobre a arquitetura

O navegador é cliente burro. Não tem cinemática nenhuma: o servidor manda as
sete transformações já calculadas e a página só multiplica matriz e desenha.
O arquivo do `/pendant_dt` é o mesmo que o servidor do UR5 serve, byte por
byte. Ela não sabe qual robô está do outro lado, pede `/config.json` e monta
o que vier.

O servidor também publica a pose em UDP na `127.0.0.1:47101`, então o
`twin3d_fanuc.py` de desktop, no repositório original, segue a tela do
navegador sem precisar saber que ela existe.

## Créditos

- **Ricardo Bertolin**
- **Diego Simões Barreto** — coautor do projeto e colaboração no laboratório

Os robôs, a documentação e os modelos de CAD são do laboratório. O
`interface_ipad.md`, no repositório original, registra as decisões de projeto
que levaram a esta arquitetura e o porquê de cada uma.
