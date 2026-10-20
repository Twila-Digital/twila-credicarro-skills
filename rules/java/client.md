# Cliente (Java)

O Credicarro tem SDK oficial em Java (`br.com.twila:credicarro`, pacote raiz `twila.credicarro`). **Use o SDK; não escreva HTTP à mão.** Ele cuida do token de acesso, da `Idempotency-Key`, da retentativa, do circuit breaker e dos erros tipados. Todos os módulos usam o mesmo `CredicarroClient`.

## Instalação

```xml
<dependency>
    <groupId>br.com.twila</groupId>
    <artifactId>credicarro</artifactId>
    <version>1.0.0</version>
</dependency>
```

Gradle (Kotlin DSL): `implementation("br.com.twila:credicarro:1.0.0")`. Compila com `--release 8` (roda em JDK 8 ou superior); o HTTP é OkHttp (dependência transitiva). Veja [tools/sdks/java.md](../../tools/sdks/java.md).

## Modelos

```java
public interface CredicarroClient extends AutoCloseable {
    CustomersClient customers();
    SimulationsClient simulations();
    ProposalsClient proposals();
    WebhooksClient webhooks();
    V1Client v1();                 // rotas v1: v1().simulations(), v1().proposals()
    void close();
    static Builder builder();      // clientId, clientSecret, environment, baseUrl(URI), resilience, build()
}

public enum CredicarroEnvironment { STAGING, PRODUCTION }

@Value @Builder
public class CredicarroResilienceOptions {
    Duration totalTimeout;                  // 30 s
    Duration attemptTimeout;                // 10 s
    Duration documentUploadAttemptTimeout;  // 60 s
    int maxRetryAttempts;                   // 3
    Duration retryBaseDelay;                // 500 ms, com jitter
    double circuitBreakerFailureRatio;      // 0.5
    int circuitBreakerSlidingWindowSize;    // 30
    int circuitBreakerMinimumThroughput;    // 10
    Duration circuitBreakerBreakDuration;   // 15 s
    boolean retryOn500;                     // true
    boolean disableAutomaticIdempotencyKey; // false
}

@Value
public class ListRequest {                  // ListRequest.of(page, pageSize), ListRequest.defaults()
    int page;                               // padrão 1, mínimo 1
    int pageSize;                           // padrão 10, de 1 a 100
}

@Value
public class PagedResult<T> {
    List<T> items; boolean hasNext; boolean hasPrevious; int page; int pageSize; long totalCount;
}
```

Hierarquia de erros (`twila.credicarro.errors`), todas `RuntimeException`:

```text
CredicarroException
├── CredicarroConfigurationException     builder inválido (clientId/clientSecret ausentes, baseUrl sem https)
├── CredicarroAuthenticationException    credenciais inválidas ou 401 persistente depois de renovar o token
├── CredicarroTimeoutException           timeout (da tentativa ou total), falha de rede ou circuit breaker aberto
├── CredicarroWebhookSignatureException  assinatura de webhook inválida/expirada ou corpo ilegível
└── CredicarroApiException               qualquer erro HTTP da API (403, 404, 409, 5xx...)
    ├── CredicarroValidationException    400
    ├── CredicarroBusinessRuleException  422
    └── CredicarroRateLimitException     429, com getRetryAfter()
```

`CredicarroApiException` expõe `getStatusCode()`, `getErrorCode()` (o campo `tipo`, no formato `Modulo.Contexto.Motivo`), `getTitle()`, `getDetail()`, `getField()`, `getErrors()` (itens `CredicarroApiError` com `getCode()`, `getMessage()`, `getField()`) e `getRawBody()`.

## Funcionalidades

- **Ambientes**: `environment(CredicarroEnvironment.STAGING)` usa `https://api.staging.credicarro.com.br/integration/`; `PRODUCTION` usa `https://api.credicarro.com.br/integration/`. **Sem `environment(...)` o SDK usa `PRODUCTION`.** `baseUrl(URI)` sobrescreve a URL (por exemplo, um proxy) e precisa ser HTTPS, exceto `localhost` e `127.0.0.1`. Credenciais e webhooks são de cada ambiente; veja [tools/environments.md](../../tools/environments.md).
- **Token**: gerado e renovado pelo SDK (`POST v1/authentication/accesstoken`). Fica em cache até o `expira_em`, a renovação acontece uma única vez mesmo com várias threads, e um `401` numa rota autenticada renova o token e repete a chamada **uma** vez. Você não chama o endpoint de token.
- **Singleton**: `CredicarroClient` é thread-safe. Crie **um** por aplicação (bean do Spring, por exemplo) e feche só no shutdown (`destroyMethod = "close"`). Ele guarda o pool de conexões, o cache do token e o circuit breaker; um cliente por requisição joga tudo isso fora.
- **Idempotência automática**: o SDK gera uma `Idempotency-Key` (UUID) por chamada lógica, **a mesma em todas as tentativas**, em `customers.create`, `upsertAddress`, `upsertProfessionalData`, `simulations.createFinancing/createRefinancing`, `proposals.create` (v1 e v2) e `proposals.uploadDocument`.

  | Chamada | Chave | Repetida automaticamente? |
  | --- | --- | --- |
  | Todo `GET` e o token | — | Sim |
  | Criações acima | Gerada pelo SDK | Sim, com a mesma chave |
  | `proposals.uploadDocument(id, upload, chave)` | A que você informar (sem ela, o SDK gera uma) | Sim |
  | `customers.upsert(request, chave)` | A que você informar | Sim |
  | `customers.upsert(request)` | **Nunca** | **Não** |
  | `proposals.sendVehicleDetails`, `sendDepositAccount` | — (reenviar substitui) | Sim |
  | `webhooks.update`, `webhooks.delete` | — | Sim |
  | `webhooks.create` | — (a rota não aceita chave) | **Não** |

- **`customers.upsert`: criar ou atualizar**. Sem chave, a rota `POST v1/customer/unified` cria ou atualiza o cadastro. Com chave, ela **só cria** e um CPF já cadastrado responde `409 Cpf.CpfAlreadyAdded`. Por isso o SDK nunca gera chave nessa rota e não repete a chamada quando você não informa uma. Veja [customers](customers.md).
- **Retentativa**: `408`, `429` (respeitando `Retry-After`), `500` (`retryOn500`, ligado por padrão), `502`, `503`, `504`, falha de rede e timeout de tentativa, até `maxRetryAttempts` (3), com backoff exponencial e jitter. Os demais `4xx` nunca são repetidos. O token também tem retry próprio. `Retry-After` vale em segundos ou data HTTP; valor inválido, zero ou negativo é ignorado, e se for maior que o tempo restante a chamada falha na hora com `CredicarroRateLimitException` (`getRetryAfter()`), sem dormir.
- **Orçamento de tempo**: `totalTimeout` (30 s) cobre a chamada inteira, incluindo token e esperas; cada requisição usa `min(attemptTimeout, restante)`. No envio de documento o orçamento é `documentUploadAttemptTimeout × maxRetryAttempts` (180 s). Tudo roda na thread do chamador (sem pool interno). Redirects (`3xx`) não são seguidos e viram `CredicarroApiException`. Falha de rede ou timeout depois das tentativas vira `CredicarroTimeoutException` com causa sanitizada.
- **Circuit breaker**: abre com 50% de falhas numa janela de 30 segundos (mínimo de 10 chamadas) e fica aberto por 15 s; enquanto isso as chamadas lançam `CredicarroTimeoutException`.
- **`disableAutomaticIdempotencyKey(true)`** desliga a chave automática: as rotas afetadas deixam de ser repetidas. O envio de documento continua sempre com chave, pois ela é obrigatória na API.
- **Paginação**: `simulations().list`, `proposals().list` e `webhooks().list` recebem `ListRequest` e devolvem `PagedResult<T>`. Não há auto-paginação; avance a página enquanto `isHasNext()` for verdadeiro.

## Exemplo

(Fonte: `examples/java/client.java`)

```java
CredicarroClient client = CredicarroClient.builder()
        .clientId(System.getenv("CREDICARRO_CLIENT_ID"))
        .clientSecret(System.getenv("CREDICARRO_CLIENT_SECRET"))
        .environment(CredicarroEnvironment.STAGING)
        .build();                                   // singleton da aplicação

UUID id = client.proposals().create(CreateProposalRequest.builder()
        .cpf("12345678909").simulationId(simulationId).build());
PagedResult<ProposalSummary> page = client.proposals().list(ListRequest.of(1, 50));
```

## Erros e casos de borda

- Trate o erro pelo **`getErrorCode()`** (por exemplo `Store.Integration.NotFound`), nunca pelo texto da mensagem nem de `getDetail()`: eles podem mudar. Capture as subclasses antes de `CredicarroApiException`.
- A **mensagem** da exceção traz só o status, o `tipo` e o `titulo`. `getDetail()` e `getRawBody()` podem conter dados pessoais: não os registre em log. Em log, use `ex.getClass().getSimpleName()`, `getStatusCode()` e `getErrorCode()`.
- `401` vem sem corpo e vira `CredicarroAuthenticationException`. Falhas inesperadas no formato padrão (`type`/`title`/`detail`) são lidas do mesmo jeito.
- `getErrors()` aparece só quando o JSON enviado está malformado ou tem valor de tipo errado.
- As validações locais do SDK lançam `IllegalArgumentException` (`ListRequest` com página fora do intervalo, `DocumentFile` inválido); `UncheckedIOException` na leitura de arquivo.
- Valores novos que o SDK ainda não conhece em enums viram `UNKNOWN`, e o valor original continua em `getXxxRaw()`/`getXxxName()`. Não quebre o código com `switch` sem `default`.
- A serialização Jackson dos modelos usa os valores reais (a máscara é só do `toString`); o cliente e o provedor de token recusam serialização.
- `toString` de requisições e respostas mascara CPF (`***.456.789-**`), e-mail, celular, renda, conta, credencial e segredo; ainda assim não registre objetos inteiros em log.
- Dinheiro é `BigDecimal`, em reais, nunca `double`.
- **Não coloque retry em outra camada** (Resilience4j, Spring Retry, proxy) sobre o mesmo cliente: retentativas empilhadas multiplicam a carga durante um incidente.
- `CredicarroConfigurationException` na construção significa configuração errada (variável de ambiente ausente, `baseUrl` sem HTTPS): falhe na inicialização.
