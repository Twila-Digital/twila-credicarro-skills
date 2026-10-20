# Indo para produção

## Requisitos

1. Valide pelo menos uma proposta de ponta a ponta no staging, na modalidade que você vai oferecer (financiamento, refinanciamento ou as duas).
2. Peça `clientId` e `clientSecret` de produção em atendimento@credicarro.com.br, com a lista de lojas (CNPJ) que vão operar.
3. Aguarde o time Credicarro liberar a integração e vincular as lojas ao seu cadastro de parceiro.
4. Troque a base URL (`https://api.credicarro.com.br/integration`) e as credenciais — só configuração, nenhuma mudança de código.
5. Cadastre de novo o webhook na produção e guarde o novo `segredo_assinatura`. Os webhooks do staging não recebem eventos reais.

## Checklist técnico

- [ ] Base URL e credenciais vêm de configuração; `clientSecret` num gerenciador de segredos.
- [ ] Cliente do SDK reaproveitado (singleton) — ele mantém o token em cache até `expira_em` e o estado do circuit breaker.
- [ ] `Idempotency-Key` gerada uma vez por operação e reaproveitada nas retentativas.
- [ ] Retentativa só em `500`, `502`, `503`, timeout e falha de rede, com espera crescente e limite de tentativas. Nunca em `4xx`.
- [ ] Erros de negócio tratados pelo `tipo`, com tratamento genérico por status para códigos novos.
- [ ] Webhook em URL HTTPS pública, com autenticação Basic ou JWT conferida no endpoint e assinatura HMAC validada em tempo constante.
- [ ] O endpoint de webhook não sobe sem `CREDICARRO_WEBHOOK_SECRET` e limita o corpo a 1 MiB.
- [ ] Webhook responde `2xx` rápido, deduplica pelo `Idempotency-Key` e processa de forma assíncrona.
- [ ] Estado da proposta reconciliado pela consulta (`GET /v2/proposal/{id}`) — notificações chegam fora de ordem e param após 3 retentativas.
- [ ] Logs sem CPF completo, token, `clientSecret`, `segredo_assinatura` ou conteúdo de documentos.

## Diferenças staging → produção

- Só a base URL e as credenciais mudam. Regras de negócio e formato de resposta são os mesmos.
- Em produção as propostas são reais: confirme antes de repetir automaticamente uma criação de proposta sem `Idempotency-Key`.

## Depois do go-live

- Acompanhe as primeiras propostas: as etapas avançam? Os documentos são aceitos?
- Monitore o endpoint de webhook: depois de 3 retentativas, ou em respostas `4xx`, a notificação deixa de ser enviada.
- Monitore taxa de erro e latência das chamadas à API; alerte em aumento de `5xx` ou `401`.
