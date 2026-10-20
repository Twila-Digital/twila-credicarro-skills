<?php
// Snippet de referência (SDK PHP do Credicarro, twila/credicarro; PHP 7.4+).
// Instalação: composer require twila/credicarro
declare(strict_types=1);

namespace Parceiro\Credicarro;

use Psr\SimpleCache\CacheInterface;
use Twila\Credicarro\Config\ClientOptions;
use Twila\Credicarro\Config\Environment;
use Twila\Credicarro\Config\ResilienceOptions;
use Twila\Credicarro\CredicarroClient;
use Twila\Credicarro\Errors\CredicarroApiException;
use Twila\Credicarro\Errors\CredicarroAuthenticationException;
use Twila\Credicarro\Errors\CredicarroBusinessRuleException;
use Twila\Credicarro\Errors\CredicarroConfigurationException;
use Twila\Credicarro\Errors\CredicarroRateLimitException;
use Twila\Credicarro\Errors\CredicarroTimeoutException;
use Twila\Credicarro\Errors\CredicarroValidationException;
use Twila\Credicarro\ListRequest;
use Twila\Credicarro\Proposals\CreateProposalRequest;
use Twila\Credicarro\Proposals\ProposalSummary;

/**
 * Um único cliente por processo (use o container de DI do seu framework). Ele guarda o estado do circuit breaker
 * e o token de acesso. Por padrão o token fica só na memória da instância; em PHP-FPM cada requisição HTTP é um
 * processo novo e geraria um token por requisição. Passe um cache PSR-16 ($tokenCache: APCu, Redis, Memcached)
 * para compartilhar o token entre requisições. O cache guarda só o token (nunca o clientSecret): use um backend
 * que só a sua aplicação consiga ler.
 *
 * Exemplo de cache: new \Symfony\Component\Cache\Psr16Cache(new \Symfony\Component\Cache\Adapter\ApcuAdapter('credicarro'))
 */
function credicarroClient(?CacheInterface $tokenCache = null): CredicarroClient
{
    static $client = null;
    if ($client === null) {
        $baseUrl = getenv('CREDICARRO_BASE_URL'); // opcional (ex.: proxy); precisa ser https
        $environment = getenv('CREDICARRO_ENVIRONMENT') === 'production' ? Environment::PRODUCTION : Environment::STAGING;

        $client = new CredicarroClient(new ClientOptions(
            requireEnv('CREDICARRO_CLIENT_ID'),
            requireEnv('CREDICARRO_CLIENT_SECRET'),
            $environment,
            $baseUrl !== false && $baseUrl !== '' ? $baseUrl : null,
            // Os valores abaixo são os padrões: só configure se precisar mudar algum.
            new ResilienceOptions(30000, 10000, 60000, 3, 500),
            $tokenCache
        )); // lança CredicarroConfigurationException se a configuração for inválida
    }
    return $client;
}

/**
 * Percorre todas as páginas: o SDK não tem auto-paginação.
 * @return ProposalSummary[]
 */
function listAllProposals(CredicarroClient $client): array
{
    $all = [];
    $page = 1;
    do {
        $result = $client->proposals->list(new ListRequest($page, 50)); // tamanho de 1 a 100
        foreach ($result->items as $proposal) {
            $all[] = $proposal;
        }
        $page++;
    } while ($result->hasNext);

    return $all;
}

/** Trate os erros pelo código estável (getErrorCode), nunca pelo texto da mensagem. */
function createProposalHandlingErrors(CredicarroClient $client, CreateProposalRequest $request): ?string
{
    try {
        return $client->proposals->create($request);
    } catch (CredicarroValidationException $e) { // 400 (também validações locais do SDK)
        error_log('Dado inválido | campo: ' . $e->getField() . ' | tipo: ' . $e->getErrorCode());
    } catch (CredicarroBusinessRuleException $e) { // 422
        if ($e->getErrorCode() === 'Proposal.SimulationAlreadyExpired') {
            // refazer a simulação
        }
    } catch (CredicarroRateLimitException $e) { // 429: o SDK já respeitou Retry-After nas tentativas
        error_log('Limite de requisições | retryAfterMs: ' . var_export($e->getRetryAfterMs(), true));
    } catch (CredicarroApiException $e) { // 403, 404, 409, 5xx...
        error_log('Erro da API | status: ' . $e->getStatusCode() . ' | tipo: ' . $e->getErrorCode());
    } catch (CredicarroAuthenticationException $e) { // credenciais inválidas ou 401 persistente
        error_log('Falha de autenticação | erro: ' . get_class($e));
    } catch (CredicarroTimeoutException $e) { // timeout, rede ou circuit breaker aberto
        error_log('Credicarro indisponível | erro: ' . get_class($e));
    }
    // getDetail() e getRawBody() podem conter dados pessoais: não os registre em log.

    return null;
}

function requireEnv(string $name): string
{
    $value = getenv($name);
    if ($value === false || trim($value) === '') {
        throw new CredicarroConfigurationException('Variável de ambiente ausente: ' . $name);
    }
    return $value;
}
