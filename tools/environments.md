# Ambientes (staging x produção)

O ambiente é escolhido pela URL base. As credenciais e os webhooks são de cada ambiente:

| | Staging | Produção |
| --- | --- | --- |
| Base URL | `https://api.staging.credicarro.com.br/integration` | `https://api.credicarro.com.br/integration` |
| Credenciais | Próprias do staging | Próprias da produção |
| Propostas | Simuladas — nenhuma operação real | Reais |
| Webhooks | Recebem só eventos do staging | Recebem só eventos reais |

Um token de staging retorna `401` em produção. Uma proposta criada num ambiente retorna `404` no outro.

## Configuração recomendada

Leia a base URL e as credenciais de configuração, nunca do código:

```bash
CREDICARRO_ENVIRONMENT=staging
CREDICARRO_CLIENT_ID='<client-id-do-staging>'
CREDICARRO_CLIENT_SECRET='<client-secret-do-staging>'
CREDICARRO_WEBHOOK_SECRET='<segredo_assinatura-do-webhook-do-staging>'
# "Bearer <credencial>" ou "Basic <credencial>": o mesmo valor cadastrado no webhook
CREDICARRO_WEBHOOK_AUTHORIZATION='Bearer <credencial>'
```

| Variável | Uso | Ausente |
| --- | --- | --- |
| `CREDICARRO_ENVIRONMENT` | `staging` ou `production` — vira a opção `Environment` do SDK | Os exemplos usam staging (o padrão do SDK, sem configuração, é produção) |
| `CREDICARRO_BASE_URL` | URL base customizada, sempre `https` (opcional; sobrescreve o ambiente) | Usa a URL do ambiente |
| `CREDICARRO_CLIENT_ID` / `CREDICARRO_CLIENT_SECRET` | Gerar o token | A aplicação não inicia |
| `CREDICARRO_WEBHOOK_SECRET` | Validar `X-CrediCarro-Signature` | O endpoint de webhook não inicia — nunca valide com segredo vazio |
| `CREDICARRO_WEBHOOK_AUTHORIZATION` | Conferir o header `Authorization` recebido (tipo de autenticação `2` ou `3`) | Só a assinatura é conferida |
| `CREDICARRO_WEBHOOK_CREDENTIAL` | `credencial` enviada no cadastro do webhook (token JWT ou Base64 de `usuario:senha`) | Só necessária ao cadastrar |

Os exemplos de [`examples/`](../examples) usam esses nomes.

## Primeiros passos no staging

1. Peça `clientId` e `clientSecret` de staging em atendimento@credicarro.com.br, junto com o cadastro das lojas de teste (`cnpjLoja`).
2. Gere um token ([auth.md](auth.md)).
3. Cadastre um webhook do tipo Proposal (`tipo` = 3) e guarde o `segredo_assinatura`.
4. Rode o fluxo completo (financiamento e/ou refinanciamento) — veja [rules/agent.md](../rules/agent.md).

Para receber webhooks na sua máquina, exponha o servidor local com um túnel (ngrok, Cloudflare Tunnel) e cadastre a URL HTTPS pública gerada. `localhost` e IP privado são recusados (`422` `Organization.Webhook.InvalidEndpoint`).

## O que testar no staging

- Token reaproveitado até perto de `expira_em`; `401` com token expirado.
- Cliente com cadastro completo; faixa e simulação com `cnpjLoja`; proposta a partir de um `id_simulacao`.
- Documentos, dados do veículo e conta de recebimento enviados quando a etapa pedir.
- Erros esperados: `400` `Validation.Cpf.Invalid`, `404` `Store.Integration.NotFound`, `422` `Customer.Account.Incomplete`, `409` ao reutilizar uma `Idempotency-Key` com outro corpo.
- Webhook: assinatura validada contra o corpo bruto, `2xx` em menos de 15 s, deduplicação pelo `Idempotency-Key`, notificações fora de ordem.
- Resiliência: retentativa com a mesma `Idempotency-Key` após timeout; espera crescente em `502`/`503`.
