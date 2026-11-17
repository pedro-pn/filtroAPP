# -*- coding: utf-8 -*-
import html, re, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from content import BLOCKS

VERSION = 'Versão 1.0 · Novembro de 2026'
TITLE = 'Manual do Usuário — Módulo Equipamentos'

def slug(n): return f's{n}'

def number_blocks():
    """Atribui numeração (1, 1.1…) e ids aos títulos."""
    out, h1, h2 = [], 0, 0
    for b in BLOCKS:
        if b[0] == 'h1':
            h1 += 1; h2 = 0
            title = b[1]
            numbered = title if title.startswith('Apêndice') else f'{h1}. {title}'
            out.append(('h1', numbered, f'h{h1}'))
        elif b[0] == 'h2':
            h2 += 1
            out.append(('h2', f'{h1}.{h2} {b[1]}' if not BLOCKS_APPENDIX(out) else b[1], f'h{h1}_{h2}'))
        else:
            out.append(b)
    return out

def BLOCKS_APPENDIX(out):
    for b in reversed(out):
        if b[0] == 'h1': return b[1].startswith('Apêndice')
    return False

def render_legend(items):
    if not items: return ''
    li = ''.join(f'<li><span class="n">{i}</span><span>{t}</span></li>' for i, t in enumerate(items, 1))
    return f'<ol class="leg">{li}</ol>'

def render_block(b, web=False):
    k = b[0]
    if k == 'h1':
        return f'<h1 id="{b[2]}" data-toc="1" class="pb kwn">{b[1]}</h1>'
    if k == 'h2':
        return f'<h2 id="{b[2]}" data-toc="2" class="kwn">{b[1]}</h2>'
    if k == 'p': return f'<p class="blk">{b[1]}</p>'
    if k == 'ul': return '<ul class="blk">' + ''.join(f'<li>{x}</li>' for x in b[1]) + '</ul>'
    if k == 'ol': return '<ol class="blk steps">' + ''.join(f'<li>{x}</li>' for x in b[1]) + '</ol>'
    if k == 'note':
        label = {'dica': 'Dica', 'atencao': 'Atenção', 'importante': 'Importante'}[b[1]]
        return f'<div class="blk note {b[1]}"><b class="nl">{label}</b><div>{b[2]}</div></div>'
    if k == 'table':
        head = ''.join(f'<th>{h}</th>' for h in b[1])
        rows = ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in b[2])
        widths = b[3]
        cg = '<colgroup>' + ''.join(f'<col style="width:{w}%">' for w in widths) + '</colgroup>' if widths else ''
        return f'<table class="blk tbl">{cg}<thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table>'
    if k == 'fig':
        _, img, cap, legend, layout = b
        im = f'<img src="img/{img}.jpg" alt="{html.escape(re.sub("<[^>]+>", "", cap))}">'
        leg = render_legend(legend)
        capt = f'<figcaption>{cap}</figcaption>'
        if layout == 'side' and legend:
            return f'<figure class="blk fig side"><div class="fx"><div class="im">{im}</div>{leg}</div>{capt}</figure>'
        if layout == 'tall':
            return f'<figure class="blk fig tall"><div class="im">{im}</div>{capt}</figure>'
        return f'<figure class="blk fig wide"><div class="im">{im}</div>{leg}{capt}</figure>'
    raise ValueError(k)

BASE_CSS = '''
:root{--g:#30503A;--g2:#3d6449;--b:#11437E;--r:#C8161B;--l:#9C94A9;--s:#E8E8E8;--ink:#1c2420;--mut:#5d6a62;--line:#cfd6d1;--bg:#fff;--soft:#f3f6f4}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Ubuntu','Segoe UI',Calibri,Arial,sans-serif;color:var(--ink);background:var(--bg);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.n{display:inline-flex;align-items:center;justify-content:center;min-width:5.2mm;height:5.2mm;padding:0 1mm;border-radius:50%;background:#E5392B;color:#fff;font:700 8pt/1 Arial;margin:0 .6mm;vertical-align:1px;flex:none}
b{font-weight:700}kbd{font:600 .85em Consolas,monospace;background:var(--s);border:1px solid var(--line);border-bottom-width:2px;border-radius:3px;padding:0 4px}
.badge{display:inline-block;border-radius:4px;padding:1px 7px;font-size:8.5pt;font-weight:600}
.badge.ok{background:#e3f3e8;color:#1a6b3c}.badge.warn{background:#fdf0d3;color:#8a5a00}.badge.bad{background:#fbe0e0;color:#a31a1a}
h1{color:var(--g)}h2{color:var(--g)}
.blk p,p.blk{line-height:1.5}
ul.blk,ol.blk{padding-left:6mm;line-height:1.45}ul.blk li,ol.blk li{margin:1.1mm 0}
ol.steps{list-style:none;counter-reset:st;padding-left:0}
ol.steps li{counter-increment:st;position:relative;padding-left:9mm;margin:1.6mm 0}
ol.steps li:before{content:counter(st);position:absolute;left:0;top:0;width:6.2mm;height:6.2mm;border-radius:50%;background:var(--g);color:#fff;font:700 8.5pt/6.2mm Arial;text-align:center}
.note{display:flex;gap:3mm;border-left:1.6mm solid var(--g);background:var(--soft);border-radius:0 2mm 2mm 0;padding:2.4mm 3.4mm;line-height:1.45}
.note .nl{flex:none;text-transform:uppercase;letter-spacing:.08em;font-size:7.5pt;color:var(--g);padding-top:.6mm;min-width:17mm}
.note.atencao{border-color:#d68a00;background:#fff6e0}.note.atencao .nl{color:#8a5a00}
.note.importante{border-color:var(--b);background:#eaf1fa}.note.importante .nl{color:var(--b)}
table.tbl{width:100%;border-collapse:collapse;font-size:9.4pt;line-height:1.35}
.tbl th{background:var(--g);color:#fff;text-align:left;padding:1.6mm 2.2mm;font-weight:600}
.tbl td{padding:1.5mm 2.2mm;border-bottom:1px solid var(--line);vertical-align:top}
.tbl tr:nth-child(even) td{background:#f7f9f8}
figure.fig{margin:0}
figure.fig .im img{display:block;width:100%;border:1px solid var(--line);border-radius:2mm}
figure.fig figcaption{font-size:8.6pt;color:var(--mut);margin-top:1.6mm;font-style:italic}
ol.leg{list-style:none;font-size:8.8pt;line-height:1.35;columns:2;column-gap:5mm}
ol.leg li{display:flex;gap:2mm;align-items:flex-start;margin:0 0 1.4mm;break-inside:avoid}
.fig.side .fx{display:flex;gap:4mm;align-items:flex-start}.fig.side .im{flex:0 0 60%}.fig.side ol.leg{columns:1;flex:1}
.fig.wide ol.leg{margin-top:2.2mm}
.fig.tall .im{width:62mm;margin:0 auto}
'''

PRINT_CSS = BASE_CSS + '''
@page{size:A4;margin:0}
html,body{width:210mm}
.page{width:210mm;height:297mm;position:relative;overflow:hidden;page-break-after:always;break-after:page;background:#fff}
.wm{position:absolute;inset:0;background:url(image1.png) center/100% 100% no-repeat;opacity:.045;z-index:0}
.hdr{position:absolute;top:0;left:0;right:0;height:13mm;background:var(--g);display:flex;align-items:center;justify-content:space-between;padding:0 17mm;z-index:2}
.hdr img{height:7mm}.hdr span{color:#fff;font-size:7.6pt;letter-spacing:.14em;text-transform:uppercase}
.hdr:after{content:"";position:absolute;left:0;right:0;bottom:-1.2mm;height:1.2mm;background:linear-gradient(90deg,var(--b) 0 33%,var(--r) 33% 66%,var(--l) 66%)}
.ftr{position:absolute;left:17mm;right:17mm;bottom:8mm;display:flex;justify-content:space-between;font-size:8pt;color:var(--mut);border-top:.4mm solid var(--g);padding-top:1.8mm;z-index:2}
.ftr b{color:var(--g)}
.body{position:absolute;top:21mm;left:17mm;right:17mm;bottom:17mm;overflow:hidden;z-index:1;font-size:10.2pt}
.body>*{margin-bottom:3.4mm}
.body h1{font-size:19pt;line-height:1.15;padding:4mm 0 3mm;margin:0 0 4mm;border-bottom:.7mm solid var(--g);position:relative}
.body h1:after{content:"";position:absolute;left:0;bottom:-.7mm;width:26mm;height:.7mm;background:var(--r)}
.body h2{font-size:13pt;margin:5mm 0 2.4mm}
.cover{background:#fff}
.cover .wave{position:absolute;top:0;left:0;width:210mm;height:70mm}
.cover .ctitle{position:absolute;top:92mm;left:20mm;right:20mm}
.cover .eyebrow{font-size:10pt;letter-spacing:.24em;color:var(--r);font-weight:700;text-transform:uppercase}
.cover h1{font-size:34pt;line-height:1.05;margin-top:4mm;border:0;padding:0}
.cover .sub{font-size:14pt;color:var(--mut);margin-top:5mm;line-height:1.35}
.cover .meta{position:absolute;bottom:34mm;left:20mm;right:20mm;display:flex;justify-content:space-between;align-items:flex-end;border-top:.6mm solid var(--g);padding-top:4mm;font-size:10pt;color:var(--mut)}
.cover .meta b{color:var(--g)}
.cover .band{position:absolute;bottom:0;left:0;right:0;height:14mm;background:var(--g)}
.cover .band:before{content:"";position:absolute;left:0;right:0;top:-1.4mm;height:1.4mm;background:linear-gradient(90deg,var(--b) 0 33%,var(--r) 33% 66%,var(--l) 66%)}
.cover .band img{position:absolute;right:20mm;top:3.2mm;height:7.5mm}
.cover .wm{opacity:.08}
.toc-title{font-size:19pt;color:var(--g);font-weight:700;padding:4mm 0 3mm;border-bottom:.7mm solid var(--g);margin-bottom:5mm}
.tocline{display:flex;align-items:baseline;gap:2mm;font-size:10.2pt}
.tocline.l1{font-weight:700;color:var(--g);margin-top:3mm;font-size:10.8pt}
.tocline.l2{padding-left:7mm;color:var(--ink)}
.tocline .dots{flex:1;border-bottom:1px dotted #9aa59e;transform:translateY(-1px)}
.tocline .pg{min-width:8mm;text-align:right;font-variant-numeric:tabular-nums}
'''

PAGINATE_JS = r'''
(async function(){
  const src=document.getElementById('src'); const doc=document.getElementById('doc');
  const blocks=[...src.children]; src.remove();
  await Promise.all([...document.images].map(i=>i.decode ? i.decode().catch(()=>{}) : Promise.resolve()));
  const TITLE=document.body.dataset.title; const VERSION=document.body.dataset.version;
  function newPage(){
    const p=document.createElement('section'); p.className='page';
    p.innerHTML='<div class="wm"></div><header class="hdr"><img src="LOGO_BRANCA.png" alt="Filtrovali"><span>'+TITLE+'</span></header><div class="body"></div><footer class="ftr"><span><b>Filtrovali</b> · '+VERSION+'</span><span class="pn"></span></footer>';
    doc.appendChild(p); return p;
  }
  let cur=newPage(), body=cur.querySelector('.body');
  const fits=()=>body.scrollHeight<=body.clientHeight+1;
  const isFig=el=>el.tagName==='FIGURE';
  const isFlow=el=>/^(P|UL|OL|TABLE)$/.test(el.tagName)||el.classList.contains('note')||el.classList.contains('tocline');
  const queue=[...blocks];
  while(queue.length){
    const b=queue.shift();
    if(b.classList.contains('pb') && body.children.length){ cur=newPage(); body=cur.querySelector('.body'); }
    body.appendChild(b);
    if(fits()) continue;
    // 1) figura: tenta reduzir (zoom) até 0,78 para caber na página atual
    if(isFig(b)){
      let z=1;
      while(!fits() && z>0.78){ z=Math.round((z-0.04)*100)/100; b.style.zoom=z; }
      if(fits()) continue;
      b.style.zoom='';
    }
    // 2) não coube: recua (com títulos "kwn" que precisam acompanhar o bloco)
    const carry=[b]; body.removeChild(b);
    while(body.lastElementChild && body.lastElementChild.classList.contains('kwn') && body.children.length>1){ carry.unshift(body.lastElementChild); body.removeChild(body.lastElementChild); }
    // 3) aproveita o espaço restante com os blocos de texto seguintes (até o próximo título/figura)
    if(isFig(b)){
      let i=0;
      while(i<queue.length){
        const c=queue[i];
        if(!isFlow(c)) break;
        body.appendChild(c);
        if(fits()){ queue.splice(i,1); } else { body.removeChild(c); break; }
      }
    }
    cur=newPage(); body=cur.querySelector('.body'); carry.forEach(x=>body.appendChild(x));
  }
  const pages=[...doc.querySelectorAll('.page:not(.cover)')];
  const total=pages.length+1; // + capa
  pages.forEach((p,i)=>{ p.querySelector('.pn').textContent='Página '+(i+2)+' de '+total; });
  // índice
  document.querySelectorAll('[data-for]').forEach(el=>{
    const t=document.getElementById(el.dataset.for); const pg=t.closest('.page'); el.textContent=pages.indexOf(pg)+2;
  });
  document.body.dataset.ready='1'; document.title=TITLE+' ('+total+' páginas)';
})();
'''

def build_print():
    nb = number_blocks()
    # TOC
    toc = ['<div class="blk toc-title kwn">Índice</div>']
    for b in nb:
        if b[0] == 'h1':
            toc.append(f'<div class="blk tocline l1"><span>{b[1]}</span><span class="dots"></span><span class="pg" data-for="{b[2]}"></span></div>')
        elif b[0] == 'h2':
            toc.append(f'<div class="blk tocline l2"><span>{b[1]}</span><span class="dots"></span><span class="pg" data-for="{b[2]}"></span></div>')
    # a primeira linha do índice não deve ser seguida de quebra
    blocks_html = ''.join(toc)
    # o 1º H1 do conteúdo começa nova página (pb), e o índice termina antes
    content = ''.join(render_block(b) for b in nb)
    cover = f'''<section class="page cover"><div class="wm"></div><img class="wave" src="image2.png" alt="">
<div class="ctitle"><div class="eyebrow">Manual do usuário</div><h1>Módulo<br>Equipamentos</h1>
<div class="sub">Cadastro de categorias e equipamentos, calibração, anexos, dados técnicos, manual de operação, checklist, QR code, manutenção e notificações.</div></div>
<div class="meta"><span><b>Filtrovali</b> · Sistema Integrado de Operação</span><span>{VERSION}</span></div>
<div class="band"><img src="LOGO_BRANCA.png" alt="Filtrovali"></div></section>'''
    return f'''<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>{TITLE}</title><style>{PRINT_CSS}</style></head>
<body data-title="{TITLE}" data-version="{VERSION}">
<div id="doc">{cover}</div>
<div id="src">{blocks_html}{content}</div>
<script>{PAGINATE_JS}</script></body></html>'''

if __name__ == '__main__' and len(sys.argv) == 1:
    out = os.path.dirname(os.path.abspath(__file__))
    open(os.path.join(out, 'print.html'), 'w', encoding='utf-8').write(build_print())
    print('print.html ok')


WEB_CSS = '''
:root{--bg:#f6f8f6;--surface:#fff;--soft:#eef3ef;--fg:#1c2420;--mut:#5d6a62;--line:#d5ddd8;--g:#30503A;--g-ink:#fff;--accent:#C8161B;--blue:#11437E;--note-bg:#eef3ef;--warn-bg:#fff4dc;--warn:#8a5a00;--imp-bg:#e8f0fa;--imp:#11437E;--shadow:0 1px 2px rgba(20,40,30,.08)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121916;--surface:#19221e;--soft:#202b26;--fg:#e6ece8;--mut:#9fb0a6;--line:#2f3d36;--g:#7fb28f;--g-ink:#0f1a14;--accent:#ff7b7f;--blue:#8db8f0;--note-bg:#202b26;--warn-bg:#33290f;--warn:#f0c264;--imp-bg:#16263a;--imp:#8db8f0;--shadow:none;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#121916;--surface:#19221e;--soft:#202b26;--fg:#e6ece8;--mut:#9fb0a6;--line:#2f3d36;--g:#7fb28f;--g-ink:#0f1a14;--accent:#ff7b7f;--blue:#8db8f0;--note-bg:#202b26;--warn-bg:#33290f;--warn:#f0c264;--imp-bg:#16263a;--imp:#8db8f0;--shadow:none;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 'Ubuntu','Segoe UI',system-ui,sans-serif;}
.gutter{padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.sitebar{border-bottom:1px solid var(--line);background:var(--surface)}
.sitebar .in{max-width:1180px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:16px;padding-block:14px}
.logochip{display:inline-flex;align-items:center;background:#fff;border-radius:12px;padding:8px 16px;border:1px solid var(--line)}
.logochip img{display:block;height:46px;width:auto}
.sitebar .tag{text-align:right;line-height:1.3}
.sitebar .tag b{display:block;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
.sitebar .tag span{font-size:13px;color:var(--mut)}
.sitebar .tag a.back{display:block;margin-top:4px;font-size:13px;color:var(--g);text-decoration:none;font-weight:600}.sitebar .tag a.back:hover{text-decoration:underline}
@media (max-width:520px){.logochip img{height:36px}.sitebar .tag span{display:none}}
.titleblock{max-width:1180px;margin:0 auto;padding-block:30px 10px}
.wrap{max-width:1180px;margin:0 auto;display:grid;grid-template-columns:270px minmax(0,1fr);gap:40px;padding-block:8px 64px}
nav.toc{position:sticky;top:env(safe-area-inset-top,0px);align-self:start;max-height:100vh;overflow:auto;padding:20px 4px 24px 0;font-size:13.5px}
nav.toc .toclabel{font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--mut);font-weight:700;margin:4px 8px 6px}
nav.toc a{display:block;color:var(--fg);text-decoration:none;padding:3px 8px;border-radius:6px;line-height:1.35}
nav.toc a:hover{background:var(--soft)}
nav.toc a.l1{font-weight:700;color:var(--g);margin-top:10px}
nav.toc a.l2{padding-left:20px;color:var(--mut)}
nav.toc a.on{background:var(--soft);color:var(--g)}
nav.toc a:focus-visible,.pdf a:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
header.hero{padding:0 0 22px}
.eyebrow{font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent);font-weight:700}
header.hero h1{font-size:clamp(30px,5.4vw,46px);line-height:1.05;margin:8px 0 12px;color:var(--g);text-wrap:balance}
header.hero p{margin:0;color:var(--mut);max-width:62ch}
.pdf{margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.pdf a{display:inline-block;background:var(--g);color:var(--g-ink);padding:8px 16px;border-radius:8px;font-weight:600;text-decoration:none}
.pdf .ver{color:var(--mut);font-size:13px}
main section.chap{padding-top:10px}
h1.pb{font-size:26px;line-height:1.2;color:var(--g);margin:46px 0 14px;padding-bottom:10px;border-bottom:2px solid var(--g);text-wrap:balance;scroll-margin-top:16px}
h2{font-size:18px;color:var(--g);margin:28px 0 8px;scroll-margin-top:16px}
.blk{margin:12px 0}
p.blk{max-width:75ch}
ul.blk,ol.blk{padding-left:22px;max-width:78ch}
ul.blk li,ol.blk li{margin:5px 0}
ol.steps{list-style:none;counter-reset:st;padding-left:0}
ol.steps li{counter-increment:st;position:relative;padding-left:36px;margin:8px 0}
ol.steps li:before{content:counter(st);position:absolute;left:0;top:1px;width:24px;height:24px;border-radius:50%;background:var(--g);color:var(--g-ink);font:700 12px/24px Arial;text-align:center}
.n{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 5px;border-radius:50%;background:#E5392B;color:#fff;font:700 12px/1 Arial;margin:0 2px;vertical-align:1px;flex:none}
kbd{font:600 .88em Consolas,monospace;background:var(--soft);border:1px solid var(--line);border-bottom-width:2px;border-radius:4px;padding:0 5px}
.badge{display:inline-block;border-radius:5px;padding:1px 8px;font-size:12.5px;font-weight:600}
.badge.ok{background:#e3f3e8;color:#1a6b3c}.badge.warn{background:#fdf0d3;color:#8a5a00}.badge.bad{background:#fbe0e0;color:#a31a1a}
.note{display:flex;gap:14px;border-left:5px solid var(--g);background:var(--note-bg);border-radius:0 8px 8px 0;padding:11px 16px;max-width:80ch}
.note .nl{flex:none;text-transform:uppercase;letter-spacing:.08em;font-size:11px;color:var(--g);padding-top:3px;min-width:74px}
.note.atencao{border-color:#d68a00;background:var(--warn-bg)}.note.atencao .nl{color:var(--warn)}
.note.importante{border-color:var(--blue);background:var(--imp-bg)}.note.importante .nl{color:var(--imp)}
.tblwrap{overflow-x:auto;margin:14px 0;border:1px solid var(--line);border-radius:8px;background:var(--surface)}
table.tbl{width:100%;border-collapse:collapse;font-size:14px;line-height:1.45;min-width:520px}
.tbl th{background:var(--g);color:var(--g-ink);text-align:left;padding:8px 12px;font-weight:600}
.tbl td{padding:8px 12px;border-top:1px solid var(--line);vertical-align:top}
figure.fig{margin:22px 0;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px;box-shadow:var(--shadow)}
figure.fig .im img{display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:8px;background:#fff}
figure.fig figcaption{font-size:13px;color:var(--mut);margin-top:10px}
ol.leg{list-style:none;padding:0;margin:12px 0 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:6px 22px;font-size:13.5px;line-height:1.4}
ol.leg li{display:flex;gap:9px;align-items:flex-start}
.fig.side .fx{display:grid;grid-template-columns:minmax(0,58%) minmax(0,1fr);gap:20px;align-items:start}
.fig.side ol.leg{grid-template-columns:1fr;margin:0}
.fig.tall .im{max-width:340px;margin:0 auto}
@media (max-width:900px){.wrap{grid-template-columns:minmax(0,1fr);gap:0}nav.toc{position:static;max-height:none;border-bottom:1px solid var(--line);padding-bottom:12px}nav.toc .list{display:none}nav.toc.open .list{display:block}.tocbtn{display:inline-block}.fig.side .fx{grid-template-columns:1fr}}
.tocbtn{display:none;background:var(--soft);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:6px 12px;font:inherit;cursor:pointer;margin-bottom:6px}
.tools{display:flex;gap:8px;margin-top:10px}
.tools button{background:var(--soft);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:5px 12px;font:inherit;font-size:12.5px;cursor:pointer}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
'''

def build_web():
    nb = number_blocks()
    toc = []
    for b in nb:
        if b[0] == 'h1': toc.append(f'<a class="l1" href="#{b[2]}">{b[1]}</a>')
        elif b[0] == 'h2': toc.append(f'<a class="l2" href="#{b[2]}">{b[1]}</a>')
    body = ''
    for b in nb:
        h = render_block(b, web=True)
        h = h.replace(' class="pb kwn"', ' class="pb"').replace(' class="kwn"', '')
        if b[0] == 'table':
            h = h.replace('<table class="blk tbl">', '<div class="tblwrap"><table class="tbl">', 1).replace('</table>', '</table></div>', 1)
        body += h
    return f'''<title>Manual do Módulo Equipamentos</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Ubuntu:wght@400;500;700&display=swap">
<style>{WEB_CSS}</style>
<div class="sitebar gutter"><div class="in"><span class="logochip"><img src="LOGO_COLORIDO.png" alt="Filtrovali"></span><div class="tag"><b>Manual do usuário</b><span>Sistema Integrado de Operação</span></div></div></div>
<div class="gutter"><div class="titleblock"><header class="hero"><div class="eyebrow">Módulo</div><h1>Equipamentos</h1>
<p>Cadastro de categorias e equipamentos, calibração, anexos, dados técnicos, manual de operação, checklist, QR code, manutenção e notificações — com imagens reais das telas e a indicação de onde clicar.</p>
<div class="pdf"><a href="Manual-Modulo-Equipamentos.pdf" target="_blank" rel="noopener">Abrir versão em PDF</a><span class="ver">{VERSION}</span></div></header></div></div>
<div class="gutter"><div class="wrap">
<nav class="toc" aria-label="Índice do manual"><div class="toclabel">Índice</div>
<button class="tocbtn" id="tocbtn" type="button" aria-expanded="false" aria-controls="toclist">Mostrar índice</button>
<div class="list" id="toclist">{''.join(toc)}</div></nav>
<main>
{body}
</main></div></div>
<script>
(function(){{
  var btn=document.getElementById('tocbtn'), nav=document.querySelector('nav.toc');
  btn.addEventListener('click',function(){{var o=nav.classList.toggle('open');btn.setAttribute('aria-expanded',o?'true':'false');}});
  var links=[].slice.call(document.querySelectorAll('nav.toc .list a'));
  var map={{}};links.forEach(function(a){{map[a.getAttribute('href').slice(1)]=a;}});
  var heads=[].slice.call(document.querySelectorAll('h1[id],h2[id]'));
  function spy(){{var cur=null;heads.forEach(function(h){{if(h.getBoundingClientRect().top<140)cur=h;}});
    links.forEach(function(a){{a.classList.remove('on');}});if(cur&&map[cur.id])map[cur.id].classList.add('on');}}
  window.addEventListener('scroll',spy,{{passive:true}});spy();
}})();
</script>'''

if __name__ == '__main__' and len(sys.argv) > 1 and sys.argv[1] == 'web':
    out = os.path.dirname(os.path.abspath(__file__))
    open(os.path.join(out, 'web.html'), 'w', encoding='utf-8').write(build_web())
    print('web.html ok')


# ───────────── Versão embutida no app (fragmento HTML + CSS escopado) ─────────────

def _split_top(css):
    """Quebra um CSS simples em (seletor, corpo) de nível superior, respeitando chaves aninhadas."""
    rules, i, n = [], 0, len(css)
    while i < n:
        j = css.find('{', i)
        if j < 0: break
        sel = css[i:j].strip()
        depth, k = 1, j + 1
        while k < n and depth:
            depth += {'{': 1, '}': -1}.get(css[k], 0)
            k += 1
        rules.append((sel, css[j + 1:k - 1]))
        i = k
    return rules

def scope_css(css, scope):
    out = []
    for sel, body in _split_top(css):
        if sel.startswith('@media'):
            out.append(f'{sel}{{{scope_css(body, scope)}}}')
            continue
        parts = []
        for one in [x.strip() for x in sel.split(',')]:
            if one == '*': parts.append(f'{scope} *')
            elif one in ('body', ':root'): parts.append(scope)
            elif one == 'html': continue
            elif one.startswith(':root'):
                rest = one[len(':root'):]
                # :root:not([data-theme="light"]) / :root[data-theme="dark"] -> mantém no root e acha o escopo dentro
                parts.append(f':root{rest} {scope}')
            else: parts.append(f'{scope} {one}')
        if parts: out.append(f'{",".join(parts)}{{{body}}}')
    return ''.join(out)

def build_app(img_dir_url_token='{{img:%s}}'):
    nb = number_blocks()
    toc = []
    for b in nb:
        if b[0] == 'h1': toc.append(f'<a class="l1" href="#{b[2]}">{b[1]}</a>')
        elif b[0] == 'h2': toc.append(f'<a class="l2" href="#{b[2]}">{b[1]}</a>')
    body = ''
    for b in nb:
        h = render_block(b, web=True)
        h = h.replace(' class="pb kwn"', ' class="pb"').replace(' class="kwn"', '')
        if b[0] == 'table':
            h = h.replace('<table class="blk tbl">', '<div class="tblwrap"><table class="tbl">', 1).replace('</table>', '</table></div>', 1)
        body += h
    body = re.sub(r'src="img/([^".]+)\.jpg"', lambda m: 'src="' + (img_dir_url_token % m.group(1)) + '" loading="lazy"', body)
    html_out = f'''<div class="sitebar gutter"><div class="in"><span class="logochip"><img src="{img_dir_url_token % 'logo'}" alt="Filtrovali"></span><div class="tag"><b>Manual do usuário</b><span>Sistema Integrado de Operação</span><a class="back" href="/equipamentos" data-manual-back>← Voltar ao módulo</a></div></div></div>
<div class="gutter"><div class="titleblock"><header class="hero"><div class="eyebrow">Módulo</div><h1>Equipamentos</h1>
<p>Cadastro de categorias e equipamentos, calibração, anexos, dados técnicos, manual de operação, checklist, QR code, manutenção e notificações — com imagens reais das telas e a indicação de onde clicar.</p>
<div class="pdf"><span class="ver">{VERSION}</span></div></header></div></div>
<div class="gutter"><div class="wrap">
<nav class="toc" aria-label="Índice do manual"><div class="toclabel">Índice</div>
<button class="tocbtn" data-toc-button type="button" aria-expanded="false" aria-controls="equip-manual-toc">Mostrar índice</button>
<div class="list" id="equip-manual-toc">{''.join(toc)}</div></nav>
<main>
{body}
</main></div></div>'''
    css = scope_css(WEB_CSS, '.equip-manual')
    return html_out, css

if __name__ == '__main__' and len(sys.argv) > 2 and sys.argv[1] == 'app':
    html_out, css = build_app()
    outdir = sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    open(os.path.join(outdir, 'manual.html'), 'w', encoding='utf-8').write(html_out)
    open(os.path.join(outdir, 'manual.css'), 'w', encoding='utf-8').write(css)
    print('app ok', len(html_out), len(css))
