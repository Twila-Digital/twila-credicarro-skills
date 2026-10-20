# Webhooks (Node.js)

A Credicarro avisa seu sistema a cada mudança de status, etapa ou documento da proposta. Você cadastra a URL por `client.webhooks` e valida cada entrega pelo header `X-CrediCarro-Signature` com as funções de webhook do SDK. Para o significado dos códigos do payload, veja [Etapas e status da proposta](../proposal-steps.md). Só o tipo Proposal envia eventos hoje.

## Tipos

```typescript
import {
  WebhookType, WebhookAuthenticationType, WebhookStatus,
  type Webhook, type CreateWebhookRequest, type CreateWebhookResult, type UpdateWebhookRequest,
  type ProposalWebhookEvent, type WebhookVerificationOptions,
} from '@twila/credicarro';

enum WebhookType { Customer = 1, Simulation = 2, Proposal = 3, Unknown = -1 }
enum WebhookAuthenticationType { None = 1, Basic = 2, Jwt = 3, Unknown = -1 }
enum WebhookStatus { Active = 1, Inactive = 2, Unknown = -1 }

interface CreateWebhookRequest {
  type: WebhookType;
  url: string;                                   // HTTPS pública, até 2048 caracteres
  authenticationType: WebhookAuthenticationType;
  credential?: string;                           // Basic: Base64 de "usuario:senha"; Jwt: o token
}
interface CreateWebhookResult { webhookId: string; signingSecret: string }   // o segredo só vem aqui
interface UpdateWebhookRequest { type: WebhookType; url: string; status?: WebhookStatus }
interface Webhook { id: string; type: WebhookType; url: string; authenticationType: WebhookAuthenticationType; status: WebhookStatus }

interface ProposalWebhookEvent {
  proposalId: string;
  status: ProposalStatus; statusRaw: number; statusName: string;   // aceita nomes em português (v2) e inglês (v1)
  eventReason?: ProposalEventReason; eventReasonRaw?: string;      // StatusChanged | StepsChanged | DocumentsChanged
  refusalReason?: string; eventDate?: string;
  buyer?: ProposalParticipantState; seller?: ProposalParticipantState; store?: ProposalParticipantState;
  isDetailed: boolean;                                              // true no payload v2 (retrato completo)
}
interface WebhookVerificationOptions { toleranceMs?: number; nowMs?: number }   // padrão: 5 min e Date.now(); toleranceMs finito e >= 0, senão RangeError
```

Payload v1: só `id_proposta`, `enum_status` e `status`. Payload v2: acrescenta `motivo_evento`, `motivo_recusa`, `data_evento`, `comprador`, `loja` e `vendedor` (hoje sempre `null`).

## Interface

```typescript
interface WebhooksClient {   // client.webhooks
  create(request: CreateWebhookRequest): Promise<CreateWebhookResult>;   // POST v1/webhook -> 201
  list(request?: ListRequest): Promise<PagedResult<Webhook>>;            // GET v1/webhook
  update(webhookId: string, request: UpdateWebhookRequest): Promise<void>;  // PUT v1/webhook/{id} -> 204
  delete(webhookId: string): Promise<void>;                              // DELETE v1/webhook/{id} -> 204
}

// Funções do SDK (também agrupadas em CredicarroWebhookEvent: parse, parseUnverified, verifySignature, verifyAuthorization)
parseWebhookEvent(rawBody: string | Uint8Array, signatureHeader: string, signingSecret: string, options?: WebhookVerificationOptions): ProposalWebhookEvent;  // verifica; header e segredo obrigatórios
parseWebhookEventUnverified(rawBody: string | Uint8Array): ProposalWebhookEvent;  // SEM verificar: só para testes; nunca em endpoint público
verifyWebhookSignature(rawBody: string | Uint8Array, signatureHeader: string, signingSecret: string, options?: WebhookVerificationOptions): boolean;
verifyWebhookAuthorization(receivedHeader: string | undefined, expectedHeader: string | undefined): boolean;  // tempo constante
computeWebhookSignature(signingSecret: string, timestamp: number | string, rawBody: string | Uint8Array): string;
getPendingActions(event: ProposalWebhookEvent): PendingAction[];
```

## Features

- **Cadastro:** `create` devolve `signingSecret` **uma única vez**. Grave-o no cofre de segredos antes de qualquer outra coisa. O SDK não repete `create`; se der timeout, liste os webhooks antes de cadastrar de novo.
- **Assinatura:** `X-CrediCarro-Signature: t={1 a 10 dígitos},v1={hex}`. É o HMAC-SHA256 de `"{t}.{corpo bruto}"` com o segredo em UTF-8, em hex minúsculo, comparado em tempo constante, com tolerância de 5 minutos nos dois sentidos. O SDK faz tudo isso; passe o **corpo bruto** (`Buffer`) e o header.
- **`parseWebhookEvent(raw, header, secret)`** verifica e só então lê o corpo (v1 ou v2). Assinatura inválida, segredo vazio ou timestamp fora da janela lançam `CredicarroWebhookSignatureError`; o mesmo erro sai se o corpo não for JSON ou não trouxer `id_proposta`. Header ou segredo ausente/vazio também lançam esse erro: a verificação nunca é pulada. `t` ou `v1` repetidos no header invalidam a assinatura, e o corpo precisa trazer um `id_proposta` UUID. Para ler sem verificar (só testes; **nunca em endpoint público**), use `parseWebhookEventUnverified(raw)`.
- **`verifyWebhookSignature`** devolve `boolean` e permite separar `401` (assinatura) de `400` (corpo ilegível com assinatura válida).
- **`verifyWebhookAuthorization(recebido, esperado)`** confere o header `Authorization` do cadastro (Basic ou Jwt) em tempo constante.
- **`getPendingActions(evento)`** funciona com o evento v2 (`isDetailed`). Mesmo assim, o worker deve consultar `client.proposals.get` para o estado mais recente.
- **Endpoint seguro** (Express): `express.raw({ type: '*/*', limit: '1mb' })` e `Buffer.isBuffer(req.body)`; nunca `express.json()` nesta rota. O limite de 1 MiB barra corpo gigante com `413`.
- **Ordem do endpoint:** corpo é `Buffer`? → `Authorization` → assinatura → leitura do corpo (`400` se ilegível) → deduplicação → **enfileirar** → só então `2xx`.
- **Variáveis:** `CREDICARRO_WEBHOOK_SECRET` obrigatória (sem ela a aplicação não sobe) e `CREDICARRO_WEBHOOK_AUTHORIZATION` com o valor completo esperado do header (`Basic ...` ou `Bearer ...`) quando o webhook usa autenticação 2 ou 3.

## Exemplo
(Fonte: `examples/node/webhooks.ts`)

```typescript
const result = await client.webhooks.create({
  type: WebhookType.Proposal,
  url: 'https://parceiro.com.br/webhooks/credicarro',
  authenticationType: WebhookAuthenticationType.Basic,
  credential: Buffer.from('usuario:senha').toString('base64'),
});
await saveToSecretsManager(result.signingSecret);   // só vem agora

app.post('/webhooks/credicarro', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  if (!Buffer.isBuffer(req.body)) return void res.sendStatus(401);
  if (expectedAuthorization && !verifyWebhookAuthorization(req.header('Authorization'), expectedAuthorization)) return void res.sendStatus(401);
  const signature = req.header('X-CrediCarro-Signature') ?? '';
  if (!verifyWebhookSignature(req.body, signature, signingSecret)) return void res.sendStatus(401);

  const evento = parseWebhookEvent(req.body, signature, signingSecret);   // verifica de novo; 400 se CredicarroWebhookSignatureError (corpo ilegível)
  // deduplica por Idempotency-Key (atômico), enfileira evento.proposalId; se falhar: desfaz a deduplicação e 503
  res.sendStatus(200);
});
```

**Vetor de teste:** segredo `segredo-de-exemplo`, `t=1715792400` e corpo `{"id_proposta":"bea8d060-f93d-48eb-b6c4-45f64483cdd9","enum_status":2,"status":"Approved"}` resultam em `v1=db66c554eb116ef2577deb63f72619793502a31520f622b2d59864b074eb8df2`. Rode com `{ nowMs: 1715792400 * 1000 }`, senão a tolerância rejeita a data antiga. O exemplo traz `checkDocumentationVector()`, que devolve `true`.

## Erros e casos de borda

- **Segredo obrigatório:** `CREDICARRO_WEBHOOK_SECRET` ausente ou vazio derruba a inicialização. HMAC com chave vazia é forjável; as funções do SDK tratam segredo vazio como inválido.
- Assinatura inválida, corpo que não é `Buffer` (POST sem corpo) ou `Authorization` diferente: responda `401`. JSON inesperado, ou `id_proposta` que não seja UUID, com assinatura válida: `400` (repetir não adianta).
- Corpo acima de 1 MiB: `413`. O handler de erro do Express não deve vazar detalhes. O exemplo usa handler `async`, que o Express 5 encaminha ao handler de erro; no Express 4, envolva o corpo em `try/catch`.
- **Enfileirar antes de responder:** valide, enfileire e só então responda `2xx` (limite de 15 s por entrega). Se enfileirar falhar, **desfaça a marca de deduplicação** e responda `503`; a Credicarro repete a entrega.
- **O worker registra a falha de cada job**, só com o id da proposta e o tipo do erro (`error.name`/`describeError`). Sem isso, a falha some.
- A fila em memória do exemplo **deve virar fila durável** em produção (SQS, RabbitMQ, outbox); um reinício perderia os eventos.
- **Deduplicação:** use o header `Idempotency-Key` (`{id_mensagem}:{id_webhook}`) em armazenamento compartilhado e atômico (Redis `SET chave 1 NX EX <ttl>`), não em memória. A checagem e a marcação são uma operação só.
- Entregas chegam fora de ordem e repetidas: consulte `client.proposals.get(proposalId)` para o estado mais recente.
- Retentativas da Credicarro: `408`, `425`, `429`, `5xx`, rede e timeout, até 3 novas tentativas (cerca de 1 s, 5 s e 30 s). Outros `4xx` e `3xx` não são repetidos; reconcile consultando a proposta.
- Não registre o corpo do webhook, o header `Authorization` nem a assinatura; logue só `proposalId` e o tipo do erro.
- Para trocar a autenticação de um webhook, exclua-o e cadastre outro (`update` não altera a autenticação, e o novo cadastro traz novo `signingSecret`).
- Erros do cadastro: `422 Organization.Webhook.InvalidEndpoint` (URL precisa ser HTTPS pública), `404 Webhook.Registration.NotFound`, `409 Organization.Webhook.ConcurrencyConflict` (tente de novo).
- Staging e produção têm webhooks e segredos separados.
