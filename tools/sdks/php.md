# SDK PHP

Repositório: [twila-credicarro-php-sdk](https://github.com/Twila-Digital/twila-credicarro-php-sdk)

```bash
composer require twila/credicarro
```

- Compatível com PHP 7.4+ (inclusive 8.0–8.5).
- HTTP via Guzzle (PSR-18), com seam de DI opcional (`ClientInterface`) pra plugar mocks.
- Namespace: `Twila\Credicarro`.
- Sem `enum` nativo nem `readonly`: os "enums" são classes de constantes, com `UNKNOWN = -1` para valores novos.
- Sem `$environment`, o padrão é `Environment::PRODUCTION`. Por padrão o token vive só na instância do `CredicarroClient` (em PHP-FPM, um token por requisição); passe um cache PSR-16 (APCu/Redis) como último argumento de `ClientOptions` para compartilhá-lo.
- Requer `guzzlehttp/guzzle` `^7.4.5` e `psr/simple-cache`. O `clientSecret` fica num objeto interno sem getter; `ClientOptions` e o cliente recusam `serialize`. Os DTOs são mascarados só em `var_dump`/`print_r` (serialização e JSON levam os valores reais).
- `DocumentFile::fromBytes($bytes, $fileName)` e `fromStream($stream, $fileName)` recebem o conteúdo primeiro.

Ver [rules/php/](../../rules/php) para regras de integração por recurso.
