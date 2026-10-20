# Contribuindo

Obrigado por contribuir com as Credicarro Skills! Este repositório é só conteúdo (Markdown + snippets de código de referência) — não há build nem testes automatizados de execução.

## Estrutura

- `rules/<linguagem>/<modulo>.md` — regra de integração por linguagem e módulo (`client`, `customers`, `simulations`, `proposals`, `webhooks`, `security`).
- `rules/proposal-steps.md` — regra de negócio compartilhada: status, etapas, documentos e webhook de proposta.
- `rules/agent.md` — uso direto da API via `curl`, independente de linguagem.
- `examples/<linguagem>/<modulo>.<ext>` — snippet de referência (não é um projeto completo).
- `tools/`, `utils/` — documentação de apoio (autenticação, ambientes, linguagens, FAQ, glossário).

## Fonte da verdade

A [documentação oficial](https://documentacao.credicarro.com.br) e o seu [`openapi.yaml`](https://documentacao.credicarro.com.br/openapi.yaml) prevalecem. Antes de escrever ou atualizar uma regra:

1. Confira rota, campos JSON, enums e códigos de erro (`tipo`) na documentação oficial. Não invente valores.
2. Verifique a API pública real do SDK correspondente (veja [`tools/ecosystem.md`](tools/ecosystem.md)) antes de escrever ou atualizar um exemplo — nomes de classe e método podem mudar entre versões. Compile os exemplos contra o SDK.
3. Siga o padrão de seção dos arquivos existentes: `## Modelos`, `## Operações`, `## Exemplo` (com a fonte em `examples/`) e `## Erros e casos de borda`.
4. Se mudar uma regra de negócio, atualize as 6 linguagens, o [`rules/agent.md`](rules/agent.md) e o [`rules/proposal-steps.md`](rules/proposal-steps.md).
5. Atualize o índice em [`SKILL.md`](SKILL.md) se adicionar um arquivo novo.
6. Regenere os arquivos únicos ([`SKILL-CONSOLIDATED.md`](SKILL-CONSOLIDATED.md) e [`SKILL-AGENT.md`](SKILL-AGENT.md)):

   ```bash
   node scripts/build-consolidated.mjs
   ```

## Pull Requests

Este repositório é público — qualquer pessoa pode abrir um PR. Todo merge exige aprovação de alguém dos times Admin ou Backend da Twila Digital (`CODEOWNERS`), e `production` é protegida (sem push direto, mesmo por admins).

## Dúvidas

Abra uma issue neste repositório, ou veja [tools/ecosystem.md](tools/ecosystem.md) para os canais oficiais.
