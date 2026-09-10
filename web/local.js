"use strict";
/*
  O servidor_fanuc.py portado para dentro da pagina, para o modo sem Python.

  O pendant_dt.html e cliente burro de proposito: ele pede /config.json,
  escuta /estado e desenha as sete transformacoes que o Python manda pronta.
  Isso continua valendo quando ha servidor. So que no iPad de quem abriu o
  GitHub Pages nao ha servidor nenhum, e a escolha e entre a tela travada na
  primeira requisicao ou a mesma conta rodando aqui.

  Entao aqui esta a mesma conta. Este arquivo e a traducao de tres pedacos
  do Python, e nada alem deles:

      modelo_fanuc.py    a cadeia por exponenciais, o jacobiano e a pose
      pendant_fanuc.py   aplicar_jog, os overrides, as poses, os limites
      servidor_fanuc.py  configuracao() e instantaneo(), o que desce por SSE

  DUAS COPIAS DA CINEMATICA E UM RISCO CONHECIDO

  O projeto inteiro foi montado para nao ter isso: o pendant de desktop e o
  servidor compartilham aplicar_jog justamente para a tela e o twin nao
  discordarem. Aqui a copia e inevitavel - navegador nao roda numpy - e o
  que sobra e deixar a divida anotada e o formato identico. O `estado` que
  sai daqui tem os mesmos campos, nas mesmas unidades, do que sai do
  instantaneo() do Python; a pagina nao sabe qual dos dois esta falando.

  O ACOPLAMENTO J2-J3 VEM JUNTO

  E o ponto que faz cinematica de FANUC dar errado para quem vem de UR: o
  J3 do pendant e medido em relacao a horizontal, nao ao braco, entao o
  angulo que entra na cadeia e (J3 + J2). Sem isso, jogar J2 aqui giraria o
  antebraco e a tela discordaria do robo de verdade. O jacobiano leva a
  mesma correcao, senao o jog cartesiano anda torto na direcao de J2.

  O QUE ESTE MODO NAO FAZ

  Controlador. O --robo do servidor vigia se o R-30iA responde na rede, e
  navegador nao abre socket cru para perguntar isso. Aqui e simulacao pura,
  e a pilula do canto diz isso.
*/

(function(){

// ============================================================
// MODELO: modelo_fanuc.py
// ============================================================

// Matriz 3x3 em ordem de LINHA, num vetor de 9. E o mesmo formato que o
// servidor manda em `corpos`, entao o paraModelo() da pagina nao muda.
//
// Frame WORLD: origem no centro da placa de fixacao, X para a frente, Y
// para a esquerda, Z para cima. Os sinais dos eixos seguem a convencao do
// pendant: +J2 leva o braco para a frente, +J3 levanta o antebraco.
const EIXOS = [
  [0, 0, 1], [0, 1, 0], [0, -1, 0], [-1, 0, 0], [0, -1, 0], [-1, 0, 0],
];

const PONTOS = [
  [0.000, 0, 0.000],
  [0.075, 0, 0.330],
  [0.075, 0, 0.630],
  [0.075, 0, 0.705],
  [0.395, 0, 0.705],
  [0.475, 0, 0.705],
];

const FLANGE = [0.475, 0, 0.705];
// Colunas [Xt, Yt, Zt] com o robo zerado. Em W P R isso e (0, 90, 0).
const FLANGE_R = [0, 0, 1,  0, 1, 0,  -1, 0, 0];

// Veja o cabecalho: o J3 do pendant e medido contra a horizontal.
const ACOPLAMENTO_J23 = true;

// Cursos do catalogo da serie 200iC, em graus. Centrados e aproximados:
// servem para o simulador nao passar de valores absurdos, nao para
// substituir os limites do controlador.
const LIMITES = [
  [-170, 170], [-100, 100], [-194, 194], [-190, 190], [-120, 120], [-360, 360],
];

// Velocidade maxima de cada junta em graus/s, do catalogo.
const VELOCIDADES = [350, 350, 400, 450, 450, 720];

const IDENT3 = [1, 0, 0,  0, 1, 0,  0, 0, 1];

function mul3(a, b){
  const c = new Array(9);
  for(let i = 0; i < 3; i++){
    for(let j = 0; j < 3; j++){
      c[i*3+j] = a[i*3]*b[j] + a[i*3+1]*b[3+j] + a[i*3+2]*b[6+j];
    }
  }
  return c;
}

const aplicar3 = (m, v) => [
  m[0]*v[0] + m[1]*v[1] + m[2]*v[2],
  m[3]*v[0] + m[4]*v[1] + m[5]*v[2],
  m[6]*v[0] + m[7]*v[1] + m[8]*v[2],
];

const cruzar = (a, b) => [a[1]*b[2] - a[2]*b[1],
                          a[2]*b[0] - a[0]*b[2],
                          a[0]*b[1] - a[1]*b[0]];

// Rodrigues, com `eixo` unitario.
function rotacao(eixo, angulo){
  const [x, y, z] = eixo;
  const s = Math.sin(angulo), c = Math.cos(angulo), u = 1 - c;
  return [
    c + x*x*u,     x*y*u - z*s,   x*z*u + y*s,
    y*x*u + z*s,   c + y*y*u,     y*z*u - x*s,
    z*x*u - y*s,   z*y*u + x*s,   c + z*z*u,
  ];
}

// Angulos do pendant para os angulos da cadeia serial. So J3 muda.
function angulosDaCadeia(q){
  const a = q.slice();
  if(ACOPLAMENTO_J23) a[2] = q[2] + q[1];
  return a;
}

// Os 7 corpos (base + 6 elos). O corpo 0 e a base fixa, entao sai
// identidade; o corpo j acumula as juntas 1..j.
function transformadas(q){
  const a = angulosDaCadeia(q);
  const corpos = [{R: IDENT3.slice(), t: [0, 0, 0]}];
  let R = IDENT3.slice(), t = [0, 0, 0];

  for(let i = 0; i < 6; i++){
    const Ri = rotacao(EIXOS[i], a[i]);
    // A junta gira em torno de uma reta que passa por PONTOS[i], nao pela
    // origem: a translacao compensa o afastamento do eixo.
    const giro = aplicar3(Ri, PONTOS[i]);
    const ti = [PONTOS[i][0] - giro[0], PONTOS[i][1] - giro[1],
                PONTOS[i][2] - giro[2]];
    const deslocado = aplicar3(R, ti);
    t = [t[0] + deslocado[0], t[1] + deslocado[1], t[2] + deslocado[2]];
    R = mul3(R, Ri);
    corpos.push({R: R.slice(), t: t.slice()});
  }
  return corpos;
}

function pontaDe(corpo){
  const p = aplicar3(corpo.R, FLANGE);
  return [p[0] + corpo.t[0], p[1] + corpo.t[1], p[2] + corpo.t[2]];
}

// Pose da face do flange no WORLD, com posicao em MILIMETROS e W P R em
// GRAUS, que e como o pendant mostra. Sem UTOOL e sem UFRAME.
function poseFlange(q){
  const c = transformadas(q)[6];
  return pontaDe(c).map(v => v * 1000).concat(wpr(mul3(c.R, FLANGE_R)));
}

// Matriz de rotacao para W, P, R em graus. FANUC usa angulos fixos na ordem
// X, Y, Z, ou seja R = Rz(R)Ry(P)Rx(W). Com P em +/- 90 a decomposicao e
// degenerada: W e R giram em torno do mesmo eixo e so a soma tem
// significado. Nesse caso W vai para zero e tudo fica em R, que e a escolha
// que o proprio controlador faz.
function wpr(r){
  const grau = 180 / Math.PI;
  const senoP = Math.max(-1, Math.min(1, -r[6]));
  const cossenoP = Math.sqrt(r[0]*r[0] + r[3]*r[3]);

  if(cossenoP < 1e-9){
    return [0, senoP < 0 ? -90 : 90, Math.atan2(-r[1], r[4]) * grau];
  }
  return [Math.atan2(r[7], r[8]) * grau,
          Math.asin(senoP) * grau,
          Math.atan2(r[3], r[0]) * grau];
}

// Jacobiano geometrico 6x6 do flange no WORLD, em relacao aos angulos do
// PENDANT. Linhas 0..2 linear, 3..5 angular.
//
// A correcao no fim e o acoplamento J2-J3: o jacobiano montado sobre a
// cadeia responde aos angulos da CADEIA, e mexer em J2 no pendant mexe em
// dois angulos da cadeia. E o mesmo `J @ derivada` do Python, so que
// escrito como o que ele faz: a coluna de J2 ganha a de J3.
function jacobiano(q){
  const corpos = transformadas(q);
  const ponta = pontaDe(corpos[6]);
  const J = Array.from({length: 6}, () => new Array(6).fill(0));

  for(let i = 0; i < 6; i++){
    const {R, t} = corpos[i];                 // corpo anterior a junta i
    const eixo = aplicar3(R, EIXOS[i]);
    const sobre = aplicar3(R, PONTOS[i]);
    const braco = [ponta[0] - sobre[0] - t[0],
                   ponta[1] - sobre[1] - t[1],
                   ponta[2] - sobre[2] - t[2]];
    const v = cruzar(eixo, braco);
    for(let k = 0; k < 3; k++){
      J[k][i] = v[k];
      J[k+3][i] = eixo[k];
    }
  }

  if(ACOPLAMENTO_J23){
    for(let k = 0; k < 6; k++) J[k][1] += J[k][2];
  }
  return J;
}

// Eliminacao de Gauss com pivotamento parcial, 6x6. Substitui o
// numpy.linalg.solve do passo_cartesiano.
function resolver(A, b){
  const n = b.length;
  const M = A.map((linha, i) => linha.concat([b[i]]));

  for(let c = 0; c < n; c++){
    let melhor = c;
    for(let l = c + 1; l < n; l++){
      if(Math.abs(M[l][c]) > Math.abs(M[melhor][c])) melhor = l;
    }
    [M[c], M[melhor]] = [M[melhor], M[c]];
    // O amortecimento do passo_cartesiano ja garante pivo nao nulo, mas se
    // um dia garantir de menos e melhor devolver zero que NaN: pose parada
    // e um defeito visivel, pose NaN some com o robo da tela.
    if(Math.abs(M[c][c]) < 1e-15) return new Array(n).fill(0);
    for(let l = c + 1; l < n; l++){
      const f = M[l][c] / M[c][c];
      for(let k = c; k <= n; k++) M[l][k] -= f * M[c][k];
    }
  }

  const x = new Array(n).fill(0);
  for(let l = n - 1; l >= 0; l--){
    let soma = M[l][n];
    for(let k = l + 1; k < n; k++) soma -= M[l][k] * x[k];
    x[l] = soma / M[l][l];
  }
  return x;
}

const normal = (J, amortecimento) => {
  const N = Array.from({length: 6}, () => new Array(6).fill(0));
  for(let i = 0; i < 6; i++){
    for(let j = 0; j < 6; j++){
      let s = 0;
      for(let k = 0; k < 6; k++) s += J[i][k] * J[j][k];
      N[i][j] = s + (i === j ? amortecimento * amortecimento : 0);
    }
  }
  return N;
};

// Um passo de jog cartesiano por minimos quadrados amortecidos. Perto de
// singularidade o movimento perde precisao na direcao ruim em vez de mandar
// a junta para o infinito, que e o mesmo motivo pelo qual o controlador
// acusa singularidade em vez de obedecer.
function passoCartesiano(q, linear, angular, dt, amortecimento){
  const J = jacobiano(q);
  const alvo = linear.concat(angular);
  const x = resolver(normal(J, amortecimento === undefined ? 0.02 : amortecimento),
                     alvo);
  return q.map((v, i) => {
    let dq = 0;
    for(let k = 0; k < 6; k++) dq += J[k][i] * x[k];
    return v + dq * dt;
  });
}

// Menor valor singular do jacobiano, que e o que a barra de baixo usa para
// avisar de singularidade. Sem SVD: sigma_min = sqrt(menor autovalor de
// J*Jt), e J*Jt e simetrico, entao Jacobi ciclico resolve em algumas
// varreduras. Isto roda 30 vezes por segundo e some no ruido: sao seis
// linhas de matriz.
function menorSigma(J){
  const A = normal(J, 0);
  for(let varredura = 0; varredura < 12; varredura++){
    let fora = 0;
    for(let p = 0; p < 5; p++){
      for(let q = p + 1; q < 6; q++) fora += A[p][q] * A[p][q];
    }
    if(fora < 1e-22) break;

    for(let p = 0; p < 5; p++){
      for(let q = p + 1; q < 6; q++){
        if(Math.abs(A[p][q]) < 1e-14) continue;
        const theta = 0.5 * Math.atan2(2 * A[p][q], A[q][q] - A[p][p]);
        const c = Math.cos(theta), s = Math.sin(theta);
        for(let k = 0; k < 6; k++){
          const akp = A[k][p], akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for(let k = 0; k < 6; k++){
          const apk = A[p][k], aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
      }
    }
  }

  let menor = Infinity;
  for(let i = 0; i < 6; i++) menor = Math.min(menor, A[i][i]);
  return Math.sqrt(Math.max(0, menor));
}

// Mensagens para juntas fora do curso.
function dentroDosLimites(qGraus){
  const problemas = [];
  qGraus.forEach((valor, i) => {
    const [baixo, alto] = LIMITES[i];
    if(valor < baixo || valor > alto){
      problemas.push(`J${i + 1} = ${valor.toFixed(1)} graus, fora do curso `
                   + `[${baixo}, ${alto}]`);
    }
  });
  return problemas;
}

// ============================================================
// JOG: pendant_fanuc.py
// ============================================================

const OVERRIDES = [["VFINE", 0.5], ["FINE", 1.0], ["1%", 1.0], ["5%", 5.0],
                   ["10%", 10.0], ["25%", 25.0], ["50%", 50.0], ["75%", 75.0],
                   ["100%", 100.0]];

// O jog manual nunca anda na velocidade de programa. O controlador limita a
// 250 mm/s em T1, e as juntas ficam bem abaixo do catalogo.
const FATOR_JOG_JUNTA = 0.25;
const VELOCIDADE_JOG_LINEAR = 0.250;    // m/s a 100% de override
const VELOCIDADE_JOG_ANGULAR = 0.5;     // rad/s a 100% de override

const LIMIAR_SINGULARIDADE = 0.02;

const POSES = {
  "ZERO": [0, 0, 0, 0, 0, 0],
  "HOME": [0, -10, -20, 0, -60, 0],
  "PICK": [25, 35, -40, 0, -55, 0],
};

// Um passo de jog. Devolve [nova_pose, aviso], com aviso null quando deu
// certo e a pose inalterada quando nao deu.
//   eixo    0..5, que sao as juntas em JOINT e X Y Z W P R nos outros
//   fracao  0..1, o override da tela
//   coord   "JOINT", "WORLD" ou "TOOL"
function aplicarJog(q, eixo, sinal, fracao, coord, dt){
  let novo;

  if(coord === "JOINT"){
    const graus = VELOCIDADES[eixo] * FATOR_JOG_JUNTA * fracao;
    novo = q.slice();
    novo[eixo] += sinal * graus * (Math.PI / 180) * dt;
  }else{
    let linear = [0, 0, 0], angular = [0, 0, 0];
    if(eixo < 3) linear[eixo] = sinal * VELOCIDADE_JOG_LINEAR * fracao;
    else angular[eixo - 3] = sinal * VELOCIDADE_JOG_ANGULAR * fracao;

    if(coord === "TOOL"){
      // As direcoes vem no frame da ferramenta e precisam ir para o WORLD,
      // que e onde o jacobiano trabalha.
      const R = mul3(transformadas(q)[6].R, FLANGE_R);
      linear = aplicar3(R, linear);
      angular = aplicar3(R, angular);
    }
    novo = passoCartesiano(q, linear, angular, dt);
  }

  const problemas = dentroDosLimites(novo.map(v => v * 180 / Math.PI));
  if(problemas.length) return [q.slice(), problemas[0]];
  return [novo, null];
}

// ============================================================
// CONFIG E ESTADO: servidor_fanuc.py
// ============================================================

const ELOS = [
  ["base",      [0.16, 0.17, 0.18]],
  ["torre",     [0.95, 0.78, 0.06]],
  ["braco",     [0.95, 0.78, 0.06]],
  ["cotovelo",  [0.95, 0.78, 0.06]],
  ["antebraco", [0.95, 0.78, 0.06]],
  ["punho",     [0.90, 0.73, 0.05]],
  ["flange",    [0.25, 0.26, 0.27]],
];

const CREDITOS = {
  projeto: "cobot_testing_app",
  pessoas: [
    "Ricardo Bertolin",
    "Diego Simões Barreto — coautor do projeto e colaboração no laboratório",
  ],
};

function configuracao(){
  return {
    robo: "LR Mate 200iC",
    controlador: "R-30iA Mate",
    jog_modo: "unico",
    tema: "fanuc",
    abas: [],
    aba_ativa: "",
    leds: ["BUSY", "RUN", "HOLD", "FAULT", "STEP", "I/O", "PROD", "TCYC"],
    juntas: [1,2,3,4,5,6].map(i => "J" + i),
    unidade_junta: "deg",
    cartesiano: [
      {n: "X", u: "mm", d: 2}, {n: "Y", u: "mm", d: 2},
      {n: "Z", u: "mm", d: 2}, {n: "W", u: "deg", d: 2},
      {n: "P", u: "deg", d: 2}, {n: "R", u: "deg", d: 2},
    ],
    titulo_juntas: "POSITION",
    titulo_cartesiano: "WORLD (UTOOL 0, UFRAME 0)",
    coordenadas: {rotulo: "COORD", valores: ["JOINT", "WORLD", "TOOL"]},
    velocidade: {tipo: "escada", rotulo: "OVERRIDE",
                 valores: OVERRIDES.map(([nome]) => nome)},
    poses: Object.keys(POSES),
    // Seis eixos so: no iPendant as mesmas teclas movem as juntas ou o
    // cartesiano conforme o COORD, ao contrario do PolyScope, que tem doze.
    jog_eixos: [0, 1, 2, 3, 4, 5],
    // O RESET do pendant, que limpa o FAULT.
    acoes: [{id: "reset", texto: "RESET", cor: "#d8c27a"}],
    aviso: "",
    comanda: false,
    espelho: false,
    // A pagina usa isto para saber que nao ha /pendant nem /twin do outro
    // lado, e para dizer na barra de baixo onde a conta esta rodando.
    local: true,
    elos: ELOS.map(([nome, cor]) => ({nome, cor})),
    camera: {raio: 2.0, alvo: [0.15, 0, 0.4], azimute: -130, elevacao: 22},
    grade: {tamanho: 1.8, divisoes: 18},
    escala_eixos: 0.15,
    creditos: CREDITOS,
  };
}

const PERIODO = 1 / 30;     // s entre passos da simulacao e quadros
const PRAZO_JOG = 0.5;      // s sem renovacao e o jog para sozinho

const agora = () => performance.now() / 1000;

// O mesmo contrato do servidor, visto pela pagina: um config, um fluxo de
// estado que se abre e se fecha, e um canal de subida para os comandos.
function criarLocal(){
  const est = {
    q: [0, 0, 0, 0, 0, 0],
    jog: null,
    jogAte: 0,
    indiceOverride: 4,          // 10%
    coord: "JOINT",
    falha: false,
    mensagem: "",
    mensagemAte: 0,
  };

  let relogio = null, ouvinte = null, ultimo = agora();

  const avisar = (texto, segundos) => {
    est.mensagem = texto;
    est.mensagemAte = agora() + (segundos || 4);
  };

  function comandar(pedido){
    const acao = pedido.acao;
    if(acao === "jog"){
      // Em FAULT o pendant nao joga. E o RESET que devolve o movimento.
      if(est.falha) return Promise.resolve();
      est.jog = [Number(pedido.eixo), Number(pedido.sinal)];
      est.jogAte = agora() + PRAZO_JOG;
    }else if(acao === "parar"){
      est.jog = null;
    }else if(acao === "pose"){
      if(pedido.nome in POSES){
        est.q = POSES[pedido.nome].map(v => v * Math.PI / 180);
        est.jog = null;
        avisar("pose " + pedido.nome);
      }
    }else if(acao === "override"){
      est.indiceOverride = Math.max(0, Math.min(
        OVERRIDES.length - 1, est.indiceOverride + Number(pedido.passo || 0)));
    }else if(acao === "coord"){
      if(["JOINT", "WORLD", "TOOL"].includes(pedido.valor)){
        est.coord = pedido.valor;
        est.jog = null;
        avisar("coordenada: " + est.coord);
      }
    }else if(acao === "reset"){
      est.falha = false;
      avisar("reset");
    }
    return Promise.resolve();
  }

  function passo(dt){
    if(est.jog === null || est.falha) return;

    // O mesmo cachorro morto do servidor: a pagina renova o pedido a cada
    // 200 ms e o jog cai sozinho se parar de chegar renovacao. Aqui nao ha
    // Wi-Fi para cair, mas ha aba escondida e dedo que sai da tela sem
    // soltar, e o comportamento tem que ser o mesmo dos dois lados.
    if(agora() > est.jogAte){
      est.jog = null;
      avisar("jog interrompido: a pagina parou de responder");
      return;
    }

    const [eixo, sinal] = est.jog;
    const [novo, aviso] = aplicarJog(
      est.q, eixo, sinal, OVERRIDES[est.indiceOverride][1] / 100, est.coord, dt);
    if(aviso){
      // Bater no limite de curso e FAULT, como no pendant: o movimento so
      // volta depois do RESET.
      est.jog = null;
      est.falha = true;
      avisar(aviso);
      return;
    }
    est.q = novo;
  }

  function instantaneo(){
    const q = est.q;
    const corpos = transformadas(q);
    const c6 = corpos[6];
    const ponta = pontaDe(c6);
    // Colunas de (R6 @ FLANGE_R) sao os eixos da ferramenta no mundo, e e
    // isso que o aplicar3d() da pagina espera ler. Ou seja: a transposta,
    // escrita a mao. Era um flatMap, que so existe a partir do iOS 12 e
    // custava a pagina inteira num iPad velho por tres linhas de ganho.
    const f = mul3(c6.R, FLANGE_R);
    const eixosPonta = [f[0], f[3], f[6],
                        f[1], f[4], f[7],
                        f[2], f[5], f[8]];
    const graus = q.map(v => v * 180 / Math.PI);
    const sigma = menorSigma(jacobiano(q));
    const movendo = est.jog !== null;

    let mensagem = agora() < est.mensagemAte ? est.mensagem : "";
    if(est.falha){
      mensagem = `FAULT: ${mensagem}   pressione RESET`;
    }else if(!mensagem){
      mensagem = sigma < LIMIAR_SINGULARIDADE
        ? `SINGULARIDADE proxima (sigma ${sigma.toFixed(4)}), `
          + `o movimento cartesiano fica impreciso aqui`
        : "sem servidor: a cinematica roda neste navegador";
    }

    return {
      q: graus,
      // Posicao em mm e W P R em graus, que e como o pendant mostra.
      pose: poseFlange(q),
      ponta,
      eixos_ponta: eixosPonta,
      corpos: corpos.map(c => c.R.concat(c.t)),
      override: OVERRIDES[est.indiceOverride][0],
      coord: est.coord,
      movendo,
      falha: est.falha,
      estado: est.falha ? "FAULT" : (movendo ? "RUN" : "ABORTED"),
      leds: {
        BUSY: movendo, RUN: movendo, HOLD: !movendo,
        FAULT: est.falha, STEP: false, "I/O": true,
        PROD: false, TCYC: false,
      },
      mensagem,
      sigma,
      avisos: dentroDosLimites(graus),
      robo: {
        modo: "simulacao", nivel: "neutro", rotulo: "SIMULACAO",
        detalhe: "nenhum controlador envolvido: a pose sai da cinematica que "
               + "roda neste navegador, sem servidor e sem rede",
      },
    };
  }

  // O relogio faz o papel do laco do servidor e do fluxo SSE ao mesmo
  // tempo. Passo e quadro no mesmo ritmo: a pagina nunca viu diferenca.
  function escutar(aoReceber){
    ouvinte = aoReceber;
    if(relogio !== null) return;
    ultimo = agora();
    relogio = setInterval(() => {
      const t = agora();
      // dt medido, e nao PERIODO fixo: aba em segundo plano e iPad que
      // engasga fazem o setInterval atrasar, e com dt fixo o jog andaria
      // menos do que o dedo pediu. O teto de 0.2 s evita o salto grande
      // quando a aba volta de um congelamento longo.
      const dt = Math.min(t - ultimo, 0.2);
      ultimo = t;
      passo(dt);
      if(ouvinte) ouvinte(instantaneo());
    }, PERIODO * 1000);
  }

  function parar(){
    if(relogio !== null){ clearInterval(relogio); relogio = null; }
    ouvinte = null;
    est.jog = null;
  }

  return {
    config: () => Promise.resolve(configuracao()),
    comandar,
    escutar,
    parar,
    malha: (i) => `malha/${i}.bin`,
  };
}

window.criarLocal = criarLocal;

})();
