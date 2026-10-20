# Propostas (.NET)

`IProposalsClient` (como `client.Proposals`) cria a proposta, acompanha as etapas e envia o que a Credicarro pede ao integrador (documentos, dados do veículo e conta de recebimento). O significado de status, etapas e situações está em [Etapas e status da proposta](../proposal-steps.md). As rotas v1 ficam em `client.V1.Proposals`.

## Modelos

```csharp
public sealed record CreateProposalRequest(string Cpf, Guid SimulationId);   // cpf, simulacaoId

public sealed record ProposalDetails(Guid Id, long Number, Guid SimulationId, ProposalStatus Status, int StatusRaw, string? StatusName,
    ProposalType Type, DateTimeOffset? CreatedAt, string? RefusalReason, string? BiometryLink,
    ProposalParticipantState? Buyer, ProposalParticipantState? Seller, ProposalParticipantState? Store)
{
    public IReadOnlyList<PendingAction> GetPendingActions();    // só o que cabe ao integrador
}
public sealed record ProposalParticipantState(string? Document, BiometryStatus? Biometry, int? BiometryRaw, string? BiometryName,
    ActiveStep? ActiveStep, IReadOnlyList<CompletedStep> CompletedSteps, IReadOnlyList<ProposalDocument> Documents);
public sealed record ActiveStep(ProposalStep Step, int StepRaw, string? StepName, StepSituation Situation, int SituationRaw,
    string? SituationName, ActionOwner ActionOwner, int ActionOwnerRaw, string? ActionOwnerName);
public sealed record ProposalDocument(DocumentType Type, int TypeRaw, string? TypeName, DocumentStatus Status, int StatusRaw,
    string? StatusName, string? Reason);

public enum PendingActionKind { SendDocuments = 1, CorrectDocuments = 2, SendVehicleDetails = 3, SendDepositAccount = 4 }
public sealed record PendingAction(ProposalParticipant Participant, ProposalStep Step, PendingActionKind Kind, IReadOnlyList<DocumentType> DocumentTypes);

public sealed record VehicleDetails(string Renavam, string Chassis, string LicensePlate, string Color);
public sealed record DepositAccount(string HolderCpf, string BankCode, string Branch, string BranchDigit,
    string AccountNumber, string AccountDigit, DepositAccountType AccountType);   // Checking | Savings | Payment (CORRENTE | POUPANCA | PAGAMENTO)
public enum ProposalParticipant { Buyer = 1, Seller = 2, Store = 3 }              // COMPRADOR | VENDEDOR | LOJA
public sealed record ProposalDocumentUpload(ProposalParticipant Participant, DocumentType DocumentType, DocumentFile File);

public sealed record ProposalSummary(Guid Id, long Number, Guid SimulationId, ProposalType Type, ProposalStatus Status,
    string? StatusName, string? BuyerCpf, string? SellerCpf, DateTimeOffset? CreatedAt);   // GET v1/proposal e v1/proposal/{id}
```

`DocumentFile` (`DocumentFile.FromBytes(content, fileName)`, `FromStream`, `FromStreamAsync`, `FromFile(path)`) valida o nome (sem caminho, até 255 caracteres), a extensão (`.pdf`, `.jpg`, `.jpeg`, `.png`) e o tamanho (1 byte a 10 MiB) e gera o Base64 puro, sem `data:`. `FromFile` e `FromStream` leem em laço com limite de 10 MiB + 1 byte (nunca confiam em `Length`) e o conteúdo é materializado **uma vez**: o mesmo `byte[]` é reaproveitado em todas as tentativas e no replay do 401. Não altere o array depois de criar o `DocumentFile`. O envio é orçado em `DocumentUploadAttemptTimeout × MaxRetryAttempts` (180 s no padrão).

## Interface

```csharp
public interface IProposalsClient
{
    Task<Guid> CreateAsync(CreateProposalRequest request, CancellationToken cancellationToken = default);                              // POST v2/proposal -> id_proposta
    Task<ProposalDetails> GetAsync(Guid proposalId, CancellationToken cancellationToken = default);                                   // GET v2/proposal/{id}
    Task<PagedResult<ProposalSummary>> ListAsync(ListRequest? request = null, CancellationToken cancellationToken = default);         // GET v1/proposal
    Task SendVehicleDetailsAsync(Guid proposalId, VehicleDetails details, CancellationToken cancellationToken = default);            // POST .../vehicle-detail -> 204
    Task SendDepositAccountAsync(Guid proposalId, DepositAccount account, CancellationToken cancellationToken = default);            // POST .../deposit-account -> 204
    Task UploadDocumentAsync(Guid proposalId, ProposalDocumentUpload upload, string? idempotencyKey = null, CancellationToken cancellationToken = default); // POST .../document -> 204
}

public interface IV1ProposalsClient   // client.V1.Proposals
{
    Task<Guid> CreateAsync(CreateProposalRequest request, CancellationToken cancellationToken = default);       // POST v1/proposal
    Task<ProposalSummary> GetAsync(Guid proposalId, CancellationToken cancellationToken = default);              // GET v1/proposal/{id}
}
```

## Features

- O cliente precisa ter cadastro completo (endereço, ocupação e renda) e a simulação deve ser de uma loja de integração.
- **Compare enums, não texto.** Os enums (`ProposalStatus`, `ProposalStep`, `StepSituation`, `ActionOwner`, `DocumentType`...) têm `Unknown = -1` para valor novo da API; o número e o nome originais ficam em `...Raw` e `...Name`. Use o nome só em tela e log e trate `Unknown` como "sem ação".
- **`GetPendingActions()`** percorre `Buyer`, `Seller` e `Store` e devolve só as etapas ativas com `ActionOwner == Integrator`: `DocumentSubmission` vira `SendDocuments` (tipos com status `Pending`), `DocumentCorrection` vira `CorrectDocuments` (tipos com status `Invalid`, e o motivo está em `ProposalDocument.Reason`), `VehicleDetails` vira `SendVehicleDetails` e `DepositAccount` vira `SendDepositAccount`.
- `SendVehicleDetailsAsync` só funciona com a etapa `VehicleDetails` ativa. `SendDepositAccountAsync` só em refinanciamento, com a etapa `DepositAccount` ativa, e o titular deve ser o cliente. Reenviar substitui, e o SDK repete a chamada em falha transitória.
- **`UploadDocumentAsync`** sempre leva `Idempotency-Key`. Sem `idempotencyKey`, o SDK gera uma por chamada e a repete nas tentativas **dessa** chamada. Para sobreviver a reinício do seu processo, **gere um UUID por envio, guarde-o junto ao envio pendente e passe-o** em `idempotencyKey`. Na correção (etapa `DocumentCorrection`), use uma chave **nova**. **Nunca use uma chave determinística** (como `doc-{proposta}-{participante}-{tipo}`): a mesma chave com outro arquivo retorna `409 Idempotency.KeyConflict`; com o mesmo arquivo em 24 h, a API devolve `204` sem reprocessar.
- Participantes: `Buyer`, `Seller`, `Store`. Tipos de documento: comprador `Cnh`, `ProofOfIncome`, `ProofOfAddress`, `VehicleDocument`, `DigitalCnh`, `InspectionReport`, `Atpv`; vendedor `Cnh`, `Cpf`, `Rg`, `ProofOfAddress`, `VehicleDocument`, `DigitalCnh`, `EcvReport`, `InspectionReport`, `CnpjCard`; loja `VehicleDocument`, `EcvReport`.
- Prefira o webhook para saber de mudanças; use `GetAsync` para o estado atual. Veja [webhooks.md](webhooks.md).
- `Proposals.ListAsync` (`v1/proposal`) e `V1.Proposals.GetAsync` devolvem o formato resumido (`ProposalSummary`), com `Status` a partir do nome em inglês; o retrato v2 (`ProposalDetails`) traz etapas e documentos.

## Exemplo

(Fonte: `examples/dotnet/proposals.cs`)

```csharp
var proposalId = await client.Proposals.CreateAsync(new CreateProposalRequest(cpf, simulationId), ct);
var proposal = await client.Proposals.GetAsync(proposalId, ct);

// O despachante só LISTA/ENFILEIRA o que está pendente. Os dados (veículo, conta, arquivo por participante)
// vêm do sistema do integrador, nas funções de envio abaixo; nada de dados literais aqui.
foreach (var action in proposal.GetPendingActions())
    await pendingQueue.EnqueueAsync(proposalId, action, ct);

// Envio de documento: o PendingUpload (arquivo + UUID por envio) foi persistido ANTES; nova chave na correção.
await client.Proposals.UploadDocumentAsync(pending.ProposalId,
    new ProposalDocumentUpload(pending.Participant, pending.DocumentType, DocumentFile.FromFile(pending.FilePath)),
    idempotencyKey: pending.IdempotencyKey,
    cancellationToken: ct);
```

## Erros e casos de borda

- `404`: `Proposal.Access.NotFound`, `Customer.Account.NotFound`, `Simulation.Access.NotFound`, `Store.Integration.NotFound`.
- `CredicarroBusinessRuleException` (`422`) na criação: `Customer.Account.Incomplete`, `Simulation.Access.NotFromStore`, `Proposal.SimulationAlreadyActivated`, `Proposal.SimulationAlreadyExpired`, `Proposal.BuyerAgeNotAllowed`, `Store.Integration.Intermediation`.
- `422` nos envios: `Proposal.InvalidStatus`, `Proposal.ProposalIsNotInDepositAccountStatus`, `Proposal.DepositAccount.OnlyRefinancing`, `Proposal.DepositAccount.HolderNotBuyer`, `Document.InvalidProposalStage`, `Document.NotPendingCorrection`, `Document.InvalidContent`, `Document.InvalidProposalModality`.
- `409`: `Proposal.IdempotencyKeyReused` (criação) e `Idempotency.KeyConflict` (documento).
- `502 Document.UploadFailed`: o SDK repete com a mesma chave; se persistir, repita o envio com a chave guardada.
- `DocumentFile` lança `ArgumentException` para nome, extensão ou tamanho inválidos, antes de qualquer chamada. A extensão precisa corresponder ao conteúdo real (`422 Document.InvalidContent`).
- `Buyer`, `Seller` e `Store` podem vir `null`; teste antes de acessar.
- Não registre CPF completo nem conteúdo de documento em log. Veja [security.md](security.md).
