// Webhooks: cadastro pela API e endpoint ASP.NET Core (Minimal API) seguro, com o SDK Twila.Credicarro.
using System.Collections.Concurrent;
using System.Text;
using System.Threading.Channels;
using Credicarro;
using Credicarro.Errors;
using Credicarro.Webhooks;
using Credicarro.Webhooks.Models;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace CredicarroExamples;

public sealed record WebhookJob(Guid ProposalId, string IdempotencyKey);

// Secret: CREDICARRO_WEBHOOK_SECRET (obrigatório; sem ele a aplicação não sobe).
// ExpectedAuthorization: CREDICARRO_WEBHOOK_AUTHORIZATION, valor completo do header Authorization ("Basic ..." ou "Bearer ...");
// configure quando tipo_autenticacao for Basic ou Jwt.
public sealed record WebhookOptions(string Secret, string? ExpectedAuthorization = null)
{
    public static WebhookOptions FromEnvironment() => new(
        Environment.GetEnvironmentVariable("CREDICARRO_WEBHOOK_SECRET") is { Length: > 0 } secret
            ? secret
            : throw new InvalidOperationException("CREDICARRO_WEBHOOK_SECRET ausente"),
        Environment.GetEnvironmentVariable("CREDICARRO_WEBHOOK_AUTHORIZATION") is { Length: > 0 } authorization ? authorization : null);
}

public static class WebhooksExample
{
    // Guarde SigningSecret na hora (cofre ou variável de ambiente): ele só vem nesta resposta.
    public static async Task<CreateWebhookResult> RegisterAsync(ICredicarroClient client, string credentialBase64, CancellationToken ct)
    {
        var result = await client.Webhooks.CreateAsync(new CreateWebhookRequest(
            WebhookType.Proposal,
            "https://parceiro.com.br/webhooks/credicarro",
            WebhookAuthenticationType.Basic,
            Credential: credentialBase64), ct); // Basic: Base64 de usuario:senha; Jwt: o token

        Console.WriteLine($"Webhook {result.WebhookId} cadastrado");
        return result;
    }

    public static async Task ManageAsync(ICredicarroClient client, CancellationToken ct)
    {
        var page = await client.Webhooks.ListAsync(new ListRequest(Page: 1, PageSize: 20), ct);

        foreach (var webhook in page.Items)
        {
            Console.WriteLine($"{webhook.Id} {webhook.Type} {webhook.Status}");
            await client.Webhooks.UpdateAsync(webhook.Id, new UpdateWebhookRequest(webhook.Type, webhook.Url, WebhookStatus.Inactive), ct);
        }
    }

    public static Task DeleteAsync(ICredicarroClient client, Guid webhookId, CancellationToken ct) =>
        client.Webhooks.DeleteAsync(webhookId, ct);

    // Teste local com o vetor da documentação: ParseUnverified(rawBody) (sem verificação) só serve para testes.
    public static ProposalWebhookEvent ParseWithoutVerificationForTests(string rawBody) =>
        CredicarroWebhookEvent.ParseUnverified(rawBody);
}

public static class WebhookEndpoint
{
    private const int MaxBodyBytes = 1024 * 1024; // 1 MiB

    // Registre depois de AddCredicarro (o worker usa o ICredicarroClient singleton).
    public static IServiceCollection AddCredicarroWebhooks(this IServiceCollection services)
    {
        services.AddSingleton(WebhookOptions.FromEnvironment());             // falha na inicialização sem segredo
        services.AddSingleton(Channel.CreateBounded<WebhookJob>(1000));      // fila entre o endpoint e o worker
        services.AddSingleton(new ConcurrentDictionary<string, byte>());     // deduplicação; em produção: Redis ou banco com TTL
        services.AddHostedService<WebhookWorker>();
        return services;
    }

    // Valida, deduplica, enfileira e só então responde 2xx (limite de entrega de 15 s). O processamento é assíncrono.
    public static IEndpointRouteBuilder MapCredicarroWebhook(this IEndpointRouteBuilder app)
    {
        var options = app.ServiceProvider.GetRequiredService<WebhookOptions>();
        var queue = app.ServiceProvider.GetRequiredService<Channel<WebhookJob>>();
        var seen = app.ServiceProvider.GetRequiredService<ConcurrentDictionary<string, byte>>();

        app.MapPost("/webhooks/credicarro", async (HttpRequest request, CancellationToken ct) =>
        {
            // 1. Authorization (Basic/Jwt) cadastrado no webhook, comparado em tempo constante pelo SDK.
            if (options.ExpectedAuthorization is { } expected
                && !CredicarroWebhookEvent.VerifyAuthorization(request.Headers.Authorization.ToString(), expected))
                return Results.Unauthorized();

            // 2. Corpo bruto, com limite de 1 MiB, antes de qualquer desserialização.
            if (request.ContentLength > MaxBodyBytes)
                return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);

            using var buffer = new MemoryStream();
            var chunk = new byte[8192];
            int read;
            while ((read = await request.Body.ReadAsync(chunk, 0, chunk.Length, ct)) > 0)
            {
                if (buffer.Length + read > MaxBodyBytes)
                    return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
                buffer.Write(chunk, 0, read);
            }

            string rawBody;
            try { rawBody = new UTF8Encoding(false, throwOnInvalidBytes: true).GetString(buffer.ToArray()); }
            catch (DecoderFallbackException) { return Results.BadRequest(); }

            // 3. Assinatura HMAC sobre o corpo bruto; inválida ou fora da tolerância (5 min): 401 sem detalhes.
            if (!CredicarroWebhookEvent.VerifySignature(rawBody, request.Headers["X-CrediCarro-Signature"].ToString(), options.Secret))
                return Results.Unauthorized();

            ProposalWebhookEvent evt;
            try { evt = CredicarroWebhookEvent.ParseUnverified(rawBody); } // já verificado acima
            catch (CredicarroWebhookSignatureException) { return Results.BadRequest(); }

            // 4. Deduplicação pelo Idempotency-Key ({id_mensagem}:{id_webhook}, igual em todas as retentativas).
            var key = request.Headers["Idempotency-Key"].ToString();
            if (key.Length > 0 && !seen.TryAdd(key, 0))
                return Results.Ok(); // entrega repetida

            // 5. TryWrite não espera: fila cheia responde 503 na hora e a Credicarro retenta.
            if (!queue.Writer.TryWrite(new WebhookJob(evt.ProposalId, key)))
            {
                seen.TryRemove(key, out _); // desfaz a deduplicação para a retentativa
                return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
            }

            return Results.Ok(); // 2xx só depois de enfileirar
        });

        return app;
    }
}

// Consome a fila: consulta a proposta (as entregas chegam fora de ordem) e age sobre o estado mais recente.
// Exceção tratada por job: uma exceção solta em ExecuteAsync derruba o host.
public sealed class WebhookWorker(Channel<WebhookJob> queue, ICredicarroClient client, ILogger<WebhookWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var job in queue.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                var proposal = await client.Proposals.GetAsync(job.ProposalId, stoppingToken);

                foreach (var action in proposal.GetPendingActions())
                    logger.LogInformation("Webhook | Proposta: {ProposalId} | {Participant} -> {Kind}", proposal.Id, action.Participant, action.Kind);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (CredicarroApiException ex)
            {
                logger.LogError("Webhook falhou | Proposta: {ProposalId} | Status: {Status} | Codigo: {Codigo}", job.ProposalId, (int)ex.StatusCode, ex.ErrorCode);
            }
            catch (Exception ex)
            {
                // Só id e tipo do erro (sem payload nem dados pessoais); segue para o próximo job.
                logger.LogError("Webhook falhou | Proposta: {ProposalId} | Erro: {ErrorType}", job.ProposalId, ex.GetType().Name);
            }
        }
    }
}
