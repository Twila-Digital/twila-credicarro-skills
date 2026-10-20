# Propostas (Java)

A proposta é a solicitação de crédito criada a partir de uma opção de simulação. Ela traz o status geral e, para cada participante (comprador, loja e vendedor), a etapa ativa e quem precisa agir. Para o significado de cada status, etapa e situação, leia [Etapas e status da proposta](../proposal-steps.md). `twila.credicarro.proposals` (e `twila.credicarro.v1` para as rotas v1) usa o `CredicarroClient` de [client](client.md).

## Modelos

```java
public interface ProposalsClient {
    UUID create(CreateProposalRequest request);                       // POST v2/proposal -> id_proposta
    ProposalDetails get(UUID proposalId);                             // GET v2/proposal/{id}
    PagedResult<ProposalSummary> list();                              // GET v1/proposal (página 1, 10 itens)
    PagedResult<ProposalSummary> list(ListRequest request);
    void sendVehicleDetails(UUID proposalId, VehicleDetails details); // POST .../vehicle-detail -> 204
    void sendDepositAccount(UUID proposalId, DepositAccount account); // POST .../deposit-account -> 204 (só refinanciamento)
    void uploadDocument(UUID proposalId, ProposalDocumentUpload upload);                      // chave gerada pelo SDK
    void uploadDocument(UUID proposalId, ProposalDocumentUpload upload, String idempotencyKey); // POST .../document -> 204
}

public interface V1ProposalsClient {                                  // client.v1().proposals()
    UUID create(CreateProposalRequest request);                       // POST v1/proposal
    ProposalSummary get(UUID proposalId);                             // GET v1/proposal/{id}
}

@Value @Builder public class CreateProposalRequest { String cpf; UUID simulationId; }
@Value @Builder public class VehicleDetails { String renavam; String chassis; String licensePlate; String color; }

@Value @Builder
public class DepositAccount {
    String holderCpf; String bankCode; String branch; String branchDigit;
    String accountNumber; String accountDigit;
    DepositAccountType accountType; // CHECKING("CORRENTE"), SAVINGS("POUPANCA"), PAYMENT("PAGAMENTO")
}

@Value @Builder
public class ProposalDocumentUpload {
    ProposalParticipant participant; // BUYER("COMPRADOR"), SELLER("VENDEDOR"), STORE("LOJA")
    DocumentType documentType;
    DocumentFile file;               // DocumentFile.fromFile(Path) | fromBytes(byte[], String) | fromStream(InputStream, String)
}

@Value
public class ProposalDetails {       // retrato v2
    UUID id; Long number; UUID simulationId;
    ProposalStatus status; int statusRaw; String statusName;
    ProposalType type;               // FINANCING, REFINANCING
    OffsetDateTime createdAt; String refusalReason; String biometryLink;
    ProposalParticipantState buyer; ProposalParticipantState seller; ProposalParticipantState store;
    List<PendingAction> getPendingActions();
}

@Value
public class ProposalParticipantState {
    String document;                 // CPF (comprador/vendedor) ou CNPJ (loja)
    BiometryStatus biometry; Integer biometryRaw; String biometryName;
    ProposalActiveStep activeStep;   // step/stepRaw/stepName, situation/..., actionOwner/...
    List<ProposalCompletedStep> completedSteps;  // step, stepRaw, stepName, date
    List<ProposalDocumentState> documents;       // type/typeRaw/typeName, status/statusRaw/statusName, reason
}

@Value
public class PendingAction {
    ProposalParticipant participant; ProposalStep step;
    PendingActionKind kind;          // SEND_DOCUMENTS, CORRECT_DOCUMENTS, SEND_VEHICLE_DETAILS, SEND_DEPOSIT_ACCOUNT
    List<DocumentType> documentTypes;
}

@Value
public class ProposalSummary {       // listagem e rotas v1
    UUID id; Long number; UUID simulationId; ProposalType type;
    ProposalStatus status; String statusName; String buyerCpf; String sellerCpf; OffsetDateTime createdAt;
}
```

Enums do SDK (`twila.credicarro.proposals.model`), todos com `UNKNOWN(-1)` para valores novos: `ProposalStatus`, `ProposalStep`, `StepSituation`, `ActionOwner` (`NONE`, `CUSTOMER`, `INTEGRATOR`, `CREDICARRO`), `BiometryStatus`, `DocumentStatus`, `DocumentType`. A tabela completa de códigos está em [Etapas e status da proposta](../proposal-steps.md).

## Funcionalidades

- `create` transforma uma opção de simulação em proposta e devolve o `UUID`. O SDK gera a `Idempotency-Key` e a reaproveita nas retentativas.
- `get` devolve o retrato v2. Todo status, etapa, situação, responsável, biometria e documento vem como enum **mais** o código bruto e o nome (`getStatus()`, `getStatusRaw()`, `getStatusName()`).
- **`getPendingActions()`** lista só o que depende do integrador (`ActionOwner.INTEGRATOR`), por participante: etapa `DOCUMENT_SUBMISSION` (6) vira `SEND_DOCUMENTS` (tipos com status `PENDING`); `DOCUMENT_CORRECTION` (7) vira `CORRECT_DOCUMENTS` (tipos com status `INVALID`); `VEHICLE_DETAILS` (8) vira `SEND_VEHICLE_DETAILS`; `DEPOSIT_ACCOUNT` (5) vira `SEND_DEPOSIT_ACCOUNT`. Use-o em vez de varrer as etapas à mão.
- `uploadDocument` envia **um arquivo por chamada**. A `Idempotency-Key` é obrigatória na API: informe a sua (recomendado) ou deixe o SDK gerar uma e reaproveitá-la nas tentativas da própria chamada.
- `sendVehicleDetails` e `sendDepositAccount` substituem o que foi enviado antes, então a repetição é segura.
- `list` (v1) devolve `ProposalSummary`. As rotas v1 (`client.v1().proposals()`) criam e consultam a proposta sem o retrato de etapas; para integrações novas, use a v2.

## Exemplo

(Fonte: `examples/java/proposals.java`)

```java
UUID id = client.proposals().create(CreateProposalRequest.builder().cpf("12345678909").simulationId(simulacaoId).build());
ProposalDetails proposta = client.proposals().get(id);

// O despachante só lista e enfileira; quem envia recebe os dados do sistema do integrador (arquivo, veículo, conta).
for (PendingAction acao : proposta.getPendingActions())
    filaDeTrabalho.enfileirar(id, acao);

// No worker, com um envio persistido (PendingUpload) que já traz a chave e o arquivo daquele participante:
client.proposals().uploadDocument(envio.proposalId, ProposalDocumentUpload.builder()
        .participant(envio.participant).documentType(envio.documentType)
        .file(DocumentFile.fromFile(envio.file)).build(), envio.idempotencyKey);
```

## Erros e casos de borda

- Compare **pelos enums** do SDK (`getStatus()`, `getActiveStep().getStep()`, `getActionOwner()`); os nomes servem para tela e log. Valor novo da API vira `UNKNOWN` e o original continua em `getStatusRaw()`/`getStatusName()`: sempre tenha um `default` nos `switch`.
- Avalie **cada** participante. A loja pode estar em `DOCUMENT_SUBMISSION` enquanto o comprador aguarda a biometria. `getPendingActions()` já faz isso.
- Criação: `404` (`Customer.Account.NotFound`, `Simulation.Access.NotFound`, `Store.Integration.NotFound`); `409 Proposal.IdempotencyKeyReused`; `422` (`Customer.Account.Incomplete`, `Simulation.Access.NotFromStore`, `Proposal.SimulationAlreadyExpired`, `Proposal.SimulationAlreadyActivated`, `Proposal.BuyerAgeNotAllowed`). Cada opção de simulação gera uma única proposta.
- `get`: `404 Proposal.Access.NotFound`; `422 Proposal.Access.NotIntegrationV2` (proposta fora desta rota; consulte-a por `client.v1().proposals().get`).
- Dados do veículo: só na etapa `VEHICLE_DETAILS` (8). Fora dela, `422 Proposal.InvalidStatus`. Chassi com 17 caracteres, sem I, O e Q.
- Conta de recebimento: só refinanciamento, na etapa `DEPOSIT_ACCOUNT` (5). Erros: `Proposal.DepositAccount.OnlyRefinancing`, `Proposal.DepositAccount.HolderNotBuyer`, `Proposal.ProposalIsNotInDepositAccountStatus`. Reenviar substitui a conta anterior.
- **Chave do documento**: nunca determinística (hash do arquivo, CPF, ID da proposta). Gere **um UUID por envio**, guarde-o junto do envio pendente e reutilize só nas retentativas daquele envio. Chave nova a cada tentativa reenvia e substitui o documento; na **correção** de um documento recusado, use chave **nova**. A chave tem de 1 a 200 caracteres (`IllegalArgumentException` se não tiver). Mesma chave e mesmo conteúdo em até 24 horas não são processados de novo.
- Arquivo: `DocumentFile` valida antes de enviar (nome sem caminho de até 255 caracteres, extensão `.pdf`, `.jpg`, `.jpeg` ou `.png`, de 1 byte a 10 MiB) e lança `IllegalArgumentException`. O Base64 é puro, sem `data:`. A extensão precisa bater com o conteúdo real (`Document.InvalidContent`).
- Tipos por participante: comprador 1, 4, 5, 6, 7, 9, 57; vendedor 1, 2, 3, 5, 6, 7, 8, 9, 11; loja 6, 8. Fora disso: `Validation.Document.TypeNotAllowed`.
- Na etapa `DOCUMENT_CORRECTION` (7), reenvie só os tipos de `CORRECT_DOCUMENTS` (status `INVALID`); senão `Document.NotPendingCorrection`. Mostre o motivo (`ProposalDocumentState.getReason()`) ao usuário.
- Outros erros de documento: `Document.InvalidProposalStage`, `Document.InvalidProposalModality`, `409 Idempotency.KeyConflict` e `502 Document.UploadFailed` (o SDK já repete com a mesma chave; se persistir, repita o envio com a mesma chave).
- `getRefusalReason()` e `getBiometryLink()` são `null` quando vazios. Trate `null`.
- `list` (v1) devolve `ProposalSummary` com `getStatus()` já normalizado e `getStatusName()` em inglês (`Approved`, `Analysing`...); o retrato v2 devolve `APROVADA`, `EM_ANALISE`... em `getStatusName()`. Compare pelo enum, não pelo nome.
