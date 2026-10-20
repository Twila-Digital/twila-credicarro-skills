# Cliente (PHP)

O Credicarro tem SDK oficial em PHP (`twila/credicarro`, namespace `Twila\Credicarro`). **Use o SDK; não escreva HTTP à mão.** Ele cuida do token de acesso, da `Idempotency-Key`, da retentativa, do circuit breaker e dos erros tipados. Todos os módulos usam o mesmo `CredicarroClient`.

## Instalação

```bash
composer require twila/credicarro
```

Requer PHP 7.4 ou superior (testado até 8.5); o HTTP é Guzzle 7 (PSR-18). O SDK não usa `enum` nativo: os "enums" (`ProposalStatus`, `ProposalStep`, `DocumentType`...) são classes com constantes `int` (ou `string`), e valores desconhecidos viram `UNKNOWN` (`-1`). Veja [tools/sdks/php.md](../../tools/sdks/php.md).

## Modelos

```php
final class CredicarroClient {
    public $customers;     // Twila\Credicarro\Customers\CustomersClient
    public $simulations;   // Simulations\SimulationsClient
    public $proposals;     // Proposals\ProposalsClient
    public $webhooks;      // Webhooks\WebhooksClient
    public $v1;            // V1\V1Client: $v1->simulations, $v1->proposals
    public function __construct(ClientOptions $options, ?\GuzzleHttp\ClientInterface $httpClient = null);
}

final class ClientOptions {
    public function __construct(
        string $clientId, string $clientSecret,
        string $environment = Environment::PRODUCTION,   // Environment::STAGING | Environment::PRODUCTION
        ?string $baseUrl = null,                          // sobrescreve a URL; precisa ser https
        ?ResilienceOptions $resilience = null,
        ?\Psr\SimpleCache\CacheInterface $tokenCache = null   // cache PSR-16 opcional para compartilhar o token
    );
    // Sem getter para o clientSecret; getClientId(), getEnvironment(), getBaseUrl(), getResilience(), getTokenCache().
}

final class ResilienceOptions {
    public function __construct(
        int $totalTimeoutMs = 30000, int $attemptTimeoutMs = 10000, int $documentUploadAttemptTimeoutMs = 60000,
        int $maxRetryAttempts = 3, int $retryBaseDelayMs = 500,
        float $circuitBreakerFailureRatio = 0.5, int $circuitBreakerSamplingDurationMs = 30000,
        int $circuitBreakerMinimumThroughput = 10, int $circuitBreakerBreakDurationMs = 15000,
        bool $retryOn500 = true, bool $disableAutomaticIdempotencyKey = false
    );
}

final class ListRequest { public function __construct(int $page = 1, int $pageSize = 10); } // página >= 1, tamanho de 1 a 100
final class PagedResult { public $items; public $hasNext; public $hasPrevious; public $page; public $pageSize; public $totalCount; }
```

Hierarquia de erros (`Twila\Credicarro\Errors`), todas herdam de `CredicarroException` (`\Exception`):

```text
CredicarroException
├── CredicarroConfigurationException     configuração inválida (clientId/clientSecret ausentes, baseUrl sem https, ambiente desconhecido)
├── CredicarroAuthenticationException    token: 400/401 (credenciais inválidas) ou 401 persistente depois de renovar (outros status do endpoint de token viram CredicarroApiException; rede, CredicarroTimeoutException)
├── CredicarroTimeoutException           timeout (da tentativa ou total), falha de rede ou circuit breaker aberto
├── CredicarroWebhookSignatureException  assinatura de webhook inválida/expirada ou corpo ilegível
└── CredicarroApiException               qualquer erro HTTP da API (403, 404, 409, 5xx...)
    ├── CredicarroValidationException    400 (e validações locais do SDK, com códigos Validation.*)
    ├── CredicarroBusinessRuleException  422
    └── CredicarroRateLimitException     429, com getRetryAfterMs()
```

`CredicarroApiException` expõe `getStatusCode()`, `getErrorCode()` (o campo `tipo`, no formato `Modulo.Contexto.Motivo`), `getTitle()`, `getDetail()`, `getField()`, `getErrors()` (a lista `erros` do corpo, itens `ProblemError` com `code`, `message`, `field`; só vem preenchida quando o JSON enviado está malformado ou tem valor de tipo errado, e vazia nos demais erros: use `getErrorCode()` e `getField()`) e `getRawBody()`.

## Funcionalidades

- **Ambientes**: `Environment::STAGING` usa `https://api.staging.credicarro.com.br/integration/`; `Environment::PRODUCTION` usa `https://api.credicarro.com.br/integration/`. **Sem o terceiro argumento o SDK usa `PRODUCTION`.** `baseUrl` sobrescreve a URL (por exemplo, um proxy) e precisa ser `https`, exceto `localhost` e `127.0.0.1`. Credenciais e webhooks são de cada ambiente; veja [tools/environments.md](../../tools/environments.md).
- **Token**: gerado e renovado pelo SDK (`POST v1/authentication/accesstoken`). Fica em cache até o `expira_em` (sem ele, a validade é `agora + max(expira_em_segundos / 2, expira_em_segundos - 60)`) e, se uma chamada devolver `401`, o SDK renova o token e repete a chamada **uma** vez. Você não chama o endpoint de token.
- **Um cliente por processo**: reaproveite a mesma instância (container de DI). Por padrão o token e o estado do circuit breaker vivem na instância, em memória. Em PHP-FPM cada requisição HTTP começa do zero e geraria um token por requisição: passe um cache **PSR-16** (APCu, Redis, Memcached) como último argumento de `ClientOptions` (`$tokenCache`) para compartilhar o token entre requisições e processos. A chave é derivada (SHA-256) do ambiente/URL base e do `clientId`, o TTL vai até a validade do token e o `clientSecret` nunca é gravado; falhas do cache são ignoradas e um token rejeitado (`401`) é removido dele. O cache guarda o token (segredo de curta duração, que vale como credencial até expirar): use um cache **exclusivo da aplicação** e protegido (Redis com senha/TLS, APCu do próprio pool) e apague a chave ao **rotacionar o `clientSecret`**. O estado do circuit breaker continua por instância.
- **`clientSecret` protegido**: fica num objeto interno (sem getter) e não aparece em `var_dump`, `print_r`, `var_export` nem em stack traces. `ClientOptions`, o cliente e os objetos de credencial/token **recusam `serialize`** (lançam exceção) e o `json_encode` deles sai mascarado. Requisições e respostas com CPF, e-mail, celular, renda, conta bancária, credencial ou conteúdo de documento aparecem **mascaradas só em `var_dump`/`print_r`** (CPF `***.456.789-**`); `serialize`, `json_encode` e as propriedades públicas carregam os **valores reais** (os modelos vão para fila, sessão e cache e voltam sem perda: `unserialize(serialize($dto)) == $dto`). Limitação: `var_export` e `(array)` mostram as propriedades públicas como são: não os use para log.
- **Idempotência automática**: o SDK gera uma `Idempotency-Key` (UUID) por chamada lógica, **a mesma em todas as tentativas**, em `customers->create`, `upsertAddress`, `upsertProfessionalData`, `simulations->createFinancing/createRefinancing`, `proposals->create` (v1 e v2) e `proposals->uploadDocument`.

  | Chamada | Chave | Repetida automaticamente? |
  | --- | --- | --- |
  | Todo `GET` e o token | — | Sim |
  | Criações acima | Gerada pelo SDK | Sim, com a mesma chave |
  | `proposals->uploadDocument($id, $upload, $chave)` | A que você informar (sem ela, o SDK gera uma) | Sim |
  | `customers->upsert($request, $chave)` | A que você informar | Sim |
  | `customers->upsert($request)` | **Nunca** | **Não** |
  | `proposals->sendVehicleDetails`, `sendDepositAccount` | — (reenviar substitui) | Sim |
  | `webhooks->update`, `webhooks->delete` | — | Sim |
  | `webhooks->create` | — (a rota não aceita chave) | **Não** |

- **`customers->upsert`: criar ou atualizar**. Sem chave, a rota `POST v1/customer/unified` cria ou atualiza o cadastro. Com chave, ela **só cria** e um CPF já cadastrado responde `409 Cpf.CpfAlreadyAdded`. Por isso o SDK nunca gera chave nessa rota e não repete a chamada quando você não informa uma. Veja [customers](customers.md).
- **Redirects**: nunca seguidos (um `3xx` vira `CredicarroApiException`).
- **Orçamento de tempo**: `totalTimeoutMs` (30 s) para as chamadas comuns; no envio de documento, `documentUploadAttemptTimeoutMs × maxRetryAttempts` (180 s). `Retry-After` (segundos ou data HTTP; inválido ou ≤ 0 é ignorado; limitado a 24 h) maior que o orçamento restante **não é esperado**: o erro sai na hora (`CredicarroRateLimitException` com `getRetryAfterMs()`); todo backoff é limitado ao restante.
- **Retentativa**: `408`, `429` (respeitando `Retry-After`), `500` (`retryOn500`, ligado por padrão), `502`, `503`, `504`, falha de rede e timeout de tentativa, até `maxRetryAttempts` (3), com backoff exponencial e jitter. Os demais `4xx` nunca são repetidos.
- **Circuit breaker**: abre com 50% de falhas na janela de 30 s (mínimo de 10 chamadas) e fica aberto por 15 s; enquanto isso as chamadas lançam `CredicarroTimeoutException`. Qualquer exceção na tentativa de meia-abertura (401 persistente, erro do token) encerra o teste: o circuito nunca fica preso.
- **Falha de rede**: depois das tentativas vira `CredicarroTimeoutException`, com causa sanitizada (só o tipo e o código; sem requisição, headers ou corpo do Guzzle).
- **`disableAutomaticIdempotencyKey: true`** desliga a chave automática: as rotas afetadas deixam de ser repetidas. O envio de documento continua sempre com chave, pois ela é obrigatória na API.
- **Paginação**: `simulations->list`, `proposals->list` e `webhooks->list` recebem `?ListRequest` e devolvem `PagedResult`. Não há auto-paginação; avance a página enquanto `$result->hasNext` for verdadeiro.
- **Guzzle próprio**: o segundo argumento do construtor aceita um `ClientInterface` (para testes com `MockHandler` ou proxy). Não adicione middleware de retry nele.

## Exemplo

(Fonte: `examples/php/client.php`)

```php
$client = new CredicarroClient(new ClientOptions(
    getenv('CREDICARRO_CLIENT_ID'),
    getenv('CREDICARRO_CLIENT_SECRET'),
    Environment::STAGING
));

$id = $client->proposals->create(new CreateProposalRequest('12345678909', $simulationId));
$page = $client->proposals->list(new ListRequest(1, 50));
```

## Erros e casos de borda

- Trate o erro pelo **`getErrorCode()`** (por exemplo `Store.Integration.NotFound`), nunca pelo texto da mensagem nem de `getDetail()`: eles podem mudar. Capture as subclasses antes de `CredicarroApiException`.
- A **mensagem** da exceção traz só o status, o `tipo` e o `titulo`. `getDetail()` e `getRawBody()` podem conter dados pessoais: não os registre em log. Em log, use `get_class($e)`, `getStatusCode()` e `getErrorCode()`.
- `401` vem sem corpo e vira `CredicarroAuthenticationException`. Falhas inesperadas no formato padrão (`type`/`title`/`detail`) são lidas do mesmo jeito.
- `getErrors()` aparece só quando o JSON enviado está malformado ou tem valor de tipo errado.
- Validações locais: página/tamanho fora do intervalo, UUID inválido, chave de idempotência fora de 1 a 200 caracteres e `DocumentFile` inválido lançam `CredicarroValidationException` (códigos `Validation.*`); alguns erros de argumento do `DocumentFile` são `\InvalidArgumentException`.
- Valores novos que o SDK ainda não conhece em enums viram `UNKNOWN`, e o valor original continua em `*Raw`/`*Name`. Sempre tenha um `default` nos `switch`.
- Datas chegam como `string` ISO-8601 e valores em `float` (reais). Para cálculos, use centavos inteiros ou `bcmath`.
- **Retry bloqueia o processo**: o backoff usa `usleep` dentro da requisição. Em requisições de usuário (PHP-FPM), reduza `totalTimeoutMs`/`maxRetryAttempts` e deixe um job repetir a operação.
- **Não coloque retry em outra camada** (middleware do Guzzle, retry do framework, proxy) sobre o mesmo cliente: retentativas empilhadas multiplicam a carga durante um incidente.
- `CredicarroConfigurationException` na construção significa configuração errada (variável de ambiente ausente, `baseUrl` sem https): falhe na inicialização.
