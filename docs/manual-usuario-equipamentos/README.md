# Manual do usuário — Módulo Equipamentos

O manual exibido no sistema (botão **Manual** no módulo, rota `/equipamentos/manual`) é gerado a partir daqui.

- `content.py`: todo o texto (blocos H1/H2/P/UL/OL/FIG/NOTE/TABLE). Para mudar o manual, edite este arquivo.
- `build.py`: gera o fragmento HTML + CSS usados pela página do app.
- Capturas de tela (com as marcações numeradas já desenhadas): `frontend/src/assets/manual-equipamentos/` (nome = argumento de `FIG(...)`; `logo.png` é a logo).

## Atualizar o manual no app

```bash
cd docs/manual-usuario-equipamentos
python3 build.py app ../../frontend/src/pages/equipamentos/manual
```

Isso reescreve `manual.html` e `manual.css`. Novas imagens vão em `frontend/src/assets/manual-equipamentos/` (jpg). O teste `frontend/test/equipment-manual-page.test.mjs` garante que toda imagem citada existe.

## Versão em PDF (opcional)

`python3 build.py` gera `print.html` (A4, com índice e numeração calculados por script). Para isso, copie as imagens para `./img/` e coloque `image1.png`/`image2.png` (mídia do `Modelos/definitivos/Datasheet.docx`) e `LOGO_BRANCA.png` (`backend/assets/Logo/`) ao lado do `print.html`; abra no Chrome e use `page.pdf({ width: '210mm', height: '297mm', printBackground: true, preferCSSPageSize: true })`.
