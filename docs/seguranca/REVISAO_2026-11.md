# Revisão de segurança — novembro de 2026

Registro da revisão feita na auditoria do filtroAPP pela régua dos 13 pilares
(critério 8.6). Atualize o status de cada item quando o PR correspondente for
mesclado ou quando um item aberto for tratado.

## Escopo e método

- **Período:** 2026-11-18.
- **Escopo:** pilares 4 (autenticação), 5 (autorização e dados), 6 (front-end de
  produção), 7 (APIs e integrações), 8 (segurança), 9 (privacidade/LGPD) e 10
  (abuso e custo), mais a recuperação (pilar 3) quando afetava segurança.
- **Método:**
  - leitura do código por pilar (rotas, middleware, permissões, validação, erros);
  - conferência ao vivo, só leitura, no servidor de produção: variáveis de
    ambiente (só nomes), papéis do PostgreSQL, ambiente dos containers, ufw,
    portas em escuta, crontab, status de backup/restauração;
  - `npm audit --omit=dev` em backend e frontend;
  - varredura de segredos nos arquivos versionados e no histórico do Git
    (2.497 revisões; padrões `sk-`, `ghp_`, `AKIA`, chaves privadas, URLs com
    senha): **nenhum segredo real encontrado**.

## Histórico

- Pentest externo anterior: achados F-01 a F-06 corrigidos no PR #102
  (commit `30805ff4`, "hardening F-01 a F-06"); F-01 e F-02 estão referenciados
  em `deploy/nginx/default.conf`. O relatório do pentest não está versionado.

## Achados

| # | Pilar | Achado | Status |
|---|---|---|---|
| 1 | 5.4 | API e worker conectavam como superusuário `postgres` | Corrigido — #589 (papel `filtrovali_app`), verificado no servidor |
| 2 | 5.4 | Senha do dono do banco visível nos containers da aplicação | Corrigido — #592, verificado no servidor (0 credenciais) |
| 3 | 4.5 | Troca de senha pelo admin não derrubava as sessões abertas | Corrigido — #587 |
| 4 | 4.1 | Senha mínima de 6 caracteres | Corrigido — #587 (10 para senhas novas) |
| 5 | 10.1 | Limite de login só por IP+usuário (contornável) | Corrigido — #587 (também por usuário e por IP) |
| 6 | 8.2 | Portas 8080 e 8087 abertas para a internet no ufw (8087 = homologação do ComercialAPP sem TLS) | Corrigido no servidor em 18/11 |
| 7 | 8.1 | `b2.env` com chaves do B2 legível por todos na pasta do repositório no servidor | Corrigido no servidor (movido, `600`) |
| 8 | 7.5 | Chamadas ao Omie, ZapSign, webhooks e imagens do PDF sem prazo | Corrigido — #590 |
| 9 | 12.1 | Produção sem nenhum alerta configurado | Corrigido — #588 + configuração (ver `docs/incidentes/`) |
| 10 | 3.5 | Restauração de backup nunca comprovada | Corrigido — #591, ensaio em 18/11 |
| 11 | 9.1 | Rotina de retenção desligada; Conecta RH (CPF) fora do ROPA; homologação com dados reais | Corrigido — retenção ligada, #603, #604, #605 |
| 12 | 2.2 | Suítes de banco puladas em silêncio no CI; jobs de banco não obrigatórios | Corrigido — #586 e proteção da `main` (12 checks) |
| 13 | 8.3 | E-mail em modo senha aceitava certificado TLS inválido | Corrigido — #606 (produção usa OAuth2) |
| 14 | 4.3 | CORS liberava qualquer origem se `ALLOWED_ORIGIN` ficasse vazio | Corrigido — #606 (produção exige a variável) |
| 15 | 7.3 | Respostas 5xx expunham códigos internos (`P1001`, `ECONNREFUSED`) | Corrigido — #606 |
| 16 | 4.1 | Sem 2FA, inclusive para administradores | **Aberto** — exige spec própria |
| 17 | 4.2 | Token de sessão no `localStorage`, válido por até 30 dias | **Aberto** — mitigado pela CSP restritiva do nginx |
| 18 | 6.5 | Homologação sem CSP/HSTS/X-Frame-Options nos estáticos (`deploy/nginx/staging.conf`) | Corrigido (`fix/staging-security-headers`; paridade testada em `nginx-security-headers.test.js`) |
| 19 | 10.3 | Nenhum alerta de abuso (picos de falha de login, 429, gasto da OpenAI) | **Aberto** |
| 20 | 10.1/10.2 | Sem limite nas rotas pesadas (PDF, Data Book, exportações) e sem teto global de gasto com a OpenAI | **Aberto** |
| 21 | 8.4 | 2 vulnerabilidades moderadas (`ajv` → `fast-uri`) e 2 baixas no backend | **Aberto** (Dependabot ativo) |
| 22 | 8.6 | Relatório do pentest externo não versionado | **Aberto** |
| 23 | 8.1 | Chave `SIGNATURE_TOKEN_SECRET` duplicada no `.env.production` (a linha em uso é a última) | **Aberto** — higiene no servidor |

## Próxima revisão

Antes de cada mudança relevante de autenticação, permissões ou integrações, e no
mínimo a cada 6 meses. Itens abertos acima entram como microentregas.
