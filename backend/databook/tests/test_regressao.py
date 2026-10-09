"""Regressão do layout: cada exemplo deve gerar exatamente a sua referência aprovada.

O exemplo real da missão 5815 (e a referência dele) contém dados de cliente e fotos verdadeiras e fica
fora do git (ver .gitignore): o teste roda só onde esses arquivos existirem localmente. O exemplo
fictício `projeto_completo.json` é versionado e roda sempre.

Rodar a partir de backend/databook:  python -m unittest discover -s tests -v
"""
import json
import os
import tempfile
import unittest

from pypdf import PdfReader

from databook import gerar_databook

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXEMPLO = os.path.join(RAIZ, "exemplo")
REFERENCIA = os.path.join(RAIZ, "referencia")


def _textos(caminho):
    # A referência do 5815 foi gerada quando o marcador "■" (sem glifo na Carlito) saía como \x00;
    # hoje o marcador é "●". Normaliza para que só o marcador não conte como diferença.
    return [p.extract_text().replace("\x00", "●") for p in PdfReader(caminho).pages]


def _carregar(nome):
    with open(os.path.join(EXEMPLO, nome), encoding="utf-8") as fh:
        return json.load(fh)


class RegressaoTest(unittest.TestCase):
    def _comparar(self, entrada, referencia, paginas=None):
        ref = os.path.join(REFERENCIA, referencia)
        if not os.path.exists(os.path.join(EXEMPLO, entrada)) or not os.path.exists(ref):
            self.skipTest(f"exemplo ou referência ausente localmente: {entrada}")
        with tempfile.TemporaryDirectory() as tmp:
            saida = os.path.join(tmp, "out.pdf")
            info = gerar_databook(_carregar(entrada), saida, base_dir=EXEMPLO)
            esperado, obtido = _textos(ref), _textos(saida)
        if paginas is not None:
            self.assertEqual(info["paginas"], paginas)
        self.assertEqual(len(obtido), len(esperado))
        for n, (a, b) in enumerate(zip(obtido, esperado), 1):
            self.assertEqual(a, b, f"texto diferente na página {n}")

    def test_missao_5815_igual_a_referencia(self):
        self._comparar("missao_5815.json", "DataBook_exemplo_missao_5815.pdf", paginas=124)

    def test_projeto_completo_igual_a_referencia(self):
        self._comparar("projeto_completo.json", "DataBook_exemplo_projeto_completo.pdf")


class SchemaTest(unittest.TestCase):
    def test_exemplos_validam_contra_schema(self):
        try:
            import jsonschema
        except ImportError:
            self.skipTest("jsonschema não instalado")
        with open(os.path.join(RAIZ, "databook", "schema.json"), encoding="utf-8") as fh:
            schema = json.load(fh)
        for nome in ("missao_5815.json", "projeto_completo.json"):
            if os.path.exists(os.path.join(EXEMPLO, nome)):
                jsonschema.validate(_carregar(nome), schema)


if __name__ == "__main__":
    unittest.main()
