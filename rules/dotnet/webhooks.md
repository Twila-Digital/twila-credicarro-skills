# Webhooks (.NET)

`IWebhooksClient` (como `client.Webhooks`) gerencia os webhooks, e `CredicarroWebhookEvent` verifica e decodifica as notificações recebidas. Hoje só o tipo **Proposal** (3) envia eventos. O significado dos códigos do payload está em [Etapas e status da proposta](../proposal-steps.md).

## Modelos

```csharp
public enum WebhookType { Customer = 1, Simulation = 2, Proposal = 3, Unknown = -1 }
public enum WebhookAuthenticationType { None = 1, Basic = 2, Jwt = 3, Unknown = -1 }
public enum WebhookStatus { Active = 1, Inactive = 2, Unknown = -1 }
public enum ProposalEventReason { StatusChanged = 1, StepsChanged = 2, DocumentsChanged = 3, Unknown = -1 }

public sealed record CreateWebhookRequest(WebhookType Type, string Url, WebhookAuthenticationType AuthenticationType, string? Credential = null);
    // tipo, url, tipo_autenticacao, credencial
public sealed record CreateWebhookResult(Guid WebhookId, string SigningSecret);   // id_webhook, segredo_assinatura (ToString não o imprime)
public sealed record UpdateWebhookRequest(WebhookType Type, string Url, WebhookStatus? Status = null);
public sealed record Webhook(Guid Id, WebhookType Type, string Url, WebhookAuthenticationType AuthenticationType, WebhookStatus Status);

public sealed record ProposalWebhookEvent(Guid ProposalId, ProposalStatus Status, int StatusRaw, string? StatusName,
    ProposalEventReason? EventReason, string? EventReasonRaw, string? RefusalReason, DateTimeOffset? EventDate,
    ProposalParticipantState? Buyer, ProposalParticipantState? Seller, ProposalParticipantState? Store, bool IsDetailed);
```

`Buyer`, `Seller` e `Store` são do mesmo tipo de `ProposalDetails` (veja [proposals.md](proposals.md)). O payload v2 é o detalhado (`IsDetailed == true`); o v1 traz só `id_proposta`, `enum_status` e `status` em inglês.

## Interface

```csharp
public interface IWebhooksClient
{
    Task<CreateWebhookResult> CreateAsync(CreateWebhookRequest request, CancellationToken cancellationToken = default);             // POST v1/webhook -> 201
    Task<PagedResult<Webhook>> ListAsync(ListRequest? request = null, CancellationToken cancellationToken = default);               // GET v1/webhook
    Task UpdateAsync(Guid webhookId, UpdateWebhookRequest request, CancellationToken cancellationToken = default);                   // PUT v1/webhook/{id} -> 204
    Task DeleteAsync(Guid webhookId, CancellationToken cancellationToken = default);                                                 // DELETE v1/webhook/{id} -> 204
}

public static class CredicarroWebhookEvent   // namespace Credicarro.Webhooks
{
    public static ProposalWebhookEvent Parse(string rawBody, string signatureHeader, string signingSecret, TimeSpan? tolerance = null); // verifica e decodifica
    public static ProposalWebhookEvent ParseUnverified(string rawBody);                                                                // sem verificação: só para testes
    public static bool VerifySignature(string rawBody, string signatureHeader, string signingSecret, TimeSpan? tolerance = null);      // tolerância padrão: 5 minutos
    public static bool VerifyAuthorization(string? receivedHeader, string? expectedHeader);                                           // tempo constante
}
```

## Features

- **Cadastro:** `Url` HTTPS pública (sem localhost, IP privado, usuário/senha ou fragmento). Autenticação: Basic (`Credential` = Base64 de `usuario:senha`, enviada como `Basic {credencial}`) ou Jwt (token, enviado como `Bearer {credencial}`). O tipo de autenticação não muda depois; para trocar, exclua e cadastre outro. `CreateAsync` não é repetido pelo SDK.
- **Segredo:** `SigningSecret` só vem na resposta do cadastro. Guarde-o na hora em cofre ou variável de ambiente.
- **Assinatura:** o header `X-CrediCarro-Signature: t={unix},v1={hex}`. O SDK calcula o HMAC-SHA256 de `"{t}.{corpo bruto}"` com o segredo como texto UTF-8, em hexadecimal minúsculo, compara em tempo constante, aceita `t` só com 1 a 10 dígitos e usa o texto bruto de `t`. A tolerância vale nos dois sentidos (padrão 5 minutos); segredo vazio nunca valida. **Não reimplemente isso.** Use `VerifySignature` (ou `Parse` com assinatura) sobre o **corpo bruto**, como string, antes de desserializar. `t` ou `v1` repetidos no header tornam-no inválido; tolerância negativa lança `ArgumentOutOfRangeException`.
- **`Authorization`:** `CredicarroWebhookEvent.VerifyAuthorization(recebido, esperado)` compara em tempo constante e devolve `false` se algum lado estiver vazio. Chame só quando houver valor esperado configurado.
- **Variáveis de ambiente:** `CREDICARRO_WEBHOOK_SECRET` é obrigatório; o exemplo (`WebhookOptions.FromEnvironment()`) falha na inicialização se faltar. `CREDICARRO_WEBHOOK_AUTHORIZATION` guarda o valor **completo** esperado do header `Authorization` (`Basic ...` ou `Bearer ...`, igual à `Credential` cadastrada com o prefixo). Com autenticação Basic ou Jwt, configure-a: o endpoint responde `401` se diferir. Nunca coloque credencial literal no código.
- **Endpoint:** confira o `Authorization`, leia o corpo bruto (limite de 1 MiB; acima disso, `413`), valide a assinatura (inválida: `401`), decodifique, deduplique pelo header `Idempotency-Key` (`{id_mensagem}:{id_webhook}`) e enfileire. Só responda `2xx` **depois** de enfileirar; se o enfileiramento falhar, desfaça a deduplicação e responda `503` (a Credicarro retenta). Fila cheia responde `503` na hora (`TryWrite`). O limite de entrega é 15 s: processe de forma assíncrona.
- **Worker:** trate exceção **por job** (`try/catch`), registre só o id da proposta e o tipo do erro, e siga o laço. Uma exceção solta em `BackgroundService.ExecuteAsync` derruba o host.
- **Fora de ordem:** as entregas podem chegar trocadas. No worker, chame `client.Proposals.GetAsync` e use `GetPendingActions()` sobre o estado mais recente (veja [proposals.md](proposals.md)).
- **Retentativas da Credicarro:** `408`, `425`, `429`, `5xx`, falha de rede e timeout, até 3 novas tentativas (cerca de 1 s, 5 s e 30 s). Outros `4xx` e `3xx` não são repetidos.
- Payload v2: `id_proposta`, `enum_status`, `status`, `motivo_evento` (`STATUS_ALTERADO`, `ETAPAS_ALTERADAS`, `DOCUMENTOS_ALTERADOS`), `motivo_recusa`, `data_evento`, `comprador`, `loja`, `vendedor` (sempre `null` hoje).

## Vetor de teste

| Item | Valor |
| --- | --- |
| Segredo | `segredo-de-exemplo` |
| `t` | `1715792400` |
| Corpo bruto | `{"id_proposta":"bea8d060-f93d-48eb-b6c4-45f64483cdd9","enum_status":2,"status":"Approved"}` |
| `v1` esperado | `db66c554eb116ef2577deb63f72619793502a31520f622b2d59864b074eb8df2` |

O SDK usa o relógio atual, e o timestamp do vetor é antigo: para testar, passe `tolerance: TimeSpan.MaxValue`.

## Exemplo

(Fonte: `examples/dotnet/webhooks.cs`)

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddCredicarro(options => { /* ClientId, ClientSecret, Environment */ });
builder.Services.AddCredicarroWebhooks();   // WebhookOptions, Channel<WebhookJob>, deduplicação e WebhookWorker (hosted service)

var app = builder.Build();
app.MapCredicarroWebhook();                 // POST /webhooks/credicarro
app.Run();
```

Dentro do endpoint:

```csharp
if (!CredicarroWebhookEvent.VerifySignature(rawBody, request.Headers["X-CrediCarro-Signature"].ToString(), options.Secret))
    return Results.Unauthorized();

var evt = CredicarroWebhookEvent.ParseUnverified(rawBody);   // já verificado acima
```

## Erros e casos de borda

- `CredicarroWebhookSignatureException`: assinatura inválida, expirada, cabeçalho malformado ou corpo que não é JSON válido. No endpoint, responda `401` (assinatura) ou `400` (corpo) sem detalhes.
- `Validation.Url.Invalid` (`400`), `Organization.Webhook.InvalidEndpoint` e `Organization.Webhook.ActivationIntegrationInactive` (`422`) no cadastro e na edição.
- `Validation.Field.Required` quando `Credential` falta em Basic ou Jwt.
- `404 Webhook.Registration.NotFound`; `409 Organization.Webhook.ConcurrencyConflict` e `503 Organization.Webhook.CredentialProtectionUnavailable`: tente de novo.
- `ParseUnverified(rawBody)` (sem verificação) existe só para testes. Em produção, verifique antes.
- `Parse(rawBody, header, secret)` exige header e segredo (vazio ou ausente = `CredicarroWebhookSignatureException`) e um `id_proposta` UUID válido no corpo; sem ele o corpo é recusado.
- `ProposalWebhookEvent.GetPendingActions()` aplica a mesma regra de `ProposalDetails.GetPendingActions()` ao evento **detalhado**; o evento simples não traz etapas (lista vazia), então consulte a proposta. O `ToString` do evento mascara CPF e motivo da recusa.
- Troque o `ConcurrentDictionary` do exemplo por Redis ou banco com expiração; ele só vale para uma instância.
- Webhooks de staging e de produção são separados. Veja [security.md](security.md).
