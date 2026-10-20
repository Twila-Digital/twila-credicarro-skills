import express from 'express'; // npm i express && npm i -D @types/express
import {
  CredicarroWebhookSignatureError,
  WebhookAuthenticationType,
  WebhookStatus,
  WebhookType,
  getPendingActions,
  parseWebhookEvent,
  verifyWebhookAuthorization,
  verifyWebhookSignature,
} from '@twila/credicarro';
import { client, describeError } from './client';

// --- Cadastro e manutenção ---------------------------------------------------------------------------------

/**
 * Cadastra o webhook de proposta. O `signingSecret` só vem nesta resposta: `saveSecret` deve gravá-lo no cofre
 * de segredos ANTES de qualquer outra coisa. A rota não é repetida pelo SDK; se der timeout, liste antes de cadastrar de novo.
 */
export async function registerProposalWebhook(
  url: string,
  saveSecret: (secret: string) => Promise<void>,
  basicCredentialBase64?: string,
): Promise<string> {
  const result = await client.webhooks.create({
    type: WebhookType.Proposal,
    url, // HTTPS pública; localhost e IP privado são recusados
    authenticationType: basicCredentialBase64 ? WebhookAuthenticationType.Basic : WebhookAuthenticationType.None,
    credential: basicCredentialBase64, // Base64 de "usuario:senha" (Basic) ou o token (Jwt)
  });

  await saveSecret(result.signingSecret);
  return result.webhookId;
}

export async function listWebhooks() {
  return client.webhooks.list({ page: 1, pageSize: 20 }); // cada item: id, type, url, authenticationType, status
}

export async function deactivateWebhook(webhookId: string, url: string): Promise<void> {
  await client.webhooks.update(webhookId, { type: WebhookType.Proposal, url, status: WebhookStatus.Inactive });
}

export async function deleteWebhook(webhookId: string): Promise<void> {
  await client.webhooks.delete(webhookId);
}

// --- Vetor de teste da documentação ------------------------------------------------------------------------

/** Deve devolver true. `nowMs` fixa o relógio em `t`; sem isso a tolerância de 5 min rejeitaria a data antiga. */
export function checkDocumentationVector(): boolean {
  const body = '{"id_proposta":"bea8d060-f93d-48eb-b6c4-45f64483cdd9","enum_status":2,"status":"Approved"}';
  const header = 't=1715792400,v1=db66c554eb116ef2577deb63f72619793502a31520f622b2d59864b074eb8df2';
  return verifyWebhookSignature(body, header, 'segredo-de-exemplo', { nowMs: 1715792400 * 1000 });
}

// --- Endpoint de recebimento -------------------------------------------------------------------------------

// Obrigatório: sem segredo a aplicação não sobe (HMAC com chave vazia é forjável).
const signingSecret = process.env.CREDICARRO_WEBHOOK_SECRET;
if (!signingSecret) throw new Error('CREDICARRO_WEBHOOK_SECRET é obrigatória');
// Valor completo esperado do header Authorization ("Basic ..." ou "Bearer ..."); defina se o webhook usa Basic/Jwt.
const expectedAuthorization = process.env.CREDICARRO_WEBHOOK_AUTHORIZATION;

/** Deduplicação atômica. Em produção: Redis `SET chave 1 NX EX <ttl>` (claim) e `DEL chave` (release). */
interface DedupStore {
  claim(key: string): Promise<boolean>; // true = primeira vez; false = já visto
  release(key: string): Promise<void>; // desfaz o claim quando não deu para enfileirar
}

class MemoryDedupStore implements DedupStore {
  private readonly seen = new Set<string>();

  async claim(key: string): Promise<boolean> {
    if (this.seen.has(key)) return false; // sem await entre checar e marcar: atômico no event loop
    this.seen.add(key);
    return true;
  }

  async release(key: string): Promise<void> {
    this.seen.delete(key);
  }
}

/** Fila em memória só para o exemplo: em produção use fila durável (SQS, RabbitMQ, tabela outbox). */
class JobQueue {
  private readonly jobs: string[] = [];
  private draining = false;

  constructor(private readonly handle: (proposalId: string) => Promise<void>) {}

  enqueue(proposalId: string): void {
    this.jobs.push(proposalId);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (let job = this.jobs.shift(); job !== undefined; job = this.jobs.shift()) {
        try {
          await this.handle(job);
        } catch (error) {
          // Falha por job, sem PII: só o id da proposta e o tipo do erro.
          console.error(`falha ao processar webhook | Proposta: ${job} | ${describeError(error)}`);
        }
      }
    } finally {
      this.draining = false;
    }
  }
}

async function processProposal(proposalId: string): Promise<void> {
  // Entregas chegam fora de ordem: consulte a proposta para o estado mais recente.
  const proposal = await client.proposals.get(proposalId);
  const actions = getPendingActions(proposal);
  console.log(`proposta ${proposal.id}: status ${proposal.statusName} | ações pendentes: ${actions.length}`);
}

const dedup: DedupStore = new MemoryDedupStore();
const queue = new JobQueue(processProposal);

export const app = express();

// express.raw preserva os bytes exatos (a assinatura é do corpo bruto) e limita o corpo a 1 MiB. Nunca use express.json() aqui.
app.post('/webhooks/credicarro', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const raw: unknown = req.body;
  if (!Buffer.isBuffer(raw)) {
    res.sendStatus(401); // POST sem corpo
    return;
  }

  if (expectedAuthorization && !verifyWebhookAuthorization(req.header('Authorization'), expectedAuthorization)) {
    res.sendStatus(401);
    return;
  }

  const signature = req.header('X-CrediCarro-Signature') ?? '';
  if (!verifyWebhookSignature(raw, signature, signingSecret)) {
    res.sendStatus(401);
    return;
  }

  let proposalId: string;
  try {
    // parseWebhookEvent verifica a assinatura de novo e lê o corpo (v1 ou v2); o SDK exige um id_proposta UUID.
    // Falha de leitura: 400, repetir não adianta.
    proposalId = parseWebhookEvent(raw, signature, signingSecret).proposalId;
  } catch (error) {
    if (error instanceof CredicarroWebhookSignatureError) {
      res.sendStatus(400);
      return;
    }
    throw error;
  }

  const idempotencyKey = req.header('Idempotency-Key') ?? ''; // {id_mensagem}:{id_webhook}
  const first = idempotencyKey ? await dedup.claim(idempotencyKey) : true;
  if (!first) {
    res.sendStatus(200); // entrega repetida: já foi aceita
    return;
  }

  try {
    queue.enqueue(proposalId); // só responde 2xx depois de enfileirar
  } catch {
    if (idempotencyKey) await dedup.release(idempotencyKey);
    res.sendStatus(503); // a Credicarro repete a entrega
    return;
  }

  res.sendStatus(200); // responda 2xx rápido (limite de 15 s)
});

// Corpo acima de 1 MiB (413) e demais erros: nunca vazam detalhes.
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = (error as { status?: number } | null)?.status;
  res.sendStatus(status === 413 ? 413 : 400);
});
