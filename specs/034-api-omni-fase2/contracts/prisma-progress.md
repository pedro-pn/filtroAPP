# Omni — vínculo oficial Prisma e avanço

Contrato aditivo de 04/11/2026. Base `/api/integracoes/v1`, Bearer, paginação,
recorte de projetos e `schemaVersion: "1.0"` existentes.

## Vínculo da missão

`GET /projetos`, escopo **`projetos.read`**, acrescenta o campo obrigatório
`prisma`, que pode ser `null`. Nenhum escopo novo é necessário.

| Campo | Tipo | Origem |
| --- | --- | --- |
| prisma.missionId | string | CrmProjectMapping.prismaMissionId |
| prisma.number | string/null | CrmProjectMapping.number, sem normalização |
| prisma.numberScope | string/null | CrmProjectMapping.numberScope, normalmente filtrovali ou fentecx |

A consulta exige `sourceSystem = prismaCRM`, `environment = production` e o
tenant configurado em `CRM_PLANNING_TENANT_ID` (padrão `filtrovali`). Mesmo em
homologação, um vínculo sandbox não é publicado neste campo. Sem vínculo nesse
namespace, retorna `prisma: null`; não tenta deduzir a missão pelo número.
O número e o escopo podem ser nulos em vínculos legados.

Exemplo fictício de um item parcial; os demais campos de `/projetos` permanecem:

```json
{
  "id": "project-demo-1",
  "code": "05776",
  "prisma": {
    "missionId": "mission-demo-fentecx",
    "number": "05776",
    "numberScope": "fentecx"
  }
}
```

O Omni deve usar `prisma.missionId` como identidade do vínculo (método
`filtroapp`), preservando as travas existentes se recorrer ao número quando
`prisma` for nulo. Números iguais em escopos diferentes não confundem os vínculos.
O endpoint respeita os projetos autorizados, inclusive com token SELECTED.
Só os três campos acima saem no objeto; não há exposição do mapeamento bruto.

Criação, alteração ou remoção de um vínculo de produção atualiza
`Project.updatedAt` na mesma transação. Troca de projeto atualiza o projeto
anterior e o novo; saída do namespace de produção também atualiza o anterior,
que passará a retornar `null`. Repetição sem mudança não altera o carimbo.
Isso vale também para alterações diretas no banco, por gatilho da migração
`20261104120000_omni_prisma_mapping_watermark`.

Após publicar esta versão, faça **uma leitura completa de `/projetos`** para
buscar vínculos preexistentes; depois continue com `updatedSince`. O acréscimo
do campo não modifica retroativamente os carimbos antigos. O Playground usa
o mesmo serviço, tenant e projeção; o catálogo lista os três campos aninhados.
O modelo bruto CrmProjectMapping continua reservado no catálogo de dados.

## Avanço oficial

Para Missões, Revisão e Gestão do Omni, a referência é o **avanço físico do
Acompanhamento**, calculado por `computeProgressDetailsForProjects`.

| Endpoint | Campo para o avanço atual |
| --- | --- |
| GET /efetivo/projetos/status | progressPercent |
| GET /efetivo/projetos/{id}/status | progressPercent |
| GET /acompanhamento/projetos/custos | avancoFisico |

Com as mesmas fontes no mesmo instante, esses campos usam o mesmo cálculo.
`progressMethod` continua `RDO`, `MANUAL` ou `null`. O cálculo considera o escopo
e o percentual da proposta, os serviços finalizados de relatórios-fonte com
data utilizável no detalhamento, históricos e correções do Acompanhamento.
Usa avanço manual quando o escopo não permite cálculo; sem fonte, retorna
`null`. O percentual pode superar 100% e deve ser preservado pelo consumidor.

`stage` indica uma etapa de processo; não define um percentual. `workflowVersion`
também não é watermark do avanço. A coleção de status continua exigindo leitura
completa, sem `updatedSince`; o sincronizador deve atualizar os valores nas três
telas a partir dessa mesma referência, sem manter o resultado antigo em cache.

Em `/acompanhamento/projetos/semanas`, `avancoInicio` e `avancoFim` representam
os limites da semana consultada. Semanas passadas podem diferir do avanço atual.
Esses campos históricos não devem substituir o avanço atual na tela de Missões.

Os projetos 5856, 5833 e 5839 motivaram o relato de divergência. A alteração unifica
o caminho de cálculo; os valores desses projetos em produção ainda precisam
ser conferidos após a publicação e nova sincronização. Não foram consultados
nem alterados dados de produção nesta entrega.
