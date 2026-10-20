# Propostas (PHP)

A proposta é a solicitação de crédito criada a partir de uma opção de simulação. Ela traz o status geral e, para cada participante (comprador, loja e vendedor), a etapa ativa e quem precisa agir. Para o significado de cada status, etapa e situação, leia [Etapas e status da proposta](../proposal-steps.md). `Twila\Credicarro\Proposals` (e `$client->v1->proposals` para as rotas v1) usa o `CredicarroClient` de [client](client.md).

## Modelos

```php
final class ProposalsClient {                                          // $client->proposals
    public function create(CreateProposalRequest $request): string;                    // POST v2/proposal -> id_proposta
    public function get(string $proposalId): ProposalDetails;                          // GET v2/proposal/{id}
    public function list(?ListRequest $request = null): PagedResult;                   // GET v1/proposal; items: ProposalSummary[]
    public function sendVehicleDetails(string $proposalId, VehicleDetails $details): void;   // POST .../vehicle-detail -> 204
    public function sendDepositAccount(string $proposalId, DepositAccount $account): void;   // POST .../deposit-account -> 204 (só refinanciamento)
    public function uploadDocument(string $proposalId, ProposalDocumentUpload $upload, ?string $idempotencyKey = null): void; // POST .../document -> 204
}

final class V1ProposalsClient {                                        // $client->v1->proposals
    public function create(CreateProposalRequest $request): string;                    // POST v1/proposal
    public function get(string $proposalId): ProposalSummary;                          // GET v1/proposal/{id}
}

final class CreateProposalRequest { public function __construct(string $cpf, string $simulationId); }
final class VehicleDetails { public function __construct(string $renavam, string $chassis, string $licensePlate, string $color); }

final class DepositAccount {
    public function __construct(
        string $holderCpf, string $bankCode, string $branch, string $branchDigit,
        string $accountNumber, string $accountDigit,
        string $accountType      // DepositAccountType::CHECKING ('CORRENTE'), SAVINGS ('POUPANCA'), PAYMENT ('PAGAMENTO')
    );
}

final class ProposalDocumentUpload {
    public function __construct(
        string $participant,     // ProposalParticipant::BUYER ('COMPRADOR'), SELLER ('VENDEDOR'), STORE ('LOJA')
        int $documentType,       // DocumentType::*
        DocumentFile $file       // DocumentFile::fromFile($path, ?$fileName) | fromBytes($bytes, $fileName) | fromStream($stream, $fileName) | new DocumentFile($bytes, $fileName)
    );
}

final class ProposalDetails {      // retrato v2
    public $id; public $number; public $simulationId;
    public $status; public $statusRaw; public $statusName;   // ProposalStatus::* (int) + código e nome brutos
    public $type; public $typeRaw;                            // ProposalType::FINANCING | REFINANCING
    public $createdAt; public $refusalReason; public $biometryLink;
    public $buyer; public $seller; public $store;             // ?ProposalParticipantState
    public function getPendingActions(): array;               // PendingAction[]
}

final class ProposalParticipantState {
    public $document;                                          // CPF (comprador/vendedor) ou CNPJ (loja)
    public $biometry; public $biometryRaw; public $biometryName;
    public $activeStep;        // ?ActiveStep: step/stepRaw/stepName, situation/..., actionOwner/...
    public $completedSteps;    // CompletedStep[]: step, stepRaw, stepName, date
    public $documents;         // ProposalDocument[]: type/typeRaw/typeName, status/statusRaw/statusName, reason
}

final class PendingAction {
    public $participant; public $step;
    public $kind;              // PendingActionKind::SEND_DOCUMENTS | CORRECT_DOCUMENTS | SEND_VEHICLE_DETAILS | SEND_DEPOSIT_ACCOUNT (strings)
    public $documentTypes;     // int[] (códigos de DocumentType::*)
}

final class ProposalSummary {  // listagem e rotas v1
    public $id; public $number; public $simulationId; public $type;
    public $status; public $statusName; public $buyerCpf; public $sellerCpf; public $createdAt;
}
```

Classes de constantes (`Twila\Credicarro\Proposals`), todas com `UNKNOWN = -1` para valores novos: `ProposalStatus`, `ProposalStep`, `StepSituation`, `ActionOwner` (`NONE`, `CUSTOMER`, `INTEGRATOR`, `CREDICARRO`), `BiometryStatus`, `DocumentStatus`, `DocumentType`. A tabela completa de códigos está em [Etapas e status da proposta](../proposal-steps.md).

## Funcionalidades

- `create` transforma uma opção de simulação em proposta e devolve o ID (`string`). O SDK gera a `Idempotency-Key` e a reaproveita nas retentativas.
- `get` devolve o retrato v2. Todo status, etapa, situação, responsável, biometria e documento vem como constante do SDK **mais** o código bruto e o nome (`$status`, `$statusRaw`, `$statusName`).
- **`getPendingActions()`** lista só o que depende do integrador (`ActionOwner::INTEGRATOR`), por participante: etapa `DOCUMENT_SUBMISSION` (6) vira `SEND_DOCUMENTS` (tipos com status `PENDING`); `DOCUMENT_CORRECTION` (7) vira `CORRECT_DOCUMENTS` (tipos com status `INVALID`); `VEHICLE_DETAILS` (8) vira `SEND_VEHICLE_DETAILS`; `DEPOSIT_ACCOUNT` (5) vira `SEND_DEPOSIT_ACCOUNT`. Use-o em vez de varrer as etapas à mão.
- `uploadDocument` envia **um arquivo por chamada**. A `Idempotency-Key` é obrigatória na API: informe a sua (recomendado) ou deixe o SDK gerar uma e reaproveitá-la nas tentativas da própria chamada.
- `sendVehicleDetails` e `sendDepositAccount` substituem o que foi enviado antes, então a repetição é segura.
- `list` (v1) devolve `ProposalSummary`. As rotas v1 (`$client->v1->proposals`) criam e consultam a proposta sem o retrato de etapas; para integrações novas, use a v2.

## Exemplo

(Fonte: `examples/php/proposals.php`)

```php
// O CPF e a simulação escolhida vêm do cadastro do seu sistema.
$id = $client->proposals->create(new CreateProposalRequest($cpf, $simulacaoId));
$proposta = $client->proposals->get($id);

// O despachante só lista e ENFILEIRA o que falta; não envia nada com dados literais.
foreach ($proposta->getPendingActions() as $acao) {
    $fila->push($id, $acao); // participante, etapa, tipo da ação e tipos de documento
}

// No worker, com os dados do participante certo vindos do seu sistema:
$envio = new PendingUpload($id, $acao->participant, DocumentType::CNH, $caminhoDoArquivo); // gera a chave do envio
$repositorio->save($envio);   // persiste ANTES de enviar (a mesma chave serve às retentativas)
$client->proposals->uploadDocument(
    $envio->proposalId,
    new ProposalDocumentUpload($envio->participant, $envio->documentType, DocumentFile::fromFile($envio->path)),
    $envio->idempotencyKey
);
$repositorio->markSent($envio);
// Dados do veículo e conta de recebimento: sendVehicleDetails($client, $id, $dadosDoVeiculo) e
// sendDepositAccount($client, $id, $contaDoComprador), com objetos montados pelo seu sistema.
```

## Erros e casos de borda

- Compare **pelas constantes** do SDK (`ProposalStatus::APPROVED`, `ProposalStep::DOCUMENT_SUBMISSION`, `ActionOwner::INTEGRATOR`) com `===`; os nomes servem para tela e log. Valor novo da API vira `UNKNOWN` e o original continua em `*Raw`/`*Name`: sempre tenha um `default` nos `switch`.
- Avalie **cada** participante. A loja pode estar em `DOCUMENT_SUBMISSION` enquanto o comprador aguarda a biometria. `getPendingActions()` já faz isso.
- Criação: `404` (`Customer.Account.NotFound`, `Simulation.Access.NotFound`, `Store.Integration.NotFound`); `409 Proposal.IdempotencyKeyReused`; `422` (`Customer.Account.Incomplete`, `Simulation.Access.NotFromStore`, `Proposal.SimulationAlreadyExpired`, `Proposal.SimulationAlreadyActivated`, `Proposal.BuyerAgeNotAllowed`). Cada opção de simulação gera uma única proposta.
- `get`: `404 Proposal.Access.NotFound`; `422 Proposal.Access.NotIntegrationV2` (proposta fora desta rota; consulte-a por `$client->v1->proposals->get`). IDs que não são UUID falham localmente com `Validation.Identifier.Invalid`.
- Dados do veículo: só na etapa `VEHICLE_DETAILS` (8). Fora dela, `422 Proposal.InvalidStatus`. Chassi com 17 caracteres, sem I, O e Q.
- Conta de recebimento: só refinanciamento, na etapa `DEPOSIT_ACCOUNT` (5). Erros: `Proposal.DepositAccount.OnlyRefinancing`, `Proposal.DepositAccount.HolderNotBuyer`, `Proposal.ProposalIsNotInDepositAccountStatus`. Reenviar substitui a conta anterior.
- **Job/worker**: o envio de documento (`uploadDocument`) roda em job/worker, nunca na requisição web: o orçamento chega a 180 s e o backoff usa `usleep`, que bloqueia o PHP-FPM. Ao reagir a um webhook, consulte a proposta (`get`) e enfileire as ações de `getPendingActions()`.
- **Chave do documento**: nunca determinística (hash do arquivo, CPF, ID da proposta). Gere **um UUID por envio**, guarde-o junto do envio pendente e reutilize só nas retentativas daquele envio. Chave nova a cada tentativa reenvia e substitui o documento; na **correção** de um documento recusado, use chave **nova**. A chave tem de 1 a 200 caracteres ASCII imprimíveis, não só espaços (`Validation.IdempotencyKey.Invalid`, antes de qualquer requisição). Mesma chave e mesmo conteúdo em até 24 horas não são processados de novo.
- Arquivo: `DocumentFile` valida antes de enviar, em qualquer forma de construção (nome sem caminho de até 255 caracteres, extensão `.pdf`, `.jpg`, `.jpeg` ou `.png`, de 1 byte a 10 MiB; arquivos e streams são lidos em blocos até 10 MiB + 1, sem confiar no tamanho informado; o Base64 é materializado uma vez e reaproveitado em todas as tentativas) e lança `CredicarroValidationException` (`Validation.File.*`). O Base64 é puro, sem `data:`. A extensão precisa bater com o conteúdo real (`Document.InvalidContent`). O participante inválido gera `Validation.Field.InvalidOption`.
- Tipos por participante: comprador 1, 4, 5, 6, 7, 9, 57; vendedor 1, 2, 3, 5, 6, 7, 8, 9, 11; loja 6, 8. Fora disso: `Validation.Document.TypeNotAllowed`.
- Na etapa `DOCUMENT_CORRECTION` (7), reenvie só os tipos de `CORRECT_DOCUMENTS` (status `INVALID`); senão `Document.NotPendingCorrection`. Mostre o motivo (`ProposalDocument::$reason`) ao usuário.
- Outros erros de documento: `Document.InvalidProposalStage`, `Document.InvalidProposalModality`, `409 Idempotency.KeyConflict` e `502 Document.UploadFailed` (o SDK já repete com a mesma chave; se persistir, repita o envio com a mesma chave).
- `refusalReason` e `biometryLink` são `null` quando vazios. Trate `null`.
- `list` (v1) devolve `ProposalSummary` com `status` já normalizado (constante) e `statusName` em inglês (`Approved`, `Analysing`...); o retrato v2 devolve `APROVADA`, `EM_ANALISE`... em `statusName`. Compare pela constante, não pelo nome.
