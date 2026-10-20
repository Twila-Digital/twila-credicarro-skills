# Segurança (Python)

Boas práticas para integrar com o Credicarro usando o SDK `twila-credicarro`.

## Credenciais
- Leia `CREDICARRO_CLIENT_ID`, `CREDICARRO_CLIENT_SECRET` e `CREDICARRO_WEBHOOK_SECRET` de variáveis de ambiente ou de um gerenciador de segredos. Falhe na inicialização se faltarem.
- Nunca versione `client_secret` nem `signing_secret`.
- O `client_secret` é **só server-side**. Não o coloque em app mobile, SPA nem em código que roda no dispositivo do cliente.
- Use uma credencial por ambiente. O SDK, sem `environment` nem `base_url`, aponta para **Produção**: passe `CredicarroEnvironment.STAGING` de forma explícita nos testes. Um token de staging dá `401` em produção.
- O SDK só aceita `base_url` em `https` (`http` só para `localhost`/`127.0.0.1`) e esconde o `client_secret` e o token do `repr` (ficam em objetos com `repr` mascarado, não em variáveis locais comuns). O `repr` de requisições e respostas mascara CPF, e-mail, celular, renda, conta bancária e credenciais; `detail`, `errors` e `raw_body` dos erros não entram em `repr` nem em `str`. A máscara vale só para `repr`/`str` (nome, sobrenome, endereço, placa, `refusal_reason` e `biometry_link` também): `pickle`, `dataclasses.asdict` e JSON dos modelos carregam os valores reais; só objetos com segredo (opções do cliente, credenciais, token) recusam serialização.
- A Credicarro nunca pede suas credenciais por e-mail ou telefone.

## Token
- O SDK gera, guarda em memória e renova o token. Você não manipula `token_de_acesso`.
- Não registre token, `client_secret` nem o header `Authorization` em logs, traces ou mensagens de erro.
- `CredicarroApiError.raw_body` e `detail` podem conter dados do cliente; não envie esses campos para logs. `str(error)` é seguro (só status, `tipo` e título).

## LGPD
- Cadastro, simulação e documentos trazem dados pessoais (CPF, nome, endereço, renda, documentos).
- Logue só identificadores técnicos (`proposal_id`, `error_code`, `status_code`). Nunca o CPF completo nem o conteúdo de documentos (`base64_content`).
- Colete só o necessário e defina retenção e exclusão conforme a sua política de privacidade.
- Se guardar cópias locais, criptografe em repouso.

## Webhook
- Exponha o endpoint em HTTPS público e cadastre autenticação Basic ou JWT (`WebhookAuthenticationType.BASIC` ou `JWT`), além da assinatura. `NONE` não é recomendado.
- Valide sempre a assinatura com `parse_webhook_event`/`verify_webhook_signature` contra o **corpo bruto** (`request.get_data()`, `MAX_CONTENT_LENGTH` de 1 MiB). Veja [webhooks.md](webhooks.md).
- Defina `CREDICARRO_WEBHOOK_SECRET` (obrigatória: sem ela a aplicação não sobe) e `CREDICARRO_WEBHOOK_AUTHORIZATION`; confira o header com `verify_webhook_authorization` (tempo constante).
- Deduplique pelo `Idempotency-Key` de forma atômica e só responda `2xx` depois de enfileirar.
- Guarde o `signing_secret` com o mesmo cuidado do `client_secret`.

## Idempotência e resiliência
- Deixe o SDK gerar e repetir a `Idempotency-Key`; ele usa a mesma em todas as tentativas de uma chamada.
- Em `proposals.upload_document`, guarde um UUID **por envio** junto do envio pendente; use chave nova na correção. Nunca derive a chave do conteúdo, do nome ou do tipo.
- Em `customers.upsert`, **não passe chave** se a intenção é criar ou atualizar; com chave a rota só cria.
- Mantenha uma única camada de retentativa (a do SDK). Não envolva as chamadas em outro laço, para evitar tempestade de requisições numa instabilidade. Trate `CredicarroRateLimitError.retry_after_ms` em vez de insistir.
- Reaproveite uma instância de `CredicarroClient` (singleton do módulo ou da app factory; é thread-safe). Criar uma por requisição derruba o cache de token e o estado do circuit breaker. Chame `client.close()` no encerramento.
- Não desligue a resiliência nem `disable_automatic_idempotency_key` sem motivo.
