package br.com.parceiro.credicarro;

// Snippet de referência (SDK Java do Credicarro, br.com.twila:credicarro; compatível com JDK 8+).
// Os arquivos de exemplo têm nome em minúsculo; em um projeto real, salve este como ClientExample.java.

import java.net.URI;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import twila.credicarro.CredicarroClient;
import twila.credicarro.ListRequest;
import twila.credicarro.PagedResult;
import twila.credicarro.config.CredicarroEnvironment;
import twila.credicarro.config.CredicarroResilienceOptions;
import twila.credicarro.errors.CredicarroApiException;
import twila.credicarro.errors.CredicarroAuthenticationException;
import twila.credicarro.errors.CredicarroBusinessRuleException;
import twila.credicarro.errors.CredicarroConfigurationException;
import twila.credicarro.errors.CredicarroRateLimitException;
import twila.credicarro.errors.CredicarroTimeoutException;
import twila.credicarro.errors.CredicarroValidationException;
import twila.credicarro.proposals.model.CreateProposalRequest;
import twila.credicarro.proposals.model.ProposalSummary;

public final class ClientExample {

    private ClientExample() {
    }

    /**
     * Crie UMA instância por aplicação (bean singleton) e feche só no shutdown: ela guarda o pool de conexões,
     * o cache do token e o estado do circuit breaker. Nunca crie um cliente por requisição.
     */
    public static CredicarroClient create() {
        CredicarroClient.Builder builder = CredicarroClient.builder()
                .clientId(requireEnv("CREDICARRO_CLIENT_ID"))
                .clientSecret(requireEnv("CREDICARRO_CLIENT_SECRET"))
                // Os valores abaixo são os padrões: só configure se precisar mudar algum.
                .resilience(CredicarroResilienceOptions.builder()
                        .totalTimeout(Duration.ofSeconds(30))
                        .attemptTimeout(Duration.ofSeconds(10))
                        .documentUploadAttemptTimeout(Duration.ofSeconds(60))
                        .maxRetryAttempts(3)
                        .retryOn500(true)
                        .build());

        String baseUrl = System.getenv("CREDICARRO_BASE_URL"); // opcional (ex.: proxy); precisa ser https
        if (baseUrl != null && !baseUrl.trim().isEmpty()) {
            builder.baseUrl(URI.create(baseUrl.trim()));
        } else {
            boolean production = "production".equalsIgnoreCase(System.getenv("CREDICARRO_ENVIRONMENT"));
            builder.environment(production ? CredicarroEnvironment.PRODUCTION : CredicarroEnvironment.STAGING);
        }
        return builder.build(); // lança CredicarroConfigurationException se a configuração for inválida
    }

    /** Percorre todas as páginas: o SDK não tem auto-paginação. */
    public static List<ProposalSummary> listAllProposals(CredicarroClient client) {
        List<ProposalSummary> all = new ArrayList<>();
        int page = 1;
        PagedResult<ProposalSummary> result;
        do {
            result = client.proposals().list(ListRequest.of(page, 50)); // pageSize de 1 a 100
            all.addAll(result.getItems());
            page++;
        } while (result.isHasNext());
        return all;
    }

    /** Trate os erros pelo código estável (getErrorCode), nunca pelo texto da mensagem. */
    public static void createProposalHandlingErrors(CredicarroClient client, CreateProposalRequest request) {
        try {
            client.proposals().create(request);
        } catch (CredicarroValidationException ex) { // 400
            System.err.println("Dado inválido | campo: " + ex.getField() + " | tipo: " + ex.getErrorCode());
        } catch (CredicarroBusinessRuleException ex) { // 422
            if ("Proposal.SimulationAlreadyExpired".equals(ex.getErrorCode())) {
                // refazer a simulação
            }
        } catch (CredicarroRateLimitException ex) { // 429: o SDK já respeitou Retry-After nas tentativas
            System.err.println("Limite de requisições | retryAfter: " + ex.getRetryAfter());
        } catch (CredicarroApiException ex) { // 403, 404, 409, 5xx...
            System.err.println("Erro da API | status: " + ex.getStatusCode() + " | tipo: " + ex.getErrorCode());
        } catch (CredicarroAuthenticationException ex) { // credenciais inválidas ou 401 persistente
            System.err.println("Falha de autenticação | erro: " + ex.getClass().getSimpleName());
        } catch (CredicarroTimeoutException ex) { // timeout, rede ou circuit breaker aberto
            System.err.println("Credicarro indisponível | erro: " + ex.getClass().getSimpleName());
        }
        // ex.getDetail() e ex.getRawBody() podem conter dados pessoais: não os registre em log.
    }

    private static String requireEnv(String name) {
        String value = System.getenv(name);
        if (value == null || value.trim().isEmpty())
            throw new CredicarroConfigurationException("Variável de ambiente ausente: " + name);
        return value;
    }
}
