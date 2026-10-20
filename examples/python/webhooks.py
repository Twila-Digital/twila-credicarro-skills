from __future__ import annotations

import os
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timezone
from functools import partial
from typing import Callable

from flask import Flask, Response, request  # pip install flask
from twila_credicarro import (
    CreateWebhookRequest,
    CredicarroWebhookSignatureError,
    ListRequest,
    PagedResult,
    UpdateWebhookRequest,
    Webhook,
    WebhookAuthenticationType,
    WebhookStatus,
    WebhookType,
    parse_webhook_event,
    verify_webhook_authorization,
    verify_webhook_signature,
)

from client import client, describe_error

# --- Cadastro e manutenção ---------------------------------------------------------------------------------


def register_proposal_webhook(
    url: str, save_secret: Callable[[str], None], basic_credential_base64: str | None = None
) -> str:
    """Cadastra o webhook de proposta. O `signing_secret` só vem nesta resposta: `save_secret` deve gravá-lo no cofre
    de segredos ANTES de qualquer outra coisa. A rota não é repetida pelo SDK; se der timeout, liste antes de cadastrar
    de novo."""
    result = client.webhooks.create(
        CreateWebhookRequest(
            type=WebhookType.PROPOSAL,
            url=url,  # HTTPS pública; localhost e IP privado são recusados
            authentication_type=(
                WebhookAuthenticationType.BASIC if basic_credential_base64 else WebhookAuthenticationType.NONE
            ),
            credential=basic_credential_base64,  # Base64 de "usuario:senha" (Basic) ou o token (Jwt)
        )
    )

    save_secret(result.signing_secret)
    return result.webhook_id


def list_webhooks() -> PagedResult[Webhook]:
    return client.webhooks.list(ListRequest(page=1, page_size=20))  # id, type, url, authentication_type, status


def deactivate_webhook(webhook_id: str, url: str) -> None:
    client.webhooks.update(
        webhook_id, UpdateWebhookRequest(type=WebhookType.PROPOSAL, url=url, status=WebhookStatus.INACTIVE)
    )


def delete_webhook(webhook_id: str) -> None:
    client.webhooks.delete(webhook_id)


# --- Vetor de teste da documentação ------------------------------------------------------------------------


def check_documentation_vector() -> bool:
    """Deve devolver True. `now` fixa o relógio em `t`; sem isso a tolerância de 5 min rejeitaria a data antiga."""
    body = '{"id_proposta":"bea8d060-f93d-48eb-b6c4-45f64483cdd9","enum_status":2,"status":"Approved"}'
    header = "t=1715792400,v1=db66c554eb116ef2577deb63f72619793502a31520f622b2d59864b074eb8df2"
    return verify_webhook_signature(
        body, header, "segredo-de-exemplo", now=datetime.fromtimestamp(1715792400, tz=timezone.utc)
    )


# --- Endpoint de recebimento -------------------------------------------------------------------------------

# Obrigatório: sem segredo a aplicação não sobe (HMAC com chave vazia é forjável).
SIGNING_SECRET = os.environ.get("CREDICARRO_WEBHOOK_SECRET")
if not SIGNING_SECRET:
    raise RuntimeError("CREDICARRO_WEBHOOK_SECRET é obrigatória")
# Valor completo esperado do header Authorization ("Basic ..." ou "Bearer ..."); defina se o webhook usa Basic/Jwt.
EXPECTED_AUTHORIZATION = os.environ.get("CREDICARRO_WEBHOOK_AUTHORIZATION")


class MemoryDedupStore:
    """Deduplicação atômica. Em produção: Redis `SET chave 1 NX EX <ttl>` (claim) e `DEL chave` (release)."""

    def __init__(self) -> None:
        self._seen: set[str] = set()
        self._lock = threading.Lock()  # o Flask atende em várias threads

    def claim(self, key: str) -> bool:
        """True = primeira vez; False = já visto. Checar e marcar acontecem sob a mesma trava."""
        with self._lock:
            if key in self._seen:
                return False
            self._seen.add(key)
            return True

    def release(self, key: str) -> None:
        """Desfaz o claim quando não deu para enfileirar."""
        with self._lock:
            self._seen.discard(key)


def process_proposal(proposal_id: str) -> None:
    # Entregas chegam fora de ordem: consulte a proposta para o estado mais recente.
    proposal = client.proposals.get(proposal_id)
    actions = proposal.get_pending_actions()
    print(f"proposta {proposal.id}: status {proposal.status_name} | ações pendentes: {len(actions)}")


def _log_failure(proposal_id: str, future: Future[None]) -> None:
    error = future.exception()
    if error is not None:  # sem PII: só o id da proposta e o tipo do erro; sem isto o executor engole a exceção
        print(f"falha ao processar webhook | Proposta: {proposal_id} | {describe_error(error)}")


dedup = MemoryDedupStore()
# Fila em memória só para o exemplo: em produção use fila durável (SQS, RabbitMQ, Celery com broker, tabela outbox).
executor = ThreadPoolExecutor(max_workers=4)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024  # 1 MiB: corpo maior vira 413 sem ser lido


@app.errorhandler(413)
def payload_too_large(_error: Exception) -> Response:
    return Response(status=413)


@app.post("/webhooks/credicarro")
def credicarro_webhook() -> Response:
    raw = request.get_data()  # corpo bruto, antes de qualquer parse (nunca request.get_json() aqui)
    signature = request.headers.get("X-CrediCarro-Signature", "")

    if EXPECTED_AUTHORIZATION and not verify_webhook_authorization(
        request.headers.get("Authorization"), EXPECTED_AUTHORIZATION
    ):
        return Response(status=401)

    if not verify_webhook_signature(raw, signature, SIGNING_SECRET):
        return Response(status=401)

    try:
        # A assinatura já passou; aqui só falta ler o corpo (v1 ou v2). Falha de leitura: 400, repetir não adianta.
        # O SDK exige header e segredo, rejeita t/v1 repetidos e id_proposta que não seja UUID.
        event = parse_webhook_event(raw, signature, SIGNING_SECRET)
    except CredicarroWebhookSignatureError:
        return Response(status=400)

    idempotency_key = request.headers.get("Idempotency-Key", "")  # {id_mensagem}:{id_webhook}
    if idempotency_key and not dedup.claim(idempotency_key):
        return Response(status=200)  # entrega repetida: já foi aceita

    try:
        future = executor.submit(process_proposal, event.proposal_id)  # só responde 2xx depois de enfileirar
        future.add_done_callback(partial(_log_failure, event.proposal_id))
    except RuntimeError:
        if idempotency_key:
            dedup.release(idempotency_key)
        return Response(status=503)  # a Credicarro repete a entrega

    return Response(status=200)  # responda 2xx rápido (limite de 15 s)
