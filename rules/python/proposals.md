# Propostas (Python)

A proposta é a solicitação de crédito, criada a partir de uma opção de simulação. Para cada participante (comprador, loja e, quando houver, vendedor), ela traz a etapa ativa e quem precisa agir. Os códigos de status, etapa, situação, responsável, biometria e documento estão em [Etapas e status da proposta](../proposal-steps.md). Acesse por `client.proposals` (v2) e `client.v1.proposals` (v1), usando o cliente único de [client.md](client.md).

## Tipos

```python
from twila_credicarro import (
    ProposalStatus, ProposalType, ProposalStep, StepSituation, ActionOwner, BiometryStatus, DocumentStatus, DocumentType,
    ProposalParticipant, DepositAccountType, PendingActionKind, DocumentFile,
    CreateProposalRequest, VehicleDetails, DepositAccount, ProposalDocumentUpload,
    ProposalDetails, ProposalSummary, ProposalParticipantState, PendingAction, ListRequest,
)

# IntEnum com UNKNOWN = -1. Compare pelo enum; o valor bruto fica em *_raw e *_name.
# ProposalStatus: ANALYSING 1, APPROVED 2, REFUSED 3, CANCELED 4, MANUAL_ANALYSIS 5, COMPLETED 6, IN_NEGOTIATION 7, EXPIRED 8, PENDING 9
# ProposalStep: UNDEFINED 0, PROPOSAL_CREATED 1, PROPOSAL_APPROVED 2, SELLER_NOTIFICATION 3, BIOMETRY_ANALYSIS 4, DEPOSIT_ACCOUNT 5,
#   DOCUMENT_SUBMISSION 6, DOCUMENT_CORRECTION 7, VEHICLE_DETAILS 8, INSPECTION 9, SIGNATURE 10, PAYMENT 11, PROPOSAL_COMPLETED 12
# StepSituation: AWAITING_SUBMISSION 1, AWAITING_CUSTOMER 2, PROCESSING 3, PENDING_CORRECTION 4, BLOCKED 5, COMPLETED 6, CANCELED 7
# ActionOwner: NONE 0, CUSTOMER 1, INTEGRATOR 2, CREDICARRO 3
# BiometryStatus: NOT_STARTED 0, SESSION_CREATED 1, IN_ANALYSIS 2, APPROVED 3, REJECTED 4
# DocumentStatus: RECEIVED 0, VALID 1, INVALID 2, IN_ANALYSIS 3, DELETED 4, PENDING 5
# DocumentType: CNH 1, CPF 2, RG 3, PROOF_OF_INCOME 4, PROOF_OF_ADDRESS 5, VEHICLE_DOCUMENT 6, DIGITAL_CNH 7, ECV_REPORT 8,
#   INSPECTION_REPORT 9, CNPJ_CARD 11, ATPV 57
# str Enum: ProposalParticipant (BUYER, SELLER, STORE), DepositAccountType (CHECKING, SAVINGS, PAYMENT),
#   PendingActionKind (SEND_DOCUMENTS, CORRECT_DOCUMENTS, SEND_VEHICLE_DETAILS, SEND_DEPOSIT_ACCOUNT)

@dataclass(frozen=True)
class ProposalDetails:               # GET v2/proposal/{id}
    id: str; number: Optional[int]; simulation_id: Optional[str]
    status: ProposalStatus; type: ProposalType
    status_raw: Optional[int] = None; status_name: Optional[str] = None
    created_at: Optional[datetime] = None; refusal_reason: Optional[str] = None; biometry_link: Optional[str] = None
    buyer: Optional[ProposalParticipantState] = None; seller: ...; store: ...
    def get_pending_actions(self) -> list[PendingAction]: ...

@dataclass(frozen=True)
class ProposalParticipantState:
    document: Optional[str]          # CPF (comprador, vendedor) ou CNPJ (loja)
    biometry: Optional[BiometryStatus]
    active_step: Optional[ActiveStep]            # step, situation, action_owner (+ *_raw e *_name)
    completed_steps: list[CompletedStep]         # step, date (+ *_raw e *_name)
    documents: list[ProposalDocument]            # type, status, reason (+ *_raw e *_name)

@dataclass(frozen=True)
class ProposalSummary:               # list e v1.get
    id: str; number: Optional[int]; simulation_id: Optional[str]; type: ProposalType; status: ProposalStatus
    status_name: Optional[str]; buyer_cpf: Optional[str]; seller_cpf: Optional[str]; created_at: Optional[datetime]

@dataclass(frozen=True)
class CreateProposalRequest: cpf: str; simulation_id: Union[str, UUID]
@dataclass(frozen=True)
class VehicleDetails: renavam: str; chassis: str; license_plate: str; color: str
@dataclass(frozen=True)
class DepositAccount:
    holder_cpf: str; bank_code: str; branch: str; branch_digit: str
    account_number: str; account_digit: str; account_type: DepositAccountType
@dataclass(frozen=True)
class ProposalDocumentUpload: participant: ProposalParticipant; document_type: DocumentType; file: DocumentFile
@dataclass(frozen=True)
class PendingAction:
    participant: ProposalParticipant; step: ProposalStep; kind: PendingActionKind
    document_types: tuple[DocumentType, ...] = ()
```

## Interface

```python
class ProposalsClient:   # client.proposals (v2)
    def create(self, request: CreateProposalRequest) -> str: ...                              # POST v2/proposal -> id_proposta
    def get(self, proposal_id: Identifier) -> ProposalDetails: ...                            # GET v2/proposal/{id}
    def list(self, request: Optional[ListRequest] = None) -> PagedResult[ProposalSummary]: ...  # GET v1/proposal
    def send_vehicle_details(self, proposal_id: Identifier, details: VehicleDetails) -> None: ...   # 204
    def send_deposit_account(self, proposal_id: Identifier, account: DepositAccount) -> None: ...   # 204, só refinanciamento
    def upload_document(self, proposal_id: Identifier, upload: ProposalDocumentUpload,
                        idempotency_key: Optional[str] = None) -> None: ...                    # 204

class V1ProposalsClient:  # client.v1.proposals
    def create(self, request: CreateProposalRequest) -> str: ...                              # POST v1/proposal
    def get(self, proposal_id: Identifier) -> ProposalSummary: ...                            # GET v1/proposal/{id}

get_pending_actions(proposal: ProposalDetails | ProposalWebhookEvent) -> list[PendingAction]   # também: proposal.get_pending_actions() e event.get_pending_actions()

DocumentFile.from_file(path, file_name: Optional[str] = None) -> DocumentFile
DocumentFile.from_bytes(content: bytes, file_name: str) -> DocumentFile        # conteúdo primeiro
DocumentFile.from_stream(stream: BinaryIO, file_name: str) -> DocumentFile      # lê em laço, limite 10 MiB + 1
```

## Features

- **`proposal.get_pending_actions()`** olha só os participantes cuja etapa ativa tem o **integrador** como responsável (`ActionOwner.INTEGRATOR`): etapa 6 → `SEND_DOCUMENTS` (documentos `PENDING`); 7 → `CORRECT_DOCUMENTS` (documentos `INVALID`); 8 → `SEND_VEHICLE_DETAILS`; 5 → `SEND_DEPOSIT_ACCOUNT`. Não reimplemente essa regra.
- **`DocumentFile`** valida antes de enviar: nome sem caminho com até 255 caracteres, extensão `.pdf`, `.jpg`, `.jpeg` ou `.png`, de 1 byte a 10 MiB, Base64 puro (sem `data:`). Vale também para `DocumentFile(file_name, base64_content)` direto. `from_file` e `from_stream` leem em laço com limite de 10 MiB + 1 byte (não confiam no tamanho informado); o conteúdo é guardado uma só vez e reaproveitado em todas as tentativas. Falha com `ValueError`, sem chamar a API. O conteúdo Base64 não aparece em `repr`.
- **`upload_document` e a chave:** a `Idempotency-Key` é obrigatória na API. Passe `idempotency_key` (UUID) **por envio**, guardada com o envio pendente e reaproveitada só ao repetir esse mesmo envio. Na correção de um documento recusado (etapa 7), gere uma chave **nova**. Nunca derive a chave do conteúdo, do nome ou do tipo. Sem `idempotency_key`, o SDK gera uma por chamada e a repete em todas as tentativas daquela chamada.
- `send_vehicle_details` e `send_deposit_account` substituem o que foi enviado antes; por isso o SDK os repete em falha transitória.
- `create`, no v2 e no v1, envia a `Idempotency-Key` sozinho.
- `list` devolve o formato resumido (`ProposalSummary`, status mapeado do nome em inglês). Use `get` para etapas e documentos.
- `ProposalWebhookEvent.get_pending_actions()` (webhook v2, `is_detailed`) lista as mesmas ações sem consultar a API; no payload v1 não há participantes, então consulte a proposta.
- Olhe o `active_step` de **cada** participante: loja e comprador podem estar em etapas diferentes.
- Rotas v1 (`client.v1.proposals`): só `create` e `get`. Uma proposta criada em `/v1` **não** aceita `client.proposals.get` nem os envios v2 (`422 Proposal.Access.NotIntegrationV2`).

## Exemplo
(Fonte: `examples/python/proposals.py`)

```python
proposal_id = client.proposals.create(CreateProposalRequest(cpf=cpf, simulation_id=simulation_id))
proposta = client.proposals.get(proposal_id)

# O despachante só lista/enfileira: não envia nada com dados digitados no código.
for acao in proposta.get_pending_actions():
    fila.enqueue(proposal_id, acao.participant, acao.kind, acao.document_types)

# O consumidor da fila busca os dados reais no sistema do integrador e chama o envio correspondente:
def enviar_documento(pending: PendingUpload) -> None:        # PendingUpload gravado ANTES de chamar a API
    arquivo = DocumentFile.from_file(pending.file_path)       # correção (etapa 7) = envio novo = chave nova
    client.proposals.upload_document(
        pending.proposal_id,
        ProposalDocumentUpload(participant=pending.participant, document_type=pending.document_type, file=arquivo),
        idempotency_key=pending.idempotency_key,
    )

def enviar_veiculo(proposal_id: str, veiculo: VehicleDetails) -> None:   # `veiculo` vem do seu cadastro
    client.proposals.send_vehicle_details(proposal_id, veiculo)
```

## Erros e casos de borda

- Criação: `422 Customer.Account.Incomplete`, `Proposal.SimulationAlreadyActivated`, `Proposal.SimulationAlreadyExpired`, `Proposal.BuyerAgeNotAllowed`, `Simulation.Access.NotFromStore`; `409 Proposal.IdempotencyKeyReused`.
- Dados do veículo fora da etapa `VEHICLE_DETAILS`: `422 Proposal.InvalidStatus`. Conta fora de `DEPOSIT_ACCOUNT`: `422 Proposal.ProposalIsNotInDepositAccountStatus`; em financiamento: `Proposal.DepositAccount.OnlyRefinancing`; `holder_cpf` diferente do cliente: `Proposal.DepositAccount.HolderNotBuyer`.
- **Documento:** tipos aceitos por participante: comprador 1, 4, 5, 6, 7, 9, 57; vendedor 1, 2, 3, 5, 6, 7, 8, 9, 11; loja 6, 8. Envio na etapa errada: `422 Document.InvalidProposalStage`. Na correção, só reenvie tipos com status `INVALID`, com **nova** chave; senão `Document.NotPendingCorrection`. Conteúdo que não bate com a extensão: `Document.InvalidContent`.
- Chave de documento reusada com outro conteúdo: `409 Idempotency.KeyConflict`. Falha de armazenamento: `502 Document.UploadFailed`; o SDK já repete com a mesma chave, e ao reiniciar o processo você repete o mesmo `PendingUpload`.
- `upload_document` com `document_type` `UNKNOWN` ou `idempotency_key` fora de 1 a 200 caracteres ASCII imprimíveis (ou só espaços) lança `ValueError` antes de chamar a API.
- Status, etapa ou documento desconhecidos chegam como `UNKNOWN`; registre o `*_raw` e siga em frente, sem lançar erro. `get_pending_actions` ignora etapas que não conhece.
- O `repr` de requisições e respostas mascara CPF (`***.456.789-**`), e-mail, celular, renda e dados da conta; ainda assim não registre esses objetos nem o conteúdo do documento em log; use só `proposal_id`, tipo do documento e o `error_code`. Veja [segurança](security.md).
