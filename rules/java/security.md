# Segurança (Java)

Boas práticas para integrar com o Credicarro em Java usando o SDK. Valem para o `CredicarroClient` ([client](client.md)) e para o endpoint de webhook ([webhooks](webhooks.md)).

## Credenciais

- Guarde `clientId` e `clientSecret` em variáveis de ambiente (`CREDICARRO_CLIENT_ID`, `CREDICARRO_CLIENT_SECRET`) ou em um gerenciador de segredos, e passe-os ao `CredicarroClient.builder()`. Nunca no código nem no repositório.
- `clientSecret` é **só do servidor**. Nunca o coloque em app Android, applet ou código que roda no dispositivo do usuário. O SDK não deve ser empacotado em cliente.
- Use credenciais diferentes em staging e produção. Cada ambiente tem as suas. Lembre que, sem `environment(...)`, o SDK aponta para **produção**: configure o ambiente explicitamente.
- Troque a credencial se ela vazar (log, commit por engano). A Credicarro nunca pede suas credenciais por e-mail ou telefone.
- O `signingSecret` do webhook tem o mesmo nível de cuidado: guarde em cofre assim que o `create` responder, pois ele não pode ser recuperado depois.

## Token e logs

- O SDK nunca coloca o `clientSecret` em `toString`, mensagem ou log; o token fica só em memória. Não registre o token nem o header `Authorization` se usar um interceptador de log HTTP próprio.
- Não registre o corpo de requisições com CPF, endereço ou renda. Mascare o CPF (`***.456.789-**`) e nunca registre o conteúdo (Base64) de um documento.
- A **mensagem** das exceções do SDK traz só status, `tipo` e `titulo`. `getDetail()` e `getRawBody()` podem conter dados pessoais: não os registre em nível de info.
- Ao logar exceções, use `ex.getClass().getSimpleName()`, `getStatusCode()` e `getErrorCode()`, mais o ID da proposta. Não despeje o payload nem a exceção inteira com `printStackTrace` em produção.

## LGPD

- Colete só os campos que a integração precisa. CPF, endereço, renda e documentos são dados pessoais.
- Criptografe em repouso o que você gravar localmente (cadastros, documentos, `biometryLink`).
- Atenda pedidos de acesso e exclusão conforme a sua política de retenção.
- Os dados enviados devem bater com os documentos do cliente: divergências de nome, CPF ou endereço podem causar recusa de documentos.

## Webhook

- Exponha uma URL **HTTPS pública**. A API recusa localhost, IP privado, usuário/senha e fragmento.
- Defina autenticação BASIC ou JWT no cadastro **e** valide a assinatura HMAC. Uma camada não substitui a outra. Com BASIC ou JWT, configure `CREDICARRO_WEBHOOK_AUTHORIZATION` (valor completo do header `Authorization`) e confira com `CredicarroWebhookEvent.verifyAuthorization`, que compara em tempo constante; a credencial vem de configuração, nunca literal no código.
- `CREDICARRO_WEBHOOK_SECRET` é obrigatória: a aplicação não deve subir sem ela, e o SDK trata segredo vazio como assinatura inválida.
- Valide a assinatura com o SDK (`CredicarroWebhookEvent.verifySignature` ou `parse(corpo, cabecalho, segredo)`), contra o corpo bruto, sempre antes de desserializar. Ele compara em tempo constante, aceita `t` só com 1 a 10 dígitos e rejeita `t` fora da tolerância de 5 minutos. Nunca use `parseUnverified(rawBody)` (sem assinatura) num endpoint público, nem compare assinaturas com `String.equals`.
- Rejeite corpos acima de 1 MiB: confira o `Content-Length`, **não** use `@RequestBody byte[]` e leia o `InputStream` com `readNBytes(1 MiB + 1)`.
- Assinatura inválida responde `401`. O processamento pesado vai para uma fila limitada; só responda `2xx` depois de enfileirar e responda `503` (desfazendo a deduplicação) se a fila estiver cheia.
- Deduplique pelo header `Idempotency-Key` da entrega. No worker, registre falhas por job (ID da proposta e tipo do erro, sem payload).

## Idempotência e resiliência

- O SDK gera a `Idempotency-Key` (um UUID por chamada lógica, o mesmo em todas as tentativas) nas criações. Você não precisa gerá-la, nem repetir `POST` por conta própria.
- No envio de documento a chave é obrigatória e nunca determinística: informe um `UUID.randomUUID()` por envio, guardado com o envio pendente e reaproveitado só nas retentativas dele. Chave nova a cada tentativa substitui o documento enviado; na correção, use chave nova.
- `customers().upsert(request)` sem chave não é repetido pelo SDK e `webhooks().create` também não: um timeout pode ter criado o registro. Consulte antes de criar de novo.
- O SDK repete só `408`, `429`, `500`, `502`, `503`, `504`, falha de rede e timeout, com espera crescente e jitter, no máximo `maxRetryAttempts` (3). Nunca `4xx`.
- Não empilhe retentativas (Resilience4j, Spring Retry, proxy) sobre as do SDK.

## Desempenho

- Mantenha um único `CredicarroClient` (singleton). Ele guarda o token em cache, o pool de conexões OkHttp e o circuit breaker; um cliente por requisição re-autentica e joga o pool fora.
- Os timeouts são configuráveis em `CredicarroResilienceOptions` (`totalTimeout` 30 s, `attemptTimeout` 10 s, `documentUploadAttemptTimeout` 60 s). Em requisições de usuário, considere reduzir `totalTimeout` e deixar um job repetir a operação.
- Com várias instâncias da aplicação, cada uma mantém o próprio token. É válido; o custo é uma chamada de autenticação por instância a cada renovação.
