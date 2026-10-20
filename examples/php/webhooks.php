<?php
// Snippet de referência (SDK PHP do Credicarro). Usa credicarroClient() de client.php.
declare(strict_types=1);

namespace Parceiro\Credicarro;

use Twila\Credicarro\CredicarroClient;
use Twila\Credicarro\ListRequest;
use Twila\Credicarro\PagedResult;
use Twila\Credicarro\Webhooks\CreateWebhookRequest;
use Twila\Credicarro\Webhooks\CredicarroWebhookEvent;
use Twila\Credicarro\Webhooks\UpdateWebhookRequest;
use Twila\Credicarro\Webhooks\WebhookAuthenticationType;
use Twila\Credicarro\Webhooks\WebhookStatus;
use Twila\Credicarro\Webhooks\WebhookType;

/**
 * Cadastra o webhook de propostas. A credencial (Base64 de usuario:senha para Basic, ou o token JWT) vem de
 * configuração. O signingSecret só aparece nesta resposta: $saveSecret(string $webhookId, string $signingSecret)
 * o grava agora em um cofre de segredos; a função devolve apenas o webhookId.
 * A rota de cadastro não aceita Idempotency-Key e o SDK não a repete: antes de tentar de novo, consulte list().
 */
function registerProposalWebhook(
    CredicarroClient $client,
    string $url,
    string $credential,
    callable $saveSecret
): string {
    $result = $client->webhooks->create(new CreateWebhookRequest(
        WebhookType::PROPOSAL,
        $url, // https público
        WebhookAuthenticationType::BASIC,
        $credential
    ));

    // O segredo vai direto para o cofre (callable do seu sistema) e nunca sai desta função: só o id é devolvido.
    $saveSecret($result->webhookId, $result->signingSecret);

    return $result->webhookId;
}

/** A listagem não devolve credencial nem segredo. */
function listWebhooks(CredicarroClient $client): PagedResult
{
    return $client->webhooks->list(new ListRequest(1, 20));
}

/** Troca tipo, URL e status; a autenticação não muda (para trocá-la, exclua e cadastre outro). */
function deactivateWebhook(CredicarroClient $client, string $webhookId, string $url): void
{
    $client->webhooks->update($webhookId, new UpdateWebhookRequest(WebhookType::PROPOSAL, $url, WebhookStatus::INACTIVE));
}

function removeWebhook(CredicarroClient $client, string $webhookId): void
{
    $client->webhooks->delete($webhookId);
}

/** Implemente com Redis, RabbitMQ, SQS ou uma tabela de jobs. */
interface WebhookQueue
{
    public function push(string $rawBody): void;
}

/** Deduplicação pela Idempotency-Key da entrega. Produção: Redis ou banco com TTL (APCu é por servidor). */
interface WebhookDeduplicator
{
    /** true se a chave é nova; false se a entrega já foi vista. */
    public function add(string $key): bool;

    public function forget(string $key): void;
}

/** Falha na inicialização se CREDICARRO_WEBHOOK_SECRET estiver ausente ou vazia. */
function requireWebhookSecret(): string
{
    $secret = getenv('CREDICARRO_WEBHOOK_SECRET');
    if ($secret === false || $secret === '') {
        throw new \RuntimeException('Variável de ambiente ausente: CREDICARRO_WEBHOOK_SECRET');
    }
    return $secret;
}

/**
 * Chame na rota POST /webhooks/credicarro.
 * $expectedAuthorization = getenv('CREDICARRO_WEBHOOK_AUTHORIZATION') (opcional): valor completo do header
 * Authorization ("Basic ..." ou "Bearer ..."). Defina-a quando o webhook usar Basic ou Jwt.
 */
function handleCredicarroWebhook(
    string $secret,
    WebhookQueue $queue,
    WebhookDeduplicator $deduplicator,
    ?string $expectedAuthorization = null
): void {
    $maxBody = 1024 * 1024; // 1 MiB
    // 1) Rejeita logo pelo Content-Length.
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > $maxBody) {
        http_response_code(413);
        return;
    }
    // 2) Autenticação por header (Basic/JWT do cadastro), antes de ler o corpo. Em alguns setups PHP-FPM o header
    //    chega em REDIRECT_HTTP_AUTHORIZATION.
    $authorization = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
    if ($expectedAuthorization !== null && $expectedAuthorization !== ''
        && !CredicarroWebhookEvent::verifyAuthorization($authorization, $expectedAuthorization)) { // tempo constante
        http_response_code(401);
        return;
    }
    // 3) Leitura limitada: no máximo 1 MiB + 1 byte, bruto, antes de qualquer json_decode.
    $rawBody = file_get_contents('php://input', false, null, 0, $maxBody + 1);
    $rawBody = $rawBody === false ? '' : $rawBody;
    if (strlen($rawBody) > $maxBody) {
        http_response_code(413);
        return;
    }
    // 4) Assinatura contra o corpo bruto. O SDK confere HMAC-SHA256 em tempo constante e a janela de 5 minutos;
    //    segredo vazio nunca valida.
    $signature = (string) ($_SERVER['HTTP_X_CREDICARRO_SIGNATURE'] ?? '');
    if (!CredicarroWebhookEvent::verifySignature($rawBody, $signature, $secret)) {
        http_response_code(401);
        return;
    }
    // 5) Deduplica pela Idempotency-Key da entrega.
    $key = $_SERVER['HTTP_IDEMPOTENCY_KEY'] ?? null;
    if ($key !== null && (strlen($key) > 200 || trim($key) === '')) {
        http_response_code(400); // chave de deduplicação fora do limite (1 a 200 caracteres)
        return;
    }
    if ($key !== null && !$deduplicator->add($key)) {
        http_response_code(204); // entrega repetida
        return;
    }
    try {
        $queue->push($rawBody);
    } catch (\Throwable $e) {
        if ($key !== null) {
            $deduplicator->forget($key);
        }
        error_log('Falha ao enfileirar webhook | erro: ' . get_class($e)); // sem payload no log
        http_response_code(503); // a Credicarro retenta
        return;
    }
    http_response_code(202); // só responde 2xx depois de enfileirar; limite de 15 s por entrega
}

/** Roda no worker. As entregas podem chegar fora de ordem: consulte a proposta para o estado mais recente. */
function processProposalEvent(CredicarroClient $client, string $rawBody): void
{
    $id = 'desconhecida';
    try {
        // Já verificado em handleCredicarroWebhook: aqui basta ler o evento.
        $event = CredicarroWebhookEvent::parseUnverified($rawBody);
        $id = $event->proposalId;
        $current = $client->proposals->get($id);
        foreach ($current->getPendingActions() as $action) {
            // Despache o que falta: documento, dados do veículo ou conta de recebimento.
            error_log("Ação pendente | proposta: {$id} | participante: {$action->participant} | ação: {$action->kind}");
        }
    } catch (\Throwable $e) {
        // Só o id da proposta e o tipo do erro: nada de payload, CPF, token ou segredo.
        error_log("Falha ao processar webhook | proposta: {$id} | erro: " . get_class($e));
    }
}
