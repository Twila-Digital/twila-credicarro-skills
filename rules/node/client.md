# Cliente (Node.js)

O SDK oficial `@twila/credicarro` cuida de autenticação, cache de token, JSON, `Idempotency-Key`, retentativa, circuit breaker e erros tipados. Você usa `CredicarroClient` e os clientes por recurso (`customers`, `simulations`, `proposals`, `webhooks`, `v1`). Não escreva chamadas HTTP à mão.

## Instalação

```bash
npm install @twila/credicarro
```

- Node.js 14 ou superior; publica CommonJS (`require`) e ES Modules (`import`) no mesmo pacote, com tipos TypeScript.
- Uso **só server-side**: o `clientSecret` nunca vai para navegador, app mobile ou SPA.

## Tipos

```typescript
import {
  CredicarroClient,
  CredicarroEnvironment,          // Staging | Production
  type CredicarroClientOptions,
  type CredicarroResilienceOptions,
  type PagedResult,
  type ListRequest,
} from '@twila/credicarro';

interface CredicarroClientOptions {
  clientId: string;
  clientSecret: string;                              // nunca aparece em log, erro ou serialização
  environment?: CredicarroEnvironment;               // padrão: Production
  baseUrl?: string;                                  // sobrescreve o ambiente; precisa ser https
  resilience?: Partial<CredicarroResilienceOptions>;
}

interface PagedResult<T> { items: T[]; page: number; pageSize: number; totalCount: number; hasNext: boolean; hasPrevious: boolean }
interface ListRequest { page?: number; pageSize?: number }   // padrão 1 e 10; pageSize de 1 a 100
```

## Interface

```typescript
class CredicarroClient {
  constructor(options: CredicarroClientOptions);
  readonly customers: CustomersClient;
  readonly simulations: SimulationsClient;
  readonly proposals: ProposalsClient;
  readonly webhooks: WebhooksClient;
  readonly v1: V1Client;   // rotas v1 sem cnpjLoja: v1.simulations e v1.proposals
}
```

## Features

- **Ambientes:** `CredicarroEnvironment.Staging` → `https://api.staging.credicarro.com.br/integration/`; `Production` → `https://api.credicarro.com.br/integration/`. **Sem `environment` nem `baseUrl`, o SDK usa Produção.** Nos testes, passe `Staging` de forma explícita.
- **`baseUrl`:** só `https` (`http` apenas para `localhost` e `127.0.0.1`). Configuração inválida lança `CredicarroConfigurationError` já no `new CredicarroClient(...)`; `clientId` e `clientSecret` vazios também.
- **Singleton:** crie **um** cliente por processo e reutilize. Ele guarda o token em cache (renovado antes de `expira_em`, com uma única renovação mesmo sob concorrência) e o estado do circuit breaker. Um cliente por requisição joga os dois fora.
- **Token:** o SDK gera e renova sozinho. Num `401` de rota autenticada ele renova e repete **uma** vez. Credencial errada ou `401` persistente vira `CredicarroAuthenticationError`.
- **Resiliência** (`resilience`, todos opcionais): `totalTimeoutMs` 30 000, `attemptTimeoutMs` 10 000, `documentUploadAttemptTimeoutMs` 60 000, `maxRetryAttempts` 3, `retryBaseDelayMs` 500 (backoff exponencial com jitter), circuit breaker (`circuitBreakerFailureRatio` 0,5, `circuitBreakerSamplingDurationMs` 30 000, `circuitBreakerMinimumThroughput` 10, `circuitBreakerBreakDurationMs` 15 000), `retryOn500` (padrão `true`) e `disableAutomaticIdempotencyKey`.
- **O que é repetido:** só o que é seguro repetir: `GET`; gerar token; `POST` com `Idempotency-Key`; `POST v2/proposal/{id}/vehicle-detail` e `deposit-account` (substituem o enviado); `PUT` e `DELETE v1/webhook/{id}`. **Não** são repetidos `POST v1/webhook` e `POST v1/customer/unified` sem chave.
- **O que dispara nova tentativa:** `408`, `429` (respeita `Retry-After` em segundos ou data HTTP; inválido ou não positivo é ignorado, limitado a 24 h, e se passar do orçamento restante o SDK não espera e lança `CredicarroRateLimitError` com `retryAfterMs`), `500` (`retryOn500`), `502`, `503`, `504`, falha de rede e timeout de tentativa. Nunca outros `4xx`.
- **`Idempotency-Key` automática:** um UUID por chamada lógica, **o mesmo em todas as tentativas**, em `customers.create`, `upsertAddress`, `upsertProfessionalData`, `simulations.createFinancing` e `createRefinancing`, `proposals.create`, `proposals.uploadDocument` e nas rotas v1 equivalentes. Você não gera nem repete a chave.
- **`customers.upsert` é a exceção:** sem chave, **cria ou atualiza** o cliente (upsert); com chave, **só cria** (CPF existente → `409 Cpf.CpfAlreadyAdded`). Por isso o SDK **nunca** gera a chave nesta rota, e sem chave a chamada **não é repetida** em falha. Veja [customers.md](customers.md).
- **Chave de documento:** `proposals.uploadDocument` aceita `idempotencyKey` opcional. Persista um UUID por envio e reuse-o só no mesmo envio; use chave nova na correção. Veja [proposals.md](proposals.md).
- **`disableAutomaticIdempotencyKey: true`** desliga a geração automática (menos no envio de documento, onde o header é obrigatório). Sem a chave, essas chamadas deixam de ser repetidas. Só use se tiver motivo.
- **Paginação:** `simulations.list`, `proposals.list` e `webhooks.list` devolvem `PagedResult<T>`. Não há auto-paginação: avance `page` enquanto `hasNext`. `pageSize` fora de 1 a 100 (ou `page < 1`) lança `RangeError` antes de chamar a API.
- **Enums:** todo enum tem `Unknown = -1` e os modelos guardam o valor bruto (`statusRaw`, `statusName`). Um valor novo da API não quebra o código; compare pelo enum e trate `Unknown`.
- **Valores monetários** vêm como `number`. Para cálculo (somas, comparação exata), use centavos inteiros ou biblioteca decimal.
- **Datas** vêm como texto ISO-8601 (`createdAt`).

### Hierarquia de erros

Tudo estende `CredicarroError`.

| Classe | Quando |
| --- | --- |
| `CredicarroConfigurationError` | Configuração inválida do cliente (credencial vazia, `baseUrl` sem https, resiliência inconsistente) |
| `CredicarroAuthenticationError` | Falha ao gerar o token (`401`/`400`) ou `401` persistente depois da renovação |
| `CredicarroApiError` | Qualquer erro da API (`statusCode`, `errorCode`, `title`, `detail`, `field`, `errors`, `rawBody`) |
| `CredicarroValidationError` | `400` (estende `CredicarroApiError`); use `field` e `errors` |
| `CredicarroBusinessRuleError` | `422` (estende `CredicarroApiError`); trate pelo `errorCode` |
| `CredicarroRateLimitError` | `429` (estende `CredicarroApiError`), com `retryAfterMs` |
| `CredicarroTimeoutError` | Timeout (de tentativa ou total), falha de rede ou circuit breaker aberto |
| `CredicarroWebhookSignatureError` | Assinatura de webhook inválida ou corpo ilegível |

## Exemplo
(Fonte: `examples/node/client.ts`)

```typescript
import { CredicarroClient, CredicarroEnvironment, CredicarroBusinessRuleError } from '@twila/credicarro';

// Módulo único, importado pelo resto da aplicação.
export const client = new CredicarroClient({
  clientId: process.env.CREDICARRO_CLIENT_ID!,
  clientSecret: process.env.CREDICARRO_CLIENT_SECRET!,
  environment: CredicarroEnvironment.Staging, // sem isto, o padrão é Production
});

try {
  const proposalId = await client.proposals.create({ cpf, simulationId });
} catch (error) {
  if (error instanceof CredicarroBusinessRuleError && error.errorCode === 'Proposal.SimulationAlreadyExpired') {
    // simule de novo
  } else {
    throw error;
  }
}

// Sem auto-paginação: avance a página enquanto hasNext.
let page = await client.proposals.list({ page: 1, pageSize: 100 });
```

## Erros e casos de borda

- Trate o erro pelo `errorCode` (o `tipo` estável da API, ex.: `Cpf.CpfAlreadyAdded`), nunca pelo `detail`, que pode mudar.
- `message` da exceção traz só status, `tipo` e título. `detail`, `problemDetails` e `rawBody` ficam em propriedades **não enumeráveis** porque podem ter dados do cliente: **não os coloque em log**. Redirecionamentos (3xx) não são seguidos e viram `CredicarroApiError`; respostas acima de 10 MiB são recusadas; `idempotencyKey` explícita aceita 1 a 200 caracteres ASCII imprimíveis.
- `401` chega sem corpo; `500` e alguns `502` podem vir no formato padrão (`type`, `title`, `detail`). O SDK normaliza os dois.
- `errors` só aparece com JSON malformado ou valor de tipo errado.
- Não envolva chamadas do SDK em outro laço de retentativa: o SDK já repete o que é seguro, e duas camadas geram tempestade de requisições numa instabilidade. Veja [segurança](security.md).
- Staging e produção têm credenciais, propostas e webhooks separados. Um token de staging dá `401` em produção.
- `RangeError` (paginação, arquivo de documento, `accountType`) é erro de uso e ocorre antes de qualquer chamada de rede.
