"""Regras dos tipos novos (RCPU, RTP, RLM) e dos campos opcionais acrescentados ao schema."""
import json
import os
import tempfile
import unittest

from pypdf import PdfReader

from databook import DatabookBuilder, gerar_databook

EXEMPLO = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "exemplo")


def completo():
    with open(os.path.join(EXEMPLO, "projeto_completo.json"), encoding="utf-8") as fh:
        return json.load(fh)


class TiposTest(unittest.TestCase):
    def _titulos(self, dados):
        with tempfile.TemporaryDirectory() as tmp:
            saida = os.path.join(tmp, "out.pdf")
            info = gerar_databook(dados, saida, base_dir=EXEMPLO)
            r = PdfReader(saida)
            return [o.title for o in r.outline if not isinstance(o, list)], info

    def test_secoes_numeradas_conforme_tipos_presentes(self):
        titulos, _ = self._titulos(completo())
        self.assertIn("3. Procedimento de Limpeza Química", titulos)
        self.assertIn("4. Contagem de Partículas e Análise de Umidade", titulos)
        self.assertIn("5. Teste de Pressão", titulos)
        self.assertIn("6. Diário de Execução", titulos)
        self.assertIn("C. Relação de Certificados de Calibração", titulos)

    def test_projeto_sem_rlq_nao_tem_secao_de_limpeza_quimica(self):
        d = completo()
        for dia in d["dias"]:
            dia["servicos"] = [s for s in dia["servicos"] if s["tipo"] == "RTP"]
            dia["fotos"] = [f for f in dia["fotos"] if f["origem"] in ("RDO", "RTP")]
        d["fds"], d["etapas_produto"] = [], []
        d["certificados"] = [c for c in d["certificados"] if c["aplicacao"] == "RTP"]
        titulos, _ = self._titulos(d)
        self.assertNotIn("3. Procedimento de Limpeza Química", titulos)
        self.assertIn("3. Teste de Pressão", titulos)
        self.assertIn("4. Diário de Execução", titulos)
        self.assertFalse(any(t.startswith("A.") for t in titulos))

    def test_avisos_dos_tipos_novos(self):
        av = DatabookBuilder(completo(), base_dir=EXEMPLO).avisos
        texto = "\n".join(av)
        self.assertIn("RTP nº 3 com laudo REPROVADO", texto)
        self.assertIn("certificado do manômetro MAN-015 vencido em 04/10/2026", texto)
        self.assertIn("ISO 4406 final 17/15/12 acima do limite 16/14/11", texto)
        self.assertIn("08/10/2026: dia sem RDO", texto)
        # serviço em andamento que continua no dia seguinte não é aviso de duplicidade
        self.assertFalse(any("05/10/2026" in a for a in av))

    def test_certificado_ausente_da_erro_claro(self):
        d = completo()
        d["certificados"][0]["arquivo"] = "certificados/nao_existe.pdf"
        with self.assertRaisesRegex(FileNotFoundError, "Certificado de calibração não encontrado"):
            DatabookBuilder(d, base_dir=EXEMPLO)

    def test_acumulado_inicial_soma_no_avanco(self):
        b = DatabookBuilder(completo(), base_dir=EXEMPLO)
        total = b.d["acumulado_inicial"] + sum(b.qty(x) for x in b.d["dias"])
        self.assertEqual(total, 72.5 + 48 + 48 + 90 + 90)

    def test_rlq_legado_sem_tipo_continua_rlq(self):
        b = DatabookBuilder({"projeto": completo()["projeto"], "dias": [
            {"data": "01/10/2026", "rdo": 1, "servicos": [{"rlq": 7, "status": "Finalizado"}]}]}, base_dir=EXEMPLO)
        s = b.d["dias"][0]["servicos"][0]
        self.assertEqual((s["tipo"], s["relatorio"], s["titulo"]), ("RLQ", 7, "Limpeza química"))
        self.assertFalse(b.misto)

    def test_avanco_por_escopo_com_unidades_mistas(self):
        d = completo()
        d["escopo_total"], d["unidade_escopo"], d["acumulado_inicial"] = 100, "%", 10
        d["avanco_escopos"] = [
            {"escopo": "Limpeza química (tubulação)", "unidade": "m", "previsto": 120, "realizado": 96, "percentual": 80},
            {"escopo": "Flushing (óleo)", "unidade": "L", "previsto": 1200, "realizado": 400.5, "percentual": 33.4}]
        with tempfile.TemporaryDirectory() as tmp:
            saida = os.path.join(tmp, "out.pdf")
            gerar_databook(d, saida, base_dir=EXEMPLO)
            texto = "\n".join(p.extract_text() for p in PdfReader(saida).pages[:6])
        self.assertIn("Avanço por escopo", texto)
        self.assertIn("400,5", texto)
        self.assertIn("Geral (ponderado)", texto)

    def test_sem_escopos_nao_tem_quadro(self):
        b = DatabookBuilder(completo(), base_dir=EXEMPLO)
        b.close()
        self.assertNotIn("avanco_escopos", b.d)


if __name__ == "__main__":
    unittest.main()
