"""Gera os arquivos fictícios usados por projeto_completo.json (sem nenhum dado real).

- certificados/*.pdf: certificados de calibração de exemplo (Anexo C);
- fotos_ficticias/*.jpg: "fotos" sintéticas (formas e texto), em paisagem e retrato;
- fds_ficticias/*.pdf: FDS de exemplo (Anexo B), sem conteúdo de fornecedor.

Uso (a partir de backend/databook/exemplo):  python gerar_fixtures.py
"""
import os
import random

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

BASE = os.path.dirname(os.path.abspath(__file__))

CERTS = [
    ("certificados/CERT_MAN-012.pdf", "Manômetro MAN-012", "CAL-2026-0412", "0 a 400 bar", "12/03/2026", "12/03/2027", 2),
    ("certificados/CERT_MAN-015.pdf", "Manômetro MAN-015", "CAL-2025-1187", "0 a 400 bar", "04/10/2025", "04/10/2026", 1),
    ("certificados/CERT_CP-03.pdf", "Contador de partículas CP-03", "LAB-2026-0077", "Série PC-88231", "20/01/2026", "20/01/2027", 2),
]

FDS = [
    ("fds_ficticias/FDS_ACIDO_CITRICO.pdf", "Ácido Cítrico Fino Granulado", "Ácido cítrico", 3),
    ("fds_ficticias/FDS_BARRILHA.pdf", "Barrilha (leve / densa)", "Carbonato de sódio", 2),
    ("fds_ficticias/FDS_NITRITO_DE_SODIO.pdf", "Nitrito de Sódio", "Nitrito de sódio", 3),
]
SECOES_FDS = ["1. Identificação", "2. Identificação de perigos", "3. Composição", "4. Primeiros socorros",
              "5. Combate a incêndio", "6. Vazamento", "7. Manuseio e armazenamento", "8. Controle de exposição"]

N_FOTOS = 21
# tons de fundo variados para que nenhuma foto seja tratada como duplicada pelo gerador
PALETA = [(52, 73, 94), (88, 110, 80), (120, 96, 72), (70, 90, 120), (110, 80, 100), (60, 100, 100), (130, 110, 60)]


def certificados():
    for arquivo, inst, cert, faixa, cal, val, paginas in CERTS:
        caminho = os.path.join(BASE, arquivo)
        os.makedirs(os.path.dirname(caminho), exist_ok=True)
        c = canvas.Canvas(caminho, pagesize=A4, invariant=1)
        c.setTitle(f"Certificado {cert} (fictício)")
        w, h = A4
        for p in range(1, paginas + 1):
            c.setFont("Helvetica-Bold", 16)
            c.drawString(25 * mm, h - 35 * mm, "CERTIFICADO DE CALIBRAÇÃO")
            c.setFont("Helvetica", 9)
            c.drawString(25 * mm, h - 42 * mm, "DOCUMENTO FICTÍCIO – fixture de teste do gerador de Data Book")
            linhas = [("Certificado nº", cert), ("Instrumento", inst), ("Faixa / identificação", faixa),
                      ("Data da calibração", cal), ("Validade", val), ("Página", f"{p} de {paginas}")]
            y = h - 60 * mm
            for rot, val_ in linhas:
                c.setFont("Helvetica-Bold", 10)
                c.drawString(25 * mm, y, rot)
                c.setFont("Helvetica", 10)
                c.drawString(75 * mm, y, val_)
                y -= 8 * mm
            c.rect(25 * mm, 60 * mm, w - 50 * mm, y - 70 * mm)
            c.setFont("Helvetica-Oblique", 9)
            c.drawCentredString(w / 2, (y + 60 * mm) / 2, "Tabela de resultados da calibração (conteúdo ilustrativo)")
            c.showPage()
        c.save()


def fds():
    for arquivo, nome, quimico, paginas in FDS:
        caminho = os.path.join(BASE, arquivo)
        os.makedirs(os.path.dirname(caminho), exist_ok=True)
        c = canvas.Canvas(caminho, pagesize=A4, invariant=1)
        c.setTitle(f"FDS {nome} (fictícia)")
        w, h = A4
        por_pagina = -(-len(SECOES_FDS) // paginas)
        for p in range(paginas):
            c.setFont("Helvetica-Bold", 15)
            c.drawString(25 * mm, h - 30 * mm, "FICHA COM DADOS DE SEGURANÇA")
            c.setFont("Helvetica", 9)
            c.drawString(25 * mm, h - 37 * mm, f"{nome} ({quimico}) – DOCUMENTO FICTÍCIO, fixture de teste do Data Book")
            y = h - 52 * mm
            for secao in SECOES_FDS[p * por_pagina:(p + 1) * por_pagina]:
                c.setFont("Helvetica-Bold", 11)
                c.drawString(25 * mm, y, secao)
                c.setFont("Helvetica", 9)
                for linha in ("Conteúdo ilustrativo; consulte a FDS oficial do fornecedor.", "Sem valor técnico ou legal."):
                    y -= 6 * mm
                    c.drawString(30 * mm, y, linha)
                y -= 12 * mm
            c.setFont("Helvetica", 8)
            c.drawRightString(w - 25 * mm, 15 * mm, f"Página {p + 1} de {paginas}")
            c.showPage()
        c.save()


def _fonte(tamanho):
    for nome in ("Carlito-Bold.ttf", "Poppins-Bold.ttf"):
        caminho = os.path.join(BASE, "..", "assets", "fonts", nome)
        if os.path.exists(caminho):
            return ImageFont.truetype(caminho, tamanho)
    return ImageFont.load_default()


def fotos():
    pasta = os.path.join(BASE, "fotos_ficticias")
    os.makedirs(pasta, exist_ok=True)
    for i in range(1, N_FOTOS + 1):
        rnd = random.Random(i)
        w, h = (1600, 1200) if i % 4 else (1200, 1600)
        r0, g0, b0 = PALETA[i % len(PALETA)]
        im = Image.new("RGB", (w, h))
        dr = ImageDraw.Draw(im)
        for y in range(h):                       # degradê vertical
            k = y / h
            dr.line([(0, y), (w, y)], fill=(int(r0 + 60 * k), int(g0 + 50 * k), int(b0 + 40 * k)))
        for _ in range(3 + i % 3):               # "tubulações"
            y = rnd.randint(int(h * 0.15), int(h * 0.85))
            esp = rnd.randint(60, 140)
            dr.rectangle([0, y, w, y + esp], fill=(150 + rnd.randint(0, 60),) * 3)
            dr.rectangle([0, y + esp // 5, w, y + esp // 3], fill=(225, 225, 225))
            for x in range(rnd.randint(80, 300), w, rnd.randint(300, 600)):   # flanges
                dr.rectangle([x, y - 25, x + 40, y + esp + 25], fill=(90, 90, 95))
        cx, cy = rnd.randint(250, w - 250), rnd.randint(250, h - 250)        # "manômetro"
        dr.ellipse([cx - 150, cy - 150, cx + 150, cy + 150], fill=(245, 245, 240), outline=(40, 40, 40), width=14)
        dr.line([cx, cy, cx + rnd.randint(-110, 110), cy - 100], fill=(200, 20, 25), width=10)
        dr.rectangle([0, h - 150, w, h], fill=(20, 30, 25))
        dr.text((40, h - 125), f"FOTO ILUSTRATIVA {i:02d}", font=_fonte(64), fill=(255, 255, 255))
        dr.text((40, h - 50), "fixture fictícia – sem relação com projeto real", font=_fonte(32), fill=(185, 201, 190))
        im.save(os.path.join(pasta, f"ficticia_{i:02d}.jpg"), quality=80, optimize=True)


if __name__ == "__main__":
    certificados()
    fds()
    fotos()
