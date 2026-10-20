# Autenticação

A API do Credicarro usa Bearer token. Toda integração precisa de um `clientId` e um `clientSecret`, gerados pelo time Credicarro (peça em atendimento@credicarro.com.br). Cada ambiente — staging e produção — tem as suas credenciais.

## Fluxo

1. `POST /v1/authentication/accesstoken` com `{"clientId": "...", "clientSecret": "..."}`.
2. A resposta traz `token_de_acesso`, `expira_em_segundos`, `expira_em` (UTC, já com 60 s de margem antes da expiração real), `tipo_de_token` (sempre `"Bearer"`) e `escopo`.
3. Envie `Authorization: Bearer <token_de_acesso>` em toda chamada seguinte. O mesmo token vale para todas as rotas.
4. Guarde o token em cache (memória, ou cache compartilhado se houver várias instâncias) e reaproveite enquanto `expira_em` não tiver passado. Proteja a renovação contra chamadas simultâneas.
5. Se uma chamada retornar `401`, gere um novo token e repita a chamada **uma** vez.

Os 6 SDKs oficiais fazem esse fluxo automaticamente (cache do token, renovação single-flight e uma nova tentativa em `401`) — veja `rules/<linguagem>/client.md` (ex.: [.NET](../rules/dotnet/client.md), [Node.js](../rules/node/client.md)). Implemente à mão só no Agent Mode ou sem SDK.

## Erros

| Situação | Resposta |
| --- | --- |
| `Authorization` ausente, token inválido ou expirado | `401` sem corpo |
| `clientId` ou `clientSecret` ausente ou longo demais | `400` com `Validation.Field.Required` ou `Validation.Field.TooLong` |
| Credenciais inválidas ou integração inativa (no token) | `401` com `Integration.Authentication.InvalidCredentials` |
| Integração desativada (com token válido) | `403` com `Integration.Access.Inactive` em qualquer rota |
| Parceiro do token não encontrado | `403` com `Integration.Access.OrganizationNotFound` |

`403` não se resolve com novo token nem com retentativa — fale com o time Credicarro.

## Ambientes

| Ambiente | Base URL |
| --- | --- |
| Staging | `https://api.staging.credicarro.com.br/integration` |
| Produção | `https://api.credicarro.com.br/integration` |

Staging é o padrão de desenvolvimento — nenhuma proposta é real. Use produção só quando o usuário pedir explicitamente.

## Boas práticas de segurança

- **Nunca** commite `clientSecret` em controle de versão.
- Use variáveis de ambiente (`CREDICARRO_CLIENT_ID`, `CREDICARRO_CLIENT_SECRET`, `CREDICARRO_BASE_URL`) ou um gerenciador de segredos.
- Gere o token só no backend. `clientSecret` nunca vai para app mobile, SPA ou qualquer código que rode no dispositivo do usuário.
- Não registre o token nem o `clientSecret` em logs.
- A Credicarro nunca pede credenciais por e-mail ou telefone.
