# Segurança (.NET)

Regras para integrar com o Credicarro em .NET, com o SDK `Twila.Credicarro`, sem expor credenciais nem dados pessoais.

## Credenciais

- Guarde `ClientId` e `ClientSecret` em variáveis de ambiente, User Secrets (só em desenvolvimento) ou em um cofre (AWS Secrets Manager, Azure Key Vault). Nunca no código nem em `appsettings.json` versionado.
- Use uma credencial por ambiente: staging e produção têm credenciais diferentes.
- Use o SDK só no backend. Nunca exponha o `ClientSecret` em app mobile, SPA ou página web.
- Nunca peça nem envie credenciais por e-mail ou chat. A Credicarro também não pede.

```csharp
services.AddCredicarro(options =>
{
    options.ClientId = Environment.GetEnvironmentVariable("CREDICARRO_CLIENT_ID") ?? string.Empty;
    options.ClientSecret = Environment.GetEnvironmentVariable("CREDICARRO_CLIENT_SECRET") ?? string.Empty;
    options.Environment = CredicarroEnvironment.Staging;   // padrão: Production
});
// As opções são validadas na primeira resolução do ICredicarroClient: resolva-o na inicialização.
// CredicarroConfigurationException cita só o nome do campo; o ClientSecret nunca aparece em log, ToString ou mensagem.
var webhook = WebhookOptions.FromEnvironment();   // exemplo de webhooks.cs: CREDICARRO_WEBHOOK_SECRET obrigatório; CREDICARRO_WEBHOOK_AUTHORIZATION opcional
```

## Logs e LGPD

- Não registre o token, o `ClientSecret`, o `SigningSecret` nem o `Authorization` de webhook.
- Não registre CPF completo, e-mail, celular, endereço, renda nem o conteúdo (Base64) de documentos. Registre o id da proposta, o `ErrorCode` do erro, o `StatusCode` HTTP e, no máximo, os 3 últimos dígitos do CPF.
- Em `CredicarroApiException`, logue `StatusCode`, `ErrorCode` e `Field`. Evite `RawBody` e `Detail`, que podem repetir dados enviados. A mensagem da exceção é segura (só status, tipo e título).
- A serialização (System.Text.Json) dos modelos leva os valores reais (para persistir em fila ou cache); `CredicarroOptions` recusa serializar. O `ToString` de requisições e respostas já mascara CPF (`***.456.789-**`), e-mail, celular, renda, conta, veículo, credenciais, segredos e conteúdo de documento. Não dependa disso: registre identificadores, não objetos inteiros.
- Use o log estruturado (`ILogger` com parâmetros nomeados), não concatenação de string.
- Envie só os dados necessários e mantenha-os pelo tempo que a finalidade exigir.

## Webhooks

- Exponha a URL só em HTTPS público. Cadastre autenticação Basic ou Jwt, **além** da assinatura HMAC.
- Valide `X-CrediCarro-Signature` com `CredicarroWebhookEvent.VerifySignature` (ou `Parse` com assinatura) sobre o corpo bruto. O SDK compara em tempo constante e recusa `t` fora da tolerância (padrão 5 minutos). Não reimplemente a comparação.
- Limite o corpo lido a 1 MiB (o exemplo lê em blocos e responde `413`).
- `CREDICARRO_WEBHOOK_SECRET` é obrigatório: a aplicação não sobe sem ele, e nunca se valida com segredo vazio.
- Com autenticação Basic ou Jwt, configure `CREDICARRO_WEBHOOK_AUTHORIZATION` (valor completo do header `Authorization`) e confira com `CredicarroWebhookEvent.VerifyAuthorization`, que compara em tempo constante.
- Valide a assinatura **antes** de desserializar. Se for inválida, responda `401` sem detalhes.
- Deduplique pelo `Idempotency-Key` e trate as notificações como idempotentes. Responda `2xx` só depois de enfileirar; se falhar, desfaça a deduplicação e responda `503`.
- Confie na consulta da proposta (`client.Proposals.GetAsync`) para o estado final, não só no payload.

## Resiliência e envio de documentos

- O SDK já repete as chamadas seguras (com a mesma `Idempotency-Key`) em `408`, `429`, `500`, `502`, `503`, `504`, falha de rede e timeout. Não empilhe retentativas (Polly ou laço seu) por cima do client.
- Nunca construa `Idempotency-Key` de documento de forma determinística. Gere um UUID **por envio**, guarde-o com o envio pendente e use uma chave **nova** na correção.
- Use `CancellationToken` em toda chamada. Não bloqueie com `.Result` ou `.Wait()`.
- Em `403` (`Integration.Access.Inactive`) pare e fale com o time Credicarro.

## Checklist

- [ ] Credenciais fora do repositório, uma por ambiente.
- [ ] `ICredicarroClient` singleton, resolvido na inicialização.
- [ ] Logs sem token, segredo, CPF completo, `Detail`/`RawBody` nem documentos.
- [ ] Webhook em HTTPS, com Basic/Jwt, assinatura HMAC pelo SDK, corpo limitado a 1 MiB e deduplicação.
- [ ] Chave de documento: UUID por envio guardado com o envio pendente; nova na correção.
