# Webhooks (Go)

`WebhooksClient` (como `client.Webhooks`) gerencia os webhooks, e `ParseWebhookEvent` e as funções `VerifyWebhook...` do pacote verificam e decodificam as notificações recebidas. Hoje só o tipo **Proposal** (3) envia eventos. O significado dos códigos do payload está em [Etapas e status da proposta](../proposal-steps.md).

## Structs e tipos

```go
type WebhookType int               // WebhookTypeCustomer=1, Simulation=2, Proposal=3, Unknown=-1
type WebhookAuthenticationType int // WebhookAuthenticationTypeNone=1, Basic=2, Jwt=3, Unknown=-1
type WebhookStatus int             // WebhookStatusActive=1, Inactive=2, Unknown=-1
type ProposalEventReason int       // ProposalEventReasonStatusChanged=1, StepsChanged=2, DocumentsChanged=3, Unknown=-1

type CreateWebhookRequest struct {
    Type WebhookType; URL string; AuthenticationType WebhookAuthenticationType
    Credential string // Basic: Base64 de usuario:senha; Jwt: o token (String() não o imprime)
}
type CreateWebhookResult struct { WebhookID string; SigningSecret string } // id_webhook, segredo_assinatura (String() não o imprime)
type UpdateWebhookRequest struct { Type WebhookType; URL string; Status *WebhookStatus } // Status nil mantém o atual
type Webhook struct {
    ID string; URL string
    Type WebhookType; TypeRaw string
    AuthenticationType WebhookAuthenticationType; AuthenticationTypeRaw string
    Status WebhookStatus; StatusRaw string
}

type ProposalWebhookEvent struct {
    ProposalID string
    Status ProposalStatus; StatusRaw int; StatusName string
    EventReason *ProposalEventReason; EventReasonRaw string
    RefusalReason, EventDate string
    Buyer, Seller, Store *ProposalParticipantState // mesmo tipo de ProposalDetails
    IsDetailed bool                                 // payload v2
}
```

`Buyer`, `Seller` e `Store` são do mesmo tipo de `ProposalDetails` (veja [proposals.md](proposals.md)). O payload v2 é o detalhado (`IsDetailed == true`); o v1 traz só `id_proposta`, `enum_status` e `status` em inglês.

## Métodos

```go
func (c *WebhooksClient) Create(ctx context.Context, req CreateWebhookRequest) (*CreateWebhookResult, error)                 // POST v1/webhook -> 201
func (c *WebhooksClient) List(ctx context.Context, req *ListRequest) (*PagedResult[Webhook], error)                         // GET v1/webhook
func (c *WebhooksClient) Update(ctx context.Context, webhookID string, req UpdateWebhookRequest) error                       // PUT v1/webhook/{id} -> 204
func (c *WebhooksClient) Delete(ctx context.Context, webhookID string) error                                                 // DELETE v1/webhook/{id} -> 204

const DefaultWebhookTolerance = 5 * time.Minute
func ParseWebhookEvent(rawBody []byte, signatureHeader, signingSecret string, tolerance time.Duration) (*ProposalWebhookEvent, error) // verifica e decodifica; tolerance 0 = 5 min
func ParseWebhookEventUnverified(rawBody []byte) (*ProposalWebhookEvent, error)                                                         // sem verificação: só para testes
func VerifyWebhookSignature(rawBody []byte, signatureHeader, signingSecret string, tolerance time.Duration) bool
func VerifyWebhookAuthorization(receivedHeader, expectedHeader string) bool                                                             // tempo constante
func ComputeWebhookSignature(signingSecret string, timestampSeconds int64, payload []byte) string                                       // para testes
```

## Features

- **Cadastro:** `URL` HTTPS pública (sem localhost, IP privado, usuário/senha ou fragmento). Autenticação: Basic (`Credential` = Base64 de `usuario:senha`, enviada como `Basic {credencial}`) ou Jwt (token, enviado como `Bearer {credencial}`). O tipo de autenticação não muda depois; para trocar, exclua e cadastre outro. `Create` não é repetido pelo SDK.
- **Segredo:** `SigningSecret` só vem na resposta do cadastro. Guarde-o na hora em cofre ou variável de ambiente.
- **Assinatura:** o header `X-CrediCarro-Signature: t={unix},v1={hex}`. O SDK calcula o HMAC-SHA256 de `"{t}.{corpo bruto}"` com o segredo como texto UTF-8, em hexadecimal minúsculo, compara em tempo constante, aceita `t` só com 1 a 10 dígitos e usa o texto bruto de `t`. A tolerância vale nos dois sentidos (`0` = 5 minutos; negativa é inválida); segredo vazio nunca valida; `t` ou `v1` repetidos no header tornam a assinatura inválida; o corpo precisa ter um `id_proposta` UUID válido. **Não reimplemente isso.** Use `VerifyWebhookSignature` ou `ParseWebhookEvent` sobre o **corpo bruto** (`[]byte`), antes de `json.Unmarshal`.
- **`Authorization`:** `VerifyWebhookAuthorization(recebido, esperado)` compara em tempo constante e devolve `false` se o esperado estiver vazio. Chame só quando houver valor esperado configurado.
- **Variáveis de ambiente:** `CREDICARRO_WEBHOOK_SECRET` é obrigatório; o exemplo (`webhookConfigFromEnv`) falha na inicialização se faltar. `CREDICARRO_WEBHOOK_AUTHORIZATION` guarda o valor **completo** esperado do header `Authorization` (`Basic ...` ou `Bearer ...`, igual à `Credential` cadastrada com o prefixo). Com autenticação Basic ou Jwt, configure-a: o handler responde `401` se diferir. Nunca coloque credencial literal no código.
- **Endpoint:** confira o `Authorization`, leia o corpo bruto (limite de 1 MiB; acima disso, `413`), valide a assinatura (inválida: `401`), decodifique, deduplique pelo header `Idempotency-Key` (`{id_mensagem}:{id_webhook}`) e enfileire no canal. Só responda `2xx` **depois** de enfileirar; se a fila estiver cheia (`select` com `default`), desfaça a deduplicação e responda `503` na hora. O limite de entrega é 15 s. Processe em outra goroutine, tratando falha (e pânico) por job sem parar o laço.
- **Fora de ordem:** as entregas podem chegar trocadas. No worker, chame `client.Proposals.Get` e use `PendingActions()` sobre o estado mais recente (veja [proposals.md](proposals.md)).
- **Retentativas da Credicarro:** `408`, `425`, `429`, `5xx`, falha de rede e timeout, até 3 novas tentativas (cerca de 1 s, 5 s e 30 s). Outros `4xx` e `3xx` não são repetidos. Por isso o handler responde `503` quando a fila está cheia.
- Payload v2: `id_proposta`, `enum_status`, `status`, `motivo_evento` (`STATUS_ALTERADO`, `ETAPAS_ALTERADAS`, `DOCUMENTOS_ALTERADOS`), `motivo_recusa`, `data_evento`, `comprador`, `loja`, `vendedor` (sempre `null` hoje).

## Vetor de teste

| Item | Valor |
| --- | --- |
| Segredo | `segredo-de-exemplo` |
| `t` | `1715792400` |
| Corpo bruto | `{"id_proposta":"bea8d060-f93d-48eb-b6c4-45f64483cdd9","enum_status":2,"status":"Approved"}` |
| `v1` esperado | `db66c554eb116ef2577deb63f72619793502a31520f622b2d59864b074eb8df2` |

`ComputeWebhookSignature("segredo-de-exemplo", 1715792400, corpo)` devolve o `v1` esperado. O SDK usa o relógio atual, e o timestamp do vetor é antigo: para verificar o header completo em teste, passe uma tolerância enorme (por exemplo, `time.Duration(math.MaxInt64)`).

## Exemplo

(Fonte: `examples/go/webhooks.go`)

```go
cfg, err := webhookConfigFromEnv() // falha na inicialização sem segredo
if err != nil {
    log.Fatal(err)
}
jobs := make(chan webhookJob, 1000)
go runWebhookWorker(ctx, client, jobs)
http.Handle("/webhooks/credicarro", webhookHandler(cfg, jobs, &sync.Map{}))
```

Dentro do handler:

```go
event, err := credicarro.ParseWebhookEvent(rawBody, r.Header.Get("X-CrediCarro-Signature"), cfg.Secret, 0) // verifica e decodifica
if err != nil { // *WebhookSignatureError: assinatura, segredo, timestamp ou id_proposta inválidos
    w.WriteHeader(http.StatusUnauthorized)
    return
}
```

## Erros e casos de borda

- `*WebhookSignatureError`: assinatura inválida, expirada, cabeçalho malformado, segredo vazio ou corpo que não é JSON válido (ou sem `id_proposta`). No handler, responda `401` (assinatura) ou `400` (corpo) sem detalhes.
- `Validation.Url.Invalid` (`400`), `Organization.Webhook.InvalidEndpoint` e `Organization.Webhook.ActivationIntegrationInactive` (`422`) no cadastro e na edição.
- `Validation.Field.Required` quando `Credential` falta em Basic ou Jwt.
- `404 Webhook.Registration.NotFound`; `409 Organization.Webhook.ConcurrencyConflict` e `503 Organization.Webhook.CredentialProtectionUnavailable`: tente de novo.
- `UpdateWebhookRequest.Status` `nil` mantém o status atual.
- `ParseWebhookEventUnverified` existe só para testes. Em produção, verifique antes.
- Troque o `sync.Map` do exemplo por Redis ou banco com expiração; ele só vale para uma instância.
- Webhooks de staging e de produção são separados. Veja [security.md](security.md).
