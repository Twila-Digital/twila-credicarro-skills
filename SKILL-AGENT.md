---
name: credicarro-agent
description: Standalone skill for calling the Credicarro vehicle credit API directly via curl — access token, customers, simulations, proposals and their steps, documents, vehicle details, deposit account and webhooks. Agent mode only, no integration code.
metadata:
  tags: credicarro, financiamento, refinanciamento, veiculos, credito, proposta, simulacao, webhooks, api
---

## Quando usar

Quando o usuário quer **executar ações** diretamente — gerar token, cadastrar cliente, consultar faixa, simular, criar ou consultar proposta, enviar documento, dados do veículo ou conta de recebimento, cadastrar ou editar webhook. Chame a API do Credicarro via `curl` no terminal. Para escrever código de integração, use a skill completa (`SKILL.md`).

---

## Regras: Agent Mode — Uso direto da API


Quando o usuário pedir para **executar** uma ação (gerar token, cadastrar cliente, simular, criar ou consultar proposta, enviar documento, gerenciar webhook) em vez de **escrever código** de integração, chame a API do Credicarro diretamente via `curl`.

#### Autenticação

A API usa Bearer token. Troque `clientId` e `clientSecret` por um token de acesso antes de qualquer outra chamada:

```bash
: "${CREDICARRO_CLIENT_ID:?exporte CREDICARRO_CLIENT_ID}" "${CREDICARRO_CLIENT_SECRET:?exporte CREDICARRO_CLIENT_SECRET}"

TOKEN=$(jq -n '{clientId: env.CREDICARRO_CLIENT_ID, clientSecret: env.CREDICARRO_CLIENT_SECRET}' \
  | curl -s -X POST "$CREDICARRO_BASE_URL/v1/authentication/accesstoken" \
      -H "Content-Type: application/json" --data-binary @- \
  | jq -r '.token_de_acesso')
```

O `jq` lê as variáveis exportadas (`env.`) e o corpo segue pela entrada padrão: o `clientSecret` não aparece em nenhuma linha de comando (`ps`, histórico) e caracteres como `"` ou `\` no segredo não quebram o JSON. As variáveis precisam estar exportadas (`export CREDICARRO_CLIENT_SECRET=...` ou `set -a; . ./.env; set +a`) — sem isso, `env.` vira `null`; a primeira linha interrompe antes de chamar a API.

Resposta completa:
```json
{
  "token_de_acesso": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expira_em_segundos": 3600,
  "expira_em": "2025-08-12T18:06:28.088+00:00",
  "tipo_de_token": "Bearer",
  "escopo": "credicarro.integration.access/full"
}
```

Use o token nas chamadas seguintes:
```bash
curl -s -H "Authorization: Bearer $TOKEN" "$CREDICARRO_BASE_URL/v2/proposal/PROPOSTA_ID" | jq "$OCULTA_CPF"
```

`OCULTA_CPF` é o filtro `jq` que mascara CPFs antes de exibir — defina-o como em [Formato de resposta e erros](#formato-de-resposta-e-erros).

- Leia `CREDICARRO_CLIENT_ID`/`CREDICARRO_CLIENT_SECRET` de variáveis de ambiente ou de um `.env` fora do controle de versão. Se não existirem, peça ao usuário que as defina no próprio terminal (`export ...`) ou no `.env` — **não** peça para colar o `clientSecret` no chat.
- O mesmo token vale para todas as rotas. Reaproveite até `expira_em` (já vem com 60 s de margem) — não gere um token por chamada.
- Em `401` (sem corpo), gere um novo token e repita a chamada **uma** vez.
- **Nunca** exiba o `clientSecret` nem o token completo no terminal ou no chat.

#### Base URL

```
Staging:    https://api.staging.credicarro.com.br/integration
Produção:   https://api.credicarro.com.br/integration
```

Use sempre staging, a menos que o usuário peça produção explicitamente — no staging nenhuma proposta é real. Credenciais e webhooks de um ambiente não funcionam no outro: um token de staging retorna `401` em produção.

#### Formato de resposta e erros

Campos JSON em português: requisições em camelCase (`cnpjLoja`, `valorEntrada`), respostas em snake_case (`id_proposta`, `token_de_acesso`). Valores monetários são números em reais, com ponto decimal (`45000`, `6500.00`) — não são centavos.

Erros vêm com um código estável em `tipo`. Trate pelo `tipo`, nunca pelo texto de `detalhe`:
```json
{
  "tipo": "Validation.Cpf.Invalid",
  "titulo": "Requisição inválida",
  "status": 400,
  "detalhe": "O CPF informado em 'cpf' é inválido.",
  "campo": "cpf"
}
```

- `campo` aparece quando o erro é de um campo (ex.: `endereco.cep`). Erros de regra de negócio (`422`) vêm sem `campo`.
- `erros` (`[{codigo, mensagem, campo}]`) aparece só com JSON malformado ou valor de tipo errado (`Validation.InvalidFormat`).
- `401` vem sem corpo. Falhas inesperadas (`500`, alguns `502`) podem vir no Problem Details padrão (`type`, `title`, `status`, `detail`).
- `403` com `Integration.Access.Inactive` ou `Integration.Access.OrganizationNotFound` pode ocorrer em qualquer rota autenticada — não repita; fale com o time Credicarro.

Ao mostrar respostas no chat, mascare os CPFs (exige `jq` 1.6+):
```bash
OCULTA_CPF='walk(if type == "object" and (.cpf | type) == "string" then .cpf |= ("***" + .[3:9] + "**") else . end)'
```

Listas paginadas usam `pagina_inicial` (mínimo 1) e `limite` (1 a 100) e respondem `{"itens": [...], "pagina": {"numero", "tamanho", "total", "tem_proximo", "tem_anterior"}}`.

#### Idempotency-Key

As rotas de cliente, simulação e criação de proposta aceitam o header `Idempotency-Key` (1 a 200 caracteres). No envio de documento ele é **obrigatório**. Mesma chave + mesmo corpo devolve o resultado original; mesma chave + outro corpo retorna `409`.

```bash
CHAVE=$(uuidgen)   # gere antes e guarde: repita a MESMA operação com a mesma chave
-H "Idempotency-Key: $CHAVE"
```

Gere a chave uma vez por operação, numa variável, **antes** do comando — nunca `$(uuidgen)` dentro do `curl`, que gera uma chave nova a cada repetição. As rotas de webhook, dados do veículo e conta de recebimento não usam o header.

Quando repetir: só `408`, `429` (respeitando `Retry-After`), `500`, `502`, `503`, `504`, timeout ou falha de rede — nunca outros `4xx` — e só em operações seguras: `GET`, `POST` com a mesma `Idempotency-Key`, dados do veículo, conta de recebimento e `PUT`/`DELETE` de webhook. **Não repita** `POST /v1/webhook` (cadastraria outro webhook) nem `POST /v1/customer/unified` sem chave: liste os webhooks ou consulte o cadastro antes de tentar de novo.

---

#### Endpoints

O fluxo de uma proposta é: token → webhook (uma vez) → cliente → faixa (opcional) → simulação → proposta → etapas. Para integrações novas, use as rotas `/v2` (com `cnpjLoja`); a consulta e a listagem de simulações e a listagem de propostas continuam em `/v1`.

##### Clientes (Customer)

O cliente é identificado pelo **CPF** em todas as chamadas — não é preciso guardar o `id_cliente`.

**Criar ou atualizar cliente com dados completos (recomendado)**
```bash
curl -s -X POST "$CREDICARRO_BASE_URL/v1/customer/unified" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "cpf": "12345678909",
    "nome": "Maria",
    "sobrenome": "Souza",
    "email": "maria.souza@exemplo.com.br",
    "celular": "+55 (11) 99876-5432",
    "dataDeNascimento": "1990-05-20T00:00:00-03:00",
    "endereco": {
      "rua": "Av. Paulista",
      "numero": "1578",
      "complemento": "Bloco B, Apto 1203",
      "bairro": "Bela Vista",
      "cidade": "São Paulo",
      "estado": "SP",
      "cep": "01311000"
    },
    "dadosProfissionais": { "tipoOcupacao": 3, "renda": 6500.00 }
  }' | jq
```
Resposta `200`: `{"id_cliente": "..."}`.

| Chamada | CPF novo | CPF já cadastrado |
| --- | --- | --- |
| `unified` **sem** `Idempotency-Key` | Cria | Atualiza |
| `unified` **com** `Idempotency-Key` | Cria | `409` `Cpf.CpfAlreadyAdded` |
| `POST /v1/customer` | Cria | `409` `Cpf.CpfAlreadyAdded` |
| `address` / `professional` | `404` `Customer.Account.NotFound` | Cria ou atualiza |

Regras dos campos: `celular` **exatamente** no formato `+55 (DD) 99999-9999`; `dataDeNascimento` em ISO-8601, com o cliente entre 18 e 75 anos; `cep` com 8 dígitos (com ou sem hífen); `estado` com a sigla da UF; `nome`/`sobrenome` até 100 caracteres. E-mail e celular também precisam ser únicos na criação (`Email.EmailAlreadyAdded`, `Phone.PhoneAlreadyAdded`).

`tipoOcupacao`: `1` aposentado, `2` pensionista, `3` assalariado, `4` autônomo, `6` freelancer, `7` proprietário (não existe `5`). `renda` é a renda mensal em reais, maior que zero.

**Criar cliente só com dados pessoais**
```bash
curl -s -X POST "$CREDICARRO_BASE_URL/v1/customer" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "cpf": "12345678909", "nome": "Maria", "sobrenome": "Souza",
    "email": "maria.souza@exemplo.com.br", "celular": "+55 (11) 99876-5432",
    "dataDeNascimento": "1990-05-20T00:00:00-03:00"
  }' | jq
```

**Criar ou atualizar endereço** (resposta `202` sem corpo)
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$CREDICARRO_BASE_URL/v1/customer/address" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "cpf": "12345678909",
    "endereco": { "rua": "Av. Paulista", "numero": "1578", "bairro": "Bela Vista",
                  "cidade": "São Paulo", "estado": "SP", "cep": "01311000" }
  }'
```

**Criar ou atualizar ocupação e renda** (resposta `202` sem corpo)
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$CREDICARRO_BASE_URL/v1/customer/professional" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"cpf": "12345678909", "tipoOcupacao": 3, "renda": 6500.00}'
```

O que cada passo exige do cadastro: a simulação exige dados pessoais; no refinanciamento, o endereço é usado quando a placa não traz a UF; a **proposta** exige dados pessoais, endereço, ocupação e renda (senão `422` `Customer.Account.Incomplete`).

---

##### Simulações (Simulation)

A loja é informada por `cnpjLoja` (formatado ou só números). Ela precisa estar vinculada ao parceiro do token (`404` `Store.Integration.NotFound`) e não pode ter contrato de intermediação (`422` `Store.Integration.Intermediation`). O cliente precisa estar cadastrado antes (`404` `Customer.Account.NotFound`).

**Faixa financiável — entrada mínima por prazo (opcional)**
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "$CREDICARRO_BASE_URL/v2/proposal/simulation/range/financing?placa=ABC1D23&cnpjLoja=11222333000181" | jq
```
Resposta: `{"opcoes_por_prazo": [{"prazo": 36, "valor_minimo_entrada": 5000.00}, ...]}`.

**Faixa refinanciável — valor mínimo e máximo por prazo (opcional)**
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "$CREDICARRO_BASE_URL/v2/proposal/simulation/range/refinancing?placa=ABC1D23&cnpjLoja=11222333000181" | jq
```
Resposta: `{"opcoes_por_prazo": [{"prazo": 36, "valor_minimo_refinanciavel": 5000, "valor_maximo_refinanciavel": 35720}, ...]}`.

Sem prazos para o veículo, as duas faixas retornam `422` `Simulation.Terms.Unavailable`.

**Consultar retornos de comissão disponíveis (opcional, antes de simular)**
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "$CREDICARRO_BASE_URL/v2/proposal/simulation/commission-returns?cnpjLoja=11222333000181" | jq
```
Resposta: `{"retornos_comissao": [{"tipo": "Financing", "alvo": "Store", "retorno_minimo": 0, "retorno_maximo": 6, "permite_taxa_padrao": true}, ...]}` — um item por tipo (`Financing`/`Refinancing`) que a loja tiver configurado. Use um valor dentro de `retorno_minimo`..`retorno_maximo` em `retornoComissao` ao simular. Se a loja não tiver nenhum item de um tipo, não envie `retornoComissao` nesse tipo (ver abaixo).

**Simular financiamento**
```bash
CHAVE=$(uuidgen)   # guarde para repetir esta mesma simulação
curl -s -X POST "$CREDICARRO_BASE_URL/v2/proposal/simulation/financing" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $CHAVE" \
  -d '{
    "cpf": "12345678909",
    "placa": "ABC1D23",
    "valorVeiculo": 45000,
    "valorEntrada": 5000,
    "uf": "SP",
    "isVeiculoZeroKm": false,
    "retornoComissao": 2,
    "cnpjLoja": "11.222.333/0001-81"
  }' | jq
```
`valorEntrada` pode ser `0`, mas tem de ser menor que `valorVeiculo` e deixar ao menos 10% do veículo para financiar (`422` `Proposal.RequestAmountInvalid`). Se nenhum prazo aceita a entrada: `422` `Proposal.DownPaymentInvalid`. `uf` é a UF de registro do veículo, com 2 letras. `retornoComissao` é **opcional**: omita para usar a taxa padrão (quando a loja permitir, ver `permite_taxa_padrao` acima); fora da faixa configurada ou loja sem faixa para `Financing`: `422` `Store.CommissionReturn.OutOfRange` / `Store.CommissionReturn.NotConfigured`. Só existe na rota `/v2` (não envie em `/v1`).

**Simular refinanciamento**
```bash
CHAVE=$(uuidgen)   # guarde para repetir esta mesma simulação
curl -s -X POST "$CREDICARRO_BASE_URL/v2/proposal/simulation/refinancing" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $CHAVE" \
  -d '{
    "cpf": "12345678909",
    "placa": "ABC1D23",
    "valorSolicitado": 25000,
    "retornoComissao": 2,
    "cnpjLoja": "11.222.333/0001-81"
  }' | jq
```
`valorSolicitado` tem de caber na faixa refinanciável de algum prazo (`422` `Simulation.Refinancing.AmountOutOfRange` ou `Proposal.RequestAmountInvalid`). Sem UF da placa nem do endereço do cliente: `422` `Simulation.Refinancing.UfUnavailable`. `retornoComissao` segue a mesma regra do financiamento, para o tipo `Refinancing`.

As duas simulações respondem `201` com **uma opção por prazo elegível**:
```json
{
  "simulacoes": [
    {
      "id_simulacao": "123e4567-e89b-12d3-a456-426614174000",
      "valor_solicitado": 40000, "prazo": 36, "valor_parcela": 2042.42,
      "valor_tac": 1500, "valor_boleto": 3.5, "valor_seguro": 0,
      "valor_iof": 872, "percentual_iof": 1.92,
      "valor_credito_total": 42722, "valor_divida_total": 73527.12,
      "percentual_cet_mensal": 3.75, "percentual_cet_anual": 55.52,
      "percentual_juros_mensal": 3.29, "percentual_juros_anual": 47.47
    }
  ]
}
```
Mostre as opções ao usuário (prazo, parcela e **CET**) e use o `id_simulacao` escolhido para criar a proposta. `valor_retencao_diaria_aproximado` só aparece quando se aplica.

**Consultar simulação**
```bash
curl -s -H "Authorization: Bearer $TOKEN" "$CREDICARRO_BASE_URL/v1/proposal/simulation/SIMULACAO_ID" | jq "$OCULTA_CPF"
```

**Listar simulações (paginado)**
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "$CREDICARRO_BASE_URL/v1/proposal/simulation?pagina_inicial=1&limite=10" | jq "$OCULTA_CPF"
```

---

##### Propostas (Proposal)

**Criar proposta**
```bash
CHAVE=$(uuidgen)   # guarde para repetir esta mesma criação
curl -s -X POST "$CREDICARRO_BASE_URL/v2/proposal" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $CHAVE" \
  -d '{"cpf": "12345678909", "simulacaoId": "SIMULACAO_ID"}' | jq
```
Resposta `201`: `{"id_proposta": "..."}`. Erros comuns (`422`): `Customer.Account.Incomplete` (complete endereço, ocupação e renda), `Proposal.SimulationAlreadyActivated` (o `id_simulacao` já virou proposta), `Proposal.SimulationAlreadyExpired` (simule de novo), `Simulation.Access.NotFromStore` (simulação feita sem `cnpjLoja`), `Proposal.BuyerAgeNotAllowed`.

**Consultar proposta (retrato atual com etapas e documentos)**
```bash
curl -s -H "Authorization: Bearer $TOKEN" "$CREDICARRO_BASE_URL/v2/proposal/PROPOSTA_ID" | jq "$OCULTA_CPF"
```
Traz `enum_status`/`status`, `tipo` (`Financing`/`Refinancing`), `motivo_recusa`, `link_biometria` e, para `comprador`, `loja` e `vendedor` (quando houver): `status_ativo`, `etapas_concluidas` e `documentos`. Uma proposta criada por `/v1/proposal` retorna `422` `Proposal.Access.NotIntegrationV2` nesta rota.

Para saber **o que fazer agora**, leia o `status_ativo` de cada participante e siga [Etapas e status da proposta](#regras-etapas-e-status-da-proposta):

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$CREDICARRO_BASE_URL/v2/proposal/PROPOSTA_ID" \
  | jq '{status, comprador: .comprador.status_ativo, loja: .loja.status_ativo}'
```

**Listar propostas (paginado)**
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "$CREDICARRO_BASE_URL/v1/proposal?pagina_inicial=1&limite=10" | jq "$OCULTA_CPF"
```
A listagem usa os nomes de status em inglês (`Analysing`, `Approved`, `Refused`...). Para etapas e documentos, consulte cada proposta em `/v2/proposal/{id}`.

**Enviar documento** (etapa `ENVIO_DOCUMENTOS` ou `CORRECAO_DOCUMENTOS`; `Idempotency-Key` obrigatória; resposta `204`)

Monte o corpo num arquivo temporário privado — um Base64 grande não cabe como argumento de linha de comando, e o arquivo tem dados pessoais:
```bash
CHAVE_DOC=$(uuidgen)   # guarde: reutilize só se precisar repetir ESTE envio

(  # subshell: umask e trap não alteram a sessão do usuário
  umask 077
  DOC_JSON=$(mktemp) && trap 'rm -f "$DOC_JSON"' EXIT

  jq -n --arg participante COMPRADOR --argjson tipo 1 --arg nome "cnh-comprador.pdf" \
    --rawfile conteudo <(base64 -w0 cnh-comprador.pdf) \
    '{participante: $participante, tipoDocumento: $tipo, nomeArquivo: $nome, conteudoBase64: $conteudo}' > "$DOC_JSON"

  curl -s -o /dev/null -w '%{http_code}\n' -X POST "$CREDICARRO_BASE_URL/v2/proposal/PROPOSTA_ID/document" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -H "Idempotency-Key: $CHAVE_DOC" \
    --data-binary @"$DOC_JSON"
)
```
- No macOS, troque `base64 -w0 arquivo` por `base64 -i arquivo`. `--rawfile` exige `jq` 1.6+.
- `participante`: `COMPRADOR`, `VENDEDOR` ou `LOJA`. `tipoDocumento` por participante: comprador `1, 4, 5, 6, 7, 9, 57`; vendedor `1, 2, 3, 5, 6, 7, 8, 9, 11`; loja `6, 8`. Veja a tabela de [tipos de documento](#regras-etapas-e-status-da-proposta).
- Arquivo PDF, JPG/JPEG ou PNG, até 10 MiB decodificado; `nomeArquivo` sem caminho, até 255 caracteres, com extensão que corresponda ao conteúdo real; Base64 puro, sem prefixo `data:` e sem quebras de linha.
- Um arquivo por chamada. Reenviar o mesmo tipo e participante substitui o anterior.
- Uma chave por envio, nunca derivada só de proposta + participante + tipo: mesma chave e mesmo corpo em até 24 h não reprocessam (`204` sem efeito), e mesma chave com outro arquivo retorna `409` `Idempotency.KeyConflict`. Em `502` `Document.UploadFailed`, repita com a **mesma** chave. Na correção, gere uma chave **nova**.

**Incluir dados do veículo** (etapa `DADOS_VEICULO`: da loja no financiamento, do comprador no refinanciamento; resposta `204`)
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$CREDICARRO_BASE_URL/v2/proposal/PROPOSTA_ID/vehicle-detail" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"renavam": "12345678900", "chassi": "9BWZZZ377VT004251", "placa": "ABC1D23", "cor": "PRATA"}'
```
`renavam` até 11 dígitos com dígito verificador válido; `chassi` com 17 caracteres, sem I, O e Q; `cor` sem números, até 30 caracteres. Fora da etapa: `422` `Proposal.InvalidStatus`.

**Incluir conta de recebimento** (só refinanciamento, etapa `CONTA_RECEBIMENTO` do comprador; resposta `204`)
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$CREDICARRO_BASE_URL/v2/proposal/PROPOSTA_ID/deposit-account" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "cpfTitular": "12345678909",
    "codigoBanco": "001",
    "agencia": "1234",
    "digitoAgencia": "5",
    "conta": "123456",
    "digitoConta": "7",
    "tipoConta": "CORRENTE"
  }'
```
`cpfTitular` tem de ser o CPF do cliente da proposta (`Proposal.DepositAccount.HolderNotBuyer`). `codigoBanco` com 3 dígitos, `agencia` até 4, `conta` de 4 a 13, dígitos `0`–`9` ou `X`. `tipoConta`: `CORRENTE`, `POUPANCA` ou `PAGAMENTO`. Reenviar substitui a conta enquanto a etapa estiver ativa.

---

##### Webhooks

Só o tipo **Proposal** (`3`) envia notificações hoje; `1` (Customer) e `2` (Simulation) podem ser cadastrados, mas não enviam nada. Mais de um webhook por tipo é permitido.

**Cadastrar webhook**
```bash
: "${CREDICARRO_WEBHOOK_CREDENTIAL:?exporte CREDICARRO_WEBHOOK_CREDENTIAL}"

(  # subshell: o umask não altera a sessão do usuário
  umask 077
  RESPOSTA_WEBHOOK=$(mktemp "${TMPDIR:-/tmp}/credicarro-webhook.XXXXXX")   # fora do repositório
  jq -n --arg url "https://parceiro.com.br/webhooks/credicarro" \
      '{tipo: 3, url: $url, tipo_autenticacao: 3, credencial: env.CREDICARRO_WEBHOOK_CREDENTIAL}' \
    | curl -s -X POST "$CREDICARRO_BASE_URL/v1/webhook" \
        -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data-binary @- \
    > "$RESPOSTA_WEBHOOK"

  jq '{id_webhook}' "$RESPOSTA_WEBHOOK"; echo "Resposta completa em: $RESPOSTA_WEBHOOK"
)
```
Resposta `201`: `{"id_webhook": "...", "segredo_assinatura": "..."}`. O `segredo_assinatura` aparece **só nesta resposta**. Grave a resposta num arquivo privado fora do repositório (como acima), mostre só o `id_webhook` e o caminho do arquivo, e peça ao usuário para mover o segredo para o cofre e apagar o arquivo. Não exiba o segredo no terminal nem no chat. `CREDICARRO_WEBHOOK_CREDENTIAL` (exportada) é a credencial que o endpoint do parceiro espera: o token, no tipo `3`; o Base64 de `usuario:senha`, no tipo `2`. O endpoint confere o header recebido contra `CREDICARRO_WEBHOOK_AUTHORIZATION` (`Bearer <credencial>` ou `Basic <credencial>`).

- `tipo_autenticacao`: `1` nenhuma (não recomendado), `2` Basic (`credencial` = Base64 de `usuario:senha`), `3` JWT (`credencial` = token enviado como `Bearer`). Tipo e credencial **não podem ser alterados**; para trocar, exclua e cadastre outro.
- `url`: HTTPS pública, até 2048 caracteres, sem localhost, IP privado, usuário/senha ou `#fragmento` (`422` `Organization.Webhook.InvalidEndpoint`).

**Listar webhooks (paginado)**
```bash
curl -s -H "Authorization: Bearer $TOKEN" "$CREDICARRO_BASE_URL/v1/webhook?pagina_inicial=1&limite=10" | jq
```
Na listagem, `tipo`, `tipo_autenticacao` e `status` vêm como texto (`Proposal`, `Basic`, `Active`). A credencial e o segredo não são retornados.

**Editar webhook** (tipo, URL e status; resposta `204`)
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X PUT "$CREDICARRO_BASE_URL/v1/webhook/WEBHOOK_ID" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"tipo": 3, "url": "https://parceiro.com.br/webhooks/credicarro", "status": 2}'
```
`status`: `1` ativo, `2` inativo (pausa sem perder o cadastro). Omitido, mantém o atual. `409` `Organization.Webhook.ConcurrencyConflict`: tente de novo.

**Excluir webhook** (resposta `204`)
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE "$CREDICARRO_BASE_URL/v1/webhook/WEBHOOK_ID" \
  -H "Authorization: Bearer $TOKEN"
```

Cada notificação é um `POST` JSON assinado com `X-CrediCarro-Signature: t={unix},v1={hex}` (HMAC-SHA256 de `"{t}.{corpo bruto}"` com o `segredo_assinatura`). Para conferir uma assinatura recebida:

```bash
printf '%s' "$T.$CORPO_BRUTO" | openssl dgst -sha256 -hmac "$CREDICARRO_WEBHOOK_SECRET" | awk '{print $NF}'
```

Use isso só para depurar no staging (o segredo passa pela linha de comando do `openssl`). Em produção, a verificação fica no código do endpoint — veja `rules/<linguagem>/webhooks.md`.

O payload, o header `Idempotency-Key` das entregas e as retentativas estão em [Etapas e status da proposta](#regras-etapas-e-status-da-proposta).

---

##### Rotas `/v1` de simulação e proposta

Integrações anteriores ao fluxo `/v2` usam `GET /v1/proposal/simulation/range/financing|refinancing?placa=...`, `POST /v1/proposal/simulation/financing|refinancing` e `POST /v1/proposal` — iguais às rotas `/v2`, mas **sem** `cnpjLoja` (usam a loja de integração vinculada ao parceiro). `GET /v1/proposal/{propostaId}` traz `status` em inglês (`Analysing`, `Approved`...), sem etapas nem documentos, e o webhook dessas propostas envia só `{"id_proposta", "enum_status", "status"}`. Não misture: uma proposta `/v1` não aceita as rotas `/v2/proposal/{id}/...`.

---

#### Diretrizes do Agent Mode

1. Confirme com o usuário antes de criar, atualizar ou excluir recursos (cliente, simulação, proposta, documento, webhook) — cada chamada tem efeito real. Em produção, confirme também o ambiente.
2. Prefira staging para qualquer teste ou exploração.
3. Formate valores monetários como `R$ X.XXX,XX` e mostre o CET ao apresentar simulações.
4. Use `jq` para formatar e filtrar respostas JSON.
5. Em erro, mostre `tipo`, `detalhe` e `campo` e sugira a correção pelo `tipo` (ex.: `Customer.Account.Incomplete` → completar o cadastro em `/v1/customer/unified`).
6. Nunca invente `id_simulacao`, `id_proposta`, `id_webhook` ou `cnpjLoja` — obtenha-os de respostas anteriores ou pergunte ao usuário.
7. Não exiba CPF completo, token, `clientSecret`, `segredo_assinatura` nem conteúdo de documentos além do necessário.

---

## Regras: Etapas e status da proposta


Use estas regras ao consultar uma proposta (`GET /v2/proposal/{propostaId}`), ao processar o webhook de proposta e ao decidir o que o seu sistema precisa enviar. Elas valem para qualquer linguagem.

Todo valor vem em par: o número (`enum_...`) e o nome. **Compare pelo número** no código e use o nome em telas e logs. Novos valores podem surgir: guarde o número e o nome brutos e trate um valor desconhecido sem quebrar (sem `switch` exaustivo que lança exceção).

#### Status da proposta (`enum_status` / `status`)

| Código | Nome (`/v2`) | Nome (`/v1`) | Significado |
| --- | --- | --- | --- |
| 1 | `EM_ANALISE` | `Analysing` | Em análise automática. |
| 2 | `APROVADA` | `Approved` | Aprovada; segue para a formalização. |
| 3 | `RECUSADA` | `Refused` | Recusada. O motivo vem em `motivo_recusa`, quando houver. |
| 4 | `CANCELADA` | `Canceled` | Cancelada. |
| 5 | `ANALISE_MANUAL` | `ManualAnalysis` | Aguardando análise manual da Credicarro. |
| 6 | `FINALIZADA` | `Completed` | Concluída. |
| 7 | `EM_NEGOCIACAO` | `InNegotiation` | Em negociação. |
| 8 | `EXPIRADA` | `Expired` | Expirou (um mês depois de criada, se não concluída). Não continua: simule e crie outra proposta. |
| 9 | `PENDENTE` | `Pending` | Pendente. |

A consulta `/v2` e o webhook de propostas `/v2` usam os nomes em português. A listagem `GET /v1/proposal`, a consulta `GET /v1/proposal/{id}` e o webhook de propostas `/v1` usam os nomes em inglês. O número é o mesmo.

#### Etapas (`enum_etapa` / `etapa`)

Cada participante — `comprador`, `loja` e, quando houver, `vendedor` — tem a sua etapa ativa em `status_ativo` e o histórico em `etapas_concluidas` (sem a etapa ativa, cada etapa uma vez, com a data mais recente).

| Código | Nome | O que acontece |
| --- | --- | --- |
| 0 | `INDEFINIDO` | Etapa ainda não definida. |
| 1 | `PROPOSTA_CRIADA` | Proposta enviada para análise. |
| 2 | `PROPOSTA_APROVADA` | Proposta aprovada. |
| 3 | `NOTIFICACAO_VENDEDOR` | Notificação interna. Não exige ação do integrador. |
| 4 | `ANALISE_BIOMETRIA` | Biometria do participante. |
| 5 | `CONTA_RECEBIMENTO` | Aguardando a conta de recebimento (refinanciamento). |
| 6 | `ENVIO_DOCUMENTOS` | Aguardando o envio de documentos. |
| 7 | `CORRECAO_DOCUMENTOS` | Documento recusado; precisa ser reenviado. |
| 8 | `DADOS_VEICULO` | Aguardando os dados do veículo. |
| 9 | `VISTORIA` | Vistoria do veículo pelo cliente. |
| 10 | `ASSINATURA` | Assinatura do contrato pelo cliente. |
| 11 | `PAGAMENTO` | Pagamento em andamento. |
| 12 | `PROPOSTA_FINALIZADA` | Fluxo concluído. |

#### Situação (`enum_situacao` / `situacao`) e responsável (`enum_responsavel_acao` / `responsavel_acao`)

| Código | Situação | Significado |
| --- | --- | --- |
| 1 | `AGUARDANDO_ENVIO` | Aguardando dados ou arquivos do integrador. |
| 2 | `AGUARDANDO_CLIENTE` | Aguardando o cliente (biometria, vistoria ou assinatura). |
| 3 | `EM_PROCESSAMENTO` | A Credicarro está processando. |
| 4 | `PENDENTE_CORRECAO` | Documento recusado aguardando reenvio. |
| 5 | `BLOQUEADA` | Etapa bloqueada (ex.: biometria reprovada). |
| 6 | `CONCLUIDA` | Proposta finalizada. |
| 7 | `CANCELADA` | Proposta recusada, cancelada ou expirada. |

| Código | Responsável | Significado |
| --- | --- | --- |
| 0 | `NENHUM` | Ninguém precisa agir (proposta encerrada). |
| 1 | `CLIENTE` | O cliente precisa agir. |
| 2 | `INTEGRADOR` | **Seu sistema** precisa enviar algo pela API. |
| 3 | `CREDICARRO` | A Credicarro está cuidando da etapa. |

#### O que fazer em cada etapa

Para **cada** participante, leia `status_ativo` e decida:

| `enum_responsavel_acao` | `enum_etapa` | Ação |
| --- | --- | --- |
| `2` INTEGRADOR | `6` ENVIO_DOCUMENTOS | `POST /v2/proposal/{id}/document` para cada documento com status `PENDENTE` (5) daquele participante. |
| `2` INTEGRADOR | `7` CORRECAO_DOCUMENTOS | `POST /v2/proposal/{id}/document` só para os tipos com status `INVALIDO` (2), com uma `Idempotency-Key` **nova**. Mostre o `motivo`. |
| `2` INTEGRADOR | `8` DADOS_VEICULO | `POST /v2/proposal/{id}/vehicle-detail` — da **loja** no financiamento, do **comprador** no refinanciamento. |
| `2` INTEGRADOR | `5` CONTA_RECEBIMENTO | `POST /v2/proposal/{id}/deposit-account` — comprador, só refinanciamento. |
| `1` CLIENTE | qualquer | Oriente o cliente. Na `ANALISE_BIOMETRIA`, ele usa o link que a Credicarro envia por WhatsApp e e-mail (ou o `link_biometria`, se a sua integração conduz o contato). |
| `3` CREDICARRO | qualquer | Aguarde. |
| `0` NENHUM | qualquer | Nada a fazer — a proposta foi encerrada. |

Como a situação é definida: com a proposta recusada, cancelada ou expirada, `CANCELADA` + `NENHUM`; finalizada, `CONCLUIDA` + `NENHUM`. Nos demais casos:

| Etapa | Situação | Responsável |
| --- | --- | --- |
| `CONTA_RECEBIMENTO`, `ENVIO_DOCUMENTOS`, `DADOS_VEICULO` | `AGUARDANDO_ENVIO` | `INTEGRADOR` |
| `CORRECAO_DOCUMENTOS` | `PENDENTE_CORRECAO` | `INTEGRADOR` |
| `VISTORIA`, `ASSINATURA` | `AGUARDANDO_CLIENTE` | `CLIENTE` |
| `ANALISE_BIOMETRIA` com sessão criada | `AGUARDANDO_CLIENTE` | `CLIENTE` |
| `ANALISE_BIOMETRIA` com biometria reprovada | `BLOQUEADA` | `CREDICARRO` |
| `ANALISE_BIOMETRIA` nos demais casos, e as demais etapas | `EM_PROCESSAMENTO` | `CREDICARRO` |
| `PROPOSTA_FINALIZADA` | `CONCLUIDA` | `NENHUM` |

Na loja, a situação da `ANALISE_BIOMETRIA` acompanha a biometria do comprador.

#### Biometria (`enum_biometria` / `biometria`)

| Código | Nome | Significado |
| --- | --- | --- |
| 0 | `NAO_INICIADA` | Não iniciada. |
| 1 | `SESSAO_CRIADA` | Sessão criada; o cliente precisa acessar o link (o mesmo de `link_biometria`). |
| 2 | `EM_ANALISE` | Em análise. |
| 3 | `APROVADA` | Aprovada. |
| 4 | `REPROVADA` | Reprovada — a etapa fica bloqueada; fale com o time Credicarro. |

#### Documentos

Status do documento (`enum_status` / `status` dentro de `documentos`); `motivo` só aparece quando houver:

| Código | Nome | Significado |
| --- | --- | --- |
| 0 | `RECEBIDO` | Recebido. |
| 1 | `VALIDO` | Aprovado. |
| 2 | `INVALIDO` | Recusado. Mostre o `motivo` e reenvie o mesmo tipo. |
| 3 | `EM_ANALISE` | Em análise. |
| 4 | `EXCLUIDO` | Excluído. |
| 5 | `PENDENTE` | Exigido e ainda não enviado. Só aparece na consulta, para comprador e loja. |

Na consulta, comprador e loja listam **só os documentos exigidos**, cada um uma vez — enviado (com o status real) ou `PENDENTE`:

| Participante | Modalidade | Documentos exigidos, nesta ordem |
| --- | --- | --- |
| Comprador | Financiamento | `COMPROVANTE_RESIDENCIA`, `COMPROVANTE_RENDA`, `ATPV` (só veículo registrado no RS), `CNH` |
| Comprador | Refinanciamento | `COMPROVANTE_RESIDENCIA`, `DOCUMENTO_VEICULO`, `COMPROVANTE_RENDA`, `CNH` |
| Loja | Financiamento | `LAUDO_ECV`, `DOCUMENTO_VEICULO` |
| Loja | Refinanciamento | Nenhum (lista vazia) |

A `CNH` aceita `CNH` ou `CNH_DIGITAL`: se só a digital foi enviada, ela aparece no lugar da `CNH` pendente. Documentos enviados fora da tabela (ex.: `LAUDO_VISTORIA`) não aparecem para comprador e loja. O vendedor lista todos os documentos enviados, sem `PENDENTE`.

##### Tipos de documento

| Código | Nome | Comprador | Vendedor | Loja |
| --- | --- | :---: | :---: | :---: |
| 1 | `CNH` | ✓ | ✓ | |
| 2 | `CPF` | | ✓ | |
| 3 | `RG` | | ✓ | |
| 4 | `COMPROVANTE_RENDA` | ✓ | | |
| 5 | `COMPROVANTE_RESIDENCIA` | ✓ | ✓ | |
| 6 | `DOCUMENTO_VEICULO` | ✓ | ✓ | ✓ |
| 7 | `CNH_DIGITAL` | ✓ | ✓ | |
| 8 | `LAUDO_ECV` | | ✓ | ✓ |
| 9 | `LAUDO_VISTORIA` | ✓ | ✓ | |
| 11 | `CARTAO_CNPJ` | | ✓ | |
| 57 | `ATPV` | ✓ | | |

O webhook e a lista do vendedor podem trazer outros tipos anexados pela Credicarro, no mesmo par código e nome — não rejeite um tipo desconhecido.

Regras do envio: um arquivo por chamada; PDF, JPG/JPEG ou PNG; até 10 MiB decodificado; `nomeArquivo` sem caminho, até 255 caracteres, extensão igual ao conteúdo real (`422` `Document.InvalidContent`); Base64 puro, sem `data:` e sem quebras de linha; `Idempotency-Key` obrigatória. Fora das etapas 6/7: `422` `Document.InvalidProposalStage`. Na correção, um tipo que não está `INVALIDO`: `422` `Document.NotPendingCorrection`. Reenviar o mesmo tipo e participante substitui o anterior.

#### Webhook de proposta

Cada webhook ativo do tipo Proposal (`tipo` = 3) recebe o retrato da proposta sempre que muda o status, uma etapa ou um documento (propostas criadas por `POST /v2/proposal`):

```json
{
  "id_proposta": "bea8d060-f93d-48eb-b6c4-45f64483cdd9",
  "enum_status": 2,
  "status": "APROVADA",
  "motivo_evento": "DOCUMENTOS_ALTERADOS",
  "motivo_recusa": null,
  "data_evento": "2026-10-12T17:20:31.512+00:00",
  "comprador": {
    "cpf": "12345678909",
    "enum_biometria": 3,
    "biometria": "APROVADA",
    "status_ativo": {
      "enum_etapa": 7, "etapa": "CORRECAO_DOCUMENTOS",
      "enum_situacao": 4, "situacao": "PENDENTE_CORRECAO",
      "enum_responsavel_acao": 2, "responsavel_acao": "INTEGRADOR"
    },
    "etapas_concluidas": [
      { "enum_etapa": 1, "etapa": "PROPOSTA_CRIADA", "data": "2026-10-12T14:05:08-03:00" }
    ],
    "documentos": [
      { "enum_tipo": 1, "tipo": "CNH", "enum_status": 2, "status": "INVALIDO", "motivo": "Documento ilegível" }
    ]
  },
  "loja": {
    "cnpj": "11222333000181",
    "status_ativo": {
      "enum_etapa": 6, "etapa": "ENVIO_DOCUMENTOS",
      "enum_situacao": 1, "situacao": "AGUARDANDO_ENVIO",
      "enum_responsavel_acao": 2, "responsavel_acao": "INTEGRADOR"
    },
    "etapas_concluidas": [],
    "documentos": []
  },
  "vendedor": null
}
```

- `motivo_evento`: `STATUS_ALTERADO`, `ETAPAS_ALTERADAS` ou `DOCUMENTOS_ALTERADOS`.
- `data_evento`: momento em que o retrato foi montado (UTC). Muda a cada retentativa — não use para deduplicar.
- `loja` pode ser `null`; `vendedor` é reservado e hoje sempre `null`.
- No webhook, `documentos` não traz `PENDENTE` — para saber o que falta, consulte a proposta.
- Propostas criadas por `POST /v1/proposal` recebem só `{"id_proposta", "enum_status", "status"}`, com `status` em inglês.

##### Entrega

| Header | Conteúdo |
| --- | --- |
| `Authorization` | `Basic {credencial}` ou `Bearer {credencial}`, conforme o `tipo_autenticacao` (ausente quando `1`). |
| `X-CrediCarro-Signature` | `t={timestamp Unix em segundos},v1={HMAC-SHA256 em hex minúsculo}`. |
| `Idempotency-Key` | `{id_mensagem}:{id_webhook}` — igual em todas as retentativas da mesma notificação. |

Validação da assinatura: concatene `t`, um ponto e o **corpo bruto** (sem reformatar o JSON); calcule o HMAC-SHA256 com o `segredo_assinatura` como chave (o texto do segredo em UTF-8 — não decodifique); compare com `v1` em **tempo constante**; recuse `t` antigo (sugestão: 5 minutos). Cada retentativa é assinada de novo, com novo `t`.

Vetor de teste — sua implementação precisa chegar ao mesmo `v1`:

| Item | Valor |
| --- | --- |
| `segredo_assinatura` | `segredo-de-exemplo` |
| `t` | `1715792400` |
| Corpo bruto | `{"id_proposta":"bea8d060-f93d-48eb-b6c4-45f64483cdd9","enum_status":2,"status":"Approved"}` |
| `v1` esperado | `db66c554eb116ef2577deb63f72619793502a31520f622b2d59864b074eb8df2` |

Como o endpoint deve responder:

1. Leia o corpo bruto antes de qualquer desserialização, com um limite de tamanho. Os exemplos usam 1 MiB — escolha deles, não da API: o payload real tem poucos KB, mas um `413` não é retentado pela Credicarro, então não use um limite apertado.
2. Com autenticação Basic ou JWT, confira o header `Authorization` em tempo constante. Diferente → `401`.
3. Assinatura inválida, `t` fora do formato (só dígitos) ou antigo → `401`. Nunca valide com segredo vazio: sem `segredo_assinatura` configurado, o endpoint não deve subir.
4. Deduplique pelo header `Idempotency-Key`, enfileire o evento e só então responda `2xx` (limite de 15 s por entrega). Se não conseguir enfileirar, desfaça a marcação da chave e responda `503` para a Credicarro tentar de novo.
5. Processe de forma assíncrona, numa fila durável em produção; falha num evento não pode derrubar o processamento dos demais. As notificações podem chegar **fora de ordem**: para o estado mais recente, consulte a proposta.

Retentativas: `408`, `425`, `429`, `5xx`, falha de rede e timeout geram até 3 novas tentativas (cerca de 1 s, 5 s e 30 s). Os demais `4xx`, `3xx` e respostas acima de 1 MiB são falha definitiva, sem retentativa. A Credicarro não reenvia um retrato idêntico ao último entregue com sucesso para o mesmo webhook. Depois das retentativas, reconcilie consultando a proposta.
