import {
  CredicarroApiError,
  CredicarroAuthenticationError,
  CredicarroBusinessRuleError,
  CredicarroClient,
  CredicarroEnvironment,
  CredicarroRateLimitError,
  CredicarroTimeoutError,
  CredicarroValidationError,
  type ListRequest,
  type PagedResult,
} from '@twila/credicarro';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} é obrigatória`);
  return value;
}

// Sem baseUrl, o padrão do SDK é PRODUÇÃO. Os exemplos usam staging, a menos que CREDICARRO_BASE_URL (https) diga o contrário.
const baseUrl = process.env.CREDICARRO_BASE_URL;

/**
 * Cliente único (singleton) da aplicação: guarda o token em cache e o estado do circuit breaker.
 * Importe sempre este objeto; nunca crie um `CredicarroClient` por requisição.
 */
export const client = new CredicarroClient({
  clientId: requireEnv('CREDICARRO_CLIENT_ID'),
  clientSecret: requireEnv('CREDICARRO_CLIENT_SECRET'),
  ...(baseUrl ? { baseUrl } : { environment: CredicarroEnvironment.Staging }),
  // Os padrões já são bons (30 s no total, 10 s por tentativa, 3 tentativas, circuit breaker). Só ajuste com motivo:
  // resilience: { maxRetryAttempts: 4, attemptTimeoutMs: 8_000 },
});

/** Texto seguro para log: só tipo do erro, status e código estável. Nunca `detail`, `rawBody`, CPF ou segredo. */
export function describeError(error: unknown): string {
  if (error instanceof CredicarroRateLimitError) return `${error.name} | Status: 429 | EsperaMs: ${error.retryAfterMs ?? 'n/d'}`;
  if (error instanceof CredicarroApiError) return `${error.name} | Status: ${error.statusCode} | Codigo: ${error.errorCode ?? 'n/d'}`;
  if (error instanceof Error) return error.name;
  return 'ErroDesconhecido';
}

/** Trata os erros pela classe e pelo `errorCode` estável (nunca pelo texto de `detail`). */
export async function createProposalOrExplain(cpf: string, simulationId: string): Promise<string | undefined> {
  try {
    return await client.proposals.create({ cpf, simulationId });
  } catch (error) {
    if (error instanceof CredicarroBusinessRuleError && error.errorCode === 'Proposal.SimulationAlreadyExpired') {
      return undefined; // simule de novo
    }
    if (error instanceof CredicarroValidationError) {
      console.warn(`dados inválidos | Campo: ${error.field ?? 'n/d'} | Codigo: ${error.errorCode ?? 'n/d'}`);
    } else if (error instanceof CredicarroTimeoutError || error instanceof CredicarroAuthenticationError) {
      // timeout (de tentativa, total ou circuit breaker aberto) e falha de credencial: não repita num laço seu
      console.error(describeError(error));
    }
    throw error;
  }
}

/** Sem auto-paginação: você avança as páginas. Use `hasNext`, não "até vir página vazia". */
export async function collectAll<T>(fetchPage: (request: ListRequest) => Promise<PagedResult<T>>, pageSize = 100): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  for (;;) {
    const result = await fetchPage({ page, pageSize });
    items.push(...result.items);
    if (!result.hasNext) return items;
    page += 1;
  }
}

// Exemplo: const propostas = await collectAll((request) => client.proposals.list(request));
