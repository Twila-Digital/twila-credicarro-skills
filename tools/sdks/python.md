# SDK Python

Repositório: [twila-credicarro-python-sdk](https://github.com/Twila-Digital/twila-credicarro-python-sdk)

```bash
pip install twila-credicarro
```

- Compatível com Python 3.9+.
- Cliente síncrono baseado em [httpx](https://www.python-httpx.org/), totalmente tipado (`py.typed`, PEP 561).
- Módulo: `twila_credicarro` (`CredicarroClient`, `CredicarroClientOptions`, `CredicarroEnvironment`).
- Sem `environment` nem `base_url`, o cliente usa **Produção**.
- `PagedResult.page` (não `page_number`); `DocumentFile.from_bytes(content, file_name)` e `from_stream(stream, file_name)` (conteúdo primeiro).

Ver [rules/python/](../../rules/python) para regras de integração por recurso.
