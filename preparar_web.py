"""
Grava as malhas do cache como arquivos estaticos, para o modo sem servidor.

    python preparar_web.py

Escreve web/malha/0.bin ... web/malha/6.bin no MESMO formato que o
servidor_fanuc.py serve em /malha/N.bin:

    uint32   numero de vertices
    uint32   numero de indices
    float32  posicoes, 3 por vertice
    uint32   indices, 3 por triangulo

Por que duplicar o que o servidor ja faz: o pendant_dt.html tem um modo que
roda inteiro no navegador, sem Python nenhum do outro lado (a cinematica
esta no web/local.js). Nesse modo nao ha quem empacote a malha na hora, e o
GitHub Pages so serve arquivo parado. Entao a malha vira arquivo parado.

Estes .bin VAO para o git, ao contrario do CAD de onde saem. Sao ~0.55 MB no
total. Sem eles no repositorio, a pagina do Pages abre sem robo.

Rode de novo sempre que o cache de malhas mudar (outro CAD, outro numero de
divisoes do preparar_cad_step.py).
"""

import json
import os
import struct
import sys

import numpy as np

import modelo_fanuc as mod


PASTA_WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
PASTA_SAIDA = os.path.join(PASTA_WEB, "malha")

# Quantos pontos por elo vao para a silhueta do modo 2D. 56 e onde a coisa
# para de melhorar: como sao os pontos MAIS AFASTADOS entre si, eles caem
# nas quinas e nas pontas, que e o que o fecho convexo usa. Dobrar para 112
# muda a silhueta em menos de um pixel e dobra o arquivo.
PONTOS_SILHUETA = 56


def gravar(pasta=PASTA_SAIDA, verboso=True):
    if not mod.cache_existe():
        raise FileNotFoundError(
            "cache de malhas ausente. Rode: python modelo_fanuc.py --preparar"
        )

    os.makedirs(pasta, exist_ok=True)
    total = 0

    for indice, (nome, v, f, _) in enumerate(mod.carregar_malhas()):
        blob = (struct.pack("<II", len(v), f.size)
                + v.astype("<f4").tobytes()
                + f.astype("<u4").tobytes())
        destino = os.path.join(pasta, f"{indice}.bin")
        with open(destino, "wb") as saida:
            saida.write(blob)
        total += len(blob)
        if verboso:
            print(f"  elo {indice} {nome:10s} {len(v):6d} vertices "
                  f"{f.size // 3:6d} triangulos -> {os.path.basename(destino)} "
                  f"({len(blob) / 1e3:.0f} kB)")

    if verboso:
        print(f"{total / 1e6:.2f} MB em {pasta}")
    return total


def amostrar(v, quantos):
    """
    Escolhe `quantos` vertices o mais afastados possivel uns dos outros.

    E o "farthest point sampling" de sempre: comeca por um ponto e vai
    pegando, a cada passo, o vertice mais distante de tudo que ja foi
    pego. O efeito util aqui e que os escolhidos caem nas quinas e nas
    extremidades da peca - exatamente os pontos que o fecho convexo usa e
    que definem a silhueta. Amostragem aleatoria pegaria o meio das faces,
    onde nao ha informacao de contorno.
    """
    escolhidos = [int(np.argmax(v[:, 2]))]
    distancia = np.linalg.norm(v - v[escolhidos[0]], axis=1)

    for _ in range(min(quantos, len(v)) - 1):
        proximo = int(np.argmax(distancia))
        escolhidos.append(proximo)
        distancia = np.minimum(distancia, np.linalg.norm(v - v[proximo], axis=1))

    return v[escolhidos]


def gravar_silhueta(destino=None, quantos=PONTOS_SILHUETA, verboso=True):
    """
    Escreve web/silhueta.json: uma nuvem de poucos pontos por elo.

    Serve o modo 2D do pendant_dt.html, que existe para os iPads sem
    WebGL2 (ou seja, anteriores ao iPadOS 15). La o robo e desenhado com
    o fecho convexo destes pontos projetados, um poligono por elo, em vez
    dos 33 mil triangulos do CAD.

    E aproximado por construcao: fecho convexo nao tem buraco, entao o vao
    do cotovelo e os furos do flange somem. O que ele preserva e o que
    importa numa tela de operacao - o tamanho, a pose e para onde a
    ferramenta aponta. E sao 9 kB contra 0,55 MB, o que num iPad de 2012
    tambem e o que decide se abre.
    """
    destino = destino or os.path.join(PASTA_WEB, "silhueta.json")

    elos = []
    for nome, v, _, _ in mod.carregar_malhas():
        pontos = amostrar(np.asarray(v, dtype=float), quantos)
        elos.append({
            "nome": nome,
            # 4 casas em metro e decimo de milimetro: mais que suficiente
            # para uma silhueta, e corta o arquivo pela metade.
            "pontos": [[round(float(c), 4) for c in p] for p in pontos],
        })

    with open(destino, "w", encoding="utf-8") as saida:
        json.dump({"elos": elos}, saida, separators=(",", ":"))

    if verboso:
        tamanho = os.path.getsize(destino)
        print(f"  silhueta: {len(elos)} elos x {quantos} pontos -> "
              f"{os.path.basename(destino)} ({tamanho / 1e3:.1f} kB)")
    return destino


if __name__ == "__main__":
    try:
        gravar()
        gravar_silhueta()
    except FileNotFoundError as erro:
        print(erro)
        sys.exit(1)
