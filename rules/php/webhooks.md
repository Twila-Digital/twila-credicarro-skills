# Webhooks (PHP)

Webhooks avisam seu sistema, de forma assíncrona, quando uma proposta muda de status, etapa ou documento. Cada webhook ativo do tipo Proposal recebe o retrato da proposta. Para os códigos de status e etapa do payload, leia [Etapas e status da proposta](../proposal-steps.md). `Twila\Credicarro\Webhooks` usa o `CredicarroClient` de [client](client.md).

## Modelos

```php
final class WebhooksClient {                                           // $client->webhooks
    public function create(CreateWebhookRequest $request): CreateWebhookResult;          // POST v1/webhook -> 201
    public function list(?ListRequest $request = null): PagedResult;                     // GET v1/webhook; items: Webhook[]
    public function update(string $webhookId, UpdateWebhookRequest $request): void;      // PUT v1/webhook/{id} -> 204
    public function delete(string $webhookId): void;                                     // DELETE v1/webhook/{id} -> 204
}

final class CreateWebhookRequest {
    public function __construct(
        int $type,                    // WebhookType::PROPOSAL
        string $url,                  // https público
        int $authenticationType,      // WebhookAuthenticationType::NONE | BASIC | JWT
        ?string $credential = null    // obrigatória em BASIC (Base64 de usuario:senha) e JWT
    );
}

final class CreateWebhookResult { public $webhookId; public $signingSecret; } // guarde o segredo: só vem aqui (var_dump/print_r mascaram o valor; serialize e json_encode não)
final class Webhook { public $id; public $type; public $url; public $authenticationType; public $status; } // constantes de WebhookType/WebhookAuthenticationType/WebhookStatus
final class UpdateWebhookRequest { public function __construct(int $type, string $url, ?int $status = null); } // WebhookStatus::ACTIVE | INACTIVE

final class CredicarroWebhookEvent {                                   // Twila\Credicarro\Webhooks
    public static function parse(string $rawBody, string $signatureHeader, string $signingSecret, int $toleranceSeconds = 300): ProposalWebhookEvent; // lança CredicarroWebhookSignatureException
    public static function parseUnverified(string $rawBody): ProposalWebhookEvent;     // SEM verificar a assinatura (testes ou já verificado)
    public static function verifySignature(string $rawBody, string $signatureHeader, string $signingSecret, int $toleranceSeconds = 300, ?int $now = null): bool;
    public static function verifyAuthorization(string $receivedHeader, string $expectedHeader): bool; // tempo constante
}

final class ProposalWebhookEvent {
    public $proposalId;
    public $status; public $statusRaw; public $statusName;     // ProposalStatus::* + código e nome brutos
    public $eventReason; public $eventReasonRaw;               // ProposalEventReason::STATUS_CHANGED | STEPS_CHANGED | DOCUMENTS_CHANGED
    public $refusalReason; public $eventDate;
    public $buyer; public $seller; public $store;              // ?ProposalParticipantState (mesmo tipo de ProposalDetails)
    public $isDetailed;                                        // payload v2
}
```

Constantes: `WebhookType::CUSTOMER = 1`, `SIMULATION = 2`, `PROPOSAL = 3`; `WebhookAuthenticationType::NONE = 1`, `BASIC = 2`, `JWT = 3`; `WebhookStatus::ACTIVE = 1`, `INACTIVE = 2`; todas com `UNKNOWN = -1`.

## Funcionalidades

- **Cadastro**: `create` devolve o `signingSecret` **uma única vez**. Grave-o em um cofre de segredos na hora; no exemplo, `registerProposalWebhook` recebe um callable `$saveSecret($webhookId, $signingSecret)` e devolve só o `webhookId`. A rota não aceita `Idempotency-Key` e o SDK **não repete** `create`: se der timeout, consulte `list()` antes de tentar de novo. `update` e `delete` são repetidos com segurança.
- **Verificação**: `CredicarroWebhookEvent` confere o header `X-CrediCarro-Signature: t={timestamp},v1={assinatura}`: HMAC-SHA256 de `"{t}.{corpo bruto}"`, com o `signingSecret` (texto UTF-8) como chave, hex minúsculo, em comparação de tempo constante (`hash_equals`). A tolerância de replay é de 5 minutos nos dois sentidos (o 4º argumento muda). Segredo vazio é sempre inválido, `t` ou `v1` duplicados no header também, e a tolerância precisa ser ≥ 0. O corpo precisa trazer um `id_proposta` UUID válido. Não reimplemente o HMAC.
- `parse($corpo, $header, $segredo)` verifica e já devolve o evento (lança `CredicarroWebhookSignatureException` em qualquer falha). `verifySignature(...)` devolve `bool` e é a opção do endpoint, que decide o status HTTP. `parseUnverified($corpo)` lê **sem** verificar: só em testes ou depois de verificar.
- `verifyAuthorization($recebido, $esperado)` compara o header `Authorization` configurado no cadastro (Basic ou Bearer) em tempo constante (compara os SHA-256 dos dois valores, então tamanhos diferentes não vazam; esperado vazio nunca é aceito). Com `authenticationType` BASIC ou JWT, defina `CREDICARRO_WEBHOOK_AUTHORIZATION` com o valor completo esperado (`Basic ...` ou `Bearer ...`).
- O evento aceita os payloads v1 (`id_proposta`, `enum_status`, `status` em inglês) e v2 (nomes em português, `motivo_evento`, `comprador`, `loja`, `vendedor`); `$isDetailed` indica o v2.

Vetor de teste da documentação (a verificação do SDK precisa aceitá-lo):

| Item | Valor |
| --- | --- |
| `segredo_assinatura` | `segredo-de-exemplo` |
| `t` | `1715792400` |
| Corpo bruto | `{"id_proposta":"bea8d060-f93d-48eb-b6c4-45f64483cdd9","enum_status":2,"status":"Approved"}` |
| `v1` esperado | `db66c554eb116ef2577deb63f72619793502a31520f622b2d59864b074eb8df2` |

O `t` do vetor é antigo: a tolerância padrão o rejeita. Em teste, passe o relógio: `CredicarroWebhookEvent::verifySignature($corpo, 't=1715792400,v1=db66...8df2', 'segredo-de-exemplo', 300, 1715792400)` devolve `true`.

## Exemplo

(Fonte: `examples/php/webhooks.php`)

```php
$criado = $client->webhooks->create(new CreateWebhookRequest(
    WebhookType::PROPOSAL,
    'https://parceiro.com.br/webhooks/credicarro',
    WebhookAuthenticationType::BASIC,
    getenv('CREDICARRO_WEBHOOK_CREDENTIAL') ?: null // Base64 de usuario:senha, lida de configuração
));
// Guarde $criado->signingSecret em um cofre: ele só aparece nesta resposta.
```

Configuração do endpoint:

- `CREDICARRO_WEBHOOK_SECRET` (obrigatória): o `segredo_assinatura`. `requireWebhookSecret()` falha na inicialização se faltar ou estiver vazia.
- `CREDICARRO_WEBHOOK_AUTHORIZATION` (opcional): valor completo esperado do header `Authorization` (`Basic ...` ou `Bearer ...`). Com BASIC ou JWT, **defina-a**: o endpoint compara com `verifyAuthorization` e responde `401` se for diferente. Em alguns setups PHP-FPM o header chega em `REDIRECT_HTTP_AUTHORIZATION`; o exemplo já tenta os dois.

`handleCredicarroWebhook` rejeita corpo acima de 1 MiB (`413`; confere `CONTENT_LENGTH` e lê no máximo 1 MiB + 1 de `php://input`), confere o `Authorization`, valida a assinatura com `verifySignature` (inválida responde `401`), deduplica pelo header `Idempotency-Key`, enfileira e só então responde `2xx`. Falha ao enfileirar desfaz a deduplicação e responde `503`. `processProposalEvent` roda no worker, consulta a proposta e, em falha, registra só o ID da proposta e o tipo do erro. A fila (`WebhookQueue`) e a deduplicação (`WebhookDeduplicator`) são interfaces que você implementa com Redis, SQS, RabbitMQ ou uma tabela.

## Erros e casos de borda

- **Responda `2xx` rápido**: o limite de cada entrega é 15 s. Respostas `2xx` com corpo de até 1 MiB confirmam o recebimento. Com PHP-FPM, enfileire e devolva a resposta; não processe na requisição.
- Retentativas automáticas (até 3, após cerca de 1 s, 5 s e 30 s) valem para `408`, `425`, `429`, `5xx`, falha de rede e timeout. Outros `4xx` e `3xx` não são repetidos, então nunca responda `401` por engano em um evento legítimo.
- Assinatura inválida: responda `401`, nunca `200`. Cada retentativa é assinada de novo, com novo `t`.
- **Deduplicação**: a chave é o header `Idempotency-Key` (`{id_mensagem}:{id_webhook}`). Retentativas repetem a chave. Rejeite (`400`) chave vazia ou com mais de 200 caracteres. Use Redis ou banco com TTL (APCu é por servidor). Se falhar ao enfileirar, remova a chave e responda `503`.
- **Fora de ordem**: as entregas podem chegar fora de ordem. Ao tratar o evento, **consulte a proposta** (`$client->proposals->get($evento->proposalId)`, `GET v2/proposal/{id}`) para o estado mais recente e use `getPendingActions()` no `ProposalDetails` devolvido (o evento do webhook não tem esse método). Não confie só no payload.
- **Envio de documento em job/worker**: nunca envie documentos (nem chame a API de forma demorada) dentro da requisição web do webhook ou do usuário. O orçamento de um upload chega a 180 s (`documentUploadAttemptTimeoutMs × maxRetryAttempts`) e o backoff usa `usleep`, que bloqueia o processo do PHP-FPM. Enfileire e deixe um worker enviar.
- **Corpo bruto**: passe ao SDK os bytes exatos recebidos (`php://input`), antes de qualquer `json_decode`; reformatar o JSON muda o hash. Não deixe framework ou middleware reescrever o corpo antes da validação. Em Laravel/Symfony, use `$request->getContent()` e valide antes de ler o JSON.
- `php://input` não vem de `$_POST`: com `multipart/form-data` ele fica vazio. O webhook do Credicarro envia JSON.
- `parseUnverified`/`parse` também lançam `CredicarroWebhookSignatureException` se o JSON for ilegível ou não trouxer `id_proposta`. No worker, capture a falha e registre só o ID da proposta e o tipo do erro; a consulta periódica da proposta cobre a lacuna.
- Payload v2: `eventReason` (`STATUS_ALTERADO`, `ETAPAS_ALTERADAS` ou `DOCUMENTOS_ALTERADOS`), `refusalReason` (pode ser `null`), `eventDate` (UTC) e os participantes. O `seller` vem sempre `null` hoje.
- Cadastro: a `url` precisa ser HTTPS pública (sem localhost, IP privado, usuário/senha ou fragmento): `422 Organization.Webhook.InvalidEndpoint` (`CredicarroBusinessRuleException`). `credential` é obrigatória em BASIC e JWT; senão `400 Validation.Field.Required`. Pode haver mais de um webhook por tipo.
- `update` troca `type`, `url` e `status`, mas não a autenticação. Para trocá-la, exclua e cadastre outro (e guarde o novo segredo). Erros: `404 Webhook.Registration.NotFound`, `409 Organization.Webhook.ConcurrencyConflict` (tente de novo).
- A listagem não devolve credencial nem segredo.
