# Segurança (PHP)

Boas práticas para integrar com o Credicarro em PHP usando o SDK. Valem para o `CredicarroClient` ([client](client.md)) e para o endpoint de webhook ([webhooks](webhooks.md)).

## Credenciais

- Guarde `clientId` e `clientSecret` em variáveis de ambiente (`CREDICARRO_CLIENT_ID`, `CREDICARRO_CLIENT_SECRET`) ou em um gerenciador de segredos, e passe-os ao `ClientOptions`. Nunca no código nem no repositório.
- Não deixe o `.env` acessível pelo servidor web: mantenha-o fora do diretório público.
- `clientSecret` é **só do servidor**. Nunca o coloque em app mobile, SPA ou código que roda no dispositivo do usuário.
- Use credenciais diferentes em staging e produção. Cada ambiente tem as suas. Lembre que, sem o argumento de ambiente, o SDK aponta para **produção**: configure `Environment::STAGING` ou `Environment::PRODUCTION` explicitamente.
- Troque a credencial se ela vazar (log, commit por engano). A Credicarro nunca pede suas credenciais por e-mail ou telefone.
- O `signingSecret` do webhook tem o mesmo nível de cuidado: guarde em cofre assim que o `create` responder, pois ele não pode ser recuperado depois.

## Token e logs

- O SDK guarda o `clientSecret` num objeto interno (sem getter) que não aparece em `var_dump`, `print_r`, `var_export` nem em stack traces, e `ClientOptions`/cliente/credenciais recusam `serialize`. Requisições e respostas com CPF, e-mail, celular, renda, conta bancária, credencial ou conteúdo de documento saem mascaradas **só em `var_dump`/`print_r`**: `serialize`, `json_encode`, `var_export` e `(array)` mostram os valores reais (os modelos precisam ir para fila, sessão e cache sem perda). **Nunca** registre esses objetos com `var_export`, `json_encode` ou `serialize`; registre só IDs e códigos de erro. O token fica em memória (e, se você configurar um cache PSR-16, também nele: use um cache exclusivo da aplicação e protegido, pois o token vale como credencial até expirar, e apague a chave ao rotacionar o `clientSecret`). Não registre o token nem o header `Authorization`. Use `#[\SensitiveParameter]` (PHP 8.2+, em linha própria) nos seus parâmetros com CPF e segredos. Desative o `debug` do Guzzle e middlewares de log que imprimem headers se passar um `ClientInterface` próprio.
- Não registre o corpo de requisições com CPF, endereço ou renda. Mascare o CPF (`***.456.789-**`) e nunca registre o conteúdo (Base64) de um documento.
- A **mensagem** das exceções do SDK traz só status, `tipo` e `titulo`. `getDetail()` e `getRawBody()` podem conter dados pessoais. Não os registre em log.
- Ao logar exceções, use `get_class($e)`, `getStatusCode()` e `getErrorCode()`, mais o ID da proposta. Evite `var_dump`/`print_r` de respostas em produção.

## LGPD

- Colete só os campos que a integração precisa. CPF, endereço, renda e documentos são dados pessoais.
- Criptografe em repouso o que você gravar localmente (cadastros, documentos, `biometryLink`).
- Atenda pedidos de acesso e exclusão conforme a sua política de retenção.
- Os dados enviados devem bater com os documentos do cliente: divergências de nome, CPF ou endereço podem causar recusa de documentos.

## Webhook

- Exponha uma URL **HTTPS pública**. A API recusa localhost, IP privado, usuário/senha e fragmento.
- Defina autenticação BASIC ou JWT no cadastro **e** valide a assinatura HMAC. Uma camada não substitui a outra. Com BASIC ou JWT, configure `CREDICARRO_WEBHOOK_AUTHORIZATION` (valor completo do header `Authorization`) e confira com `CredicarroWebhookEvent::verifyAuthorization`, que compara em tempo constante; a credencial vem de configuração, nunca literal no código.
- `CREDICARRO_WEBHOOK_SECRET` é obrigatória: o sistema não deve subir sem ela, e o SDK trata segredo vazio como assinatura inválida.
- Valide a assinatura com o SDK (`CredicarroWebhookEvent::verifySignature` ou `parse`), contra o corpo bruto, sempre antes de decodificar o JSON. Ele compara com `hash_equals`, aceita `t` só com 1 a 10 dígitos e rejeita `t` fora da tolerância de 5 minutos. Nunca use `parseUnverified` num endpoint público, nem compare assinaturas com `===`/`==`.
- Rejeite corpos acima de 1 MiB: confira `CONTENT_LENGTH` e leia no máximo 1 MiB + 1 de `php://input`.
- Assinatura inválida responde `401`. O processamento pesado vai para uma fila; só responda `2xx` depois de enfileirar e responda `503` (desfazendo a deduplicação) se enfileirar falhar.
- Deduplique pelo header `Idempotency-Key` da entrega. No worker, registre falhas por job (ID da proposta e tipo do erro, sem payload).

## Idempotência e resiliência

- A `Idempotency-Key` explícita tem de 1 a 200 caracteres ASCII imprimíveis (não só espaços); senão o SDK lança `Validation.IdempotencyKey.Invalid` antes de chamar a API. No dedup do webhook, rejeite a chave com mais de 200 caracteres.
- O SDK nunca segue redirects (um `3xx` vira `CredicarroApiException`) e a mensagem das exceções de rede não traz requisição, headers nem corpo.
- O SDK gera a `Idempotency-Key` (um UUID por chamada lógica, o mesmo em todas as tentativas) nas criações. Você não precisa gerá-la, nem repetir `POST` por conta própria.
- No envio de documento a chave é obrigatória e nunca determinística: informe um UUID por envio, guardado com o envio pendente e reaproveitado só nas retentativas dele. Chave nova a cada tentativa substitui o documento enviado; na correção, use chave nova.
- `customers->upsert($request)` sem chave não é repetido pelo SDK e `webhooks->create` também não: um timeout pode ter criado o registro. Consulte antes de criar de novo.
- O SDK repete só `408`, `429`, `500`, `502`, `503`, `504`, falha de rede e timeout, com espera crescente e jitter, no máximo `maxRetryAttempts` (3). Nunca `4xx`.
- Não empilhe retentativas (middleware do Guzzle, retry do framework, proxy) sobre as do SDK.
- O backoff usa `usleep` e bloqueia o worker do PHP-FPM. Em requisições de usuário, reduza `totalTimeoutMs`/`maxRetryAttempts` em `ResilienceOptions` e deixe um job repetir a operação com a mesma chave.

## Desempenho

- Mantenha um único `CredicarroClient` por processo (container de DI). O circuit breaker vive na instância. O token também, por padrão: em PHP-FPM isso significa um token por requisição. Para evitar essa chamada extra, passe um cache PSR-16 (APCu ou Redis) em `ClientOptions` (`$tokenCache`); a chave é derivada de ambiente e `clientId`, o `clientSecret` nunca é gravado e o token guardado é removido se o `401` o rejeitar.
- Os timeouts são configuráveis em `ResilienceOptions` (`totalTimeoutMs` 30000, `attemptTimeoutMs` 10000, `documentUploadAttemptTimeoutMs` 60000). Sem timeout, uma chamada lenta ocupa o worker indefinidamente.
- Reaproveite conexões com `curl` e keep-alive quando o ambiente permitir.
