import { randomUUID } from 'node:crypto';
import {
  DepositAccountType,
  DocumentFile,
  DocumentType,
  PendingActionKind,
  ProposalParticipant,
  ProposalStatus,
  getPendingActions,
  type DepositAccount,
  type PendingAction,
  type ProposalDetails,
  type VehicleDetails,
} from '@twila/credicarro';
import { client, describeError } from './client';

/** Cria a proposta a partir do `simulationId` da opção escolhida e lê o retrato dela. */
export async function createAndRead(cpf: string, simulationId: string): Promise<ProposalDetails> {
  const proposalId = await client.proposals.create({ cpf, simulationId });
  return client.proposals.get(proposalId);
}

/** Valor novo da API nunca quebra: o enum cai em Unknown e o valor bruto continua em statusRaw/statusName. */
export function describeStatus(proposal: ProposalDetails): string {
  if (proposal.status === ProposalStatus.Unknown) return `status novo: ${proposal.statusRaw} (${proposal.statusName})`;
  return ProposalStatus[proposal.status];
}

/** O que o integrador precisa fazer agora (só participantes com ActionOwner.Integrator). */
export function pendingActionsOf(proposal: ProposalDetails): PendingAction[] {
  return getPendingActions(proposal);
}

// --- Envio de documentos -----------------------------------------------------------------------------------

/**
 * Um envio pendente. Grave este registro ANTES de chamar a API: a `idempotencyKey` (UUID) pertence ao envio e é
 * reaproveitada só para repetir esse mesmo envio. Nunca derive a chave do arquivo, do nome ou do tipo do documento.
 */
export interface PendingUpload {
  proposalId: string;
  participant: ProposalParticipant;
  documentType: DocumentType;
  filePath: string;
  idempotencyKey: string;
}

/** Cria um envio NOVO (chave nova). Use também na correção de um documento recusado (etapa 7). */
export function newPendingUpload(
  proposalId: string,
  participant: ProposalParticipant,
  documentType: DocumentType,
  filePath: string,
): PendingUpload {
  return { proposalId, participant, documentType, filePath, idempotencyKey: randomUUID() };
}

/** Pode ser chamado de novo com o MESMO `PendingUpload` (queda, reinício): a chave guardada evita envio duplicado. */
export async function sendPendingUpload(pending: PendingUpload): Promise<void> {
  const file = await DocumentFile.fromFile(pending.filePath); // valida nome, extensão, tamanho (10 MiB) e Base64
  await client.proposals.uploadDocument(
    pending.proposalId,
    { participant: pending.participant, documentType: pending.documentType, file },
    pending.idempotencyKey,
  );
}

// --- Dados do veículo e conta de recebimento ---------------------------------------------------------------

/** Os dados vêm do sistema do integrador (cadastro do veículo); nada é fixo no código. */
export async function sendVehicleDetails(proposalId: string, details: VehicleDetails): Promise<void> {
  await client.proposals.sendVehicleDetails(proposalId, details);
}

/** Só refinanciamento, na etapa DepositAccount. Enviar de novo substitui a conta anterior. `account.holderCpf` precisa ser o CPF do comprador. */
export async function sendDepositAccount(proposalId: string, account: DepositAccount): Promise<void> {
  await client.proposals.sendDepositAccount(proposalId, account);
}

/** Uma tarefa pendente para o sistema do integrador resolver (fila, tela de backoffice, ticket). */
export interface PendingTask {
  proposalId: string;
  action: PendingAction;
}

/**
 * Descobre as ações pendentes e só as ENFILEIRA. Quem consome a fila busca os dados no sistema do integrador e chama
 * `sendPendingUpload`, `sendVehicleDetails` ou `sendDepositAccount` com eles (arquivo por participante, `PendingUpload` persistido,
 * dados do veículo, conta bancária). Este despachante nunca envia nada com dados fixos.
 */
export async function followProposal(proposalId: string, enqueue: (task: PendingTask) => Promise<void>): Promise<PendingAction[]> {
  const proposal = await client.proposals.get(proposalId);
  const actions = getPendingActions(proposal);

  for (const action of actions) {
    // documentTypes = tipos Pending (SendDocuments) ou Invalid (CorrectDocuments, com chave NOVA); documentTypesRaw preserva tipos novos.
    console.log(`ação pendente | Proposta: ${proposalId} | Tipo: ${PendingActionKind[action.kind]} | Participante: ${ProposalParticipant[action.participant]}`);
    await enqueue({ proposalId, action });
  }

  return actions;
}

// --- Listagem e rota v1 ------------------------------------------------------------------------------------

export async function listPage(page: number) {
  const result = await client.proposals.list({ page, pageSize: 20 }); // ProposalSummary: sem etapas nem documentos
  return { items: result.items, hasNext: result.hasNext };
}

/** Rota v1 (`client.v1.proposals`): devolve o resumo, não o retrato com etapas. Prefira `client.proposals`. */
export async function createV1AndRead(cpf: string, simulationId: string) {
  const proposalId = await client.v1.proposals.create({ cpf, simulationId });
  return client.v1.proposals.get(proposalId);
}

export async function safeFollow(proposalId: string, enqueue: (task: PendingTask) => Promise<void>): Promise<PendingAction[]> {
  try {
    return await followProposal(proposalId, enqueue);
  } catch (error) {
    console.error(`falha ao acompanhar a proposta | Proposta: ${proposalId} | ${describeError(error)}`);
    throw error;
  }
}
