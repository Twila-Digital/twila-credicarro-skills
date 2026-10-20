# SDK Java

Repositório: [twila-credicarro-java-sdk](https://github.com/Twila-Digital/twila-credicarro-java-sdk)

```xml
<dependency>
    <groupId>br.com.twila</groupId>
    <artifactId>credicarro</artifactId>
    <version>1.0.0</version>
</dependency>
```

- Compatível com JDK 8 ou superior (compilado com `--release 8`; os testes do SDK rodam em CI nos JDK 11 e 21).
- HTTP via OkHttp (o `HttpClient` nativo do JDK exigiria Java 11+, incompatível com o piso de Java 8).
- Builder fluente: `CredicarroClient.builder().clientId(...).clientSecret(...).environment(...).build()`. Sem `environment(...)`, o padrão é `PRODUCTION`.
- Pacote raiz: `twila.credicarro` (`twila.credicarro.config`, `twila.credicarro.errors`, `twila.credicarro.webhooks`, etc.).
- O endpoint de webhook dos exemplos usa Spring Boot 3 (JDK 17+); qualquer framework serve, desde que entregue o corpo bruto limitado.

Ver [rules/java/](../../rules/java) para regras de integração por recurso.
