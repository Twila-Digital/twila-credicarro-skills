# Webhooks (Java)

Webhooks avisam seu sistema, de forma assíncrona, quando uma proposta muda de status, etapa ou documento. Cada webhook ativo do tipo Proposal recebe o retrato da proposta. Para os códigos de status e etapa do payload, leia [Etapas e status da proposta](../proposal-steps.md). `twila.credicarro.webhooks` usa o `CredicarroClient` de [client](client.md).

## Modelos

```java
public interface WebhooksClient {
    CreateWebhookResult create(CreateWebhookRequest request);     // POST v1/webhook -> 201
    PagedResult<Webhook> list();                                  // GET v1/webhook
    PagedResult<Webhook> list(ListRequest request);
    void update(UUID webhookId, UpdateWebhookRequest request);    // PUT v1/webhook/{id} -> 204
    void delete(UUID webhookId);                                  // DELETE v1/webhook/{id} -> 204
}

@Value @Builder
public class CreateWebhookRequest {
    WebhookType type;                         // PROPOSAL
    String url;                               // https público
    WebhookAuthenticationType authenticationType; // NONE, BASIC, JWT
    String credential;                        // obrigatória em BASIC (Base64 de usuario:senha) e JWT
}

@Value public class CreateWebhookResult { UUID webhookId; String signingSecret; } // guarde o segredo: só vem aqui
@Value public class Webhook { UUID id; WebhookType type; String url; WebhookAuthenticationType authenticationType; WebhookStatus status; }
@Value @Builder public class UpdateWebhookRequest { WebhookType type; String url; WebhookStatus status; }

public final class CredicarroWebhookEvent {                       // twila.credicarro.webhooks
    static ProposalWebhookEvent parse(String rawBody, String signatureHeader, String signingSecret); // lança CredicarroWebhookSignatureException
    static ProposalWebhookEvent parse(String rawBody, String signatureHeader, String signingSecret, Duration tolerance);
    static ProposalWebhookEvent parseUnverified(String rawBody);  // SEM verificar a assinatura: só em testes
    static boolean verifySignature(String rawBody, String signatureHeader, String signingSecret);          // tolerância de 5 min
    static boolean verifySignature(String rawBody, String signatureHeader, String signingSecret, Duration tolerance);
    static boolean verifyAuthorization(String receivedHeader, String expectedHeader);                       // tempo constante
}

@Value
public class ProposalWebhookEvent {
    UUID proposalId;
    ProposalStatus status; int statusRaw; String statusName;
    ProposalEventReason eventReason; String eventReasonRaw; // STATUS_CHANGED, STEPS_CHANGED, DOCUMENTS_CHANGED, UNKNOWN
    String refusalReason; OffsetDateTime eventDate;
    ProposalParticipantState buyer; ProposalParticipantState seller; ProposalParticipantState store; // mesmo tipo de ProposalDetails
    boolean isDetailed;              // getter: isDetailed() (payload v2)
}
```

Enums: `WebhookType` `CUSTOMER(1)`, `SIMULATION(2)`, `PROPOSAL(3)`; `WebhookAuthenticationType` `NONE(1)`, `BASIC(2)`, `JWT(3)`; `WebhookStatus` `ACTIVE(1)`, `INACTIVE(2)`; todos com `UNKNOWN(-1)`.

## Funcionalidades

- **Cadastro**: `create` devolve o `signingSecret` **uma única vez**. Guarde-o em um cofre de segredos na hora. A rota não aceita `Idempotency-Key` e o SDK **não repete** `create`: se der timeout, consulte `list()` antes de tentar de novo. `update` e `delete` são repetidos com segurança.
- **Verificação**: `CredicarroWebhookEvent` confere o header `X-CrediCarro-Signature: t={timestamp},v1={assinatura}`: HMAC-SHA256 de `"{t}.{corpo bruto}"`, com o `signingSecret` (texto UTF-8) como chave, hex minúsculo, em comparação de tempo constante. A tolerância de replay é de 5 minutos nos dois sentidos (o 4º argumento muda). Segredo vazio é sempre inválido. Não reimplemente o HMAC.
- `parse(rawBody, header, secret)` verifica e já devolve o evento (lança `CredicarroWebhookSignatureException` em qualquer falha). `verifySignature(...)` devolve `boolean` e é a opção do endpoint, que decide o status HTTP. `parseUnverified(rawBody)` lê **sem** verificar: só em testes. Cabeçalho e segredo são obrigatórios em `parse`; `t` ou `v1` repetidos invalidam a assinatura; a tolerância precisa ser maior ou igual a zero; o corpo precisa trazer `id_proposta` UUID válido. `verifyAuthorization` compara o SHA-256 dos dois valores e nunca aceita esperado vazio. `ProposalWebhookEvent.getPendingActions()` funciona no payload v2 (no v1 vem vazio: consulte a proposta).
- `verifyAuthorization(recebido, esperado)` compara o header `Authorization` configurado no cadastro (Basic ou Bearer) em tempo constante. Com `authenticationType` BASIC ou JWT, defina `CREDICARRO_WEBHOOK_AUTHORIZATION` com o valor completo esperado (`Basic ...` ou `Bearer ...`).
- O evento aceita os payloads v1 (`id_proposta`, `enum_status`, `status` em inglês) e v2 (nomes em português, `motivo_evento`, `comprador`, `loja`, `vendedor`); `isDetailed()` indica o v2.

Vetor de teste da documentação (a verificação do SDK precisa aceitá-lo):

| Item | Valor |
| --- | --- |
| `segredo_assinatura` | `segredo-de-exemplo` |
| `t` | `1715792400` |
| Corpo bruto | `{"id_proposta":"bea8d060-f93d-48eb-b6c4-45f64483cdd9","enum_status":2,"status":"Approved"}` |
| `v1` esperado | `db66c554eb116ef2577deb63f72619793502a31520f622b2d59864b074eb8df2` |

O `t` do vetor é antigo: a tolerância padrão o rejeita. Em teste, passe uma tolerância longa: `CredicarroWebhookEvent.parse(corpo, "t=1715792400,v1=db66...8df2", "segredo-de-exemplo", Duration.ofDays(100000))` devolve o evento com `APPROVED`. O `t` do cabeçalho de produção é validado; nunca use `parseUnverified` num endpoint.

## Exemplo

(Fonte: `examples/java/webhooks.java`)

```java
CreateWebhookResult criado = client.webhooks().create(CreateWebhookRequest.builder()
        .type(WebhookType.PROPOSAL)
        .url("https://parceiro.com.br/webhooks/credicarro")
        .authenticationType(WebhookAuthenticationType.BASIC)
        .credential(System.getenv("CREDICARRO_WEBHOOK_CREDENTIAL")) // Base64 de usuario:senha, lida de configuração
        .build());
// Guarde criado.getSigningSecret() em um cofre: ele só aparece nesta resposta.
```

O endpoint de exemplo é um `@RestController` do Spring Boot 3 que recebe o `HttpServletRequest` (sem `@RequestBody`) e lê `request.getInputStream()` com limite. Configuração:

- `CREDICARRO_WEBHOOK_SECRET` (obrigatória): o `segredo_assinatura`. Sem ela a aplicação falha ao iniciar.
- `CREDICARRO_WEBHOOK_AUTHORIZATION` (opcional): valor completo esperado do header `Authorization`. Com BASIC ou JWT, **defina-a**: o endpoint compara com `verifyAuthorization` e responde `401` se for diferente.

O endpoint rejeita `Content-Length` acima de 1 MiB (`413`), confere o `Authorization`, lê no máximo 1 MiB + 1 byte (se passar, `413`), valida a assinatura com `verifySignature` (inválida responde `401`), deduplica pelo header `Idempotency-Key`, enfileira numa fila limitada e só então responde `2xx`. Se a fila estiver cheia, desfaz a deduplicação e responde `503`. O worker relê o evento, consulta a proposta e, em falha, registra só o ID da proposta e o tipo do erro.

## Erros e casos de borda

- **Responda `2xx` rápido**: o limite de cada entrega é 15 s. Respostas `2xx` com corpo de até 1 MiB confirmam o recebimento. Processe em fila ou executor.
- Retentativas automáticas (até 3, após cerca de 1 s, 5 s e 30 s) valem para `408`, `425`, `429`, `5xx`, falha de rede e timeout. Outros `4xx` e `3xx` não são repetidos, então nunca responda `401` por engano em um evento legítimo.
- Assinatura inválida: responda `401`, nunca `200`. Cada retentativa é assinada de novo, com novo `t`.
- **Deduplicação**: a chave é o header `Idempotency-Key` (`{id_mensagem}:{id_webhook}`). Retentativas repetem a chave. Em produção, guarde as chaves em Redis ou banco com TTL, não em memória. Se falhar ao enfileirar, remova a chave e responda `503`.
- **Fora de ordem**: as entregas podem chegar fora de ordem. Consulte `proposals().get(id)` para o estado mais recente e não confie só no payload.
- **Corpo bruto**: o SDK recebe o corpo como `String`. Leia os bytes do `InputStream` e converta com `new String(bytes, StandardCharsets.UTF_8)` sem alterar nada (nem reformatar o JSON). Nenhum filtro pode alterar nem consumir o corpo antes do controller. Bytes que não sejam UTF-8 válido mudam o hash e a assinatura é recusada (`401`), o que é o comportamento certo.
- **Não use `@RequestBody byte[]`/`String`**: o Spring lê o corpo inteiro na memória antes de chamar o controller, então qualquer checagem de tamanho chega tarde (corpo enorme ou `chunked` sem `Content-Length` entraria sem autenticação). Leia o `InputStream` você mesmo, com `readNBytes(1 MiB + 1)`, e responda `413` se passar do limite.
- **Limite de 1 MiB**: o exemplo checa `Content-Length` (`-1` quando é `chunked`), autentica por header antes de ler o corpo e faz leitura limitada. Um limite no proxy/gateway é só uma camada extra.
- `parse` e `parseUnverified` também lançam `CredicarroWebhookSignatureException` se o JSON for ilegível. No worker, capture a falha e registre só o ID da proposta e o tipo do erro; a consulta periódica da proposta cobre a lacuna.
- `getEventReason()` é `null` quando o payload não traz `motivo_evento` (v1); `UNKNOWN` só para um valor presente e desconhecido (o texto original fica em `getEventReasonRaw()`).
- Payload v2: `motivo_evento` (`STATUS_ALTERADO`, `ETAPAS_ALTERADAS` ou `DOCUMENTOS_ALTERADOS`, em `getEventReason()`), `getRefusalReason()` (pode ser `null`), `getEventDate()` (UTC) e os participantes. O `getSeller()` vem sempre `null` hoje.
- Cadastro: a `url` precisa ser HTTPS pública (sem localhost, IP privado, usuário/senha ou fragmento): `422 Organization.Webhook.InvalidEndpoint` (`CredicarroBusinessRuleException`). `credential` é obrigatória em BASIC e JWT; senão `400 Validation.Field.Required`. Pode haver mais de um webhook por tipo.
- `update` troca `type`, `url` e `status`, mas não a autenticação. Para trocá-la, exclua e cadastre outro (e guarde o novo segredo). Erros: `404 Webhook.Registration.NotFound`, `409 Organization.Webhook.ConcurrencyConflict` (tente de novo).
- A listagem não devolve credencial nem segredo.
