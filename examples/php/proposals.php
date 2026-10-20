<?php
// Snippet de referência (SDK PHP do Credicarro). Usa credicarroClient() de client.php.
declare(strict_types=1);

namespace Parceiro\Credicarro;

use Twila\Credicarro\CredicarroClient;
use Twila\Credicarro\ListRequest;
use Twila\Credicarro\PagedResult;
use Twila\Credicarro\Proposals\CreateProposalRequest;
use Twila\Credicarro\Proposals\DepositAccount;
use Twila\Credicarro\Proposals\DocumentFile;
use Twila\Credicarro\Proposals\PendingAction;
use Twila\Credicarro\Proposals\PendingActionKind;
use Twila\Credicarro\Proposals\ProposalDocumentUpload;
use Twila\Credicarro\Proposals\ProposalStatus;
use Twila\Credicarro\Proposals\ProposalSummary;
use Twila\Credicarro\Proposals\VehicleDetails;

/**
 * Um envio de documento pendente. Persista este registro (banco/fila) ANTES de enviar: a chave é gerada
 * uma vez por envio e reaproveitada só nas retentativas dele. Na correção de um documento recusado,
 * crie um envio novo (chave nova). Nunca derive a chave do arquivo, do CPF ou do ID da proposta.
 */
final class PendingUpload
{
    /** @var string */
    public $proposalId;
    /** @var string ProposalParticipant::BUYER, SELLER ou STORE */
    public $participant;
    /** @var int DocumentType::* */
    public $documentType;
    /** @var string caminho do arquivo, fornecido pelo sistema do integrador */
    public $path;
    /** @var string */
    public $idempotencyKey;

    public function __construct(string $proposalId, string $participant, int $documentType, string $path)
    {
        $this->proposalId = $proposalId;
        $this->participant = $participant;
        $this->documentType = $documentType;
        $this->path = $path;
        $this->idempotencyKey = uuidV4(); // 36 caracteres ASCII: dentro do limite de 1 a 200
    }
}

/** Persistência dos envios pendentes (banco, tabela de jobs...). Implemente no seu sistema. */
interface PendingUploadStore
{
    public function save(PendingUpload $upload): void;

    public function markSent(PendingUpload $upload): void;
}

/** Fila interna de trabalho: o despachante só enfileira o que falta; quem tem os dados executa depois. */
interface PendingActionQueue
{
    public function push(string $proposalId, PendingAction $action): void;
}

function uuidV4(): string
{
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    $hex = bin2hex($data);

    return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4) . '-'
        . substr($hex, 16, 4) . '-' . substr($hex, 20, 12);
}

/** O CPF e a simulação escolhida vêm do cadastro do seu sistema (nunca literais no código). */
function createProposal(CredicarroClient $client, string $cpf, string $simulationId): string
{
    // O SDK gera uma Idempotency-Key por chamada e a reaproveita nas retentativas.
    return $client->proposals->create(new CreateProposalRequest($cpf, $simulationId));
}

/**
 * Persiste o envio ANTES de enviar e só então chama a API. Se o processo cair no meio, o envio pendente
 * guardado (com a mesma chave) é retomado sem duplicar nem reenviar com chave nova.
 */
function sendDocument(CredicarroClient $client, PendingUploadStore $store, PendingUpload $pending): void
{
    $store->save($pending);

    // DocumentFile valida nome, extensão (.pdf/.jpg/.jpeg/.png) e tamanho (1 byte a 10 MiB) antes do envio.
    $client->proposals->uploadDocument(
        $pending->proposalId,
        new ProposalDocumentUpload($pending->participant, $pending->documentType, DocumentFile::fromFile($pending->path)),
        $pending->idempotencyKey
    );

    $store->markSent($pending);
}

/**
 * Consulta a proposta e ENFILEIRA o que depende do integrador (ActionOwner::INTEGRATOR). Não executa nenhuma ação
 * nem usa dados literais: o worker que consome a fila busca no seu sistema os dados do participante certo
 * (arquivo, veículo, conta) e chama sendDocument / sendVehicleDetails / sendDepositAccount.
 */
function dispatchPendingActions(CredicarroClient $client, string $proposalId, PendingActionQueue $queue): void
{
    $proposal = $client->proposals->get($proposalId);

    // Compare pelo inteiro do SDK; valor novo da API vira UNKNOWN e o original fica em statusRaw/statusName.
    if ($proposal->status === ProposalStatus::REFUSED) {
        error_log("Proposta recusada | proposta: {$proposalId}");
        return;
    }

    foreach ($proposal->getPendingActions() as $action) {
        switch ($action->kind) {
            case PendingActionKind::SEND_DOCUMENTS:
            case PendingActionKind::CORRECT_DOCUMENTS: // na correção o envio é novo (chave nova), só dos tipos listados
            case PendingActionKind::SEND_VEHICLE_DETAILS:
            case PendingActionKind::SEND_DEPOSIT_ACCOUNT:
                $queue->push($proposalId, $action); // participante, etapa, tipo da ação e tipos de documento
                break;
            default:
                // Ação nova que este código ainda não conhece: só registre em log.
                error_log("Ação desconhecida | proposta: {$proposalId} | ação: {$action->kind}");
                break;
        }
    }
}

/**
 * Worker: transforma uma ação de documento em envios pendentes persistidos, um por tipo exigido.
 * $fileFor devolve o caminho do arquivo daquele participante e tipo (ou null se o seu sistema ainda não o tem).
 *
 * @param callable(string $participant, int $documentType): ?string $fileFor
 */
function scheduleDocumentUploads(
    string $proposalId,
    PendingAction $action,
    PendingUploadStore $store,
    callable $fileFor
): void {
    foreach ($action->documentTypes as $documentType) {
        $path = $fileFor($action->participant, $documentType);
        if ($path === null) {
            error_log("Documento ainda não disponível | proposta: {$proposalId} | tipo: {$documentType}");
            continue;
        }

        $store->save(new PendingUpload($proposalId, $action->participant, $documentType, $path));
    }
}

/** Etapa VEHICLE_DETAILS. Os dados vêm do sistema do integrador. Reenviar substitui o anterior (repetição segura). */
function sendVehicleDetails(CredicarroClient $client, string $proposalId, VehicleDetails $details): void
{
    $client->proposals->sendVehicleDetails($proposalId, $details);
}

/** Só refinanciamento, etapa DEPOSIT_ACCOUNT; a conta (vinda do sistema do integrador) precisa ser do comprador. */
function sendDepositAccount(CredicarroClient $client, string $proposalId, DepositAccount $account): void
{
    $client->proposals->sendDepositAccount($proposalId, $account);
}

function listProposals(CredicarroClient $client): PagedResult
{
    return $client->proposals->list(new ListRequest(1, 20)); // v1: o resumo traz o nome do status em inglês
}

/** Rotas v1 (sem o retrato de etapas): create devolve o id e get devolve o resumo. */
function createAndGetV1(CredicarroClient $client, string $cpf, string $simulationId): ProposalSummary
{
    $id = $client->v1->proposals->create(new CreateProposalRequest($cpf, $simulationId));

    return $client->v1->proposals->get($id);
}
