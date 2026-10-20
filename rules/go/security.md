# Segurança (Go)

Regras para integrar com o Credicarro em Go, com o SDK `twila-credicarro-go-sdk`, sem expor credenciais nem dados pessoais.

## Credenciais

- Guarde `ClientID` e `ClientSecret` em variáveis de ambiente ou em um cofre (AWS Secrets Manager, HashiCorp Vault). Nunca no código nem em arquivo versionado.
- Use uma credencial por ambiente: staging e produção têm credenciais diferentes.
- Use o SDK só no backend. Nunca exponha o `ClientSecret` em app mobile, SPA ou página web.
- Nunca peça nem envie credenciais por e-mail ou chat. A Credicarro também não pede.

```go
client, err := credicarro.NewClient(credicarro.ClientOptions{
    ClientID:     os.Getenv("CREDICARRO_CLIENT_ID"),
    ClientSecret: os.Getenv("CREDICARRO_CLIENT_SECRET"),
    Environment:  credicarro.EnvironmentStaging, // padrão: EnvironmentProduction
})
if err != nil {
    log.Fatal(err) // *ConfigurationError: não traz o valor das variáveis
}
cfg, err := webhookConfigFromEnv() // exemplo de webhooks.go: CREDICARRO_WEBHOOK_SECRET obrigatório; CREDICARRO_WEBHOOK_AUTHORIZATION opcional
if err != nil {
    log.Fatal(err)
}
```

O `ClientSecret` nunca aparece em `String()`, `%v`, `%+v`, `%#v` nem em mensagens de erro do SDK. Os modelos com dados pessoais (`UpsertCustomerRequest`, `DepositAccount`, `CreateProposalRequest`, `ProposalDetails`, `DocumentFile`...) também mostram valores mascarados (CPF `***.456.789-**`, demais `***`). Mesmo assim, registre só ids e tipos de erro. A máscara vale só para log; `json.Marshal` dos modelos traz os valores reais (trate a fila/cache como dado pessoal) e `ClientOptions` recusa a serialização.

## Logs e LGPD

- Não registre o token, o `ClientSecret`, o `SigningSecret` nem o `Authorization` de webhook.
- Não registre CPF completo, e-mail, celular, endereço, renda nem o conteúdo (Base64) de documentos. Registre o id da proposta, o `ErrorCode` do erro, o `StatusCode` HTTP e, no máximo, os 3 últimos dígitos do CPF.
- Em `*credicarro.APIError`, logue `StatusCode`, `ErrorCode` e `Field`. Evite `Body` e `Detail`, que podem repetir dados enviados. A mensagem do erro é segura (só status, tipo e título).
- Não use `%+v` nem `%#v` em requisições e respostas (`UpsertCustomerRequest`, `ProposalDetails`...): eles imprimem todos os campos, inclusive CPF.
- Envie só os dados necessários e mantenha-os pelo tempo que a finalidade exigir.

## Webhooks

- Exponha a URL só em HTTPS público. Cadastre autenticação Basic ou Jwt, **além** da assinatura HMAC.
- Valide `X-CrediCarro-Signature` com `credicarro.VerifyWebhookSignature` (ou `ParseWebhookEvent`) sobre o corpo bruto. O SDK compara em tempo constante e recusa `t` fora da tolerância (padrão 5 minutos). Não reimplemente a comparação.
- Limite o corpo lido a 1 MiB (o exemplo responde `413` acima disso).
- `CREDICARRO_WEBHOOK_SECRET` é obrigatório: a aplicação não sobe sem ele, e nunca se valida com segredo vazio.
- Com autenticação Basic ou Jwt, configure `CREDICARRO_WEBHOOK_AUTHORIZATION` (valor completo do header `Authorization`) e confira com `credicarro.VerifyWebhookAuthorization`, que compara em tempo constante.
- Valide a assinatura **antes** de desserializar. Se for inválida, responda `401` sem detalhes.
- Deduplique pelo `Idempotency-Key` e trate as notificações como idempotentes. Responda `2xx` só depois de enfileirar; se a fila estiver cheia, desfaça a deduplicação e responda `503`.
- Confie na consulta da proposta (`client.Proposals.Get`) para o estado final, não só no payload.

## Resiliência e envio de documentos

- O SDK já repete as chamadas seguras (com a mesma `Idempotency-Key`) em `408`, `429`, `500`, `502`, `503`, `504`, falha de rede e timeout. Não faça laço de retry seu em volta das chamadas.
- Nunca construa a `Idempotency-Key` de documento de forma determinística. Gere um UUID **por envio**, guarde-o com o envio pendente e use uma chave **nova** na correção.
- Crie um único `*credicarro.Client` por processo (seguro para goroutines) e passe `context.Context` com prazo em toda chamada.
- Em `403` (`Integration.Access.Inactive`) pare e fale com o time Credicarro.

## Checklist

- [ ] Credenciais fora do repositório, uma por ambiente.
- [ ] `*credicarro.Client` único, criado na inicialização.
- [ ] Logs sem token, segredo, CPF completo, `Detail`/`Body` nem documentos.
- [ ] Webhook em HTTPS, com Basic/Jwt, assinatura HMAC pelo SDK, corpo limitado a 1 MiB e deduplicação.
- [ ] Chave de documento: UUID por envio guardado com o envio pendente; nova na correção.
