# Cliente (Go)

O SDK oficial `github.com/Twila-Digital/twila-credicarro-go-sdk` (pacote `credicarro`) cuida do que todo módulo precisa: token em cache com renovação, cabeçalhos, resiliência (retry e circuit breaker), idempotência automática, erros tipados e enums com fallback. Você não monta `http.Client`, JSON nem cabeçalhos. Veja o [SDK Go](../../tools/sdks/go.md).

## Instalação

```bash
go get github.com/Twila-Digital/twila-credicarro-go-sdk
```

Go 1.18 ou superior, sem dependências externas (só a biblioteca padrão).

## Modelos

```go
type ClientOptions struct {
    ClientID     string
    ClientSecret string             // nunca aparece em String(), %v, %+v, %#v nem em mensagens de erro
    Environment  Environment        // EnvironmentStaging | EnvironmentProduction (padrão); ignorado se BaseURL for informado
    BaseURL      string             // opcional; só https (http apenas para localhost e 127.0.0.1)
    Resilience   *ResilienceOptions // nil usa DefaultResilienceOptions()
    HTTPClient   *http.Client       // opcional; nil usa um cliente próprio do SDK (transporte dedicado, TLS 1.2+, 64 conexões ociosas por host)
}

type ResilienceOptions struct {
    TotalTimeout                 time.Duration // 30 s
    AttemptTimeout               time.Duration // 10 s
    DocumentUploadAttemptTimeout time.Duration // 60 s; o orçamento total do envio de documento é este valor × MaxRetryAttempts (180 s)
    MaxRetryAttempts             int           // 3, contando a tentativa original
    RetryBaseDelay               time.Duration // 500 ms, backoff exponencial com jitter
    RetryOn500                   bool          // true
    DisableAutomaticIdempotencyKey bool        // false
    // CircuitBreakerFailureRatio 0,5 | SamplingWindow 30 s | MinThroughput 10 | BreakDuration 15 s
}

type ListRequest struct{ Page, PageSize int }       // pagina_inicial, limite; zero usa 1 e 10
type PagedResult[T any] struct {
    Items []T; Page, PageSize int; TotalCount int64; HasNext, HasPrevious bool
}
type RequestOption func(*requestOptions)
func WithIdempotencyKey(key string) RequestOption   // 1 a 200 caracteres
```

## Interface

```go
func NewClient(options ClientOptions) (*Client, error)   // *ConfigurationError se faltar credencial ou a URL não for https
func DefaultResilienceOptions() ResilienceOptions

type Client struct {
    Customers   *CustomersClient
    Simulations *SimulationsClient
    Proposals   *ProposalsClient
    Webhooks    *WebhooksClient
    V1          *V1Client              // rotas v1 sem cnpjLoja: V1.Simulations e V1.Proposals
}
```

Tipos de erro (retornados como valores; verifique com `errors.As`):

```go
*ConfigurationError    // argumento ou configuração inválida, detectada no cliente
*AuthenticationError   // StatusCode, ErrorCode (token com 400/401, ou 401 persistente); outros status do token são *APIError
*TimeoutError          // falha de rede ou timeout (causa sanitizada, sem a requisição), timeout total ou circuit breaker aberto
*WebhookSignatureError // assinatura de webhook inválida
*APIError              // StatusCode, ErrorCode, Title, Detail, Field, Errors, Body
*ValidationError       // 400; embute *APIError
*BusinessRuleError     // 422; embute *APIError
*RateLimitError        // 429; embute *APIError, com RetryAfter
```

## Features

- **Configuração:** `credicarro.NewClient(credicarro.ClientOptions{...})`. Leia `ClientID` e `ClientSecret` de variável de ambiente ou cofre; o SDK não lê variáveis de ambiente sozinho. Veja [security.md](security.md).
- **Ambientes:** `EnvironmentStaging` (`https://api.staging.credicarro.com.br/integration/`) e `EnvironmentProduction` (`https://api.credicarro.com.br/integration/`, padrão). Use credenciais separadas por ambiente. `BaseURL` só para testes ou proxies, sempre `https`.
- **Instância única:** crie um só `*credicarro.Client` por processo e injete-o. Ele guarda o token em cache e o estado do circuit breaker, e é seguro para uso concorrente. Não crie um cliente por requisição. O `http.Client` é do SDK; se precisar de proxy ou transporte próprio, injete `ClientOptions.HTTPClient`: o SDK usa uma cópia dele e **sempre desliga os redirects** (um `3xx` vira `*APIError`, nunca é seguido, para o token Bearer não ir a outro destino). `NewClient` falha na hora se a configuração for inválida: trate o erro na inicialização.
- **Token:** o SDK chama `POST v1/authentication/accesstoken`, guarda o token até `expira_em` (sem ele, `max(expira_em_segundos / 2, expira_em_segundos − 60)`) e renova de forma *single-flight*, respeitando o `context.Context` de cada chamada. Em `401` numa rota autenticada, renova e repete **uma** vez.
- **Idempotência automática:** o SDK gera uma `Idempotency-Key` **por chamada lógica** e a repete em todas as tentativas, em `Customers.Create`, `UpsertAddress`, `UpsertProfessionalData`, nas simulações e propostas (v1 e v2) e em `Proposals.UploadDocument`. Para usar a sua chave: `credicarro.WithIdempotencyKey("...")`.
- **`Customers.Upsert` é a exceção.** O SDK **nunca** gera chave para `POST v1/customer/unified`, porque a chave muda o comportamento da rota: **sem** `WithIdempotencyKey` cria ou atualiza o cliente (upsert) e a chamada **não é repetida** em falha de rede; **com** `WithIdempotencyKey` só cria (CPF existente responde `409 Cpf.CpfAlreadyAdded`) e o SDK repete com a mesma chave. Para atualizar um cliente existente, não passe a chave.
- **`Webhooks.Create` não aceita chave e não é repetido**, para não cadastrar o webhook duas vezes. Se der timeout, liste os webhooks antes de tentar de novo.
- **Retentativas:** `GET`, a geração do token, `POST` com chave, `SendVehicleDetails`, `SendDepositAccount`, `Webhooks.Update` e `Webhooks.Delete` são repetidos em `408`, `429` (respeitando `Retry-After`), `500` (`RetryOn500`, padrão `true`), `502`, `503`, `504`, falha de rede e timeout de tentativa, com backoff exponencial e jitter. Outros `4xx` nunca são repetidos. Não faça laço seu de retry em volta das chamadas.
- **`Retry-After`:** aceita segundos ou data HTTP; inválido, `≤ 0` ou absurdo é ignorado (limitado a 1 ano antes de converter). Se for maior que o orçamento restante da chamada, o SDK **não espera** e devolve já o `*RateLimitError` (ou o `*APIError`) com `RetryAfter`. O orçamento é `TotalTimeout`; no envio de documento, `DocumentUploadAttemptTimeout × MaxRetryAttempts`.
- **Falha de rede** (conexão recusada, DNS, reset, timeout), esgotadas as tentativas, volta como `*TimeoutError` com a causa sanitizada (sem URL, cabeçalhos nem corpo). Na geração do token também (não vira `*AuthenticationError`).
- **`WithIdempotencyKey`:** 1 a 200 caracteres ASCII imprimíveis, não só espaços; chave vazia ou inválida é `*ConfigurationError` antes de qualquer requisição (nunca equivale a "sem chave").
- **Logs:** `String()`, `GoString()` e `%v`/`%+v`/`%#v` dos modelos com CPF, e-mail, celular, renda, conta bancária, credencial, segredo ou conteúdo de documento mostram valores mascarados (CPF `***.456.789-**`, demais `***`). Os campos `Detail` e `Body` dos erros nunca entram na mensagem nem em `%#v`. A máscara vale só para depuração/log (`String()`, `GoString()`, `%v`, `%+v`, `%#v`). A serialização (`json.Marshal`) dos modelos de dados traz os **valores reais**, para persistir em fila ou cache (`DocumentFile` inclusive, com round-trip validado). `ClientOptions` **recusa** `json.Marshal`, por guardar o `ClientSecret`.
- **`DisableAutomaticIdempotencyKey = true`** tira a chave automática das criações e, com isso, a repetição delas. O envio de documento continua levando chave (o header é obrigatório).
- **Contexto:** todo método recebe `context.Context` como primeiro argumento. Passe sempre o do chamador, com prazo. O cancelamento ou a expiração do contexto voltam como estão (`errors.Is(err, context.Canceled)`), nunca como `TimeoutError`.
- **Paginação:** `Simulations.List`, `Proposals.List` e `Webhooks.List` devolvem `*PagedResult[T]`. Passe `nil` para a primeira página com 10 itens. Não há auto-paginação: avance `Page` enquanto `HasNext` for `true`. `Page` começa em 1 e `PageSize` vai de 1 a 100 (`*ConfigurationError` fora disso).
- **Identificadores:** ids de simulação, proposta e webhook são UUIDs em `string`, validados antes da chamada.
- **Enums:** os enums de resposta têm `...Unknown` (`-1`). Um valor novo da API nunca gera erro; o valor original fica em `...Raw` e `...Name`.
- **Dinheiro:** valores são `float64`, bons para trafegar e exibir; faça cálculos com decimal ou centavos inteiros.

## Exemplo

(Fonte: `examples/go/client.go`)

```go
client, err := credicarro.NewClient(credicarro.ClientOptions{
    ClientID:     os.Getenv("CREDICARRO_CLIENT_ID"),
    ClientSecret: os.Getenv("CREDICARRO_CLIENT_SECRET"),
    Environment:  credicarro.EnvironmentStaging,
})
if err != nil {
    log.Fatal(err) // *ConfigurationError: não imprime o valor das variáveis
}

page, err := client.Proposals.List(ctx, &credicarro.ListRequest{Page: 1, PageSize: 100})
```

## Erros e casos de borda

- Trate `ErrorCode` (o `tipo`, estável, por exemplo `Proposal.Access.NotFound`) com `errors.As`. `Error()` traz só status, `tipo` e `titulo`; `Detail` e `Body` são campos que podem repetir dados pessoais, então **não os registre em log**.
- `ValidationError`, `BusinessRuleError` e `RateLimitError` embutem `*APIError` e também respondem a `errors.As(err, &apiErr)`. Verifique primeiro o mais específico.
- `Errors` (lista com `Code`, `Message` e `Field`) vem, por exemplo, em `Validation.InvalidFormat`.
- `500` e alguns `502` chegam no formato padrão (`type`, `title`, `detail`); o SDK mapeia para `ErrorCode`, `Title` e `Detail`. `401` sem corpo vira `*AuthenticationError`.
- `403 Integration.Access.Inactive`: não repita; fale com o time Credicarro.
- `*TimeoutError` também sinaliza circuit breaker aberto: espere antes de insistir.
- Não registre o token nem o `ClientSecret`, e não use `%+v` nem `%#v` em requisições e respostas. Veja [security.md](security.md).
