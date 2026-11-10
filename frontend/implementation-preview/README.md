# Prévia de notas na assinatura e documentos dos equipamentos

Execute `npm run dev -- --host 0.0.0.0 --port 5191 --strictPort` na pasta `frontend`.
Abra <http://localhost:5191/implementation-preview/index.html>.

A prévia monta os componentes de produção com dados ilustrativos. Na aba de
assinatura, o campo de nota fica na área de confirmação, junto aos botões de assinar. O link “Ver assinatura de
vários RDOs” permite conferir notas independentes em cada relatório. As
assinaturas são simuladas; os downloads da simulação são exemplos fixos.
O link “Abrir exemplo do PDF final com nota” mostra um arquivo gerado pelo
gerador de PDF final de produção, com uma nota ilustrativa e uma assinatura de
demonstração. O texto digitado na prévia não modifica esse exemplo fixo.

Na aba de equipamentos, edite a categoria para ativar ou desativar “Anexar
documentos”. Abra a pasta de cada equipamento para arrastar ou selecionar vários PDFs,
consultar e remover arquivos. Desativar a categoria preserva os documentos.
O controle “Simular acesso de gestor” permite conferir o acesso de consulta.
As alterações desta aba ficam apenas na memória da página e são descartadas
ao recarregar. Nenhuma chamada chega ao backend real.

Verificação no navegador, a partir da raiz do repositório, com uma sessão do
Playwright CLI aberta nesta prévia:

```sh
playwright-cli run-code --filename frontend/test/browser/report-notes-equipment-documents.js
```

As capturas ficam em `output/playwright/assinatura-nota-{desktop,mobile}.png` e
`output/playwright/equipamentos-documentos-{desktop,mobile}.png`.

A publicação requer a migration
`20261110120000_signature_notes_equipment_documents`, a geração do Prisma Client
e a atualização do backend e frontend. Categorias existentes começam com a
nova opção desativada. As notas de assinatura ficam persistidas na evidência de
cada signatário e entram no PDF final, inclusive nas assinaturas pelo portal.
