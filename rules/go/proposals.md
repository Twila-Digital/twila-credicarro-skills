# Propostas (Go)

`ProposalsClient` (como `client.Proposals`) cria a proposta, acompanha as etapas e envia o que a Credicarro pede ao integrador (documentos, dados do veículo e conta de recebimento). O significado de status, etapas e situações está em [Etapas e status da proposta](../proposal-steps.md). As rotas v1 ficam em `client.V1.Proposals`.

## Structs e tipos

```go
type CreateProposalRequest struct { Cpf string; SimulationID string } // cpf, simulacaoId (UUID)

type ProposalDetails struct {
    ID string; Number int64; SimulationID string
    Status ProposalStatus; StatusRaw int; StatusName string
    Type ProposalType; TypeRaw string
    CreatedAt, RefusalReason, BiometryLink string
    Buyer, Seller, Store *ProposalParticipantState // podem ser nil
}
func (p *ProposalDetails) PendingActions() []PendingAction // só o que cabe ao integrador

type ProposalParticipantState struct {
    Document string // cpf (comprador, vendedor) ou cnpj (loja)
    Biometry *BiometryStatus; BiometryRaw int; BiometryName string
    ActiveStep *ActiveStepState; CompletedSteps []CompletedStepState; Documents []ProposalDocumentState
}
type ActiveStepState struct {
    Step ProposalStep; StepRaw int; StepName string
    Situation StepSituation; SituationRaw int; SituationName string
    ActionOwner ActionOwner; ActionOwnerRaw int; ActionOwnerName string
}
type ProposalDocumentState struct {
    Type DocumentType; TypeRaw int; TypeName string
    Status DocumentStatus; StatusRaw int; StatusName string
    Reason string // motivo da recusa, quando houver
}

type PendingActionKind string // PendingActionSendDocuments | CorrectDocuments | SendVehicleDetails | SendDepositAccount
type PendingAction struct {
    Participant ProposalParticipant; Step ProposalStep; Kind PendingActionKind
    DocumentTypes []DocumentType // Pending em SendDocuments, Invalid em CorrectDocuments
}

type VehicleDetails struct { Renavam, Chassis, LicensePlate, Color string }
type DepositAccount struct {
    HolderCpf, BankCode, Branch, BranchDigit, AccountNumber, AccountDigit string
    AccountType DepositAccountType // DepositAccountTypeChecking | Savings | Payment ("CORRENTE" | "POUPANCA" | "PAGAMENTO")
}
type ProposalParticipant string // ProposalParticipantBuyer | Seller | Store ("COMPRADOR" | "VENDEDOR" | "LOJA")
type ProposalDocumentUpload struct { Participant ProposalParticipant; DocumentType DocumentType; File DocumentFile }

type ProposalSummary struct { // GET v1/proposal e v1/proposal/{id}
    ID string; Number int64; SimulationID string
    Type ProposalType; TypeRaw string
    Status ProposalStatus; StatusName string
    BuyerCpf, SellerCpf, CreatedAt string
}
```

`DocumentFile` (`NewDocumentFileFromBytes(content, fileName)`, `NewDocumentFileFromReader(r, fileName)`, `NewDocumentFileFromFile(path, fileName)`; `fileName` vazio usa o nome do arquivo) valida o nome (sem caminho, até 255 caracteres), a extensão (`.pdf`, `.jpg`, `.jpeg`, `.png`) e o tamanho (1 byte a 10 MiB), e gera o Base64 puro, sem `data:`. Falhas voltam como `*ConfigurationError`.

## Métodos

```go
func (c *ProposalsClient) Create(ctx context.Context, req CreateProposalRequest, opts ...RequestOption) (string, error)      // POST v2/proposal -> id_proposta
func (c *ProposalsClient) Get(ctx context.Context, proposalID string) (*ProposalDetails, error)                               // GET v2/proposal/{id}
func (c *ProposalsClient) List(ctx context.Context, req *ListRequest) (*PagedResult[ProposalSummary], error)                  // GET v1/proposal
func (c *ProposalsClient) SendVehicleDetails(ctx context.Context, proposalID string, details VehicleDetails) error            // POST .../vehicle-detail -> 204
func (c *ProposalsClient) SendDepositAccount(ctx context.Context, proposalID string, account DepositAccount) error            // POST .../deposit-account -> 204
func (c *ProposalsClient) UploadDocument(ctx context.Context, proposalID string, upload ProposalDocumentUpload, opts ...RequestOption) error // POST .../document -> 204

// client.V1.Proposals
func (c *V1ProposalsClient) Create(ctx context.Context, req CreateProposalRequest, opts ...RequestOption) (string, error)     // POST v1/proposal
func (c *V1ProposalsClient) Get(ctx context.Context, proposalID string) (*ProposalSummary, error)                              // GET v1/proposal/{id}
```

## Features

- O cliente precisa ter cadastro completo (endereço, ocupação e renda) e a simulação deve ser de uma loja de integração.
- **Compare enums, não texto.** Os enums (`ProposalStatus`, `ProposalStep`, `StepSituation`, `ActionOwner`, `DocumentType`...) têm `...Unknown` (`-1`) para valor novo da API; o número e o nome originais ficam em `...Raw` e `...Name`. Use o nome só em tela e log e trate `Unknown` como "sem ação" (o `default` do `switch`).
- **`PendingActions()`** percorre `Buyer`, `Seller` e `Store` e devolve só as etapas ativas com `ActionOwner == ActionOwnerIntegrator`: `ProposalStepDocumentSubmission` vira `PendingActionSendDocuments` (tipos com status `Pending`), `ProposalStepDocumentCorrection` vira `PendingActionCorrectDocuments` (tipos `Invalid`, com o motivo em `ProposalDocumentState.Reason`), `ProposalStepVehicleDetails` vira `PendingActionSendVehicleDetails` e `ProposalStepDepositAccount` vira `PendingActionSendDepositAccount`.
- Do webhook detalhado (payload v2), `event.PendingActions()` aplica a mesma regra sobre os participantes do evento; no payload v1 não há participantes, então consulte a proposta com `Get`.
- **Despachante sem dados literais:** `PendingActions()` só diz *o que* falta. Quem executa recebe os dados (veículo, conta, arquivo por participante, `PendingUpload` persistido) do **sistema do integrador**, por parâmetro. Nunca deixe Renavam, chassi, CPF ou conta literais no código.
- `SendVehicleDetails` só funciona com a etapa `DADOS_VEICULO` (8) ativa. `SendDepositAccount` só em refinanciamento, com a etapa `CONTA_RECEBIMENTO` (5), e o titular deve ser o cliente. Reenviar substitui, e o SDK repete a chamada em falha transitória.
- **`UploadDocument`** sempre leva `Idempotency-Key`. Sem `WithIdempotencyKey`, o SDK gera uma por chamada e a repete nas tentativas **dessa** chamada. Para sobreviver a reinício do seu processo, **gere um UUID por envio, guarde-o junto ao envio pendente e passe-o** com `credicarro.WithIdempotencyKey`. Na correção (etapa `CORRECAO_DOCUMENTOS`), use uma chave **nova**. **Nunca use uma chave determinística** (como `doc-{proposta}-{participante}-{tipo}`): a mesma chave com outro arquivo retorna `409 Idempotency.KeyConflict`; com o mesmo arquivo em 24 h, a API devolve `204` sem reprocessar.
- Participantes: `COMPRADOR`, `VENDEDOR`, `LOJA`. Tipos de documento: comprador 1, 4, 5, 6, 7, 9, 57; vendedor 1, 2, 3, 5, 6, 7, 8, 9, 11; loja 6, 8.
- Prefira o webhook para saber de mudanças; use `Get` para o estado atual. Veja [webhooks.md](webhooks.md).
- `List` (`v1/proposal`) e `V1.Proposals.Get` devolvem o formato resumido (`ProposalSummary`), com `Status` a partir do nome em inglês; o retrato v2 (`ProposalDetails`) traz etapas e documentos.

## Exemplo

(Fonte: `examples/go/proposals.go`)

```go
// O despachante só lista as ações pendentes; os dados vêm do sistema do integrador (handlers).
type pendingActionHandlers struct {
    FindUpload  func(proposalID string, participant credicarro.ProposalParticipant, documentType credicarro.DocumentType) (pendingUpload, bool)
    VehicleData func(proposalID string) (credicarro.VehicleDetails, bool)
    DepositData func(proposalID string) (credicarro.DepositAccount, bool)
}

proposal, err := client.Proposals.Get(ctx, proposalID)
for _, action := range proposal.PendingActions() {
    switch action.Kind {
    case credicarro.PendingActionSendDocuments, credicarro.PendingActionCorrectDocuments:
        for _, documentType := range action.DocumentTypes {
            if upload, ok := handlers.FindUpload(proposalID, action.Participant, documentType); ok {
                // upload é o pendingUpload persistido: UUID por envio, guardado antes de chamar a API; nova chave na correção
                err = uploadDocument(ctx, client, upload)
            }
        }
    case credicarro.PendingActionSendVehicleDetails:
        if details, ok := handlers.VehicleData(proposalID); ok {
            err = client.Proposals.SendVehicleDetails(ctx, proposalID, details)
        }
    case credicarro.PendingActionSendDepositAccount:
        if account, ok := handlers.DepositData(proposalID); ok {
            err = client.Proposals.SendDepositAccount(ctx, proposalID, account)
        }
    }
}
```

## Erros e casos de borda

- `404`: `Proposal.Access.NotFound`, `Customer.Account.NotFound`, `Simulation.Access.NotFound`, `Store.Integration.NotFound`.
- `*BusinessRuleError` (`422`) na criação: `Customer.Account.Incomplete`, `Simulation.Access.NotFromStore`, `Proposal.SimulationAlreadyActivated`, `Proposal.SimulationAlreadyExpired`, `Proposal.BuyerAgeNotAllowed`, `Store.Integration.Intermediation`.
- `422` nos envios: `Proposal.InvalidStatus`, `Proposal.ProposalIsNotInDepositAccountStatus`, `Proposal.DepositAccount.OnlyRefinancing`, `Proposal.DepositAccount.HolderNotBuyer`, `Document.InvalidProposalStage`, `Document.NotPendingCorrection`, `Document.InvalidContent`, `Document.InvalidProposalModality`.
- `409`: `Proposal.IdempotencyKeyReused` (criação) e `Idempotency.KeyConflict` (documento).
- `502 Document.UploadFailed`: o SDK repete com a mesma chave; se persistir, repita o envio com a chave guardada.
- `proposalID` ou `SimulationID` que não são UUID voltam como `*ConfigurationError`, sem chamar a API. A extensão do arquivo precisa corresponder ao conteúdo real (`422 Document.InvalidContent`).
- `Buyer`, `Seller` e `Store` podem vir `nil`; teste antes de acessar.
- Não registre CPF completo nem conteúdo de documento em log. Veja [security.md](security.md).
