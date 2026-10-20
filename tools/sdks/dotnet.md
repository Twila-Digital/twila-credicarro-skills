# SDK .NET

Repositório: [twila-credicarro-dotnet-sdk](https://github.com/Twila-Digital/twila-credicarro-dotnet-sdk)

```bash
dotnet add package Twila.Credicarro
```

- Compatível com .NET Core/.NET 2.0+ e .NET Framework 4.6.2+ (`netstandard2.0` + `net8.0`).
- Autenticação com token em cache, retry/circuit breaker via Polly.Core (orçamento de upload = `DocumentUploadAttemptTimeout × MaxRetryAttempts`, `Retry-After` limitado ao orçamento, sem redirects, falha de rede vira `CredicarroTimeoutException`), idempotência automática e integração com `IServiceCollection`/`IHttpClientFactory` (`AddCredicarro(...)`).
- Recursos: `Customers`, `Simulations`, `Proposals`, `Webhooks` e `V1` (rotas v1), mais `CredicarroWebhookEvent` (`Parse`, `ParseUnverified` só para testes, `VerifySignature`, `VerifyAuthorization`). `ToString` mascara dados pessoais.
- Namespace raiz: `Credicarro` (`Credicarro.Configuration`, `Credicarro.Errors`, etc.).

Ver [rules/dotnet/](../../rules/dotnet) para regras de integração por recurso.
