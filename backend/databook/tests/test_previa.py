"""A prévia liga cada trecho ao campo certo sem alterar o PDF final."""
import json
import os
import tempfile
import unittest
from copy import deepcopy

from pypdf import PdfReader
from reportlab.graphics.shapes import Rect
from reportlab.lib.units import mm
from databook import gerar_databook
from databook.generator import DatabookBuilder

EXEMPLO = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "exemplo")
PREFIXO = "https://databook.invalid/editar/"


def campos(reader):
    return [str(a.get_object().get("/A", {}).get("/URI", ""))[len(PREFIXO):]
            for p in reader.pages for a in p.get("/Annots", [])
            if str(a.get_object().get("/A", {}).get("/URI", "")).startswith(PREFIXO)]


class PreviaTest(unittest.TestCase):
    def test_grafico_preserva_precisao_e_percentual_editado_altera_altura_da_barra(self):
        with open(os.path.join(EXEMPLO, "projeto_completo.json"), encoding="utf-8") as fh:
            dados = json.load(fh)
        normal = DatabookBuilder(dados, base_dir=EXEMPLO)
        editado = DatabookBuilder({**dados, "campos_documento": {"documento.s2.grafico.dia.0.percentual": "73,5%"}}, base_dir=EXEMPLO)
        try:
            def primeira_barra(builder):
                return next(s for s in builder.progress_chart().contents if isinstance(s, Rect) and s.y == 12 * mm and s.width > 10)
            altura = (62 - 8 - 12) * mm
            porcentagem = (normal.d["acumulado_inicial"] + normal.qty(normal.d["dias"][0])) / normal.d["escopo_total"]
            self.assertAlmostEqual(primeira_barra(normal).height, altura * porcentagem)
            self.assertAlmostEqual(primeira_barra(editado).height, altura * .735)
        finally:
            normal.close()
            editado.close()

    def test_vinculos_exatos_so_na_previa_e_texto_final_preservado(self):
        with open(os.path.join(EXEMPLO, "projeto_completo.json"), encoding="utf-8") as fh:
            dados = json.load(fh)
        original = deepcopy(dados)
        with tempfile.TemporaryDirectory() as tmp:
            final, previa = os.path.join(tmp, "final.pdf"), os.path.join(tmp, "previa.pdf")
            gerar_databook(dados, final, base_dir=EXEMPLO)
            info = gerar_databook({**dados, "previa_editavel": True}, previa, base_dir=EXEMPLO)
            rf, rp = PdfReader(final), PdfReader(previa)
            self.assertEqual([p.extract_text() for p in rp.pages], [p.extract_text() for p in rf.pages])
            self.assertEqual(campos(rf), [])
            destinos = set(campos(rp))
            catalogo = {c["id"]: c for c in info["campos"]}
            self.assertTrue(destinos.issubset(catalogo))
            vazios = [c for c in catalogo.values() if not c["valor"]]
            self.assertTrue(vazios)
            self.assertTrue(all(c["id"] in destinos for c in vazios))
            self.assertEqual(catalogo["documento.s2.indicadores.dias_execucao"]["aparencia"]["tamanho"], 20)
            self.assertGreater(len(catalogo), 1000)
            for campo in ("servico", "escopo", "resumoExecutivo", "consideracoes", "destaques", "descricao",
                          "textosAdicionais.nota_controle", "textosAdicionais.intro_rcpu", "textosAdicionais.intro_rtp",
                          "dias.0.resumo", "dias.0.atividades.0.texto", "dias.1.servicos.0.titulo", "dias.0.fotos.0.legenda"):
                self.assertTrue(any(f".origem.{campo}." in id for id in destinos), campo)
            for campo in ("documento.capa.valor.0", "documento.moldura.cliente", "documento.s2.indicadores.dias_execucao",
                          "documento.s2.indicadores.concluidos", "documento.s2.grafico.dia.0.percentual"):
                self.assertIn(campo, destinos)
            for rotulo in ("Efetivo", "Jornada (diurno)", "Pressão de teste", "Material", "Tags"):
                self.assertTrue(any(c["rotulo"] == rotulo and c["id"] in destinos for c in catalogo.values()), rotulo)
        self.assertEqual(dados, original)

    def test_legenda_mantem_indice_original_com_foto_ausente_ou_duplicada(self):
        with open(os.path.join(EXEMPLO, "projeto_completo.json"), encoding="utf-8") as fh:
            dados = json.load(fh)
        foto = deepcopy(dados["dias"][0]["fotos"][0])
        dados["dias"][0]["fotos"] = [{**foto, "arquivo": "foto-ausente.jpg"}, foto, deepcopy(foto)]
        with tempfile.TemporaryDirectory() as tmp:
            previa = os.path.join(tmp, "previa.pdf")
            gerar_databook({**dados, "previa_editavel": True}, previa, base_dir=EXEMPLO)
            destinos = campos(PdfReader(previa))
        self.assertTrue(any(".origem.dias.0.fotos.1.legenda." in id for id in destinos))
        self.assertFalse(any(".origem.dias.0.fotos.0.legenda." in id for id in destinos))
        self.assertFalse(any(".origem.dias.0.fotos.2.legenda." in id for id in destinos))

    def test_edicao_de_indicadores_tabelas_grafico_e_textos_persiste_no_pdf_final(self):
        with open(os.path.join(EXEMPLO, "projeto_completo.json"), encoding="utf-8") as fh:
            dados = json.load(fh)
        original = deepcopy(dados)
        with tempfile.TemporaryDirectory() as tmp:
            info = gerar_databook({**dados, "previa_editavel": True}, os.path.join(tmp, "base.pdf"), base_dir=EXEMPLO)
            pressao = next(c for c in info["campos"] if c["rotulo"] == "Pressão de teste")
            efetivo = next(c for c in info["campos"] if c["rotulo"] == "Efetivo")
            avanco = next(c for c in info["campos"] if c["rotulo"] == "Avanço · linha 1")
            legenda = next(c for c in info["campos"] if ".origem.dias.0.fotos.0.legenda." in c["id"])
            escopo = next(c for c in info["campos"] if ".origem.escopo.1" in c["id"])
            ajustes = {"documento.s2.indicadores.dias_execucao": "19", "documento.s2.indicadores.concluidos": "456,7",
                       "documento.s2.grafico.dia.0.percentual": "73%", pressao["id"]: "987 bar",
                       efetivo["id"]: "21 colaboradores", avanco["id"]: "82%", legenda["id"]: "Legenda revista integralmente",
                       escopo["id"]: "Texto livre com <b>literal</b> & nova linha.\n" + "Escopo detalhado. " * 300}
            editado = {**dados, "campos_documento": ajustes}
            previa, final = os.path.join(tmp, "previa.pdf"), os.path.join(tmp, "final.pdf")
            edit_info = gerar_databook({**editado, "previa_editavel": True}, previa, base_dir=EXEMPLO)
            gerar_databook(editado, final, base_dir=EXEMPLO)
            rp, rf = PdfReader(previa), PdfReader(final)
            texto_final = [p.extract_text() for p in rf.pages]
            self.assertEqual([p.extract_text() for p in rp.pages], texto_final)
            self.assertEqual(campos(rf), [])
            texto = "\n".join(texto_final)
            for valor in ("456,7", "987 bar", "21 colaboradores", "82%", "73%", "Legenda revista integralmente", "<b>literal</b> & nova linha."):
                self.assertIn(valor, texto)
            catalogo = {c["id"]: c for c in edit_info["campos"]}
            for id, valor in ajustes.items():
                self.assertEqual(catalogo[id]["valor"], valor)
            self.assertEqual(catalogo["documento.s2.indicadores.dias_execucao"]["valor"], "19")
            # A repaginação não redireciona as edições para outro dia/campo.
            self.assertGreater(edit_info["paginas"], info["paginas"])
            self.assertEqual(catalogo[pressao["id"]]["original"], pressao["original"])
        self.assertEqual(dados, original)
