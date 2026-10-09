"""CLI: python -m databook entrada.json saida.pdf

Opções (usadas pelo worker do app):
  --json            imprime {"arquivo", "paginas", "avisos"} em JSON em vez do texto
  --avisos          só pré-valida (sem gerar PDF) e imprime {"avisos": [...]} em JSON;
                    nesse modo o segundo argumento é dispensado
  --base-dir DIR    pasta base dos caminhos relativos (padrão: pasta do JSON)
"""
import argparse
import json
import os
import sys

from .generator import DatabookBuilder, gerar_databook


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m databook")
    ap.add_argument("entrada")
    ap.add_argument("saida", nargs="?")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--avisos", action="store_true")
    ap.add_argument("--base-dir")
    args = ap.parse_args(argv)
    if not args.avisos and not args.saida:
        print("uso: python -m databook entrada.json saida.pdf")
        sys.exit(2)
    with open(args.entrada, encoding="utf-8") as fh:
        dados = json.load(fh)
    base = args.base_dir or os.path.dirname(os.path.abspath(args.entrada))
    if args.avisos:
        b = DatabookBuilder(dados, base_dir=base)
        b.close()
        print(json.dumps({"avisos": b.avisos}, ensure_ascii=False))
        return
    info = gerar_databook(dados, args.saida, base_dir=base)
    if args.json:
        print(json.dumps(info, ensure_ascii=False))
        return
    print(f"OK: {info['arquivo']} ({info['paginas']} páginas)")
    for a in info["avisos"]:
        print("AVISO:", a)


if __name__ == "__main__":
    main()
