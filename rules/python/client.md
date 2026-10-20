# Cliente (Python)

O SDK oficial `twila-credicarro` (módulo `twila_credicarro`) cuida de autenticação, cache de token, JSON, `Idempotency-Key`, retentativa, circuit breaker e erros tipados. Você usa `CredicarroClient` e os clientes por recurso (`customers`, `simulations`, `proposals`, `webhooks`, `v1`). Não escreva chamadas HTTP à mão.

## Instalação

```bash
pip install twila-credicarro
```

- Python 3.9 ou superior.
- Cliente **síncrono**, baseado em [httpx](https://www.python-httpx.org/), tipado (`py.typed`, PEP 561) e thread-safe.
- Uso **só server-side**: o `client_secret` nunca vai para navegador, app mobile ou SPA.

## Tipos

```python
from twila_credicarro import (
    CredicarroClient, CredicarroClientOptions, CredicarroEnvironment, CredicarroResilienceOptions,
    ListRequest, PagedResult,
)

@dataclass(frozen=True)
class CredicarroClientOptions:
    client_id: str
    client_secret: str                               # nunca aparece em repr, log ou erro
    environment: CredicarroEnvironment = CredicarroEnvironment.PRODUCTION   # STAGING | PRODUCTION
    base_url: Optional[str] = None                   # sobrescreve o ambiente; precisa ser https
    resilience: CredicarroResilienceOptions = DEFAULT_RESILIENCE_OPTIONS

@dataclass(frozen=True)
class PagedResult(Generic[T]):
    items: list[T]; has_next: bool; has_previous: bool; page: int; page_size: int; total_count: int

@dataclass(frozen=True)
class ListRequest:
    page: int = 1; page_size: int = 10               # page >= 1; page_size de 1 a 100 (ValueError fora disso)
```

## Interface

```python
class CredicarroClient:
    def __init__(self, options: CredicarroClientOptions) -> None: ...
    customers: CustomersClient
    simulations: SimulationsClient
    proposals: ProposalsClient
    webhooks: WebhooksClient
    v1: V1Client            # rotas v1 sem cnpjLoja: v1.simulations e v1.proposals
    def close(self) -> None: ...
    # context manager: with CredicarroClient(options) as client: ...
```

## Features

- **Ambientes:** `CredicarroEnvironment.STAGING` → `https://api.staging.credicarro.com.br/integration/`; `PRODUCTION` → `https://api.credicarro.com.br/integration/`. **Sem `environment` nem `base_url`, o SDK usa Produção.** Nos testes, passe `STAGING` de forma explícita.
- **`base_url`:** só `https` (`http` apenas para `localhost` e `127.0.0.1`). Configuração inválida lança `CredicarroConfigurationError` já no `CredicarroClient(...)`; `client_id` e `client_secret` vazios também.
- **Singleton:** crie **um** cliente por processo (módulo ou app factory) e reutilize. Ele guarda o token em cache (renovado antes de `expira_em`, com uma única renovação mesmo sob concorrência) e o estado do circuit breaker, e mantém o pool de conexões do httpx. Um cliente por requisição joga tudo isso fora. Chame `client.close()` no encerramento (ou use `with`).
- **Token:** o SDK gera e renova sozinho (cache até `expira_em`; sem ele, `agora + max(expira_em_segundos / 2, expira_em_segundos − 60)`). A geração do token também tem retentativa. Num `401` de rota autenticada ele renova e repete **uma** vez. Credencial errada ou `401` persistente vira `CredicarroAuthenticationError`; falha de rede ou timeout ao gerar o token vira `CredicarroTimeoutError`.
- **Resiliência** (`CredicarroResilienceOptions`, todos opcionais): `total_timeout_ms` 30 000, `attempt_timeout_ms` 10 000, `document_upload_attempt_timeout_ms` 60 000, `max_retry_attempts` 3, `retry_base_delay_ms` 500 (backoff exponencial com jitter), circuit breaker (`circuit_breaker_failure_ratio` 0,5, `circuit_breaker_sampling_duration_ms` 30 000, `circuit_breaker_minimum_throughput` 10, `circuit_breaker_break_duration_ms` 15 000), `retry_on_500` (padrão `True`) e `disable_automatic_idempotency_key`.
- **O que é repetido:** só o que é seguro repetir: `GET`; gerar token; `POST` com `Idempotency-Key`; `POST v2/proposal/{id}/vehicle-detail` e `deposit-account` (substituem o enviado); `PUT` e `DELETE v1/webhook/{id}`. **Não** são repetidos `POST v1/webhook` e `POST v1/customer/unified` sem chave.
- **O que dispara nova tentativa:** `408`, `429` (respeita `Retry-After`, em segundos ou data HTTP; valor inválido, ≤ 0 ou não finito é ignorado e o máximo é 24 h), `500` (`retry_on_500`), `502`, `503`, `504`, falha de rede e timeout de tentativa. Nunca outros `4xx`. Se o `Retry-After` for maior que o orçamento restante, o SDK **não espera** e lança logo `CredicarroRateLimitError` com `retry_after_ms`.
- **Orçamento de tempo:** `total_timeout_ms` (30 s) vale para as chamadas em geral; o upload de documento usa `document_upload_attempt_timeout_ms × max_retry_attempts` (padrão 180 s). Toda espera entre tentativas é limitada ao que resta.
- **Redirecionamentos (`3xx`)** não são seguidos (na API e no token): viram `CredicarroApiError`.
- **`Idempotency-Key` automática:** um UUID por chamada lógica, **o mesmo em todas as tentativas**, em `customers.create`, `upsert_address`, `upsert_professional_data`, `simulations.create_financing` e `create_refinancing`, `proposals.create`, `proposals.upload_document` e nas rotas v1 equivalentes. Você não gera nem repete a chave.
- **`customers.upsert` é a exceção:** sem chave, **cria ou atualiza** o cliente (upsert); com chave, **só cria** (CPF existente → `409 Cpf.CpfAlreadyAdded`). Por isso o SDK **nunca** gera a chave nesta rota, e sem chave a chamada **não é repetida** em falha. Veja [customers.md](customers.md).
- **Chave de documento:** `proposals.upload_document` aceita `idempotency_key` opcional. Persista um UUID por envio e reuse-o só no mesmo envio; use chave nova na correção. Veja [proposals.md](proposals.md).
- **`disable_automatic_idempotency_key=True`** desliga a geração automática (menos no envio de documento, onde o header é obrigatório). Sem a chave, essas chamadas deixam de ser repetidas. Só use se tiver motivo.
- **Paginação:** `simulations.list`, `proposals.list` e `webhooks.list` devolvem `PagedResult[T]`. Não há auto-paginação: avance `page` enquanto `has_next`. `ListRequest` com `page < 1` ou `page_size` fora de 1 a 100 lança `ValueError`.
- **Enums:** todo enum (`IntEnum`) tem `UNKNOWN = -1` e os modelos guardam o valor bruto (`status_raw`, `status_name`). Um valor novo da API não quebra o código; compare pelo enum e trate `UNKNOWN`.
- **Valores monetários** vêm como `float`. Para cálculo (somas, comparação exata), use `Decimal` ou centavos inteiros.
- **Datas** vêm como `datetime` (`created_at`).
- **Identificadores** aceitam `str` ou `uuid.UUID`.

### Hierarquia de erros

Tudo estende `CredicarroError`.

| Classe | Quando |
| --- | --- |
| `CredicarroConfigurationError` | Configuração inválida do cliente (credencial vazia, `base_url` sem https, resiliência inconsistente) |
| `CredicarroAuthenticationError` | Falha ao gerar o token (`400`/`401`) ou `401` persistente depois da renovação. Outros status do endpoint de token (`3xx`, `5xx` depois das tentativas) viram `CredicarroApiError`; rede, `CredicarroTimeoutError` |
| `CredicarroApiError` | Qualquer erro da API (`status_code`, `error_code`, `title`, `detail`, `field`, `errors`, `raw_body`) |
| `CredicarroValidationError` | `400` (estende `CredicarroApiError`); use `field` e `errors` |
| `CredicarroBusinessRuleError` | `422` (estende `CredicarroApiError`); trate pelo `error_code` |
| `CredicarroRateLimitError` | `429` (estende `CredicarroApiError`), com `retry_after_ms` |
| `CredicarroTimeoutError` | Timeout (de tentativa ou total), falha de rede (conexão recusada, DNS, reset) ou circuit breaker aberto. A causa é sanitizada: só o nome do tipo do erro, nunca a requisição do httpx |
| `CredicarroWebhookSignatureError` | Assinatura de webhook inválida ou corpo ilegível |

## Exemplo
(Fonte: `examples/python/client.py`)

```python
from twila_credicarro import (
    CreateProposalRequest, CredicarroBusinessRuleError, CredicarroClient, CredicarroClientOptions, CredicarroEnvironment,
)

# Módulo único, importado pelo resto da aplicação.
client = CredicarroClient(
    CredicarroClientOptions(
        client_id=os.environ["CREDICARRO_CLIENT_ID"],
        client_secret=os.environ["CREDICARRO_CLIENT_SECRET"],
        environment=CredicarroEnvironment.STAGING,  # sem isto, o padrão é PRODUCTION
    )
)

try:
    proposal_id = client.proposals.create(CreateProposalRequest(cpf=cpf, simulation_id=simulation_id))
except CredicarroBusinessRuleError as error:
    if error.error_code != "Proposal.SimulationAlreadyExpired":
        raise
    # simule de novo

# Sem auto-paginação: avance a página enquanto has_next.
page = client.proposals.list(ListRequest(page=1, page_size=100))
```

## Erros e casos de borda

- Trate o erro pelo `error_code` (o `tipo` estável da API, ex.: `Cpf.CpfAlreadyAdded`), nunca pelo `detail`, que pode mudar.
- `str(error)` traz só status, `tipo` e título. `detail` e `raw_body` ficam em atributos porque podem ter dados do cliente: **não os coloque em log**.
- `401` chega sem corpo; `500` e alguns `502` podem vir no formato padrão (`type`, `title`, `detail`). O SDK normaliza os dois.
- `errors` só aparece com JSON malformado ou valor de tipo errado.
- Não envolva chamadas do SDK em outro laço de retentativa: o SDK já repete o que é seguro, e duas camadas geram tempestade de requisições numa instabilidade. Veja [segurança](security.md).
- Staging e produção têm credenciais, propostas e webhooks separados. Um token de staging dá `401` em produção.
- `ValueError` (paginação, arquivo de documento, `document_type` `UNKNOWN`, `idempotency_key` fora de 1 a 200 caracteres) é erro de uso e ocorre antes de qualquer chamada de rede.
- O cliente é síncrono: em código `async` (FastAPI, aiohttp), chame o SDK em `asyncio.to_thread(...)` ou numa thread pool, para não bloquear o laço de eventos.
