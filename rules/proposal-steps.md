# Etapas e status da proposta

Use estas regras ao consultar uma proposta (`GET /v2/proposal/{propostaId}`), ao processar o webhook de proposta e ao decidir o que o seu sistema precisa enviar. Elas valem para qualquer linguagem.

Todo valor vem em par: o número (`enum_...`) e o nome. **Compare pelo número** no código e use o nome em telas e logs. Novos valores podem surgir: guarde o número e o nome brutos e trate um valor desconhecido sem quebrar (sem `switch` exaustivo que lança exceção).

## Status da proposta (`enum_status` / `status`)

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

## Etapas (`enum_etapa` / `etapa`)

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

## Situação (`enum_situacao` / `situacao`) e responsável (`enum_responsavel_acao` / `responsavel_acao`)

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

## O que fazer em cada etapa

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

## Biometria (`enum_biometria` / `biometria`)

| Código | Nome | Significado |
| --- | --- | --- |
| 0 | `NAO_INICIADA` | Não iniciada. |
| 1 | `SESSAO_CRIADA` | Sessão criada; o cliente precisa acessar o link (o mesmo de `link_biometria`). |
| 2 | `EM_ANALISE` | Em análise. |
| 3 | `APROVADA` | Aprovada. |
| 4 | `REPROVADA` | Reprovada — a etapa fica bloqueada; fale com o time Credicarro. |

## Documentos

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

### Tipos de documento

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

## Webhook de proposta

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

### Entrega

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
