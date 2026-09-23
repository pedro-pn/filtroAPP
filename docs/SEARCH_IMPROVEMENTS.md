# Precisão e resposta das buscas

## Diagnóstico — 15/09/2026

O problema relatado ao buscar `5800` é compatível com duas falhas no fluxo dos
relatórios: o `keepPreviousData` global apresentava resultados da consulta anterior
como dados temporários da nova consulta, e a lista acumulada podia salvar esses
itens no novo cache. Além disso, consultas independentes de grupos continuavam
inserindo resultados depois da troca de busca. A latência amplia essa janela.

A correspondência também compactava todos os campos juntos: `58` no final de um
campo e `00` no início do seguinte podiam produzir uma correspondência para `5800`.
Consultas apenas com pontuação tinham uma alternativa vazia que aceitava tudo.

## Alterações

- Removido o reaproveitamento global de dados entre chaves de consulta diferentes.
  O cache da mesma consulta continua disponível durante sua revalidação.
- Relatórios: cada texto digitado identifica imediatamente sua própria consulta;
  a requisição aguarda 200 ms sem novas teclas. Consultas antigas são canceladas.
- Respostas de grupos também verificam se ainda pertencem à busca ativa, mesmo
  quando o transporte não consegue cancelar a resposta. Trocar de aba ou sair da
  tela invalida essas requisições.
- Cache acumulado atualizado para versão 2, descartando snapshots antigos que
  possam conter itens de outra busca. Busca persistida restaurada por aba antes
  de renderizar os filhos.
- Indicador “Buscando…” e estado de carregamento durante a digitação/consulta;
  aplicado também às consultas de romaneios e colaboradores do efetivo.
- Correspondência mantém os limites entre campos, acentos e identificadores
  formatados. Comboboxes usam as mesmas regras de normalização e múltiplos termos.
- Servidor: buscas paginadas internas carregam inicialmente só os campos usados
  para pesquisar; detalhes dos cards são carregados apenas para a página resultante.
  Filtros de acesso, totais e contagem por projeto/tipo são preservados.

## Validação e limites

Testes de correspondência, paginação, busca pela rota e visibilidade dos relatórios;
build TypeScript/Vite e ESLint dos arquivos alterados. A suíte do frontend passou,
com o teste de isolamento de subprocessos reexecutado fora do sandbox.

O [cenário de navegador](../frontend/test/browser/README.md) usa React e React Query
reais, digitação rápida e respostas entregues manualmente fora de ordem. Inclui
limpeza, consulta vazia, abas, desmontagem, cache antigo e acentos.

As alterações não foram publicadas nem cronometradas em produção. O servidor
ainda percorre os campos pesquisáveis dos relatórios autorizados; não foi criado
um índice textual no banco. A otimização de carregamento de detalhes é para perfis
internos; o cliente mantém seu fluxo de visibilidade por relações entre relatórios.
