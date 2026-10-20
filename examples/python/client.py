from __future__ import annotations

import atexit
import os
from typing import Callable, TypeVar

from twila_credicarro import (
    CreateProposalRequest,
    CredicarroApiError,
    CredicarroAuthenticationError,
    CredicarroBusinessRuleError,
    CredicarroClient,
    CredicarroClientOptions,
    CredicarroEnvironment,
    CredicarroRateLimitError,
    CredicarroTimeoutError,
    CredicarroValidationError,
    ListRequest,
    PagedResult,
)

T = TypeVar("T")


def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} é obrigatória")
    return value


def _build_client() -> CredicarroClient:
    client_id = _require_env("CREDICARRO_CLIENT_ID")
    client_secret = _require_env("CREDICARRO_CLIENT_SECRET")
    base_url = os.environ.get("CREDICARRO_BASE_URL")

    # Sem base_url nem environment, o padrão do SDK é PRODUÇÃO. Os exemplos usam staging, a menos que
    # CREDICARRO_BASE_URL (https) diga o contrário.
    if base_url:
        return CredicarroClient(
            CredicarroClientOptions(client_id=client_id, client_secret=client_secret, base_url=base_url)
        )

    # Os padrões de resiliência já são bons (30 s no total, 10 s por tentativa, 3 tentativas, circuit breaker).
    # Só ajuste com motivo: CredicarroClientOptions(..., resilience=CredicarroResilienceOptions(max_retry_attempts=4)).
    return CredicarroClient(
        CredicarroClientOptions(
            client_id=client_id, client_secret=client_secret, environment=CredicarroEnvironment.STAGING
        )
    )


# Cliente único (singleton) da aplicação: guarda o token em cache e o estado do circuit breaker, e é thread-safe.
# Importe sempre este objeto; nunca crie um CredicarroClient por requisição.
client = _build_client()
atexit.register(client.close)  # libera o pool de conexões do httpx no encerramento


def describe_error(error: BaseException) -> str:
    """Texto seguro para log: só tipo do erro, status e código estável. Nunca `detail`, `raw_body`, CPF ou segredo."""
    if isinstance(error, CredicarroRateLimitError):
        return f"{type(error).__name__} | Status: 429 | EsperaMs: {error.retry_after_ms}"
    if isinstance(error, CredicarroApiError):
        return f"{type(error).__name__} | Status: {error.status_code} | Codigo: {error.error_code}"
    return type(error).__name__


def create_proposal_or_explain(cpf: str, simulation_id: str) -> str | None:
    """Trata os erros pela classe e pelo `error_code` estável (nunca pelo texto de `detail`)."""
    try:
        return client.proposals.create(CreateProposalRequest(cpf=cpf, simulation_id=simulation_id))
    except CredicarroBusinessRuleError as error:
        if error.error_code == "Proposal.SimulationAlreadyExpired":
            return None  # simule de novo
        raise
    except CredicarroValidationError as error:
        print(f"dados inválidos | Campo: {error.field} | Codigo: {error.error_code}")
        raise
    except (CredicarroTimeoutError, CredicarroAuthenticationError) as error:
        # timeout (de tentativa, total ou circuit breaker aberto) e falha de credencial: não repita num laço seu
        print(describe_error(error))
        raise


def collect_all(fetch_page: Callable[[ListRequest], PagedResult[T]], page_size: int = 100) -> list[T]:
    """Sem auto-paginação: você avança as páginas. Use `has_next`, não "até vir página vazia"."""
    items: list[T] = []
    page = 1
    while True:
        result = fetch_page(ListRequest(page=page, page_size=page_size))
        items.extend(result.items)
        if not result.has_next:
            return items
        page += 1


# Exemplo: propostas = collect_all(client.proposals.list)
