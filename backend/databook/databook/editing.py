"""Campos de apresentação: a edição muda a cópia do documento, nunca os RDOs."""
import html
import hashlib
import re
from difflib import SequenceMatcher
from html.parser import HTMLParser

from reportlab.graphics.shapes import Drawing, String
from reportlab.pdfbase import pdfmetrics
from reportlab.platypus import Paragraph

EDIT_URL = "https://databook.invalid/editar/"


class _PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag == "br":
            self.parts.append("\n")

    def handle_data(self, data):
        self.parts.append(data)


def plain_text(markup):
    parser = _PlainText()
    parser.feed(str(markup))
    return "".join(parser.parts).replace("\xa0", " ")


class _StyledText(HTMLParser):
    """Associa cada caractere às tags confiáveis do modelo do documento."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tags = []
        self.characters = []

    def handle_starttag(self, tag, attrs):
        if tag == "br":
            self.handle_data("\n")
        else:
            self.tags.append((tag, self.get_starttag_text()))

    def handle_endtag(self, tag):
        if self.tags and self.tags[-1][0] == tag:
            self.tags.pop()

    def handle_data(self, data):
        self.characters.extend((char, tuple(self.tags)) for char in data)


def replace_styled_text(markup, value):
    """Troca texto literal, conservando os estilos dos trechos do modelo.

    Inserções herdam o trecho anterior; substituições, o trecho substituído.
    Só tags do modelo são reutilizadas, nunca marcação enviada na edição.
    """
    parser = _StyledText()
    parser.feed(markup)
    source = parser.characters
    original = "".join(char for char, _ in source).replace("\xa0", " ")
    if original == value:
        return markup
    edited = []
    for operation, start, end, new_start, new_end in SequenceMatcher(None, original, value, autojunk=False).get_opcodes():
        if operation == "equal":
            edited.extend(source[start:end])
        elif operation != "delete":
            index = start - 1 if operation == "insert" and start else start
            if start < len(source) and source[index][0].isspace() and not source[start][0].isspace():
                index = start
            tags = source[min(index, len(source) - 1)][1] if source else ()
            edited.extend((char, tags) for char in value[new_start:new_end])
    parts, active = [], ()
    for char, tags in edited:
        common = 0
        while common < min(len(active), len(tags)) and active[common] == tags[common]:
            common += 1
        parts.extend(f"</{tag}>" for tag, _ in reversed(active[common:]))
        parts.extend(markup for _, markup in tags[common:])
        parts.append("<br/>" if char == "\n" else html.escape(char))
        active = tags
    parts.extend(f"</{tag}>" for tag, _ in reversed(active))
    return "".join(parts)


class EditableDrawing(Drawing):
    def draw(self):
        super().draw()
        for key, rect in getattr(self, "_edit_links", []):
            self.canv.linkURL(EDIT_URL + key, rect, relative=1, thickness=0)


class _EmptyField(Paragraph):
    """Uma célula vazia continua clicável sem alterar a altura/texto do PDF."""
    def __init__(self, style, key):
        super().__init__("", style)
        self.field_key = key

    def draw(self):
        super().draw()
        self.canv.linkURL(EDIT_URL + self.field_key, (0, -3, max(8, min(self.width, 60)), 3), relative=1, thickness=0)


def appearance(font, size, leading=None, alignment=0, color=None):
    return dict(tamanho=size, entrelinha=leading or size * 1.2, alinhamento=alignment,
                negrito=font in ("HB", "BB") or "bold" in font.lower(),
                italico=font == "BI" or any(word in font.lower() for word in ("italic", "oblique")),
                cor=color.hexval().replace("0x", "#") if color is not None else "#000000")


class DocumentFields:
    """IDs por seção e origem lógica, independentes da paginação.

    Cada passe reconstrói o catálogo; uma quebra de linha/página não muda IDs.
    Valores recebidos são texto literal, sem interpretar marcação do usuário.
    """
    def __init__(self, dados):
        self.preview = bool(dados.get("previa_editavel"))
        self.overrides = dados.get("campos_documento") or {}
        self.reset()

    def reset(self):
        self.items = {}
        self.counts = {}
        self.section("capa", "Capa")

    def section(self, key, title):
        self.context, self.title = key, title

    def key(self, kind, identity=None):
        if identity is not None:
            kind += "." + hashlib.sha256(str(identity).encode("utf-8")).hexdigest()[:12]
        base = f"documento.{self.context}.{kind}"
        index = self.counts.get(base, 0)
        self.counts[base] = index + 1
        return f"{base}.{index}"

    def value(self, key, original, label=None, multiline=True, section=None):
        original = str(original)
        value = self.overrides.get(key, original)
        if not isinstance(value, str):
            value = original
        self.items[key] = dict(id=key, rotulo=label or original[:100] or "Campo vazio",
                               secao=section or self.title, original=original, valor=value,
                               multilinha=multiline)
        return value

    def paragraph(self, text, style, key=None, label=None, multiline=True):
        key = key or self.key("texto." + re.sub(r"[^\w.-]", "_", style.name, flags=re.ASCII), text)
        original = plain_text(text)
        value = self.value(key, original, label, multiline=multiline)
        template = None
        if key in self.overrides:
            template = Paragraph(text, style)
            text = replace_styled_text(text, value)
        if self.preview and text:
            text = f'<link href="{EDIT_URL}{key}">{text}</link>'
        if self.preview and not text:
            paragraph = _EmptyField(style, key)
        else:
            paragraph = Paragraph(text, style)
        # Tags internas também podem definir a fonte/cor (ex.: status do laudo).
        # A aparência do editor vem do modelo, independente do tamanho da edição.
        fragment = max((template or paragraph).frags, key=lambda f: len(getattr(f, "text", "").strip()), default=None)
        self.items[key]["aparencia"] = appearance(
            fragment.fontName if fragment else style.fontName, fragment.fontSize if fragment else style.fontSize,
            style.leading, style.alignment, fragment.textColor if fragment else style.textColor)
        return paragraph

    def canvas_text(self, c, key, x, y, text, label=None, right=False, section=None):
        value = self.value(key, text, label, multiline=False, section=section).replace("\n", " ")
        font, size = c._fontname, c._fontsize
        original_size = size
        width = pdfmetrics.stringWidth(value, font, size)
        available = x - 18 * 72 / 25.4 if right else c._pagesize[0] - 18 * 72 / 25.4 - x
        # Cabeçalhos/capa têm altura fixa; textos maiores cabem reduzindo a fonte.
        if key in self.overrides and width > available > 0:
            size *= available / width
            c.setFont(font, size)
            width = available
        (c.drawRightString if right else c.drawString)(x, y, value)
        self.items[key]["aparencia"] = appearance(font, size, alignment=2 if right else 0, color=c._fillColorObj)
        if self.preview:
            left = x - width if right else x
            c.linkURL(EDIT_URL + key, (left, y - size * .25, left + max(width, 18), y + size), relative=1, thickness=0)
        # Não deixa a redução de fonte de um campo afetar o seguinte.
        c.setFont(font, original_size)

    def chart_text(self, drawing, key, x, y, text, label=None, **style):
        value = self.value(key, text, label, multiline=False).replace("\n", " ")
        drawing.add(String(x, y, value, **style))
        size = style.get("fontSize", 10)
        self.items[key]["aparencia"] = appearance(style.get("fontName", "Helvetica"), size,
                                                alignment={"middle": 1, "end": 2}.get(style.get("textAnchor"), 0),
                                                color=style.get("fillColor"))
        if self.preview:
            width = pdfmetrics.stringWidth(value, style.get("fontName", "Helvetica"), size)
            anchor = style.get("textAnchor", "start")
            left = x - (width if anchor == "end" else width / 2 if anchor == "middle" else 0)
            if not hasattr(drawing, "_edit_links"):
                drawing._edit_links = []
            drawing._edit_links.append((key, (left, y - size * .25, left + max(width, 18), y + size)))
