"""Author the XLSX design with openpyxl; Python is only needed to rebuild this asset.

Run: python backend/scripts/generate-functioning-checklist-styles.py
Requires: openpyxl. The API consumes the generated OOXML, without a Python runtime.
Colors come from docs/filtrovali-ds/01-design-tokens.md.
"""

from pathlib import Path
from tempfile import TemporaryDirectory
from xml.dom.minidom import parseString
from zipfile import ZipFile

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, NamedStyle, PatternFill, Side

ROOT = Path(__file__).resolve().parents[1]
BRAND = "30503A"
INK = "16211B"
MUTED = "596273"
LINE = "B8C5BC"
WHITE = "FFFFFF"
SOFT = "E6EFE9"
WASH = "F2F7F4"

thin = Side(style="thin", color=LINE)
week = Side(style="medium", color="9AA7A0")
grid = Border(left=thin, right=thin, top=thin, bottom=thin)
underline = Border(bottom=thin)

# Stable order: the API uses these names, including matching weekday separators.
STYLES = [
    ("blank", {}),
    ("title", {"size": 16, "bold": True, "color": BRAND}),
    ("subtitle", {"size": 8, "color": MUTED}),
    ("rule", {"fill": BRAND}),
    ("code", {"size": 15, "bold": True, "color": BRAND, "fill": SOFT, "align": "center"}),
    ("equipment", {"size": 11, "bold": True}),
    ("category", {"size": 8, "color": MUTED}),
    ("fieldLabel", {"size": 7, "bold": True, "color": MUTED}),
    ("fieldValue", {"size": 10, "border": underline}),
    ("section", {"size": 9, "bold": True, "color": WHITE, "fill": BRAND}),
    ("sectionSoft", {"size": 8, "bold": True, "color": BRAND, "fill": SOFT}),
    ("itemNumber", {"size": 8, "bold": True, "color": BRAND, "fill": SOFT, "align": "center", "border": grid}),
    ("item", {"size": 9, "border": grid}),
    ("itemAlternate", {"size": 9, "fill": WASH, "border": grid}),
    ("day", {"size": 9, "align": "center", "border": grid}),
    ("dayGroupEnd", {"size": 9, "align": "center", "border": Border(left=thin, right=week, top=thin, bottom=thin)}),
    ("dayHeader", {"size": 8, "bold": True, "color": WHITE, "fill": BRAND, "align": "center", "border": grid}),
    ("dayHeaderGroupEnd", {"size": 8, "bold": True, "color": WHITE, "fill": BRAND, "align": "center", "border": Border(left=thin, right=week, top=thin, bottom=thin)}),
    ("legendOk", {"size": 8, "bold": True, "color": "1F7A3D", "fill": "E6F4EA"}),
    ("legendRestriction", {"size": 8, "color": "B45309", "fill": "FFF7E6"}),
    ("legendStopped", {"size": 8, "color": "C81519", "fill": "FDECEC"}),
    ("writing", {"size": 8, "color": MUTED, "vertical": "top", "border": underline}),
    ("responsible", {"size": 8, "bold": True, "color": BRAND, "fill": WASH, "border": grid}),
    ("photo", {"size": 8, "color": MUTED, "vertical": "top", "border": grid}),
    ("caption", {"size": 7, "color": MUTED}),
]

workbook = Workbook()
sheet = workbook.active
sheet.title = "Catálogo de estilos"
for index, (name, options) in enumerate(STYLES, start=1):
    style = NamedStyle(name=name)
    style.font = Font(name="Arial", size=options.get("size", 9), bold=options.get("bold", False), color=options.get("color", INK))
    style.fill = PatternFill("solid", fgColor=options.get("fill", WHITE))
    style.border = options.get("border", Border())
    style.alignment = Alignment(horizontal=options.get("align", "left"), vertical=options.get("vertical", "center"), wrap_text=True, indent=0 if options.get("align") == "center" else 1)
    workbook.add_named_style(style)
    sheet.cell(index, 1, name).style = name
    assert sheet.cell(index, 1).style_id == index

destination = ROOT / "assets" / "Equipamentos" / "checklist-styles.xml"
destination.parent.mkdir(parents=True, exist_ok=True)
with TemporaryDirectory() as directory:
    path = Path(directory) / "styles.xlsx"
    workbook.save(path)
    with ZipFile(path) as archive:
        stylesheet = parseString(archive.read("xl/styles.xml"))
        destination.write_text(stylesheet.toprettyxml(indent="  "), encoding="utf-8")
print(destination)
