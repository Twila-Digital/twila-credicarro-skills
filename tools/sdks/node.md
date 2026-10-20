# SDK Node.js

Repositório: [twila-credicarro-node-sdk](https://github.com/Twila-Digital/twila-credicarro-node-sdk)

```bash
npm install @twila/credicarro
```

- Compatível com Node.js 14+, CommonJS e ES Modules.
- Totalmente tipado (TypeScript), cliente único reaproveitável como singleton.
- Tipos principais: `CredicarroClient`, `CredicarroEnvironment`, `getPendingActions`, `parseWebhookEvent` (verificado), `parseWebhookEventUnverified` (só testes), `DocumentFile.fromBytes`.
- Sem `environment` nem `baseUrl`, o cliente usa **Produção**.

Ver [rules/node/](../../rules/node) para regras de integração por recurso.
