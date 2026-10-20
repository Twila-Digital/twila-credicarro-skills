# Segurança (Node.js)

Boas práticas para integrar com o Credicarro usando o SDK `@twila/credicarro`.

## Credenciais
- Leia `CREDICARRO_CLIENT_ID`, `CREDICARRO_CLIENT_SECRET` e `CREDICARRO_WEBHOOK_SECRET` de variáveis de ambiente ou de um gerenciador de segredos. Falhe na inicialização se faltarem.
- Nunca versione `clientSecret` nem `signingSecret`.
- O `clientSecret` é **só server-side**. Não o coloque em bundle de navegador, app mobile nem em código que roda no dispositivo do cliente.
- Use uma credencial por ambiente. O SDK, sem `environment` nem `baseUrl`, aponta para **Produção**: passe `CredicarroEnvironment.Staging` de forma explícita nos testes. Um token de staging dá `401` em produção.
- O SDK só aceita `baseUrl` em `https` (`http` só para `localhost`/`127.0.0.1`) e nunca imprime o `clientSecret`.
- A Credicarro nunca pede suas credenciais por e-mail ou telefone.

## Token
- O SDK gera, guarda em memória e renova o token. Você não manipula `token_de_acesso`.
- Não registre token, `clientSecret` nem o header `Authorization` em logs, traces ou mensagens de erro.
- `CredicarroApiError.rawBody`, `problemDetails` e `detail` podem conter dados do cliente: são propriedades **não enumeráveis** (fora de `JSON.stringify`/`util.inspect`), mas não envie esses campos para logs. As respostas do SDK (propostas, simulações, eventos, `DocumentFile`, resultado do cadastro de webhook) mostram CPF mascarado (`***.456.789-**`) e o resto como `***` em `util.inspect`/`console.log`. `JSON.stringify`/`toJSON` carregam os valores **reais** (para responder, enfileirar e persistir): não registre o JSON de respostas em log; objetos de requisição que você monta não são mascarados. `error.message` é seguro (só status, `tipo` e título).

## LGPD
- Cadastro, simulação e documentos trazem dados pessoais (CPF, nome, endereço, renda, documentos).
- Logue só identificadores técnicos (`proposalId`, `errorCode`, `statusCode`). Nunca o CPF completo nem o conteúdo de documentos (`base64Content`).
- Colete só o necessário e defina retenção e exclusão conforme a sua política de privacidade.
- Se guardar cópias locais, criptografe em repouso.

## Webhook
- Exponha o endpoint em HTTPS público e cadastre autenticação Basic ou JWT (`WebhookAuthenticationType.Basic` ou `Jwt`), além da assinatura. `None` não é recomendado.
- Valide sempre a assinatura com `parseWebhookEvent`/`verifyWebhookSignature` (header e segredo obrigatórios; `parseWebhookEventUnverified` só para testes, nunca em endpoint público) contra o **corpo bruto** (`express.raw`, limite de 1 MiB, `Buffer.isBuffer`). Veja [webhooks.md](webhooks.md).
- Defina `CREDICARRO_WEBHOOK_SECRET` (obrigatória: sem ela a aplicação não sobe) e `CREDICARRO_WEBHOOK_AUTHORIZATION`; confira o header com `verifyWebhookAuthorization` (tempo constante).
- Deduplique pelo `Idempotency-Key` de forma atômica e só responda `2xx` depois de enfileirar.
- Guarde o `signingSecret` com o mesmo cuidado do `clientSecret`.

## Idempotência e resiliência
- Deixe o SDK gerar e repetir a `Idempotency-Key`; ele usa a mesma em todas as tentativas de uma chamada.
- Em `proposals.uploadDocument`, guarde um UUID **por envio** junto do envio pendente; use chave nova na correção. Nunca derive a chave do conteúdo, do nome ou do tipo.
- Em `customers.upsert`, **não passe chave** se a intenção é criar ou atualizar; com chave a rota só cria.
- Mantenha uma única camada de retentativa (a do SDK). Não envolva as chamadas em outro laço, para evitar tempestade de requisições numa instabilidade. Trate `CredicarroRateLimitError.retryAfterMs` em vez de insistir.
- Reaproveite uma instância de `CredicarroClient` (singleton do módulo). Criar uma por requisição derruba o cache de token e o estado do circuit breaker.
- Não desligue a resiliência nem `disableAutomaticIdempotencyKey` sem motivo.
