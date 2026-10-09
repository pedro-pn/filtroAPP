# -*- coding: utf-8 -*-
"""
Gerador de Data Book (Filtrovali) – PDF A4 a partir de um dicionário/JSON.

Uso:
    from databook import gerar_databook
    info = gerar_databook(dados, "saida.pdf")          # dados = dict no formato de schema.json
    print(info["paginas"], info["avisos"])

Dependências: reportlab>=4, pypdf>=4, Pillow>=10.
Os caminhos de fotos e FDS podem ser absolutos ou relativos a `base_dir`
(por padrão, a pasta do JSON quando chamado pela CLI, ou o diretório atual).
"""
import hashlib
import io
import os
import re
import tempfile
from copy import deepcopy

from PIL import Image
from pypdf import PdfReader, PdfWriter
from reportlab.graphics.shapes import Drawing, Line, Rect, String
from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as rlcanvas
from reportlab.platypus import (BaseDocTemplate, CondPageBreak, Flowable, Frame, NextPageTemplate,
                                PageBreak, PageTemplate, Paragraph, Spacer, Table, TableStyle)
from reportlab.platypus import Image as RLImage

ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")

# ============================================================ tema (identidade visual)
GREEN = HexColor("#30503A")     # verde Filtrovali (wordmark)
GREEN_D = HexColor("#22392A")   # fundo da capa
GREEN_L = HexColor("#E8EEE9")   # fundo dos KPIs
BLUE = HexColor("#11437E")      # seta azul do emblema
RED = HexColor("#C81519")       # seta vermelha do emblema (acentos)
LAV = HexColor("#9B93A8")       # seta lilás do emblema (dias sem produção)
INK = HexColor("#1F2623")
MUTED = HexColor("#5F6B64")
RULE = HexColor("#C9D3CC")
ZEBRA = HexColor("#F4F7F5")
PHOTO_BG = HexColor("#EEF1EF")

W, H = A4
ML, MR, MT, MB = 18 * mm, 18 * mm, 30 * mm, 20 * mm
CW = W - ML - MR

FOTO_MAX_PX = 760       # lado maior das fotos embutidas
FOTO_JPEG_Q = 72
FOTO_COLS = 3
FOTO_CELL_H = 58 * mm

_FONTS_OK = False


def _register_fonts(assets):
    global _FONTS_OK
    if _FONTS_OK:
        return
    f = os.path.join(assets, "fonts")
    pdfmetrics.registerFont(TTFont("H", os.path.join(f, "Poppins-Medium.ttf")))
    pdfmetrics.registerFont(TTFont("HB", os.path.join(f, "Poppins-Bold.ttf")))
    pdfmetrics.registerFont(TTFont("HL", os.path.join(f, "Poppins-Light.ttf")))
    pdfmetrics.registerFont(TTFont("B", os.path.join(f, "Carlito-Regular.ttf")))
    pdfmetrics.registerFont(TTFont("BB", os.path.join(f, "Carlito-Bold.ttf")))
    pdfmetrics.registerFont(TTFont("BI", os.path.join(f, "Carlito-Italic.ttf")))
    registerFontFamily("B", normal="B", bold="BB", italic="BI", boldItalic="BB")
    _FONTS_OK = True


def S(name, **kw):
    base = dict(fontName="B", fontSize=9.5, leading=13, textColor=INK)
    base.update(kw)
    return ParagraphStyle(name, **base)


sBody = S("body")
sBodyJ = S("bodyj", alignment=4)
sSmall = S("small", fontSize=8, leading=10.5, textColor=MUTED)
sCell = S("cell", fontSize=8.6, leading=11)
sCellW = S("cellw", fontName="BB", fontSize=8.6, leading=11, textColor=colors.white)
sCellC = S("cellc", fontSize=8.6, leading=11, alignment=TA_CENTER)
sLabel = S("label", fontName="BB", fontSize=7.2, leading=9, textColor=MUTED)
sVal = S("val", fontSize=9.2, leading=11.5)
sH1 = S("h1", fontName="HB", fontSize=17, leading=21, textColor=GREEN, spaceAfter=2)
sH2 = S("h2", fontName="H", fontSize=11.5, leading=15, textColor=GREEN, spaceBefore=8, spaceAfter=4)
sKicker = S("kick", fontName="H", fontSize=8, leading=10, textColor=RED)
sCap = S("cap", fontSize=7.6, leading=9.5, textColor=MUTED, alignment=TA_CENTER)
sTOCB = S("tocb", fontName="H", fontSize=10.5, leading=14, textColor=GREEN)
sTOC1 = S("toc1", fontSize=8.8, leading=10.5, leftIndent=12, textColor=INK)


def esc(t):
    """Escapa texto livre para Paragraph (permite <b>, <i>, <br/> vindos do JSON)."""
    if t is None:
        return ""
    t = str(t).replace("&", "&amp;")
    t = t.replace("<", "&lt;").replace(">", "&gt;")
    return re.sub(r"&lt;(/?)(b|i|br/?)&gt;", r"<\1\2>", t)


def num(v):
    """Quantidade sem casas quando inteira (38), com vírgula quando fracionária (12,5)."""
    v = float(v or 0)
    if v == int(v):
        return str(int(v))
    return f"{v:.2f}".rstrip("0").rstrip(".").replace(".", ",")


# ============================================================ tipos de relatório técnico
TIPOS = ("RLQ", "RCPU", "RTP", "RLM")
TIPO_NOME = {"RLQ": "Relatórios de Limpeza Química", "RCPU": "Relatórios de Contagem de Partículas e Umidade",
             "RTP": "Relatórios de Teste de Pressão", "RLM": "Relatórios de Limpeza Mecânica"}
TIPO_TITULO = {"RLQ": "Limpeza química", "RCPU": "Flushing", "RTP": "Teste de pressão", "RLM": "Limpeza mecânica"}


def _iso(code):
    """'18/16/13' -> (18, 16, 13); None se não for um código ISO 4406."""
    parts = re.findall(r"\d+", str(code or ""))
    return tuple(int(p) for p in parts) if len(parts) in (2, 3) else None


def _numero(v):
    m = re.search(r"\d+(?:[.,]\d+)?", str(v or ""))
    return float(m.group(0).replace(",", ".")) if m else None


def _data_ord(dt):
    """dd/mm/aaaa -> aaaammdd (comparável); None se inválida."""
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", str(dt or "").strip())
    return f"{m.group(3)}{m.group(2)}{m.group(1)}" if m else None


def acima_do_limite(medido, limite, kind):
    """True/False quando há medição e limite comparáveis; None caso contrário."""
    if kind == "iso":
        a, b = _iso(medido), _iso(limite)
        if not a or not b or len(a) != len(b):
            return None
        return any(x > y for x, y in zip(a, b))
    a, b = _numero(medido), _numero(limite)
    if a is None or b is None:
        return None
    return a > b


# ============================================================ flowables de paginação
class _Marker(Flowable):
    def __init__(self, st, key, title, level=0):
        super().__init__()
        self.st, self.key, self.title, self.level = st, key, title, level

    def wrap(self, *a):
        return (0, 0)

    def draw(self):
        pg = self.canv.getPageNumber() + self.st["offset"]
        self.st["headings"].append((self.key, self.title, self.level, pg))


class _SetOffset(Flowable):
    """Colocado no topo de cada divisória de FDS: soma as páginas de FDS já inseridas."""
    def __init__(self, st, idx):
        super().__init__()
        self.st, self.idx = st, idx

    def wrap(self, *a):
        return (0, 0)

    def draw(self):
        self.st["offset"] = sum(self.st["fds_pages"][: self.idx])


# ============================================================ builder
class DatabookBuilder:
    def __init__(self, dados, base_dir=None, assets_dir=None):
        self.d = deepcopy(dados)
        self.base = base_dir or os.getcwd()
        self.assets = os.path.abspath(assets_dir or ASSETS)
        _register_fonts(self.assets)
        # fds_pages: nº de páginas de cada PDF anexado (FDS e, depois, certificados), na ordem dos anexos
        self.st = dict(headings=[], total=0, offset=0, fds_pages=[], toc=None)
        self.avisos = []
        self._tmp = tempfile.TemporaryDirectory(prefix="databook_")
        self._foto_cache = {}
        self._normalize()

    def close(self):
        """Libera o diretório temporário quando o builder é usado só para pré-validar (sem build)."""
        self._tmp.cleanup()

    # ------------------------------------------------------------ dados
    def _p(self, path):
        return path if os.path.isabs(path) else os.path.join(self.base, path)

    def _normalize(self):
        d = self.d
        P = d["projeto"]
        dias = d["dias"]
        P.setdefault("periodo", f"{dias[0]['data']} a {dias[-1]['data']}" if dias else "")
        P.setdefault("rev", "0")
        d.setdefault("unidade_escopo", "APVs")
        d.setdefault("equipe", [])
        d.setdefault("etapas_produto", [])
        d.setdefault("criterios_aceitacao", [])
        d.setdefault("fds", [])
        d.setdefault("textos", {})
        d.setdefault("dados_tecnicos", [])
        d.setdefault("ocorrencias_sms", 0)
        d.setdefault("certificados", [])
        d.setdefault("criterios_rtp", [])
        d.setdefault("limites_rcpu", {})
        d.setdefault("acumulado_inicial", 0)
        for dia in dias:
            dia.setdefault("servicos", [])
            dia.setdefault("atividades", [])
            dia.setdefault("fotos", [])
            for s in dia["servicos"]:
                s.setdefault("tipo", "RLQ")
                s.setdefault("titulo", TIPO_TITULO.get(s["tipo"], "Limpeza química"))
                s.setdefault("status", "Finalizado")
                s.setdefault("quantidade", 0)
                s.setdefault("concluidas", s["quantidade"] if s["status"].lower().startswith("finaliz") else 0)
                s.setdefault("etapas", [])
                # `rlq` continua valendo para RLQ; `relatorio` é o nº do relatório de origem de qualquer tipo
                if s["tipo"] == "RLQ":
                    if s.get("relatorio") is None and s.get("rlq") is not None:
                        s["relatorio"] = s["rlq"]
                    elif s.get("rlq") is None and s.get("relatorio") is not None:
                        s["rlq"] = s["relatorio"]
                if s["tipo"] == "RCPU":
                    r = s.setdefault("rcpu", {})
                    for k, lk in (("limite_iso", "iso"), ("limite_nas", "nas"), ("limite_umidade_ppm", "umidade_ppm")):
                        if r.get(k) in (None, "") and d["limites_rcpu"].get(lk) not in (None, ""):
                            r[k] = d["limites_rcpu"][lk]
                if s["tipo"] == "RTP":
                    s.setdefault("rtp", {})
        if not d.get("escopo_total"):
            d["escopo_total"] = (d["acumulado_inicial"] + sum(self.qty(x) for x in dias)) or 1
        servs = [s for x in dias for s in x["servicos"]]
        self.tipos = [t for t in TIPOS if any(s["tipo"] == t for s in servs)]
        # Projeto só com RLQ (ou sem serviços) mantém exatamente os textos do modelo original
        self.misto = any(s["tipo"] != "RLQ" for s in servs)
        self._validar()

    def qty(self, dia):
        return sum(float(s.get("concluidas", 0) or 0) for s in dia.get("servicos", []))

    @staticmethod
    def ref(s):
        return f"{s['tipo']} nº {s['relatorio']}" if s.get("relatorio") not in (None, "") else ""

    def _validar(self):
        av = self.avisos
        for dia in self.d["dias"]:
            dt = dia["data"]
            for turno, dds in (("", dia.get("dds")), (" noturno", dia.get("dds_noturno"))):
                if dds and dds.get("inicio") and dds.get("fim") and dds["fim"] < dds["inicio"] and not turno:
                    av.append(f"{dt}: DDS termina ({dds['fim']}) antes de começar ({dds['inicio']}).")
                if dds and dds.get("fim") and dds.get("inicio") and dds["fim"] >= "12:00" and dds["inicio"] < "08:00":
                    av.append(f"{dt}: DDS{turno} com término às {dds['fim']} (provável erro de digitação).")
            for s in dia["servicos"]:
                tags = s.get("tags", "")
                parts = [re.sub(r"[^0-9A-Z]", "", p.upper()) for p in re.split(r"[/;,]| e | E ", tags) if p.strip()]
                if len(parts) >= 2 and len(set(parts)) < len(parts):
                    av.append(f"{dt}: tag repetida no mesmo serviço: '{tags}'.")
                fin = s["status"].lower().startswith("finaliz")
                if s["tipo"] == "RLQ":
                    if fin and not s.get("rlq"):
                        av.append(f"{dt}: serviço finalizado sem RLQ/laudo associado.")
                    continue
                self._validar_tecnico(dia, s, fin)
            if not dia.get("rdo"):
                av.append(f"{dt}: dia sem RDO.")
            if not dia["fotos"]:
                av.append(f"{dt}: dia sem fotos.")
            for f in dia["fotos"]:
                if not os.path.exists(self._p(f["arquivo"])):
                    av.append(f"{dt}: foto não encontrada: {f['arquivo']}")
        for f in self.d["fds"]:
            if not os.path.exists(self._p(f["arquivo"])):
                raise FileNotFoundError(f"FDS não encontrada: {f['arquivo']}")
        for c in self.d["certificados"]:
            if not os.path.exists(self._p(c["arquivo"])):
                raise FileNotFoundError(f"Certificado de calibração não encontrado: {c['arquivo']}")

    def _validar_tecnico(self, dia, s, fin):
        """Avisos de RCPU, RTP e RLM (os de RLQ seguem as regras originais)."""
        av, dt, tipo, ref = self.avisos, dia["data"], s["tipo"], self.ref(s)
        quem = ref or f"serviço {tipo}"
        if fin and not s.get("relatorio"):
            av.append(f"{dt}: serviço finalizado sem {tipo}/laudo associado.")
        if str(s.get("laudo", "")).upper() == "REPROVADO":
            av.append(f"{dt}: {quem} com laudo REPROVADO.")
        if s.get("relatorio") and not any(f.get("origem") == tipo and str(f.get("numero", "")) == str(s["relatorio"])
                                          for f in dia["fotos"]):
            av.append(f"{dt}: {quem} sem fotos.")
        hoje = _data_ord(dt)
        if tipo == "RCPU":
            r = s["rcpu"]
            for rot, med, lim, kind, un in (("ISO 4406", r.get("iso_final"), r.get("limite_iso"), "iso", ""),
                                             ("NAS 1638", r.get("nas_final"), r.get("limite_nas"), "num", ""),
                                             ("umidade", r.get("umidade_final_ppm"), r.get("limite_umidade_ppm"), "num", " ppm")):
                if acima_do_limite(med, lim, kind):
                    av.append(f"{dt}: {quem}: {rot} final {med}{un} acima do limite {lim}{un}.")
            val = _data_ord(r.get("contador_validade"))
            if hoje and val and val < hoje:
                av.append(f"{dt}: {quem}: certificado do contador {r.get('contador', '')} vencido em {r['contador_validade']}.".replace("  ", " "))
        if tipo == "RTP":
            r = s["rtp"]
            for m in r.get("manometros", []):
                val = _data_ord(m.get("validade"))
                if hoje and val and val < hoje:
                    av.append(f"{dt}: {quem}: certificado do manômetro {m.get('tag', '')} vencido em {m['validade']}.")
            pt, pw = _numero(r.get("pressao_teste")), _numero(r.get("pressao_trabalho"))
            if pt is not None and pw is not None and pt < pw:
                av.append(f"{dt}: {quem}: pressão de teste ({r['pressao_teste']}) menor que a de trabalho ({r['pressao_trabalho']}).")

    # ------------------------------------------------------------ fotos
    def _foto(self, path):
        """Reduz e recomprime a foto (cache por arquivo). Retorna (caminho_tmp, w, h, hash)."""
        src = self._p(path)
        if src in self._foto_cache:
            return self._foto_cache[src]
        im = Image.open(src)
        try:
            from PIL import ImageOps
            im = ImageOps.exif_transpose(im)
        except Exception:
            pass
        im = im.convert("RGB")
        h = hashlib.md5(im.resize((16, 16)).tobytes()).hexdigest()
        im.thumbnail((FOTO_MAX_PX, FOTO_MAX_PX), Image.LANCZOS)
        out = os.path.join(self._tmp.name, f"{len(self._foto_cache):05d}.jpg")
        im.save(out, quality=FOTO_JPEG_Q, optimize=True)
        self._foto_cache[src] = (out, im.width, im.height, h)
        return self._foto_cache[src]

    def day_photos(self, dia):
        out, seen = [], set()
        for f in dia["fotos"]:
            if not os.path.exists(self._p(f["arquivo"])):
                continue
            p, w, h, hs = self._foto(f["arquivo"])
            if hs in seen:          # remove duplicadas (mesma foto no RDO e no RLQ)
                continue
            seen.add(hs)
            out.append((p, w, h, f.get("origem", "RDO"), f.get("numero", ""), f.get("legenda")))
        return out

    def photo_rows(self, photos, day_idx):
        gap = 4 * mm
        cw = (CW - gap * (FOTO_COLS - 1)) / FOTO_COLS
        flows = []
        for off in range(0, len(photos), FOTO_COLS):
            chunk = photos[off:off + FOTO_COLS]
            row = []
            for j, (p, iw, ih, src, n, leg) in enumerate(chunk):
                s = min((cw - 2) / iw, (FOTO_CELL_H - 2) / ih)
                frame = Table([[RLImage(p, width=iw * s, height=ih * s)]], colWidths=[cw], rowHeights=[FOTO_CELL_H])
                frame.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                                           ("BACKGROUND", (0, 0), (-1, -1), PHOTO_BG),
                                           ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                                           ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
                kind = esc(leg) if leg else ("Registro de campo" if src == "RDO" else "Sistema / inspeção")
                ref = f" · {src} nº {n}" if n != "" else ""
                cap = Paragraph(f"<font name='BB' color='#30503A'>Foto {day_idx}.{off + j + 1}</font> · {kind}{ref}", sCap)
                row.append([frame, Spacer(1, 2), cap])
            while len(row) < FOTO_COLS:
                row.append("")
            line, widths = [], []
            for i, cell in enumerate(row):
                line.append(cell)
                widths.append(cw)
                if i < FOTO_COLS - 1:
                    line.append("")
                    widths.append(gap)
            t = Table([line], colWidths=widths)
            t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                                   ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                                   ("TOPPADDING", (0, 0), (-1, -1), 0)]))
            flows.append(t)
        return flows

    # ------------------------------------------------------------ blocos visuais
    def marker(self, key, title, level=0):
        return _Marker(self.st, key, title, level)

    def section_title(self, num, title, key, kicker=None):
        full = f"{num}. {title}" if num else title
        out = [self.marker(key, full)]
        if kicker:
            out.append(Paragraph(esc(kicker).upper(), sKicker))
        out.append(Paragraph(esc(full), sH1))
        d = Drawing(CW, 6)
        d.add(Rect(0, 2, 28 * mm, 2.2, fillColor=RED, strokeColor=None))
        d.add(Rect(28 * mm, 2.6, CW - 28 * mm, 0.6, fillColor=RULE, strokeColor=None))
        return out + [d, Spacer(1, 6)]

    @staticmethod
    def kv_table(rows, cols=2):
        cells, line = [], []
        for lab, val in rows:
            line.append([Paragraph(esc(lab).upper(), sLabel), Paragraph(esc(val) if val not in (None, "") else "—", sVal)])
            if len(line) == cols:
                cells.append(line)
                line = []
        if line:
            while len(line) < cols:
                line.append("")
            cells.append(line)
        t = Table(cells, colWidths=[CW / cols] * cols)
        t.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOX", (0, 0), (-1, -1), 0.6, RULE),
            ("INNERGRID", (0, 0), (-1, -1), 0.4, RULE), ("BACKGROUND", (0, 0), (-1, -1), colors.white),
            ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6)]))
        return t

    @staticmethod
    def data_table(header, rows, colw, align_center=()):
        data = [[Paragraph(h, sCellW) for h in header]]
        for r in rows:
            data.append([c if isinstance(c, Flowable) else
                         Paragraph(esc(c), sCellC if i in align_center else sCell) for i, c in enumerate(r)])
        t = Table(data, colWidths=colw, repeatRows=1)
        st = [("BACKGROUND", (0, 0), (-1, 0), GREEN), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
              ("LINEBELOW", (0, 0), (-1, -1), 0.4, RULE), ("BOX", (0, 0), (-1, -1), 0.6, RULE),
              ("TOPPADDING", (0, 0), (-1, -1), 3.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 4.5),
              ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5)]
        for i in range(2, len(data), 2):
            st.append(("BACKGROUND", (0, i), (-1, i), ZEBRA))
        t.setStyle(TableStyle(st))
        return t

    @staticmethod
    def hr(width, color=RULE, thick=0.6):
        d = Drawing(width, 4)
        d.add(Line(0, 2, width, 2, strokeColor=color, strokeWidth=thick))
        return d

    @staticmethod
    def bullet(txt, style_name="bl"):
        return Paragraph(f"<font color='#C81519'>●</font>&nbsp;&nbsp;{esc(txt)}", S(style_name, spaceBefore=2))

    # ------------------------------------------------------------ moldura
    def _logo(self, name):
        return os.path.join(self.assets, "logos", name)

    def draw_header_footer(self, c, doc):
        P = self.d["projeto"]
        pg = c.getPageNumber() + self.st["offset"]
        c.saveState()
        lg = self._logo("logo_horizontal.png")
        iw, ih = Image.open(lg).size
        c.drawImage(lg, ML, H - 19 * mm, width=38 * mm, height=38 * mm * ih / iw, mask="auto")
        c.setFont("H", 8)
        c.setFillColor(GREEN)
        c.drawRightString(W - MR, H - 13.2 * mm, "DATA BOOK  ·  " + P["servico"].upper())
        c.setFont("B", 8)
        c.setFillColor(MUTED)
        c.drawRightString(W - MR, H - 17.4 * mm, f"{P['missao']}  ·  {P['cliente']}")
        c.setStrokeColor(GREEN); c.setLineWidth(1.2); c.line(ML, H - 21.5 * mm, W - MR, H - 21.5 * mm)
        c.setStrokeColor(RED); c.line(ML, H - 21.5 * mm, ML + 22 * mm, H - 21.5 * mm)
        c.setStrokeColor(RULE); c.setLineWidth(0.5); c.line(ML, 13 * mm, W - MR, 13 * mm)
        c.setFont("B", 7.2)
        c.setFillColor(MUTED)
        c.drawString(ML, 9 * mm, P["empresa"])
        c.drawString(ML, 5.6 * mm, f"Doc. {P['doc']}  ·  Rev. {P['rev']}  ·  Emissão {P['emissao']}  ·  Contrato/Proposta {P['contrato']}")
        c.setFont("BB", 8)
        c.setFillColor(GREEN)
        c.drawRightString(W - MR, 9 * mm, f"Página {pg} de {self.st['total'] or '—'}")
        c.restoreState()

    def draw_cover(self, c, doc):
        P = self.d["projeto"]
        c.saveState()
        c.setFillColor(GREEN_D)
        c.rect(0, 0, W, H, fill=1, stroke=0)
        c.saveState()
        c.setFillAlpha(0.07)
        c.drawImage(self._logo("emblema_branco.png"), W - 150 * mm, -40 * mm, width=210 * mm, height=210 * mm, mask="auto")
        c.restoreState()
        for i, col in enumerate([BLUE, RED, LAV]):
            c.setFillColor(col)
            c.rect(ML + i * 14 * mm, H - 14 * mm, 12 * mm, 2.2 * mm, fill=1, stroke=0)
        lg = self._logo("logo_horizontal_branco.png")
        iw, ih = Image.open(lg).size
        c.drawImage(lg, ML, H - 48 * mm, width=72 * mm, height=72 * mm * ih / iw, mask="auto")
        c.setFillColor(HexColor("#B9C9BE")); c.setFont("H", 10)
        c.drawString(ML, H - 98 * mm, P.get("subtitulo_capa", "RELATÓRIO FINAL DE SERVIÇO"))
        c.setFillColor(colors.white); c.setFont("HB", 46)
        c.drawString(ML - 1.5, H - 117 * mm, "DATA BOOK")
        c.setFont("HL", 19)
        c.drawString(ML, H - 130 * mm, P["servico"])
        c.setFillColor(RED)
        c.rect(ML, H - 139 * mm, 30 * mm, 1.6 * mm, fill=1, stroke=0)
        rows = [("CLIENTE", P["cliente"]), ("UNIDADE / MISSÃO", P["missao"]), ("LOCAL", P["local"]),
                ("CONTRATO / PROPOSTA", P["contrato"]), ("PERÍODO DE EXECUÇÃO", P["periodo"]),
                ("DOCUMENTO", f"{P['doc']}  ·  Rev. {P['rev']}  ·  Emissão {P['emissao']}")]
        yy = H - 158 * mm
        for lab, val in rows:
            c.setFillColor(HexColor("#9DB3A4")); c.setFont("H", 7.5); c.drawString(ML, yy, lab)
            c.setFillColor(colors.white); c.setFont("B", 12.5); c.drawString(ML, yy - 5.6 * mm, val)
            yy -= 14 * mm
        c.setFillColor(HexColor("#9DB3A4")); c.setFont("B", 7.5)
        c.drawString(ML, 12 * mm, P["empresa"])
        c.restoreState()

    # ------------------------------------------------------------ gráfico
    def progress_chart(self):
        days = self.d["dias"]
        total = self.d["escopo_total"]
        n = max(len(days), 1)
        dw, dh = CW, 62 * mm
        d = Drawing(dw, dh)
        left, bottom, top = 12 * mm, 12 * mm, dh - 8 * mm
        ph = top - bottom
        bw = (dw - left - 4 * mm) / n
        fs = 1.0 if n <= 12 else (0.85 if n <= 25 else 0.7)   # reduz rótulos com muitos dias
        for v in (0, 25, 50, 75, 100):
            y = bottom + ph * v / 100
            d.add(Line(left, y, dw, y, strokeColor=RULE, strokeWidth=0.4))
            d.add(String(left - 2 * mm, y - 2.5, f"{v}%", fontName="B", fontSize=7, fillColor=MUTED, textAnchor="end"))
        acc = self.d["acumulado_inicial"]
        for i, day in enumerate(days):
            q = self.qty(day)
            acc += q
            pct = min(acc / total * 100, 100)
            x = left + i * bw + bw * 0.18
            w = bw * 0.64
            h = ph * pct / 100
            d.add(Rect(x, bottom, w, max(h, 0.01), fillColor=GREEN if q else LAV, strokeColor=None))
            if q:
                qh = min(ph * q / total, h)
                d.add(Rect(x, bottom + h - qh, w, qh, fillColor=RED, strokeColor=None))
            d.add(String(x + w / 2, bottom + h + 2.2 * mm, f"{pct:.0f}%", fontName="BB", fontSize=7.5 * fs, fillColor=INK, textAnchor="middle"))
            d.add(String(x + w / 2, bottom - 4.5 * mm, day["data"][:5], fontName="B", fontSize=7.3 * fs, fillColor=MUTED, textAnchor="middle"))
            d.add(String(x + w / 2, bottom - 8.5 * mm, f"{num(acc)}/{num(total)}", fontName="B", fontSize=6.8 * fs, fillColor=MUTED, textAnchor="middle"))
        for lx, col, txt in [(left, GREEN, f"Avanço acumulado ({self.d['unidade_escopo']} concluídos / escopo)"),
                             (left + 82 * mm, RED, "Produção do dia"), (left + 112 * mm, LAV, "Sem produção")]:
            d.add(Rect(lx, dh - 4 * mm, 3 * mm, 3 * mm, fillColor=col, strokeColor=None))
            d.add(String(lx + 4.5 * mm, dh - 3.6 * mm, txt, fontName="B", fontSize=7.5, fillColor=INK))
        return d

    # ------------------------------------------------------------ conteúdo
    def _toc_table(self):
        rows = []
        for key, title, lvl, pg in (self.st["toc"] or []):
            if key in ("controle", "sumario"):
                continue
            rows.append([Paragraph(esc(title), sTOCB if lvl == 0 else sTOC1),
                         Paragraph(str(pg), S("tp", fontName="BB" if lvl == 0 else "B", fontSize=10 if lvl == 0 else 8.8,
                                              leading=14 if lvl == 0 else 10.5, alignment=TA_RIGHT,
                                              textColor=GREEN if lvl == 0 else INK))])
        if not rows:
            rows = [["", ""]]
        t = Table(rows, colWidths=[CW - 20 * mm, 20 * mm])
        t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.3, RULE),
                               ("TOPPADDING", (0, 0), (-1, -1), 1.2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
        return t

    def story(self):
        D, P, T = self.d, self.d["projeto"], self.d["textos"]
        dias, total, un = D["dias"], D["escopo_total"], D["unidade_escopo"]
        servs = [s for x in dias for s in x["servicos"]]
        emitidos = [s for s in servs if s.get("relatorio")]
        aprovados = [s for s in emitidos if str(s.get("laudo", "")).upper() == "APROVADO"]
        inicial = D["acumulado_inicial"]
        concluido = inicial + sum(self.qty(x) for x in dias)
        st = [NextPageTemplate("content"), PageBreak()]

        # ---- Controle do documento
        st += self.section_title("", "Controle do Documento", "controle", kicker="Folha de rosto")
        st.append(self.kv_table([
            ("Título", f"Data Book – {P['servico']}"), ("Número do documento", P["doc"]),
            ("Cliente", P["cliente"]), ("CNPJ do cliente", P.get("cnpj", "")),
            ("Unidade / Missão", P["missao"]), ("Contrato / Proposta", P["contrato"]),
            ("Local do serviço", P["local"]), ("Período de execução", P["periodo"]),
            ("Executante", P["empresa"]), ("Data de emissão", P["emissao"])]))
        st += [Spacer(1, 8), Paragraph("Registro de revisões", sH2)]
        ap = D.get("aprovacoes", {})
        revs = D.get("revisoes") or [{"rev": P["rev"], "data": P["emissao"], "descricao": "Emissão inicial",
                                      "elaborado": (ap.get("elaborado") or {}).get("nome", ""),
                                      "verificado": (ap.get("verificado") or {}).get("nome", ""),
                                      "aprovado": (ap.get("aprovado") or {}).get("nome", "")}]
        rows = [[r.get("rev", ""), r.get("data", ""), r.get("descricao", ""), r.get("elaborado", ""),
                 r.get("verificado", ""), r.get("aprovado", "")] for r in revs] + [[""] * 6]
        st.append(self.data_table(["Rev.", "Data", "Descrição", "Elaborado", "Verificado", "Aprovado"], rows,
                                  [12 * mm, 22 * mm, CW - 124 * mm, 30 * mm, 30 * mm, 30 * mm], align_center=(0, 1)))
        st += [Spacer(1, 8), Paragraph("Aprovações", sH2)]
        sig = []
        ap = D.get("aprovacoes", {})
        for key, role in [("elaborado", "Elaborado por (Filtrovali)"), ("verificado", "Verificado por (Filtrovali)"),
                          ("aprovado", "Aprovado por (Cliente)")]:
            pessoa = ap.get(key) or {}
            cell = [Spacer(1, 18 * mm), self.hr(CW / 3 - 10 * mm, INK),
                    Paragraph(f"<b>{role}</b>", S("sg", fontSize=8.5, leading=11, alignment=TA_CENTER))]
            if pessoa.get("nome"):
                cell.append(Paragraph(esc(pessoa["nome"]), S("sgn", fontSize=8.8, leading=11, alignment=TA_CENTER)))
                cell.append(Paragraph(f"Cargo: {esc(pessoa.get('cargo', ''))}<br/>Data: {esc(pessoa.get('data') or '____/____/______')}",
                                      S("sg2", fontSize=7.5, leading=10, textColor=MUTED, alignment=TA_CENTER)))
            else:
                cell.append(Paragraph("Nome / Cargo / Data", S("sg2", fontSize=7.5, leading=10, textColor=MUTED, alignment=TA_CENTER)))
            sig.append(cell)
        t = Table([sig], colWidths=[CW / 3] * 3)
        t.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER"), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOX", (0, 0), (-1, -1), 0.6, RULE),
                               ("INNERGRID", (0, 0), (-1, -1), 0.4, RULE), ("TOPPADDING", (0, 0), (-1, -1), 4),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
        st += [t, Spacer(1, 10)]
        rdos = [x["rdo"] for x in dias if x.get("rdo")] + [n for x in dias for n in x.get("rdos_extras", [])]
        rlqs = [s["rlq"] for s in emitidos if s["tipo"] == "RLQ"]
        nota = T.get("nota_controle") or (self._nota_mista(rdos, emitidos) if self.misto else None) or (
            f"Este Data Book consolida os Relatórios Diários de Obra (RDO nº {min(rdos)} a {max(rdos)}) e os Relatórios de "
            f"Limpeza Química (RLQ nº {min(rlqs)} a {max(rlqs)}) emitidos durante a execução do serviço, apresentando de forma "
            "condensada as atividades diárias, os dados técnicos de cada serviço, o avanço físico e o registro fotográfico, "
            "acompanhados das Fichas com Dados de Segurança (FDS) dos produtos químicos utilizados. Os relatórios originais "
            "assinados permanecem disponíveis para consulta." if rdos and rlqs else "")
        st += [Paragraph(esc(nota), S("note", fontSize=8.6, leading=12, textColor=MUTED, alignment=4)), PageBreak()]

        # ---- Sumário
        st += self.section_title("", "Sumário", "sumario")
        st += [self._toc_table(), PageBreak()]

        # ---- 1. Dados gerais
        st += self.section_title("1", "Dados Gerais do Serviço", "s1", kicker="Seção 1")
        if T.get("escopo"):
            st += [Paragraph("Escopo", sH2), Paragraph(esc(T["escopo"]), sBodyJ), Spacer(1, 6)]
        if D["dados_tecnicos"]:
            st.append(self.kv_table([tuple(x) for x in D["dados_tecnicos"]]))
        if D["equipe"]:
            st.append(Paragraph("Equipe executante", sH2))
            st.append(self.data_table(["Nome", "Função", "Observação"],
                                      [[e.get("nome", ""), e.get("funcao", ""), e.get("observacao", "")] for e in D["equipe"]],
                                      [70 * mm, 70 * mm, CW - 140 * mm]))
        st.append(Paragraph("Rastreabilidade dos registros", sH2))
        rows = []
        for i, x in enumerate(dias, 1):
            if self.misto:
                rl = ", ".join(self.ref(s) for s in x["servicos"] if s.get("relatorio")) or "—"
            else:
                rl = ", ".join(f"RLQ nº {s['rlq']}" for s in x["servicos"] if s.get("rlq")) or "—"
            rdo = ", ".join(f"RDO nº {n}" for n in ([x["rdo"]] if x.get("rdo") else []) + x.get("rdos_extras", [])) or "—"
            rows.append([f"{i:02d}", x["data"], x.get("dia_semana", ""), rdo, rl, x.get("resumo", "")])
        if self.misto:
            st.append(self.data_table(["Dia", "Data", "Dia da semana", "RDO", "Relatórios técnicos", "Atividade principal"], rows,
                                      [10 * mm, 20 * mm, 24 * mm, 20 * mm, 30 * mm, CW - 104 * mm], align_center=(0, 1, 3, 4)))
        else:
            st.append(self.data_table(["Dia", "Data", "Dia da semana", "RDO", "RLQ", "Atividade principal"], rows,
                                      [10 * mm, 20 * mm, 24 * mm, 20 * mm, 20 * mm, CW - 94 * mm], align_center=(0, 1, 3, 4)))
        st.append(PageBreak())

        # ---- 2. Resumo executivo / avanço
        st += self.section_title("2", "Resumo Executivo e Avanço Físico", "s2", kicker="Seção 2")
        kpis = [(T.get("kpi_rotulo_concluidos", f"{un} limpos e aprovados"), num(concluido)),
                ("Laudos aprovados", f"{len(aprovados)}/{len(emitidos)}"),
                ("Dias de execução", f"{len(dias)}"), ("Ocorrências de SMS", f"{D['ocorrencias_sms']}")]
        kc = [[Paragraph(v, S("kv", fontName="HB", fontSize=20, leading=24, textColor=GREEN)),
               Paragraph(esc(lab).upper(), sLabel)] for lab, v in kpis]
        t = Table([kc], colWidths=[CW / 4] * 4)
        t.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.6, RULE), ("INNERGRID", (0, 0), (-1, -1), 0.4, RULE),
                               ("BACKGROUND", (0, 0), (-1, -1), GREEN_L), ("TOPPADDING", (0, 0), (-1, -1), 7),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 8), ("LEFTPADDING", (0, 0), (-1, -1), 9)]))
        st += [t, Spacer(1, 8)]
        if T.get("resumo_executivo"):
            resumo = T["resumo_executivo"]
        elif un == "%":
            resumo = (f"Entre {dias[0]['data']} e {dias[-1]['data']} o avanço físico ponderado passou de {num(inicial)}% para "
                      f"<b>{num(concluido)}%</b> do escopo, com {len(aprovados)} laudo(s) aprovado(s) no período.")
        elif inicial:
            resumo = (f"Entre {dias[0]['data']} e {dias[-1]['data']} foram concluídos <b>{num(concluido - inicial)} {un}</b>, "
                      f"totalizando <b>{num(concluido)} de {num(total)} {un}</b> ({concluido / total * 100:.0f}% do escopo) "
                      f"com o acumulado anterior de {num(inicial)} {un}, com {len(aprovados)} laudo(s) aprovado(s) no período.")
        else:
            resumo = (f"Entre {dias[0]['data']} e {dias[-1]['data']} foram concluídos <b>{num(concluido)} de {num(total)} {un}</b> "
                      f"({concluido / total * 100:.0f}% do escopo), com {len(aprovados)} laudo(s) aprovado(s).")
        st.append(Paragraph(esc(resumo), sBodyJ))
        if self.misto:
            st += [Paragraph("Relatórios técnicos por tipo", sH2), self._quadro_tipos(servs)]
        if un == "%":
            base = "Base de cálculo: avanço físico ponderado dos escopos do contrato (100%)" + (f", {T['base_calculo']}" if T.get("base_calculo") else "")
            if inicial:
                base += f"; inclui {num(inicial)}% executados antes de {dias[0]['data']}"
        else:
            base = f"Base de cálculo: escopo de {num(total)} {un}" + (f", {T['base_calculo']}" if T.get("base_calculo") else "")
            if inicial:
                base += f"; inclui {num(inicial)} {un} concluídos antes de {dias[0]['data']}"
        st += [Paragraph("Curva de avanço", sH2), self.progress_chart(), Paragraph(base + ".", sSmall)]
        if D.get("avanco_escopos"):
            st += self._quadro_escopos(concluido, total)
        st.append(Paragraph("Quadro de avanço por dia", sH2))
        rows, acc = [], inicial
        for x in dias:
            q = self.qty(x)
            acc += q
            tags = [s.get("tags", "") for s in x["servicos"]]
            if self.misto:
                tags = list(dict.fromkeys(t for t in tags if t))
            tags = " · ".join(tags) or x.get("resumo", "")
            if any(str(s.get("laudo", "")).upper() == "APROVADO" for s in x["servicos"]):
                laudo = "<font color='#30503A'><b>APROVADO</b></font>"
            elif any(not s["status"].lower().startswith("finaliz") for s in x["servicos"]):
                laudo = "<font color='#C81519'><b>EM ANDAMENTO</b></font>"
            elif x["servicos"]:
                laudo = esc(x["servicos"][0].get("laudo") or "—")
            else:
                laudo = "—"
            rows.append([x["data"][:5], tags, num(q), num(acc), f"{acc / total * 100:.0f}%", Paragraph(laudo, sCellC)])
        st.append(self.data_table(["Data", "Tags / identificação", "Qtd.", "Acum.", "Avanço", "Laudo"], rows,
                                  [14 * mm, CW - 81 * mm, 12 * mm, 13 * mm, 15 * mm, 27 * mm], align_center=(0, 2, 3, 4)))
        st.append(PageBreak())

        # ---- 3+. Seções técnicas (só as dos tipos presentes); a numeração segue sozinha
        n = 2
        if "RLQ" in self.tipos or D["etapas_produto"] or D["fds"]:
            n += 1
            st += self.section_title(str(n), "Procedimento de Limpeza Química", f"s{n}", kicker=f"Seção {n}")
            st += [Paragraph(esc(T.get("intro_procedimento",
                                       "Sequência de etapas e produtos químicos aplicados, conforme registrado nos Relatórios de "
                                       "Limpeza Química (RLQ). Montagem, teste de estanqueidade, secagem e desmontagem foram "
                                       "registrados nos dias em que se aplicaram.")), sBodyJ), Spacer(1, 6)]
            if D["etapas_produto"]:
                st.append(self.data_table(["#", "Etapa", "Produto químico"],
                                          [[f"{i:02d}", e["etapa"], e.get("produto") or "—"] for i, e in enumerate(D["etapas_produto"], 1)],
                                          [10 * mm, 55 * mm, CW - 65 * mm], align_center=(0,)))
            if D["criterios_aceitacao"]:
                st += [Paragraph("Critérios de aceitação", sH2), Paragraph("O spool/tubulação pode ser aprovado quando:", sBody)]
                for i, c in enumerate(D["criterios_aceitacao"], 1):
                    st.append(Paragraph(f"<font name='BB' color='#C81519'>{i}.</font>&nbsp;&nbsp;{esc(c)}",
                                        S(f"cr{i}", leftIndent=12, firstLineIndent=-12, spaceBefore=3)))
            if D["fds"]:
                st.append(Paragraph("Produtos químicos utilizados", sH2))
                st.append(self.data_table(["Produto (conforme RLQ)", "Nome comercial (FDS)", "Etapa", "Anexo"],
                                          [[f["produto"], f["nome_comercial"], f.get("etapa", ""), f"B.{i}"] for i, f in enumerate(D["fds"], 1)],
                                          [42 * mm, 58 * mm, CW - 116 * mm, 16 * mm], align_center=(3,)))
            st.append(PageBreak())
        if "RCPU" in self.tipos:
            n += 1
            st += self._secao_rcpu(n, dias) + [PageBreak()]
        if "RTP" in self.tipos:
            n += 1
            st += self._secao_rtp(n, dias) + [PageBreak()]

        # ---- Diário
        nd = n + 1
        st += self.section_title(str(nd), "Diário de Execução", f"s{nd}", kicker=f"Seção {nd}")
        fontes = "RDOs e RLQs" if not self.misto else "RDOs e dos relatórios técnicos (" + ", ".join(self.tipos) + ")"
        st += [Paragraph(f"Condensação diária dos {fontes}: jornada, DDS, atividades, dados técnicos do serviço, "
                         "avanço e registro fotográfico.", sBody), Spacer(1, 4)]
        acc = inicial
        for i, x in enumerate(dias, 1):
            q = self.qty(x)
            acc += q
            if i > 1:
                st.append(PageBreak())
            st.append(self.marker(f"d{i}", f"{nd}.{i}  {x['data']} – {x.get('dia_semana', '')}", level=1))
            refs = [f"RDO nº {r}" for r in ([x["rdo"]] if x.get("rdo") else []) + x.get("rdos_extras", [])] + \
                   [self.ref(s) for s in x["servicos"] if s.get("relatorio")]
            refs = " · ".join(r.replace(" ", "&nbsp;") for r in refs) if self.misto else " · ".join(refs)
            band = Table([[Paragraph(f"DIA {i:02d}", S("dn", fontName="HB", fontSize=15, leading=18, textColor=colors.white)),
                           Paragraph(f"<font name='H' size='12.5'>{x['data']}</font>  <font color='#B9C9BE'>{esc(x.get('dia_semana', ''))}</font><br/>"
                                     f"<font size='8.5' color='#B9C9BE'>{esc(x.get('resumo', ''))}</font>",
                                     S("dd", fontSize=11, leading=15, textColor=colors.white)),
                           Paragraph(f"<font size='8' color='#B9C9BE'>REGISTROS</font><br/>{refs}",
                                     S("dr", fontName="BB", fontSize=9, leading=12, textColor=colors.white, alignment=TA_RIGHT))]],
                         colWidths=[24 * mm, CW - 70 * mm, 46 * mm])
            band.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), GREEN), ("BACKGROUND", (0, 0), (0, 0), RED),
                                      ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 6),
                                      ("BOTTOMPADDING", (0, 0), (-1, -1), 7), ("LEFTPADDING", (0, 0), (-1, -1), 8),
                                      ("RIGHTPADDING", (0, 0), (-1, -1), 8)]))
            st += [band, Spacer(1, 6)]

            av = f"{num(q)} {un} no dia · {num(acc)}/{num(total)} acumulado ({acc / total * 100:.0f}%)"
            if x.get("rdo"):
                dds = x.get("dds") or {}
                jr = [("Jornada (diurno)", x.get("jornada", "")), ("Efetivo", f"{x.get('efetivo', len(D['equipe']))} colaboradores"),
                      ("Horas extras (diurno)", x.get("horas_extras") or "—"),
                      ("DDS", f"{dds.get('inicio', '')} – {dds.get('fim', '')}" if dds else "—"),
                      ("Tema do DDS", dds.get("tema", "")), ("Avanço", av)]
                if x.get("stand_by"):
                    jr.append(("Stand-by", f"{x['stand_by'].get('tempo', '')} – {x['stand_by'].get('motivo', '')}"))
                if x.get("comentario"):
                    jr.append(("Comentário (jornada)", x["comentario"]))
                jr += self._jornada_noturna(x)
            elif all(s["tipo"] == "RLQ" for s in x["servicos"]):
                rl = ", ".join(str(s["rlq"]) for s in x["servicos"] if s.get("rlq"))
                jr = [("Avanço", av), ("Fonte", f"Dados conforme RLQ nº {rl} (sem RDO correspondente)")]
            else:
                rl = ", ".join(self.ref(s) for s in x["servicos"] if s.get("relatorio"))
                jr = [("Avanço", av), ("Fonte", f"Dados conforme {rl} (sem RDO correspondente)")]
            st.append(self.kv_table(jr))

            if x["atividades"]:
                st.append(Paragraph("Atividades", sH2))
                for a in x["atividades"]:
                    hr_ = a.get("hora")
                    pre = f"<font name='BB' color='#30503A'>{esc(hr_)}</font>&nbsp;&nbsp;" if hr_ else "<font color='#C81519'>●</font>&nbsp;&nbsp;"
                    st.append(Paragraph(pre + esc(a["texto"]), S(f"at{i}", spaceBefore=1, spaceAfter=2, alignment=4)))

            for k, s in enumerate(x["servicos"], 1):
                st.append(Paragraph(f"Serviço {k} – {esc(s['titulo'])}", sH2))
                equip = " · ".join(v for v in [s.get("equipamento"), s.get("sistema")] if v)
                if s.get("quantidade"):
                    equip += f" ({num(s['quantidade'])} {s.get('unidade_quantidade', 'un.')})"
                if s["tipo"] == "RLQ":
                    if s.get("rlq"):
                        laudo = f"{s.get('laudo', 'APROVADO')} – RLQ nº {s['rlq']}"
                    else:
                        laudo = s.get("laudo_observacao") or "Não emitido"
                    st.append(self.kv_table([
                        ("Equipamento / sistema", equip), ("Material", s.get("material", "")),
                        ("Início – término", f"{s.get('inicio', '')} – {s.get('fim', '')}"), ("Método", s.get("metodo", "")),
                        ("Tags", s.get("tags", "")), ("Inspeção", s.get("inspecao") or "—"),
                        ("Status", s["status"]), ("Laudo (RLQ)", laudo)]))
                else:
                    st += self._bloco_tecnico(s, equip)
                if s["etapas"]:
                    chips = "  ".join(f"<font color='#30503A'>●</font> {esc(e)}" for e in s["etapas"])
                    et = Table([[Paragraph("ETAPAS EXECUTADAS", sLabel)], [Paragraph(chips, S("chips", fontSize=8.8, leading=13))]],
                               colWidths=[CW])
                    et.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.6, RULE), ("BACKGROUND", (0, 0), (-1, -1), ZEBRA),
                                            ("LEFTPADDING", (0, 0), (-1, -1), 6), ("TOPPADDING", (0, 0), (-1, -1), 3),
                                            ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
                    st += [Spacer(1, 4), et]
                st += self._medicoes(s)
                if s.get("obs"):
                    st += [Spacer(1, 4), Paragraph(f"<font name='BB' color='#5F6B64'>OBS.:</font> {esc(s['obs'])}", sBody)]

            ph = self.day_photos(x)
            if ph:
                st.append(CondPageBreak(75 * mm))
                st.append(Paragraph(f"Registro fotográfico <font size='8.5' color='#5F6B64'>({len(ph)} fotos)</font>", sH2))
                st += self.photo_rows(ph, i)
        st.append(PageBreak())

        # ---- SMS
        ns = nd + 1
        st += self.section_title(str(ns), "Segurança, Meio Ambiente e Saúde", f"s{ns}", kicker=f"Seção {ns}")
        st += [Paragraph("Diálogos Diários de Segurança (DDS) realizados no início de cada turno, conforme RDOs.", sBody), Spacer(1, 4)]
        rows = []
        for x in dias:
            if not x.get("rdo"):
                continue
            if x.get("dds"):
                rows.append([x["data"], f"RDO nº {x['rdo']}", f"{x['dds'].get('inicio', '')} – {x['dds'].get('fim', '')}", x["dds"].get("tema", "")])
            if x.get("dds_noturno"):
                dn = x["dds_noturno"]
                rows.append([x["data"], f"RDO nº {x['rdo']}", f"{dn.get('inicio', '')} – {dn.get('fim', '')}",
                             f"<i>Turno noturno:</i> {dn.get('tema', '')}"])
        st.append(self.data_table(["Data", "Registro", "Horário", "Tema"], rows, [22 * mm, 22 * mm, 26 * mm, CW - 70 * mm], align_center=(0, 1, 2)))
        if T.get("destaques_sms"):
            st.append(Paragraph("Destaques do período", sH2))
            st += [self.bullet(t_) for t_ in T["destaques_sms"]]
        if T.get("consideracoes_finais"):
            st += [Paragraph("Considerações finais", sH2), Paragraph(esc(T["consideracoes_finais"]), sBodyJ)]
        st.append(PageBreak())

        # ---- Anexos
        if D["fds"]:
            pages = dict((k, p) for k, _, _, p in (self.st["toc"] or []))
            st += self.section_title("A", "Relação de Fichas com Dados de Segurança", "anexoA", kicker="Anexos")
            fabs = sorted({f.get("fabricante", "") for f in D["fds"] if f.get("fabricante")})
            st += [Paragraph("FDS dos produtos químicos empregados nas etapas de limpeza química"
                             + (f", fornecidas por {esc(', '.join(fabs)).rstrip('.')}" if fabs else "")
                             + f". As fichas são reproduzidas integralmente nos Anexos B.1 a B.{len(D['fds'])}.", sBodyJ), Spacer(1, 6)]
            rows = [[f"B.{i}", f["nome_comercial"], f["produto"], f.get("codigo", ""), f.get("revisao", ""), f.get("data", ""),
                     str(self.st["fds_pages"][i - 1]), str(pages.get(f"b{i}", ""))] for i, f in enumerate(D["fds"], 1)]
            st.append(self.data_table(["Anexo", "Produto (FDS)", "Conforme RLQ", "Código", "Rev.", "Data", "Pág.", "Início"], rows,
                                      [14 * mm, 44 * mm, 34 * mm, 22 * mm, 10 * mm, 20 * mm, 10 * mm, CW - 154 * mm],
                                      align_center=(0, 3, 4, 5, 6, 7)))
            for i, f in enumerate(D["fds"], 1):
                st += [PageBreak(), _SetOffset(self.st, i - 1),
                       self.marker(f"b{i}", f"Anexo B.{i} – FDS {f['nome_comercial']}"), Spacer(1, 70 * mm),
                       Paragraph(f"ANEXO B.{i}", S("ak", fontName="H", fontSize=11, leading=14, textColor=RED)),
                       Paragraph("Ficha com Dados de Segurança", S("at", fontName="HL", fontSize=14, leading=18, textColor=MUTED)),
                       Paragraph(esc(f["nome_comercial"]), S("an", fontName="HB", fontSize=26, leading=31, textColor=GREEN))]
                dd = Drawing(CW, 8)
                dd.add(Rect(0, 3, 30 * mm, 2, fillColor=RED, strokeColor=None))
                st += [dd, Spacer(1, 6), self.kv_table([
                    ("Produto (conforme RLQ)", f["produto"]), ("Etapa de aplicação", f.get("etapa", "")),
                    ("Código / Revisão", f"{f.get('codigo', '')} · Rev. {f.get('revisao', '')}"), ("Data da revisão", f.get("data", "")),
                    ("Fabricante", f.get("fabricante", "")), ("Nº de páginas", str(self.st["fds_pages"][i - 1]))])]
        if D["certificados"]:
            st += self._anexo_certificados()
        return st

    # ------------------------------------------------------------ RCPU / RTP / RLM
    def _nota_mista(self, rdos, emitidos):
        partes = []
        for t in self.tipos:
            ns = [s["relatorio"] for s in emitidos if s["tipo"] == t]
            if ns:
                faixa = f"{t} nº {min(ns)} a {max(ns)}" if min(ns) != max(ns) else f"{t} nº {ns[0]}"
                partes.append(f"{TIPO_NOME[t]} ({faixa})")
        if not rdos or not partes:
            return ""
        anexos = []
        if self.d["fds"]:
            anexos.append("das Fichas com Dados de Segurança (FDS) dos produtos químicos utilizados")
        if self.d["certificados"]:
            anexos.append("dos certificados de calibração dos instrumentos de medição")
        return (f"Este Data Book consolida os Relatórios Diários de Obra (RDO nº {min(rdos)} a {max(rdos)}) e os "
                + ", ".join(partes[:-1]) + (" e " if len(partes) > 1 else "") + partes[-1]
                + " emitidos durante a execução do serviço, apresentando de forma condensada as atividades diárias, os dados "
                  "técnicos de cada serviço, as medições, o avanço físico e o registro fotográfico"
                + (", acompanhados " + " e ".join(anexos) if anexos else "")
                + ". Os relatórios originais assinados permanecem disponíveis para consulta.")

    def _quadro_tipos(self, servs):
        rows = []
        for t in self.tipos:
            ss = [s for s in servs if s["tipo"] == t]
            em = [s for s in ss if s.get("relatorio")]
            ap = [s for s in em if str(s.get("laudo", "")).upper() == "APROVADO"]
            tags = ", ".join(dict.fromkeys(s.get("tags") for s in ss if s.get("tags")))
            if t in ("RLQ", "RLM"):
                dest = f"Tags: {tags}" if tags else "—"
            elif t == "RCPU":
                isos = [_iso(s["rcpu"].get("iso_final")) for s in em]
                isos = [i for i in isos if i]
                ppm = [_numero(s["rcpu"].get("umidade_final_ppm")) for s in em]
                ppm = [p for p in ppm if p is not None]
                n_an = sum(1 for s in em if s['rcpu'].get('iso_final') or s['rcpu'].get('nas_final'))
                partes = [f"{n_an} análise{'s' if n_an != 1 else ''} de contaminação"]
                if isos:
                    partes.append("classe final ISO " + ("até " if len(set(isos)) > 1 else "") + "/".join(map(str, max(isos))))
                if ppm:
                    partes.append(f"umidade final até {num(max(ppm))} ppm")
                dest = "; ".join(partes)
            elif t == "RTP":
                pts = [(_numero(s["rtp"].get("pressao_teste")), s["rtp"].get("pressao_teste")) for s in em]
                pts = [p for p in pts if p[0] is not None]
                dest = (f"Pressão de teste até {max(pts)[1]}" if pts else "—") + (f"; tags: {tags}" if tags else "")
            rows.append([TIPO_NOME[t].replace("Relatórios", "Relatório", 1) + f" ({t})", str(len(em)), str(len(ap)), dest])
        return self.data_table(["Tipo de relatório", "Emitidos", "Aprovados", "Destaques"], rows,
                               [62 * mm, 17 * mm, 19 * mm, CW - 98 * mm], align_center=(1, 2))

    def _quadro_escopos(self, concluido, total):
        """Escopo com unidades mistas: previsto × realizado por escopo e o % geral ponderado."""
        rows = [[e.get("escopo", ""), e.get("unidade", ""), num(e.get("previsto")), num(e.get("realizado")),
                 "—" if e.get("percentual") is None else f"{float(e['percentual']):.0f}%"] for e in self.d["avanco_escopos"]]
        rows.append([Paragraph("<b>Geral (ponderado)</b>", sCell), "", "", "",
                     Paragraph(f"<b>{min(concluido / total * 100, 999):.0f}%</b>", sCellC)])
        return [Paragraph("Avanço por escopo", sH2),
                self.data_table(["Escopo", "Unid.", "Previsto", "Realizado", "Avanço"], rows,
                                [CW - 88 * mm, 14 * mm, 25 * mm, 25 * mm, 24 * mm], align_center=(1, 2, 3, 4))]

    def _jornada_noturna(self, x):
        jr = []
        if x.get("jornada_noturna"):
            jr.append(("Jornada (noturno)", x["jornada_noturna"]))
        if x.get("efetivo_noturno"):
            jr.append(("Efetivo (noturno)", f"{x['efetivo_noturno']} colaboradores"))
        if x.get("horas_extras_noturno"):
            jr.append(("Horas extras (noturno)", x["horas_extras_noturno"]))
        dn = x.get("dds_noturno")
        if dn:
            jr += [("DDS (noturno)", f"{dn.get('inicio', '')} – {dn.get('fim', '')}"), ("Tema do DDS (noturno)", dn.get("tema", ""))]
        return jr

    def _laudo(self, s):
        if s.get("relatorio"):
            return f"{s.get('laudo') or 'Sem laudo'} – {self.ref(s)}"
        return s.get("laudo_observacao") or "Não emitido"

    def _bloco_tecnico(self, s, equip):
        t, ini_fim = s["tipo"], f"{s.get('inicio', '')} – {s.get('fim', '')}"
        if t == "RCPU":
            r = s["rcpu"]
            unid = " · ".join(v for v in [r.get("unidade"), r.get("unidade_desidratacao")] if v)
            oleo = " · ".join(v for v in [r.get("oleo"), r.get("volume")] if v)
            rows = [("Equipamento / sistema", equip), ("Serviços realizados", r.get("servicos_realizados", "")),
                    ("Óleo · volume", oleo), ("Unidade (flushing/filtragem · desidratação)", unid),
                    ("Início – término", ini_fim), ("Tempo total", r.get("tempo_total", "")),
                    ("Tags", s.get("tags", "")), ("Contador de partículas", r.get("contador", "")),
                    ("Status", s["status"]), ("Laudo (RCPU)", self._laudo(s))]
        elif t == "RTP":
            r = s["rtp"]
            rows = [("Equipamento / sistema", equip), ("Equipamento testado", r.get("equipamento_testado", "")),
                    ("Material", s.get("material", "")), ("Fluido de teste", r.get("fluido", "")),
                    ("Pressão de trabalho", r.get("pressao_trabalho", "")), ("Pressão de teste", r.get("pressao_teste", "")),
                    ("Unidade de teste (UTH)", r.get("unidade_teste", "")), ("Início – término", ini_fim),
                    ("Tags", s.get("tags", "")), ("Status", s["status"]), ("Laudo (RTP)", self._laudo(s))]
        else:
            rows = [("Equipamento / sistema", equip), ("Material", s.get("material", "")),
                    ("Início – término", ini_fim), ("Tags", s.get("tags", "")),
                    ("Status", s["status"]), (f"Laudo ({t})", self._laudo(s))]
        return [self.kv_table(rows)]

    def _medicoes(self, s):
        """Tabelas de medição (estilo data_table) exibidas após as etapas do serviço."""
        out = []
        r = s.get("rcpu") if s["tipo"] == "RCPU" else s.get("rtp") if s["tipo"] == "RTP" else None
        if not r:
            return out
        tubos = r.get("tubulacoes") or []
        if tubos:
            rotulo = "Tubulações" if s["tipo"] == "RCPU" else (r.get("equipamento_testado") or "Tubulações")
            out += [Spacer(1, 4), self.data_table([f"{esc(rotulo)} – diâmetro", "Comprimento"],
                                                  [[t.get("diametro", ""), t.get("comprimento", "")] for t in tubos],
                                                  [CW / 2, CW / 2], align_center=(0, 1))]
        if s["tipo"] == "RCPU":
            rows = []
            for rot, ini, fim, lim, kind, un in (
                    ("Contaminação – ISO 4406", r.get("iso_inicial"), r.get("iso_final"), r.get("limite_iso"), "iso", ""),
                    ("Contaminação – NAS 1638", r.get("nas_inicial"), r.get("nas_final"), r.get("limite_nas"), "num", ""),
                    ("Umidade (ppm)", r.get("umidade_inicial_ppm"), r.get("umidade_final_ppm"), r.get("limite_umidade_ppm"), "num", "")):
                if ini in (None, "") and fim in (None, ""):
                    continue
                acima = acima_do_limite(fim, lim, kind)
                res = ("—" if acima is None else
                       "<font color='#C81519'><b>ACIMA DO LIMITE</b></font>" if acima else
                       "<font color='#30503A'><b>CONFORME</b></font>")
                rows.append([rot, ini or "—", fim or "—", lim or "—", Paragraph(res, sCellC)])
            if rows:
                out += [Spacer(1, 4), self.data_table(["Análise", "Inicial", "Final", "Limite", "Resultado"], rows,
                                                      [CW - 120 * mm, 27 * mm, 27 * mm, 30 * mm, 36 * mm], align_center=(1, 2, 3))]
        if s["tipo"] == "RTP" and r.get("manometros"):
            rows = [[m.get("tag", ""), m.get("escala", ""), m.get("certificado", ""), m.get("calibracao", ""), m.get("validade", "")]
                    for m in r["manometros"]]
            out += [Spacer(1, 4), self.data_table(["Manômetro", "Escala", "Certificado de calibração", "Calibração", "Validade"], rows,
                                                  [30 * mm, 30 * mm, CW - 112 * mm, 26 * mm, 26 * mm], align_center=(0, 1, 2, 3, 4))]
        return out

    def _anexo_ref(self, codigo):
        for i, c in enumerate(self.d["certificados"], 1):
            if codigo and c.get("codigo") == codigo:
                return f"C.{i}"
        return "—"

    def _instrumentos(self, aplicacao):
        certs = [c for c in self.d["certificados"] if c.get("aplicacao") == aplicacao]
        if not certs:
            return []
        rows = [[c.get("equipamento", ""), c.get("codigo", ""), c.get("serie") or c.get("escala") or "—", c.get("certificado", ""),
                 c.get("calibracao", ""), c.get("validade", ""), self._anexo_ref(c.get("codigo"))] for c in certs]
        return [Paragraph("Instrumentos de medição", sH2),
                self.data_table(["Instrumento", "Código", "Série / escala", "Certificado", "Calibração", "Validade", "Anexo"], rows,
                                [CW - 136 * mm, 22 * mm, 26 * mm, 28 * mm, 20 * mm, 20 * mm, 20 * mm], align_center=(1, 2, 3, 4, 5, 6))]

    def _criterios(self, intro, itens, chave):
        if not itens:
            return []
        out = [Paragraph("Critérios de aceitação", sH2), Paragraph(esc(intro), sBody)]
        for i, c in enumerate(itens, 1):
            out.append(Paragraph(f"<font name='BB' color='#C81519'>{i}.</font>&nbsp;&nbsp;{esc(c)}",
                                 S(f"{chave}{i}", leftIndent=12, firstLineIndent=-12, spaceBefore=3)))
        return out

    def _servicos_do_tipo(self, dias, tipo):
        return [(x, s) for x in dias for s in x["servicos"] if s["tipo"] == tipo and s.get("relatorio")]

    def _secao_rcpu(self, n, dias):
        T, L = self.d["textos"], self.d["limites_rcpu"]
        st = self.section_title(str(n), "Contagem de Partículas e Análise de Umidade", f"s{n}", kicker=f"Seção {n}")
        itens = self._servicos_do_tipo(dias, "RCPU")
        procs = sorted({s["rcpu"].get("procedimento") for _, s in itens if s["rcpu"].get("procedimento")})
        st += [Paragraph(esc(T.get("intro_rcpu",
                                   "Resultados das análises de contaminação por partículas (ISO 4406 / NAS 1638) e de umidade "
                                   "registradas nos Relatórios de Contagem de Partículas e Umidade (RCPU)"
                                   + (f", executadas conforme o procedimento {', '.join(procs)}" if procs else "") + ".")),
                         sBodyJ), Spacer(1, 6)]
        if itens:
            rows = []
            for x, s in itens:
                r = s["rcpu"]
                iso = " → ".join(v for v in [r.get("iso_inicial"), r.get("iso_final")] if v) or "—"
                nas = " → ".join(str(v) for v in [r.get("nas_inicial"), r.get("nas_final")] if v not in (None, "")) or "—"
                ppm = " → ".join(str(v) for v in [r.get("umidade_inicial_ppm"), r.get("umidade_final_ppm")] if v not in (None, "")) or "—"
                rows.append([f"nº {s['relatorio']}", x["data"][:5], s.get("tags") or s.get("sistema", ""), iso, nas, ppm,
                             s.get("laudo") or "—"])
            st.append(self.data_table(["RCPU", "Data", "Tags / sistema", "ISO 4406", "NAS", "Umidade (ppm)", "Laudo"], rows,
                                      [14 * mm, 12 * mm, CW - 136 * mm, 38 * mm, 18 * mm, 28 * mm, 26 * mm],
                                      align_center=(0, 1, 3, 4, 5, 6)))
        lim = [f"Classe de contaminação final igual ou inferior a ISO 4406 {L['iso']};" if L.get("iso") else None,
               f"Classe de contaminação final igual ou inferior a NAS 1638 classe {L['nas']};" if L.get("nas") else None,
               f"Teor de umidade final igual ou inferior a {L['umidade_ppm']} ppm;" if L.get("umidade_ppm") else None]
        lim = [c for c in lim if c] + list(self.d.get("criterios_rcpu", []))
        st += self._criterios("O sistema pode ser aprovado quando:", lim, "crr")
        st += self._instrumentos("RCPU")
        return st

    def _secao_rtp(self, n, dias):
        T = self.d["textos"]
        st = self.section_title(str(n), "Teste de Pressão", f"s{n}", kicker=f"Seção {n}")
        st += [Paragraph(esc(T.get("intro_rtp",
                                   "Testes de pressão registrados nos Relatórios de Teste de Pressão (RTP), com o fluido, as "
                                   "pressões de trabalho e de teste e os manômetros calibrados utilizados em cada teste.")),
                         sBodyJ), Spacer(1, 6)]
        itens = self._servicos_do_tipo(dias, "RTP")
        if itens:
            rows = [[f"nº {s['relatorio']}", x["data"][:5], s.get("tags") or s.get("sistema", ""), s["rtp"].get("fluido", ""),
                     s["rtp"].get("pressao_trabalho", ""), s["rtp"].get("pressao_teste", ""),
                     f"{s.get('inicio', '')} – {s.get('fim', '')}", s.get("laudo") or "—"] for x, s in itens]
            st.append(self.data_table(["RTP", "Data", "Tags / sistema", "Fluido", "P. trabalho", "P. teste", "Duração", "Laudo"], rows,
                                      [13 * mm, 12 * mm, CW - 135 * mm, 26 * mm, 19 * mm, 17 * mm, 24 * mm, 24 * mm],
                                      align_center=(0, 1, 3, 4, 5, 6, 7)))
        st += self._criterios("O sistema pode ser aprovado quando:", self.d["criterios_rtp"], "crt")
        st += self._instrumentos("RTP")
        return st

    def _anexo_certificados(self):
        D, nf = self.d, len(self.d["fds"])
        pages = dict((k, p) for k, _, _, p in (self.st["toc"] or []))
        certs = D["certificados"]
        st = [PageBreak()] if D["fds"] else []
        st += [_SetOffset(self.st, nf)]     # a relação vem depois do PDF da última FDS
        st += self.section_title("C", "Relação de Certificados de Calibração", "anexoC", kicker="Anexos")
        st += [Paragraph("Certificados de calibração dos instrumentos de medição utilizados nos testes de pressão e nas análises "
                         f"de contaminação. Os certificados são reproduzidos integralmente nos Anexos C.1 a C.{len(certs)}.",
                         sBodyJ), Spacer(1, 6)]
        rows = [[f"C.{i}", c.get("equipamento", ""), c.get("codigo", ""), c.get("certificado", ""), c.get("calibracao", ""),
                 c.get("validade", ""), c.get("aplicacao", ""), str(self.st["fds_pages"][nf + i - 1]), str(pages.get(f"c{i}", ""))]
                for i, c in enumerate(certs, 1)]
        st.append(self.data_table(["Anexo", "Instrumento", "Código", "Certificado", "Calibração", "Validade", "Uso", "Pág.", "Início"], rows,
                                  [14 * mm, CW - 139 * mm, 22 * mm, 28 * mm, 20 * mm, 20 * mm, 13 * mm, 10 * mm, 12 * mm],
                                  align_center=(0, 2, 3, 4, 5, 6, 7, 8)))
        for i, c in enumerate(certs, 1):
            nome = " ".join(v for v in [c.get("equipamento"), c.get("codigo")] if v)
            st += [PageBreak(), _SetOffset(self.st, nf + i - 1),
                   self.marker(f"c{i}", f"Anexo C.{i} – Certificado {nome}"), Spacer(1, 70 * mm),
                   Paragraph(f"ANEXO C.{i}", S("ck", fontName="H", fontSize=11, leading=14, textColor=RED)),
                   Paragraph("Certificado de Calibração", S("ct", fontName="HL", fontSize=14, leading=18, textColor=MUTED)),
                   Paragraph(esc(nome), S("cn", fontName="HB", fontSize=26, leading=31, textColor=GREEN))]
            dd = Drawing(CW, 8)
            dd.add(Rect(0, 3, 30 * mm, 2, fillColor=RED, strokeColor=None))
            st += [dd, Spacer(1, 6), self.kv_table([
                ("Instrumento", c.get("equipamento", "")), ("Código", c.get("codigo", "")),
                ("Série / escala", c.get("serie") or c.get("escala") or "—"), ("Nº do certificado", c.get("certificado", "")),
                ("Data de calibração", c.get("calibracao", "")), ("Validade", c.get("validade", "")),
                ("Utilizado em", c.get("aplicacao", "")), ("Nº de páginas", str(self.st["fds_pages"][nf + i - 1]))])]
        return st

    # ------------------------------------------------------------ montagem
    def _build_body(self, path):
        P = self.d["projeto"]
        self.st["headings"], self.st["offset"] = [], 0
        doc = BaseDocTemplate(path, pagesize=A4, leftMargin=ML, rightMargin=MR, topMargin=MT, bottomMargin=MB,
                              title=f"Data Book – {P['servico']} – {P['missao']}", author=P["empresa"],
                              subject=f"{P['doc']} Rev. {P['rev']}")
        fr = Frame(ML, MB, CW, H - MT - MB, id="f", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        doc.addPageTemplates([PageTemplate("cover", frames=[fr], onPage=self.draw_cover),
                              PageTemplate("content", frames=[fr], onPageEnd=self.draw_header_footer)])
        doc.build(self.story())
        return len(PdfReader(path).pages)

    def _stamp(self, label, pg, total):
        P = self.d["projeto"]
        buf = io.BytesIO()
        c = rlcanvas.Canvas(buf, pagesize=A4)
        c.setFillColor(colors.white)
        c.rect(ML - 2, 3.2 * mm, CW + 4, 4.6 * mm, fill=1, stroke=0)
        c.setFont("B", 6.8); c.setFillColor(MUTED)
        c.drawString(ML, 4.6 * mm, f"Data Book {P['doc']} Rev. {P['rev']}  ·  {label}")
        c.setFont("BB", 7); c.setFillColor(GREEN)
        c.drawRightString(W - MR, 4.6 * mm, f"Página {pg} de {total}")
        c.save()
        buf.seek(0)
        return PdfReader(buf).pages[0]

    def _anexos(self):
        """PDFs anexados integralmente, na ordem: (chave do marcador, rótulo do carimbo, arquivo)."""
        out = [(f"b{i}", f"Anexo B.{i} – FDS {f['nome_comercial']}", f["arquivo"]) for i, f in enumerate(self.d["fds"], 1)]
        for i, c in enumerate(self.d["certificados"], 1):
            nome = " ".join(v for v in [c.get("equipamento"), c.get("codigo")] if v)
            out.append((f"c{i}", f"Anexo C.{i} – Certificado {nome}", c["arquivo"]))
        return out

    def build(self, saida):
        anexos = self._anexos()
        self.st["fds_pages"] = [len(PdfReader(self._p(a[2])).pages) for a in anexos]
        body = os.path.join(self._tmp.name, "_body.pdf")
        # passes até a paginação estabilizar (sumário e "Página X de Y" dependem dela)
        for _ in range(5):
            n = self._build_body(body)
            total = n + sum(self.st["fds_pages"])
            stable = self.st["toc"] == self.st["headings"] and self.st["total"] == total
            self.st["toc"], self.st["total"] = list(self.st["headings"]), total
            if stable:
                break
        r = PdfReader(body)
        heads = dict((k, p) for k, _, _, p in self.st["headings"])
        phys_div = [heads[a[0]] - sum(self.st["fds_pages"][:i]) for i, a in enumerate(anexos)]
        out = PdfWriter()
        for idx, page in enumerate(r.pages, 1):
            out.add_page(page)
            if idx in phys_div:
                _, rotulo, arquivo = anexos[phys_div.index(idx)]
                start = len(out.pages) + 1
                for j, p in enumerate(PdfReader(self._p(arquivo)).pages):
                    p.merge_page(self._stamp(rotulo, start + j, self.st["total"]))
                    out.add_page(p)
        parent = None
        for key, title, lvl, pg in self.st["headings"]:
            if lvl == 0:
                parent = out.add_outline_item(title, pg - 1)
            else:
                out.add_outline_item(title, pg - 1, parent=parent)
        out.page_mode = "/UseOutlines"
        P = self.d["projeto"]
        out.add_metadata({"/Title": f"Data Book – {P['servico']} – {P['missao']}", "/Author": P["empresa"]})
        out.compress_identical_objects(remove_identicals=True, remove_orphans=True)
        os.makedirs(os.path.dirname(os.path.abspath(saida)), exist_ok=True)
        with open(saida, "wb") as fh:
            out.write(fh)
        self._tmp.cleanup()
        return {"arquivo": os.path.abspath(saida), "paginas": len(out.pages), "avisos": self.avisos}


def gerar_databook(dados, saida, base_dir=None, assets_dir=None):
    """Gera o PDF do Data Book. Retorna {'arquivo', 'paginas', 'avisos'}."""
    return DatabookBuilder(dados, base_dir=base_dir, assets_dir=assets_dir).build(saida)
