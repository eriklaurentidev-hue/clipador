# -*- coding: utf-8 -*-
"""
Separa a voz da musica de fundo com Demucs e grava as duas faixas em WAV.

Serve pra quando a live tem musica tocando e o TikTok derruba o corte por
direito autoral: o corte e remontado so com a faixa de voz.

Reporta progresso em stdout, uma linha JSON por vez, igual ao transcrever.py.
"""
import argparse
import io
import json
import os
import sys

# Windows costuma abrir o stdout em cp1252 e quebrar com acento.
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


def avisar(tipo, **campos):
    campos["tipo"] = tipo
    print(json.dumps(campos, ensure_ascii=False), flush=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--audio", required=True)
    p.add_argument("--voz", required=True, help="WAV so com a voz")
    p.add_argument("--resto", default="", help="WAV com o que sobrou (musica/ambiente)")
    p.add_argument("--modelo", default="htdemucs")
    args = p.parse_args()

    try:
        import numpy as np
        import soundfile as sf
        import torch
        from demucs.apply import apply_model
        from demucs.pretrained import get_model
    except ImportError as e:
        avisar("erro", msg="demucs nao instalado (%s)" % e)
        sys.exit(2)

    avisar("progresso", pct=3, msg="Carregando o modelo de separacao (%s)..." % args.modelo)
    # Em CPU o demucs usa todos os nucleos por padrao e trava a maquina.
    # Deixa um livre pra maquina continuar respondendo.
    torch.set_num_threads(max(1, (os.cpu_count() or 2) - 1))
    try:
        modelo = get_model(args.modelo)  # 1a vez baixa os pesos (~80 MB) e guarda
        modelo.eval()
    except Exception as e:
        avisar("erro", msg="nao consegui carregar o modelo: %s" % e)
        sys.exit(3)

    try:
        dados, sr = sf.read(args.audio, always_2d=True, dtype="float32")  # (amostras, canais)
    except Exception as e:
        avisar("erro", msg="nao consegui ler o audio: %s" % e)
        sys.exit(4)
    if sr != modelo.samplerate:
        avisar("erro", msg="o audio precisa estar em %d Hz (veio %d)" % (modelo.samplerate, sr))
        sys.exit(4)
    if dados.shape[1] == 1:
        dados = np.repeat(dados, 2, axis=1)
    wav = torch.from_numpy(dados[:, :2].T.copy())  # (canais, amostras)

    avisar("progresso", pct=10, msg="Separando voz e musica...")
    ref = wav.mean(0)
    media, desvio = ref.mean(), ref.std() + 1e-8
    try:
        with torch.no_grad():
            fontes = apply_model(modelo, ((wav - media) / desvio)[None], device="cpu", split=True, overlap=0.25, progress=False)[0]
    except Exception as e:
        avisar("erro", msg="falha na separacao: %s" % e)
        sys.exit(4)
    fontes = fontes * desvio + media

    nomes = list(modelo.sources)
    if "vocals" not in nomes:
        avisar("erro", msg="o modelo nao devolveu faixa de voz: %s" % nomes)
        sys.exit(5)
    voz = fontes[nomes.index("vocals")].clamp(-1, 1).numpy().T
    sf.write(args.voz, voz, sr)
    avisar("progresso", pct=92, msg="Voz gravada.")

    # O resto so interessa pra conferir o que foi tirado - nao entra no corte.
    if args.resto:
        sobra = sum(fontes[k] for k, n in enumerate(nomes) if n != "vocals")
        sf.write(args.resto, sobra.clamp(-1, 1).numpy().T, sr)

    avisar("pronto", voz=args.voz, resto=args.resto, taxa=sr, faixas=nomes)


if __name__ == "__main__":
    main()
