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

Estes .bin VAO para o git, ao contrario do CAD de onde saem. Sem eles no
repositorio, a pagina do Pages abre sem robo.

Rode de novo sempre que o cache de malhas mudar (outro CAD, outro numero de
divisoes do preparar_cad_step.py).
"""

import os
import struct
import sys

import modelo_fanuc as mod


PASTA_SAIDA = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "web", "malha")


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


if __name__ == "__main__":
    try:
        gravar()
    except FileNotFoundError as erro:
        print(erro)
        sys.exit(1)
