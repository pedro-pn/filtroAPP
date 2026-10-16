"""Edições literais conservam os estilos do campo e dos trechos do modelo."""
import unittest

from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfgen.canvas import Canvas

from databook.editing import DocumentFields


class FormattingTest(unittest.TestCase):
    def setUp(self):
        self.style = ParagraphStyle("campo", fontName="Helvetica", fontSize=11,
                                    leading=15, textColor=colors.HexColor("#1f2623"), alignment=2)

    def paragraph(self, original, value, preview=False):
        fields = DocumentFields({"previa_editavel": preview, "campos_documento": {"documento.campo": value}})
        paragraph = fields.paragraph(original, self.style, key="documento.campo")
        return paragraph, fields.items["documento.campo"]["aparencia"]

    def test_status_conserva_cor_negrito_tamanho_e_alinhamento(self):
        for preview in (True, False):
            with self.subTest(preview=preview):
                paragraph, appearance = self.paragraph(
                    '<font color="#30503A" size="13"><b>APROVADO</b></font>', "REVISADO", preview)
                self.assertEqual("".join(f.text for f in paragraph.frags), "REVISADO")
                for fragment in paragraph.frags:
                    self.assertEqual(fragment.fontName, "Helvetica-Bold")
                    self.assertEqual(fragment.fontSize, 13)
                    self.assertEqual(fragment.textColor, colors.HexColor("#30503a"))
                    self.assertEqual(bool(fragment.link), preview)
                self.assertEqual(appearance, dict(tamanho=13, entrelinha=15, alinhamento=2,
                                                  negrito=True, italico=False, cor="#30503a"))

    def test_edicao_parcial_preserva_trechos_negritos_italicos_e_marcador_colorido(self):
        original = '<font color="#C81519">●</font>&nbsp;&nbsp;Limpeza de <b>APVs</b> e <i>filtros</i>.'
        paragraph, _ = self.paragraph(original, "●  Limpeza de TANQUES e filtros novos.")
        fragments = [f for f in paragraph.frags if f.text.strip()]
        self.assertEqual(fragments[0].textColor, colors.HexColor("#c81519"))
        self.assertEqual(next(f for f in fragments if "TANQUES" in f.text).fontName, "Helvetica-Bold")
        self.assertEqual(next(f for f in fragments if "filtros" in f.text).fontName, "Helvetica-Oblique")
        self.assertTrue(all(f.textColor == self.style.textColor for f in fragments[1:]))

    def test_texto_digitado_continua_literal_e_quebras_preservam_estilo(self):
        value = '<i>literal</i> & revisão\nSegunda linha'
        paragraph, appearance = self.paragraph('<b><font color="#30503A">Original</font></b>', value)
        self.assertEqual("".join("\n" if getattr(f, "lineBreak", False) else f.text for f in paragraph.frags), value)
        self.assertTrue(all(f.fontName == "Helvetica-Bold" for f in paragraph.frags))
        self.assertEqual(appearance["cor"], "#30503a")

    def test_paragrafo_longo_conserva_estilos_depois_de_editar_o_inicio(self):
        repeated = "texto " * 60
        paragraph, _ = self.paragraph("O " + repeated + "<b>tanques</b> e <i>filtros</i>",
                                      "Novo " + repeated + "tanques e filtros")
        self.assertEqual(next(f for f in paragraph.frags if f.text == "tanques").fontName, "Helvetica-Bold")
        self.assertEqual(next(f for f in paragraph.frags if f.text == "filtros").fontName, "Helvetica-Oblique")

    def test_aparencia_do_editor_nao_muda_quando_trecho_em_negrito_cresce(self):
        original = 'Texto normal longo e <b>x</b>'
        _, before = self.paragraph(original, "Texto normal longo e x")
        paragraph, after = self.paragraph(original, "Texto normal longo e " + "x" * 100)
        self.assertEqual(after, before)
        self.assertFalse(after["negrito"])
        self.assertEqual(paragraph.frags[-1].fontName, "Helvetica-Bold")

    def test_valor_original_nao_modifica_espacos_nao_separaveis_ou_estilos(self):
        original = '<b>Nome</b>&nbsp;&nbsp;<i>Cargo</i><br/>Data'
        edited, _ = self.paragraph(original, "Nome  Cargo\nData")
        unchanged = DocumentFields({}).paragraph(original, self.style)
        self.assertEqual([vars(f) for f in edited.frags], [vars(f) for f in unchanged.frags])

    def test_campo_vazio_pode_ser_preenchido_e_apagado(self):
        paragraph, appearance = self.paragraph("", "Novo <b>texto</b>")
        self.assertEqual(paragraph.getPlainText(), "Novo <b>texto</b>")
        self.assertEqual(appearance["cor"], "#1f2623")
        paragraph, appearance = self.paragraph("<b>Original</b>", "", preview=True)
        self.assertEqual(paragraph.getPlainText(), "")
        self.assertEqual(appearance["cor"], "#1f2623")

    def test_catalogo_inclui_cores_da_capa_e_do_grafico(self):
        fields = DocumentFields({})
        canvas = Canvas("unused.pdf")
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 20)
        fields.canvas_text(canvas, "documento.capa", 50, 50, "Título")
        fields.chart_text(Drawing(100, 100), "documento.grafico", 10, 10, "42%",
                          fontName="Helvetica-Oblique", fontSize=9, fillColor=colors.HexColor("#30503A"))
        self.assertEqual(fields.items["documento.capa"]["aparencia"]["cor"], "#ffffff")
        self.assertTrue(fields.items["documento.capa"]["aparencia"]["negrito"])
        self.assertEqual(fields.items["documento.grafico"]["aparencia"]["cor"], "#30503a")
        self.assertTrue(fields.items["documento.grafico"]["aparencia"]["italico"])
