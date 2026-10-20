# SDK Go

Repositório: [twila-credicarro-go-sdk](https://github.com/Twila-Digital/twila-credicarro-go-sdk)

```bash
go get github.com/Twila-Digital/twila-credicarro-go-sdk
```

- Compatível com Go 1.18+.
- Zero dependências externas — só a standard library.
- Pacote raiz: `credicarro` (`credicarro.NewClient(credicarro.ClientOptions{...})`).
- Recursos: `Customers`, `Simulations`, `Proposals`, `Webhooks` e `V1` (rotas v1), mais `ParseWebhookEvent` e `VerifyWebhookSignature` para verificar e decodificar webhooks.
- Redirects sempre desligados; `ClientOptions.HTTPClient` é opcional (o SDK força `CheckRedirect`).
- Modelos com dados pessoais têm `String()`/`GoString()` mascarados.
- Erros são valores de retorno tipados, verificáveis via `errors.As` (não exceções).

Ver [rules/go/](../../rules/go) para regras de integração por recurso.
