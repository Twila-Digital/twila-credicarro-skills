# Ecossistema Credicarro

## Documentação oficial

- [documentacao.credicarro.com.br](https://documentacao.credicarro.com.br) — guia completo da API: autenticação, fluxo da proposta, webhooks, erros e guias de financiamento, refinanciamento e envio de documentos. Índice completo em [`/llms.txt`](https://documentacao.credicarro.com.br/llms.txt); qualquer página pode ser lida como Markdown trocando a extensão da URL para `.md`.
- O contrato OpenAPI 3.1 da API está em [`/openapi.yaml`](https://documentacao.credicarro.com.br/openapi.yaml).
- Em caso de divergência entre estas skills e a documentação oficial, a documentação oficial prevalece.

## SDKs

| Linguagem | Pacote | Repositório | Guia |
| --- | --- | --- | --- |
| .NET | `Twila.Credicarro` (NuGet) | [twila-credicarro-dotnet-sdk](https://github.com/Twila-Digital/twila-credicarro-dotnet-sdk) | [sdks/dotnet.md](sdks/dotnet.md) |
| Java | `br.com.twila:credicarro` (Maven Central) | [twila-credicarro-java-sdk](https://github.com/Twila-Digital/twila-credicarro-java-sdk) | [sdks/java.md](sdks/java.md) |
| Node.js | `@twila/credicarro` (npm) | [twila-credicarro-node-sdk](https://github.com/Twila-Digital/twila-credicarro-node-sdk) | [sdks/node.md](sdks/node.md) |
| Python | `twila-credicarro` (PyPI) | [twila-credicarro-python-sdk](https://github.com/Twila-Digital/twila-credicarro-python-sdk) | [sdks/python.md](sdks/python.md) |
| PHP | `twila/credicarro` (Packagist) | [twila-credicarro-php-sdk](https://github.com/Twila-Digital/twila-credicarro-php-sdk) | [sdks/php.md](sdks/php.md) |
| Go | `github.com/Twila-Digital/twila-credicarro-go-sdk` | [twila-credicarro-go-sdk](https://github.com/Twila-Digital/twila-credicarro-go-sdk) | [sdks/go.md](sdks/go.md) |

Todos os SDKs encapsulam: token em cache com renovação automática (inclusive em `401`), retry com backoff e circuit breaker só em requisições seguras, `Idempotency-Key` automática nas rotas que a aceitam (exceto o cadastro unificado de cliente, que vira "só cria" com a chave), erros tipados pelo `tipo` da API, enums com valor `Unknown` para códigos novos, paginação (`PagedResult`), as rotas `/v1` e `/v2`, e a verificação de assinatura dos webhooks. Use o SDK da linguagem em vez de chamar a API com um cliente HTTP próprio. Não invente classes ou métodos: confira a regra da linguagem em `rules/<linguagem>/`.

## Servidor MCP

[twila-credicarro-mcp](https://github.com/Twila-Digital/twila-credicarro-mcp) — servidor [MCP](https://modelcontextprotocol.io) (stdio para Claude Desktop/Cursor, HTTP com OAuth para conectores remotos) que expõe clientes, simulações, propostas e webhooks como ferramentas, usando o SDK .NET.

## Suporte

- Credenciais, cadastro de lojas e liberação da produção: atendimento@credicarro.com.br.
- Em um erro, informe ao suporte o `tipo`, o status HTTP, a rota e o horário (sem enviar token nem `clientSecret`).

## Este repositório

[twila-credicarro-skills](https://github.com/Twila-Digital/twila-credicarro-skills) — pacotes de contexto (este repositório) para ensinar agentes de IA a integrar com o Credicarro pelos 6 SDKs acima e a operar a API diretamente via `curl` (Agent Mode).

Todos são open source (MIT) e aceitam PR de qualquer pessoa; o merge exige aprovação do time Twila Digital.
