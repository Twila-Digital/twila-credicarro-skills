# Cliente (.NET)

O SDK oficial `Twila.Credicarro` (namespace raiz `Credicarro`) cuida do que todo módulo precisa: token em cache com renovação, cabeçalhos, resiliência (retry e circuit breaker), idempotência automática, erros tipados e enums com fallback. Você não monta `HttpClient`, JSON nem cabeçalhos. Veja o [SDK .NET](../../tools/sdks/dotnet.md).

## Instalação

```bash
dotnet add package Twila.Credicarro
```

Compatível com .NET Core 2.0+ e .NET Framework 4.6.2+ (`netstandard2.0` e `net8.0`).

## Modelos

```csharp
public sealed class CredicarroOptions
{
    public string ClientId { get; set; }
    public string ClientSecret { get; set; }              // nunca aparece em log, ToString ou mensagem de erro
    public CredicarroEnvironment Environment { get; set; } // Staging | Production (padrão Production)
    public Uri? BaseUrl { get; set; }                      // substitui o ambiente; só https (http apenas para localhost e 127.0.0.1)
    public CredicarroResilienceOptions Resilience { get; set; }
}

public sealed class CredicarroResilienceOptions
{
    public TimeSpan TotalTimeout { get; set; }                 // 30 s
    public TimeSpan AttemptTimeout { get; set; }               // 10 s
    public TimeSpan DocumentUploadAttemptTimeout { get; set; } // 60 s por tentativa; orçamento total do upload = 60 s × MaxRetryAttempts = 180 s
    public int MaxRetryAttempts { get; set; }                  // 3, contando a tentativa original
    public TimeSpan RetryBaseDelay { get; set; }               // 500 ms, backoff exponencial com jitter
    public bool RetryOn500 { get; set; }                       // true
    public bool DisableAutomaticIdempotencyKey { get; set; }   // false
    // CircuitBreakerFailureRatio 0,5 | SamplingDuration 30 s | MinimumThroughput 10 | BreakDuration 15 s
}

public sealed record ListRequest(int Page = 1, int PageSize = 10);   // pagina_inicial, limite
public sealed class PagedResult<T> { IReadOnlyList<T> Items; int Page; int PageSize; long TotalCount; bool HasNext; bool HasPrevious; }
```

## Interface

```csharp
public interface ICredicarroClient
{
    ICustomersClient Customers { get; }
    ISimulationsClient Simulations { get; }
    IProposalsClient Proposals { get; }
    IWebhooksClient Webhooks { get; }
    IV1Client V1 { get; }          // rotas v1 sem cnpjLoja
}

public static IHttpClientBuilder AddCredicarro(this IServiceCollection services, Action<CredicarroOptions> configureOptions);
```

Hierarquia de erros (namespace `Credicarro.Errors`):

```csharp
CredicarroException                              // base
├── CredicarroConfigurationException             // opções inválidas
├── CredicarroAuthenticationException            // StatusCode?, ErrorCode (falha ao gerar o token ou 401 persistente)
├── CredicarroTimeoutException                   // timeout ou circuit breaker aberto
├── CredicarroWebhookSignatureException          // assinatura de webhook inválida
└── CredicarroApiException                       // StatusCode, ErrorCode, Title, Detail, Field, Errors, RawBody
    ├── CredicarroValidationException            // 400
    ├── CredicarroBusinessRuleException          // 422
    └── CredicarroRateLimitException             // 429, RetryAfter
```

## Features

- **Configuração:** `services.AddCredicarro(options => ...)` registra o `IHttpClientFactory`, a autenticação, a resiliência e o `ICredicarroClient` como **singleton**. Leia `ClientId` e `ClientSecret` de variável de ambiente, User Secrets (só em desenvolvimento) ou cofre. O SDK não lê variáveis de ambiente sozinho. Veja [security.md](security.md).
- **Ambientes:** `Staging` (`https://api.staging.credicarro.com.br/integration/`) e `Production` (`https://api.credicarro.com.br/integration/`, padrão). Use credenciais separadas por ambiente. `BaseUrl` só para testes ou proxies, sempre `https`.
- **Validação:** as opções são validadas na primeira vez que o client é resolvido (`CredicarroConfigurationException`, com o nome do campo e nunca o valor). Resolva `ICredicarroClient` na inicialização para falhar cedo.
- **Singleton:** um `ICredicarroClient` por processo. O token em cache e o estado do circuit breaker vivem nele. Não crie um client por requisição nem monte `HttpClient` à mão.
- **Token:** o SDK chama `POST v1/authentication/accesstoken`, guarda o token até `expira_em` (sem ele, usa `max(expira_em_segundos / 2, expira_em_segundos − 60)`) e renova de forma *single-flight*. Em `401` numa rota autenticada, renova e repete **uma** vez. Credenciais inválidas viram `CredicarroAuthenticationException`.
- **Idempotência automática:** o SDK gera uma `Idempotency-Key` (UUID) **por chamada lógica** e a repete em todas as tentativas, em `Customers.CreateAsync`, `UpsertAddressAsync`, `UpsertProfessionalDataAsync`, nas simulações e propostas (v1 e v2) e em `Proposals.UploadDocumentAsync`.
- **`Customers.UpsertAsync` é a exceção.** O SDK **nunca** gera chave para `POST v1/customer/unified`, porque a chave muda o comportamento da rota: **sem** `idempotencyKey` cria ou atualiza o cliente (upsert) e a chamada **não é repetida** em falha de rede; **com** `idempotencyKey` só cria (CPF existente responde `409 Cpf.CpfAlreadyAdded`) e o SDK repete com a mesma chave. Para atualizar um cliente existente, não passe a chave.
- **`Webhooks.CreateAsync` não é repetido**, para não cadastrar o webhook duas vezes. Se der timeout, liste os webhooks antes de tentar de novo.
- **Retentativas:** `GET`, a geração do token, `POST` com chave, `SendVehicleDetailsAsync`, `SendDepositAccountAsync`, `Webhooks.UpdateAsync` e `DeleteAsync` são repetidos em `408`, `429` (respeitando `Retry-After`, em segundos ou data HTTP; valor inválido, ≤ 0 ou absurdo é ignorado e o máximo aceito é 24 h; se for maior que o orçamento restante o SDK **não espera** e lança já `CredicarroRateLimitException` com `RetryAfter`), `500` (`RetryOn500`, padrão `true`), `502`, `503`, `504`, falha de rede e timeout de tentativa, com backoff exponencial e jitter. Outros `4xx` nunca são repetidos. Não coloque Polly nem laço seu por cima do client.
- **`DisableAutomaticIdempotencyKey = true`** tira a chave automática das criações e, com isso, a repetição delas. O envio de documento continua levando chave (o header é obrigatório).
- **Cancelamento e timeout:** todo método aceita `CancellationToken`. Passe sempre o do chamador. `TotalTimeout` limita a chamada inteira (no envio de documento o orçamento é `DocumentUploadAttemptTimeout × MaxRetryAttempts`, 180 s no padrão); `AttemptTimeout`, cada tentativa. O `HttpClient.Timeout` do SDK é infinito: quem manda é a pipeline.
- **Paginação:** `Simulations.ListAsync`, `Proposals.ListAsync` e `Webhooks.ListAsync` devolvem `PagedResult<T>`. Não há auto-paginação: avance `Page` enquanto `HasNext` for `true`. `Page` começa em 1 e `PageSize` vai de 1 a 100 (validado antes da chamada, com `ArgumentOutOfRangeException`).
- **Enums:** os enums de resposta têm `Unknown = -1`. Um valor novo da API nunca lança exceção; o valor original fica em `...Raw` e `...Name`.

## Exemplo

(Fonte: `examples/dotnet/client.cs`)

```csharp
services.AddCredicarro(options =>
{
    options.ClientId = Environment.GetEnvironmentVariable("CREDICARRO_CLIENT_ID") ?? string.Empty;
    options.ClientSecret = Environment.GetEnvironmentVariable("CREDICARRO_CLIENT_SECRET") ?? string.Empty;
    options.Environment = CredicarroEnvironment.Staging;
});
// ...
var client = provider.GetRequiredService<ICredicarroClient>();   // resolva na inicialização para validar as opções
var page = await client.Proposals.ListAsync(new ListRequest(Page: 1, PageSize: 100), ct);
```

## Erros e casos de borda

- Trate `CredicarroApiException.ErrorCode` (o `tipo`, estável, por exemplo `Proposal.Access.NotFound`). A mensagem da exceção traz só status, `tipo` e `titulo`; `Detail` e `RawBody` são propriedades que podem repetir dados pessoais, então **não os registre em log**.
- Capture do mais específico para o mais genérico: `CredicarroBusinessRuleException`, `CredicarroValidationException`, `CredicarroRateLimitException`, `CredicarroApiException`.
- `Errors` (lista com `Code`, `Message` e `Field`) vem, por exemplo, em `Validation.InvalidFormat`.
- `500` e alguns `502` chegam no formato padrão (`type`, `title`, `detail`); o SDK mapeia para `ErrorCode`, `Title` e `Detail`. `401` sem corpo vira `CredicarroAuthenticationException`.
- `403 Integration.Access.Inactive`: não repita; fale com o time Credicarro.
- `CredicarroTimeoutException` sinaliza timeout, circuit breaker aberto **e falha de rede** (conexão recusada, DNS, reset) depois das tentativas; a causa vem sem URL, cabeçalhos nem corpo. Espere antes de insistir.
- Redirects (`3xx`) não são seguidos (o Bearer não pode ir para outro host): viram `CredicarroApiException`.
- `ToString` das requisições e respostas (CPF, e-mail, celular, renda, conta, veículo, credencial, segredo) mostra valores mascarados (CPF `***.456.789-**`, o resto `***`); ainda assim, não registre objetos inteiros em log.
- Não registre o token nem o `ClientSecret`. Veja [security.md](security.md).
