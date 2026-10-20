# FAQ

1. **Onde está a documentação completa da API?**
   Em [documentacao.credicarro.com.br](https://documentacao.credicarro.com.br) — autenticação, fluxo da proposta, webhooks, erros e guias. Índice para IA em [`/llms.txt`](https://documentacao.credicarro.com.br/llms.txt).

2. **Existe SDK do Credicarro?**
   Sim, para .NET, Java, Node.js, Python, PHP e Go. Veja os pacotes em [tools/ecosystem.md](../tools/ecosystem.md) e a configuração em `rules/<linguagem>/client.md` (ex.: [.NET](../rules/dotnet/client.md), [Python](../rules/python/client.md)). Os SDKs cuidam de token, retry, `Idempotency-Key` e assinatura de webhook.

3. **Qual ambiente uso no desenvolvimento?**
   Staging (`https://api.staging.credicarro.com.br/integration`) — nenhuma proposta é real. Credenciais e webhooks de um ambiente não funcionam no outro.

4. **Preciso de um token por rota ou por requisição?**
   Não. O mesmo token vale para todas as rotas até `expira_em`. Guarde em cache e renove só quando expirar ou numa resposta `401`.

5. **Os valores monetários são em centavos?**
   Não. São números em reais com ponto decimal (`45000`, `6500.00`).

6. **Qual a ordem das chamadas?**
   Token → webhook (uma vez) → cliente completo (`/v1/customer/unified`) → faixa (opcional) → simulação `/v2` com `cnpjLoja` → proposta `/v2` com o `id_simulacao` escolhido → etapas. Veja [rules/agent.md](../rules/agent.md).

7. **Por que a simulação retorna `404` ou `422` para a loja?**
   `404` `Store.Integration.NotFound`: o `cnpjLoja` não existe ou não está vinculado ao seu cadastro de parceiro. `422` `Store.Integration.Intermediation`: a loja tem contrato de intermediação e não pode ser usada na integração.

8. **Por que a proposta retorna `Customer.Account.Incomplete`?**
   A proposta exige dados pessoais, endereço, ocupação e renda. Envie tudo em `POST /v1/customer/unified` **sem** `Idempotency-Key` (com a chave, um CPF já cadastrado retorna `409`).

9. **Como sei o que enviar em cada etapa?**
   Leia o `status_ativo` de cada participante. Quando `responsavel_acao` for `INTEGRADOR`, a `etapa` diz o endpoint: documentos (6 e 7), dados do veículo (8) ou conta de recebimento (5). Veja [Etapas e status da proposta](../rules/proposal-steps.md).

10. **Um documento foi recusado. E agora?**
    Ele aparece com `status` `INVALIDO` e um `motivo`. Corrija o arquivo e reenvie só aquele tipo, para o mesmo participante, com uma `Idempotency-Key` nova.

11. **Posso repetir uma requisição que deu timeout?**
    Sim, com a mesma `Idempotency-Key` e o mesmo corpo. Repita só `500`, `502`, `503`, timeout e falha de rede.

12. **Como valido que um webhook veio da Credicarro?**
    Pela assinatura HMAC-SHA256 do header `X-CrediCarro-Signature`, calculada sobre `"{t}.{corpo bruto}"` com o `segredo_assinatura`. Veja `rules/<linguagem>/webhooks.md` e o vetor de teste em [proposal-steps.md](../rules/proposal-steps.md#webhook-de-proposta).

13. **Perdi o `segredo_assinatura`.**
    Ele só aparece no cadastro. Exclua o webhook e cadastre outro para gerar um novo segredo.

14. **A proposta expirou. Dá para retomar?**
    Não. A proposta expira um mês depois de criada, se não for concluída. Faça uma nova simulação e crie outra proposta.

15. **Recebo `404` numa proposta que existe.**
    Confira se o token é do mesmo ambiente em que a proposta foi criada. A API também retorna `404` para recursos de outro parceiro.
