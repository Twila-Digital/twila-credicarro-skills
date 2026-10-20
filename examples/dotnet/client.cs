// Cliente: instalação, configuração por variáveis de ambiente, paginação e tratamento de erros com o SDK Twila.Credicarro.
using Credicarro;
using Credicarro.Configuration;
using Credicarro.DependencyInjection;
using Credicarro.Errors;
using Credicarro.Proposals.Models;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace CredicarroExamples;

public static class ClientExample
{
    // Registra o ICredicarroClient como singleton (token em cache, retry, circuit breaker e idempotência já vêm prontos).
    // CREDICARRO_ENVIRONMENT: "staging" ou "production" (padrão do SDK).
    public static IServiceCollection AddCredicarroFromEnvironment(this IServiceCollection services)
    {
        services.AddCredicarro(options =>
        {
            options.ClientId = Environment.GetEnvironmentVariable("CREDICARRO_CLIENT_ID") ?? string.Empty;
            options.ClientSecret = Environment.GetEnvironmentVariable("CREDICARRO_CLIENT_SECRET") ?? string.Empty;
            options.Environment = string.Equals(Environment.GetEnvironmentVariable("CREDICARRO_ENVIRONMENT"), "staging", StringComparison.OrdinalIgnoreCase)
                ? CredicarroEnvironment.Staging
                : CredicarroEnvironment.Production;

            // Resiliência: os padrões já servem. Ajuste só com motivo.
            options.Resilience.TotalTimeout = TimeSpan.FromSeconds(30);
            options.Resilience.MaxRetryAttempts = 3;
        });
        return services;
    }

    // As opções são validadas na primeira resolução do client: resolva-o na inicialização para falhar cedo
    // (CredicarroConfigurationException cita só o nome do campo, nunca o valor).
    public static ICredicarroClient ResolveOnStartup(IServiceProvider provider) =>
        provider.GetRequiredService<ICredicarroClient>();

    // Paginação manual: PageSize de 1 a 100; siga enquanto HasNext for true.
    public static async Task<IReadOnlyList<ProposalSummary>> ListAllProposalsAsync(ICredicarroClient client, CancellationToken ct)
    {
        var all = new List<ProposalSummary>();
        var request = new ListRequest(Page: 1, PageSize: 100);

        PagedResult<ProposalSummary> page;
        do
        {
            page = await client.Proposals.ListAsync(request, ct);
            all.AddRange(page.Items);
            request = request with { Page = request.Page + 1 };
        }
        while (page.HasNext);

        return all;
    }

    // Hierarquia de erros: trate do mais específico para o mais genérico e registre só dados não sensíveis.
    public static async Task<Guid?> TryCreateProposalAsync(
        ICredicarroClient client, string cpf, Guid simulationId, ILogger logger, CancellationToken ct)
    {
        try
        {
            return await client.Proposals.CreateAsync(new CreateProposalRequest(cpf, simulationId), ct);
        }
        catch (CredicarroBusinessRuleException ex) when (ex.ErrorCode == "Proposal.SimulationAlreadyExpired")
        {
            return null; // refaça a simulação
        }
        catch (CredicarroRateLimitException ex)
        {
            logger.LogWarning("Limite de requisições | Aguardar: {RetryAfter}", ex.RetryAfter);
            throw;
        }
        catch (CredicarroApiException ex)
        {
            // Nada de ex.Detail nem ex.RawBody: podem repetir dados pessoais enviados.
            logger.LogWarning("Erro da API | Status: {Status} | Codigo: {Codigo} | Campo: {Campo}", (int)ex.StatusCode, ex.ErrorCode, ex.Field);
            throw;
        }
        catch (CredicarroTimeoutException ex)
        {
            logger.LogWarning("Timeout ou circuit breaker aberto | Erro: {ErrorType}", ex.GetType().Name);
            throw;
        }
        catch (CredicarroAuthenticationException ex)
        {
            logger.LogError("Credenciais rejeitadas | Status: {Status} | Codigo: {Codigo}", ex.StatusCode, ex.ErrorCode);
            throw;
        }
    }
}
