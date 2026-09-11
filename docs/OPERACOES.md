# Operações da API de integrações

## Runbook: suspeita de vazamento de token

1. No painel **Administração → Tokens de API**, localize a credencial pelo nome, destinatário ou identificação mascarada. Não copie o segredo para chamado, chat, motivo, query string ou log.
2. Se houver risco real, escolha **Revogar**, informe um motivo sem dados pessoais/segredos e confirme. A revogação é terminal e vale para a requisição seguinte.
3. Registre no incidente apenas ID da credencial, prefixo mascarado, horários, operações, códigos de resultado e `X-Request-Id`. Preserve os eventos administrativos; eles não contêm corpo nem `Authorization`.
4. Avalie o impacto no painel de uso: período, volume, operações, status e IPs conhecidos. Correlacione por request ID, sem exportar respostas integrais.
5. Se a integração precisa continuar, gere ou rotacione para uma substituta com escopos, projetos, CIDRs, validade e cotas mínimos. Grave o novo valor diretamente no cofre e atualize o consumidor autorizado.
6. Confirme chamadas bem-sucedidas com o novo token e que o anterior recebe `401 INVALID_TOKEN`. Encerre qualquer sobreposição; em incidente, prefira revogação imediata.
7. Se a chave HMAC do servidor tiver sido exposta, trate como incidente de infraestrutura: crie nova versão no cofre, torne-a ativa para novas emissões, revogue/reemita credenciais da versão comprometida e remova a versão antiga somente após a transição aprovada.
8. Registre causa, janela, contenção e prevenção. Não restaure uma credencial revogada e não apague a trilha para “limpar” o incidente.

## Verificações operacionais

- Alertar para crescimento de `401`, `403`, `429` e `5xx`, sem capturar headers ou corpo.
- Monitorar cotas por minuto/dia, linhas e bytes; cliente deve respeitar `Retry-After` e usar backoff com jitter.
- Executar retenção primeiro em `--dry-run`; logs/buckets expiram conforme política, eventos críticos são preservados.
- Manter `API_TOKEN_HASH_KEY_V1` e futuras versões somente no cofre de produção. Falha de boot por chave ausente/curta é intencional.
- Aceitar tráfego externo somente por HTTPS e proxies confiáveis. CORS da árvore `/api/integracoes/v1` é fechado por padrão.
- Fazer restauração e testes de contrato em homologação antes de liberar uma mudança de schema ou nova família de endpoints.

## Exemplo de referência ao cofre

O manifesto do consumidor deve conter apenas uma referência, nunca o valor:

```yaml
env:
  - name: FILTRO_API_TOKEN
    valueFrom:
      secretKeyRef:
        name: integracao-bi-qualidade
        key: token
```

O repositório, pipeline, saída de `curl`, telemetria e evidências de teste não devem conter o conteúdo resolvido dessa referência.
