<div align="center">

# Credicarro Skills

Conjunto de conhecimentos, regras e ferramentas especializadas para potencializar a integração com o **Credicarro** através de **IAs** e automações.

## O que são SKILLS?

Skills são pacotes de contexto especializado que ensinam **agentes de IA** (como **Cursor**, **Claude Code** e similares) e desenvolvedores sobre as melhores práticas, regras de negócio e padrões técnicos da API de financiamento e refinanciamento de veículos do Credicarro. Funcionam como um "manual de instruções inteligente".

## Para que servem?

</div>

- **Contexto preciso:** a API de integração do Credicarro — token, cliente, simulação, proposta, etapas, documentos e webhooks — alinhada à documentação oficial.
- **6 SDKs oficiais:** regras e exemplos para os SDKs .NET, Java, Node.js, Python, PHP e Go, com a superfície real de cada um.
- **Padronização:** garante que o código gerado siga as convenções de cada SDK — token em cache, `Idempotency-Key`, retentativa segura e verificação HMAC de webhooks.
- **Exemplos práticos:** implementações de referência nas 6 linguagens.
- **Agent Mode:** permite que a IA opere a API diretamente via `curl`, sem escrever código.

<div align="center">

## Como instalar

As skills são consumidas principalmente por **IDEs** e **agentes de IA** que leem contexto local.

</div>

1. **Clonagem:** clone este repositório na sua máquina.
2. **Contexto da IA:** adicione a pasta deste repositório ao contexto do seu editor (ex.: `.cursorrules`, skills do Claude Code).
3. **Skill única:** se a sua ferramenta só aceita um arquivo, use [`SKILL-CONSOLIDATED.md`](SKILL-CONSOLIDATED.md) (tudo concatenado) ou [`SKILL-AGENT.md`](SKILL-AGENT.md) (só o modo de API direta).

<div align="center">

## Como usar

A estrutura é dividida para facilitar a descoberta.

</div>

- **[`rules/`](rules):** regras de integração por linguagem (.NET/Java/Node/Python/PHP/Go) e por módulo (Client, Customers, Simulations, Proposals, Webhooks, Security), mais [`rules/proposal-steps.md`](rules/proposal-steps.md) (etapas e status da proposta) e [`rules/agent.md`](rules/agent.md) (uso direto da API).
- **[`examples/`](examples):** implementações de referência por linguagem.
- **[`tools/`](tools):** autenticação, ambientes, produção, ecossistema e os 6 SDKs.
- **[`utils/`](utils):** FAQ e glossário.

Para uma visão detalhada de todos os arquivos, consulte o [**`SKILL.md`**](SKILL.md).

<div align="center">

## Ecossistema

</div>

- [Documentação oficial](https://documentacao.credicarro.com.br) — guia completo da API ([`llms.txt`](https://documentacao.credicarro.com.br/llms.txt), [`openapi.yaml`](https://documentacao.credicarro.com.br/openapi.yaml)).
- [SDK .NET](https://github.com/Twila-Digital/twila-credicarro-dotnet-sdk) · [SDK Java](https://github.com/Twila-Digital/twila-credicarro-java-sdk) · [SDK Node.js](https://github.com/Twila-Digital/twila-credicarro-node-sdk) · [SDK Python](https://github.com/Twila-Digital/twila-credicarro-python-sdk) · [SDK PHP](https://github.com/Twila-Digital/twila-credicarro-php-sdk) · [SDK Go](https://github.com/Twila-Digital/twila-credicarro-go-sdk)
- [Servidor MCP](https://github.com/Twila-Digital/twila-credicarro-mcp) — a API como ferramentas no Claude Desktop, Cursor e conectores remotos.
- [Credicarro](https://www.credicarro.com.br)
- Suporte e credenciais: atendimento@credicarro.com.br

<div align="center">

Feito pela equipe Twila Digital · Open source, sob licença MIT.

</div>
