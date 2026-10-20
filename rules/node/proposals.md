# Propostas (Node.js)

A proposta é a solicitação de crédito, criada a partir de uma opção de simulação. Para cada participante (comprador, loja e, quando houver, vendedor), ela traz a etapa ativa e quem precisa agir. Os códigos de status, etapa, situação, responsável, biometria e documento estão em [Etapas e status da proposta](../proposal-steps.md). Acesse por `client.proposals` (v2) e `client.v1.proposals` (v1), usando o cliente único de [client.md](client.md).

## Tipos

```typescript
import {
  ProposalStatus, ProposalType, ProposalStep, StepSituation, ActionOwner, BiometryStatus, DocumentStatus, DocumentType,
  ProposalParticipant, DepositAccountType, PendingActionKind, DocumentFile,
  type ProposalDetails, type ProposalSummary, type ProposalParticipantState, type PendingAction,
} from '@twila/credicarro';

// Todos os enums têm Unknown = -1. Compare pelo enum; o valor bruto fica em *Raw e *Name.
// ProposalStatus: Analysing 1, Approved 2, Refused 3, Canceled 4, ManualAnalysis 5, Completed 6, InNegotiation 7, Expired 8, Pending 9
// ProposalStep: Undefined 0, ProposalCreated 1, ProposalApproved 2, SellerNotification 3, BiometryAnalysis 4, DepositAccount 5,
//   DocumentSubmission 6, DocumentCorrection 7, VehicleDetails 8, Inspection 9, Signature 10, Payment 11, ProposalCompleted 12
// StepSituation: AwaitingSubmission 1, AwaitingCustomer 2, Processing 3, PendingCorrection 4, Blocked 5, Completed 6, Canceled 7
// BiometryStatus: NotStarted 0, SessionCreated 1, InAnalysis 2, Approved 3, Rejected 4
// ActionOwner: None 0, Customer 1, Integrator 2, Credicarro 3
// DocumentStatus: Received 0, Valid 1, Invalid 2, InAnalysis 3, Deleted 4, Pending 5
// DocumentType: Cnh 1, Cpf 2, Rg 3, ProofOfIncome 4, ProofOfAddress 5, VehicleDocument 6, DigitalCnh 7, EcvReport 8, InspectionReport 9, CnpjCard 11, Atpv 57
// ProposalParticipant: Buyer, Seller, Store      DepositAccountType: Checking, Savings, Payment

interface ProposalDetails {          // GET v2/proposal/{id}
  id: string; number: number; simulationId: string;
  status: ProposalStatus; statusRaw: number; statusName: string; type: ProposalType;
  createdAt: string; refusalReason?: string; biometryLink?: string;
  buyer?: ProposalParticipantState; seller?: ProposalParticipantState; store?: ProposalParticipantState;
}
interface ProposalParticipantState {
  document: string;                  // CPF (comprador, vendedor) ou CNPJ (loja)
  biometry?: BiometryStatus; biometryRaw?: number; biometryName?: string;
  activeStep?: { step: ProposalStep; situation: StepSituation; actionOwner: ActionOwner /* + *Raw e *Name */ };
  completedSteps: { step: ProposalStep; stepRaw: number; stepName: string; date?: string }[];
  documents: { type: DocumentType; status: DocumentStatus; reason?: string /* + *Raw e *Name */ }[];
}
interface ProposalSummary {          // list e v1.get
  id: string; number: number; simulationId: string; type: ProposalType;
  status: ProposalStatus; statusName: string; buyerCpf: string; sellerCpf?: string; createdAt: string;
}

interface CreateProposalRequest { cpf: string; simulationId: string }
interface VehicleDetails { renavam: string; chassis: string; licensePlate: string; color: string }
interface DepositAccount {
  holderCpf: string; bankCode: string; branch: string; branchDigit: string;
  accountNumber: string; accountDigit: string; accountType: DepositAccountType;
}
interface ProposalDocumentUpload { participant: ProposalParticipant; documentType: DocumentType; file: DocumentFile }
interface PendingAction { participant: ProposalParticipant; step: ProposalStep; kind: PendingActionKind; documentTypes: DocumentType[]; documentTypesRaw: number[] }
enum PendingActionKind { SendDocuments = 1, CorrectDocuments = 2, SendVehicleDetails = 3, SendDepositAccount = 4 }
```

## Interface

```typescript
interface ProposalsClient {          // client.proposals (v2)
  create(request: CreateProposalRequest): Promise<string>;                 // POST v2/proposal -> id_proposta
  get(proposalId: string): Promise<ProposalDetails>;                       // GET v2/proposal/{id}
  list(request?: ListRequest): Promise<PagedResult<ProposalSummary>>;      // GET v1/proposal
  sendVehicleDetails(proposalId: string, details: VehicleDetails): Promise<void>;  // 204
  sendDepositAccount(proposalId: string, account: DepositAccount): Promise<void>;  // 204, só refinanciamento
  uploadDocument(proposalId: string, upload: ProposalDocumentUpload, idempotencyKey?: string): Promise<void>; // 204
}

interface V1ProposalsClient {        // client.v1.proposals
  create(request: CreateProposalRequest): Promise<string>;                 // POST v1/proposal
  get(proposalId: string): Promise<ProposalSummary>;                       // GET v1/proposal/{id}
}

function getPendingActions(proposal: ProposalParticipants): PendingAction[];  // helper do SDK; aceita ProposalDetails ou ProposalWebhookEvent (v2)

DocumentFile.fromFile(path: string, fileName?: string): Promise<DocumentFile>;
DocumentFile.fromBytes(content: Buffer | Uint8Array, fileName: string): DocumentFile;
DocumentFile.fromStream(stream: Readable, fileName: string): Promise<DocumentFile>;
```

## Features

- **`getPendingActions(proposal)`** olha só os participantes cuja etapa ativa tem o **integrador** como responsável (`ActionOwner.Integrator`): etapa 6 → `SendDocuments` (documentos `Pending`); 7 → `CorrectDocuments` (documentos `Invalid`); 8 → `SendVehicleDetails`; 5 → `SendDepositAccount`. Não reimplemente essa regra.
- **`DocumentFile`** (`fromBytes`, `fromStream`, `fromFile`) lê em laço com limite de 10 MiB + 1 byte (nunca confia no tamanho informado) e `util.inspect` não mostra o conteúdo (`JSON.stringify` o inclui, para persistir o envio pendente). Valida antes de enviar: nome sem caminho com até 255 caracteres, extensão `.pdf`, `.jpg`, `.jpeg` ou `.png`, de 1 byte a 10 MiB, Base64 puro (sem `data:`). Falha com `RangeError`, sem chamar a API.
- **`uploadDocument` e a chave:** a `Idempotency-Key` é obrigatória na API. Passe `idempotencyKey` (UUID) **por envio**, guardada com o envio pendente e reaproveitada só ao repetir esse mesmo envio. Na correção de um documento recusado (etapa 7), gere uma chave **nova**. Nunca derive a chave do conteúdo, do nome ou do tipo. Sem `idempotencyKey`, o SDK gera uma por chamada e a repete em todas as tentativas daquela chamada.
- `documentTypesRaw` (em `PendingAction`) preserva o código de tipos de documento que o SDK ainda não conhece (o enum vira `Unknown`).
- **Acompanhar a proposta não envia dados fixos:** o despachante (`followProposal`) só lista/enfileira as ações; as funções de envio recebem os dados (veículo, conta, arquivo por participante, `PendingUpload` persistido) do sistema do integrador.
- O orçamento do envio de documento é tentativa × tentativas (padrão 180 s), e o SDK reaproveita o mesmo corpo em todas as tentativas.
- `sendVehicleDetails` e `sendDepositAccount` substituem o que foi enviado antes; por isso o SDK os repete em falha transitória.
- `create`, no v2 e no v1, envia a `Idempotency-Key` sozinho.
- `list` devolve o formato resumido (`ProposalSummary`, status mapeado do nome em inglês). Use `get` para etapas e documentos.
- Olhe o `activeStep` de **cada** participante: loja e comprador podem estar em etapas diferentes.
- Rotas v1 (`client.v1.proposals`): só `create` e `get`. Uma proposta criada em `/v1` **não** aceita `client.proposals.get` nem os envios v2 (`422 Proposal.Access.NotIntegrationV2`).

## Exemplo
(Fonte: `examples/node/proposals.ts`)

```typescript
const proposalId = await client.proposals.create({ cpf, simulationId });
const proposta = await client.proposals.get(proposalId);

// O despachante só enfileira; o consumidor da fila busca os dados no seu sistema.
for (const acao of getPendingActions(proposta)) {
  await fila.enqueue({ proposalId, acao }); // SendDocuments/CorrectDocuments -> sendPendingUpload(PendingUpload persistido)
}

// Consumidor (dados vêm do sistema do integrador, nunca literais):
await sendVehicleDetails(proposalId, veiculoDoSistema); // VehicleDetails
await sendDepositAccount(proposalId, contaDoSistema); // DepositAccount
await sendPendingUpload(envioPersistido); // { proposalId, participant, documentType, filePath, idempotencyKey }
```

## Erros e casos de borda

- Criação: `422 Customer.Account.Incomplete`, `Proposal.SimulationAlreadyActivated`, `Proposal.SimulationAlreadyExpired`, `Proposal.BuyerAgeNotAllowed`, `Simulation.Access.NotFromStore`; `409 Proposal.IdempotencyKeyReused`.
- Dados do veículo fora da etapa `VehicleDetails`: `422 Proposal.InvalidStatus`. Conta fora de `DepositAccount`: `422 Proposal.ProposalIsNotInDepositAccountStatus`; em financiamento: `Proposal.DepositAccount.OnlyRefinancing`; `holderCpf` diferente do cliente: `Proposal.DepositAccount.HolderNotBuyer`.
- **Documento:** tipos aceitos por participante: comprador 1, 4, 5, 6, 7, 9, 57; vendedor 1, 2, 3, 5, 6, 7, 8, 9, 11; loja 6, 8. Envio na etapa errada: `422 Document.InvalidProposalStage`. Na correção, só reenvie tipos com status `Invalid`, com **nova** chave; senão `Document.NotPendingCorrection`. Conteúdo que não bate com a extensão: `Document.InvalidContent`.
- Chave de documento reusada com outro conteúdo: `409 Idempotency.KeyConflict`. Falha de armazenamento: `502 Document.UploadFailed`; o SDK já repete com a mesma chave, e ao reiniciar o processo você repete o mesmo `PendingUpload`.
- `sendDepositAccount` com `accountType` `Unknown` e `uploadDocument` com participante ou tipo `Unknown` lançam `RangeError` antes de chamar a API.
- Status, etapa ou documento desconhecidos chegam como `Unknown`; registre o `*Raw` e siga em frente, sem lançar erro. `getPendingActions` ignora etapas que não conhece.
- Não registre CPF nem o conteúdo do documento em log; use só `proposalId`, tipo do documento e o `errorCode`. Veja [segurança](security.md).
