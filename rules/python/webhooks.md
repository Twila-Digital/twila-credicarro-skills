# Webhooks (Python)

A Credicarro avisa seu sistema a cada mudança de status, etapa ou documento da proposta. Você cadastra a URL por `client.webhooks` e valida cada entrega pelo header `X-CrediCarro-Signature` com as funções de webhook do SDK. Para o significado dos códigos do payload, veja [Etapas e status da proposta](../proposal-steps.md). Só o tipo Proposal envia eventos hoje.

## Tipos

```python
from twila_credicarro import (
    WebhookType, WebhookAuthenticationType, WebhookStatus,
    Webhook, CreateWebhookRequest, CreateWebhookResult, UpdateWebhookRequest, ProposalWebhookEvent,
    CredicarroWebhookSignatureError, DEFAULT_SIGNATURE_TOLERANCE,
)

class WebhookType(IntEnum): CUSTOMER = 1; SIMULATION = 2; PROPOSAL = 3; UNKNOWN = -1
class WebhookAuthenticationType(IntEnum): NONE = 1; BASIC = 2; JWT = 3; UNKNOWN = -1
class WebhookStatus(IntEnum): ACTIVE = 1; INACTIVE = 2; UNKNOWN = -1

@dataclass(frozen=True)
class CreateWebhookRequest:
    type: WebhookType
    url: str                                   # HTTPS pública, até 2048 caracteres
    authentication_type: WebhookAuthenticationType
    credential: Optional[str] = None           # Basic: Base64 de "usuario:senha"; Jwt: o token
@dataclass(frozen=True)
class CreateWebhookResult: webhook_id: str; signing_secret: str      # o segredo só vem aqui; fora do repr
@dataclass(frozen=True)
class UpdateWebhookRequest: type: WebhookType; url: str; status: Optional[WebhookStatus] = None
@dataclass(frozen=True)
class Webhook: id: str; type: WebhookType; url: str; authentication_type: WebhookAuthenticationType; status: WebhookStatus

@dataclass(frozen=True)
class ProposalWebhookEvent:
    proposal_id: str
    status: ProposalStatus                     # aceita nomes em português (v2) e inglês (v1)
    status_raw: Optional[int] = None; status_name: Optional[str] = None
    event_reason: Optional[ProposalEventReason] = None; event_reason_raw: Optional[str] = None   # STATUS_CHANGED | STEPS_CHANGED | DOCUMENTS_CHANGED
    refusal_reason: Optional[str] = None; event_date: Optional[datetime] = None
    buyer: Optional[ProposalParticipantState] = None; seller: ...; store: ...
    is_detailed: bool = False                  # True no payload v2 (retrato completo)
```

Payload v1: só `id_proposta`, `enum_status` e `status`. Payload v2: acrescenta `motivo_evento`, `motivo_recusa`, `data_evento`, `comprador`, `loja` e `vendedor` (hoje sempre `null`).

## Interface

```python
class WebhooksClient:   # client.webhooks
    def create(self, request: CreateWebhookRequest) -> CreateWebhookResult: ...                     # POST v1/webhook -> 201
    def list(self, request: Optional[ListRequest] = None) -> PagedResult[Webhook]: ...               # GET v1/webhook
    def update(self, webhook_id: Identifier, request: UpdateWebhookRequest) -> None: ...             # PUT v1/webhook/{id} -> 204
    def delete(self, webhook_id: Identifier) -> None: ...                                            # DELETE v1/webhook/{id} -> 204

# Funções do SDK (módulo twila_credicarro)
parse_webhook_event(raw_body: Union[str, bytes], signature_header: Optional[str], signing_secret: Optional[str],
                    tolerance: timedelta = DEFAULT_SIGNATURE_TOLERANCE, now: Optional[datetime] = None) -> ProposalWebhookEvent
verify_webhook_signature(raw_body, signature_header, signing_secret, tolerance=..., now=None) -> bool
verify_webhook_authorization(received_header: Optional[str], expected_header: Optional[str]) -> bool   # hmac.compare_digest
compute_webhook_signature(signing_secret: str, timestamp: Union[int, str], payload: Union[str, bytes]) -> str
parse_webhook_payload(raw_body) -> ProposalWebhookEvent        # SEM verificar a assinatura: só em testes
```

## Features

- **Cadastro:** `create` devolve `signing_secret` **uma única vez**. Grave-o no cofre de segredos antes de qualquer outra coisa. O SDK não repete `create`; se der timeout, liste os webhooks antes de cadastrar de novo.
- **Assinatura:** `X-CrediCarro-Signature: t={1 a 10 dígitos},v1={hex}`. É o HMAC-SHA256 de `"{t}.{corpo bruto}"` com o segredo em UTF-8, em hex minúsculo, comparado em tempo constante, com tolerância de 5 minutos nos dois sentidos. O SDK faz tudo isso; passe o **corpo bruto** (`bytes`) e o header.
- **`parse_webhook_event(raw, header, secret)`** verifica e só então lê o corpo (v1 ou v2). Assinatura inválida, segredo vazio ou timestamp fora da janela lançam `CredicarroWebhookSignatureError`; o mesmo erro sai se o corpo não for JSON ou não trouxer `id_proposta`. `parse_webhook_payload(raw)` lê sem verificar e **só serve para testes**.
- **`verify_webhook_signature`** devolve `bool` e permite separar `401` (assinatura) de `400` (corpo ilegível com assinatura válida).
- **`verify_webhook_authorization(recebido, esperado)`** confere o header `Authorization` do cadastro (Basic ou Jwt) em tempo constante.
- `event.get_pending_actions()` lista as ações do integrador no payload v2 (`is_detailed`). O payload v1 não traz participantes (lista vazia): nesse caso, e sempre que precisar do estado mais recente, consulte `client.proposals.get(event.proposal_id)` e use `proposal.get_pending_actions()`.
- **Endpoint seguro** (Flask): `request.get_data()` (bytes brutos) antes de qualquer `get_json()`, e `app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024` para barrar corpo gigante com `413`.
- **Ordem do endpoint:** `Authorization` → assinatura → leitura do corpo (`400` se ilegível) → deduplicação → **enfileirar** → só então `2xx`.
- **Variáveis:** `CREDICARRO_WEBHOOK_SECRET` obrigatória (sem ela a aplicação não sobe) e `CREDICARRO_WEBHOOK_AUTHORIZATION` com o valor completo esperado do header (`Basic ...` ou `Bearer ...`) quando o webhook usa autenticação 2 ou 3.

## Exemplo
(Fonte: `examples/python/webhooks.py`)

```python
result = client.webhooks.create(
    CreateWebhookRequest(
        type=WebhookType.PROPOSAL,
        url="https://parceiro.com.br/webhooks/credicarro",
        authentication_type=WebhookAuthenticationType.BASIC,
        credential=base64.b64encode(b"usuario:senha").decode("ascii"),
    )
)
save_to_secrets_manager(result.signing_secret)   # só vem agora

app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024

@app.post("/webhooks/credicarro")
def credicarro_webhook():
    raw = request.get_data()                      # corpo bruto
    signature = request.headers.get("X-CrediCarro-Signature", "")
    if EXPECTED_AUTHORIZATION and not verify_webhook_authorization(request.headers.get("Authorization"), EXPECTED_AUTHORIZATION):
        return Response(status=401)
    if not verify_webhook_signature(raw, signature, SIGNING_SECRET):
        return Response(status=401)
    event = parse_webhook_event(raw, signature, SIGNING_SECRET)   # 400 se CredicarroWebhookSignatureError
    # deduplica por Idempotency-Key (atômico), enfileira event.proposal_id; se falhar: desfaz a deduplicação e 503
    return Response(status=200)
```

**Vetor de teste:** segredo `segredo-de-exemplo`, `t=1715792400` e corpo `{"id_proposta":"bea8d060-f93d-48eb-b6c4-45f64483cdd9","enum_status":2,"status":"Approved"}` resultam em `v1=db66c554eb116ef2577deb63f72619793502a31520f622b2d59864b074eb8df2`. Rode com `now=datetime.fromtimestamp(1715792400, tz=timezone.utc)`, senão a tolerância rejeita a data antiga. O exemplo traz `check_documentation_vector()`, que devolve `True`.

## Erros e casos de borda

- **Segredo obrigatório:** `CREDICARRO_WEBHOOK_SECRET` ausente ou vazio derruba a inicialização. HMAC com chave vazia é forjável; as funções do SDK tratam segredo vazio como inválido.
- Assinatura inválida ou `Authorization` diferente: responda `401`. JSON inesperado, ou `id_proposta` que não seja UUID (o SDK já recusa), com assinatura válida: `400` (repetir não adianta). Cabeçalho com `t` ou `v1` repetidos é inválido; `tolerance` precisa ser `timedelta` ≥ 0.
- Corpo acima de 1 MiB: `413` (Flask, por `MAX_CONTENT_LENGTH`), sem detalhes na resposta.
- **Enfileirar antes de responder:** valide, enfileire e só então responda `2xx` (limite de 15 s por entrega). Se enfileirar falhar, **desfaça a marca de deduplicação** e responda `503`; a Credicarro repete a entrega.
- **O worker registra a falha de cada job** (`future.add_done_callback`), só com o id da proposta e o tipo do erro. Sem o callback, o executor engole a exceção.
- O `ThreadPoolExecutor` do exemplo **deve virar fila durável** em produção (SQS, RabbitMQ, Celery com broker, outbox); um reinício perderia os eventos.
- **Deduplicação:** use o header `Idempotency-Key` (`{id_mensagem}:{id_webhook}`) em armazenamento compartilhado e atômico (Redis `SET chave 1 NX EX <ttl>`), não em `set` na memória. Em memória, checar e marcar acontecem sob um `threading.Lock` (o Flask atende em várias threads), e o desfazer em falha também.
- `event.get_pending_actions()` lista as ações do integrador no payload v2; o payload v1 não traz participantes (lista vazia): consulte a proposta.
- `verify_webhook_authorization` compara o SHA-256 dos dois valores em tempo constante; esperado vazio nunca é aceito.
- Entregas chegam fora de ordem e repetidas: consulte `client.proposals.get(proposal_id)` para o estado mais recente.
- Retentativas da Credicarro: `408`, `425`, `429`, `5xx`, rede e timeout, até 3 novas tentativas (cerca de 1 s, 5 s e 30 s). Outros `4xx` e `3xx` não são repetidos; reconcile consultando a proposta.
- Não registre o corpo do webhook, o header `Authorization` nem a assinatura; logue só `proposal_id` e o tipo do erro.
- Para trocar a autenticação de um webhook, exclua-o e cadastre outro (`update` não altera a autenticação, e o novo cadastro traz novo `signing_secret`).
- Erros do cadastro: `422 Organization.Webhook.InvalidEndpoint` (URL precisa ser HTTPS pública), `404 Webhook.Registration.NotFound`, `409 Organization.Webhook.ConcurrencyConflict` (tente de novo).
- Staging e produção têm webhooks e segredos separados.
