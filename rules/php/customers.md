# Clientes (PHP)

O cliente (comprador) precisa estar cadastrado antes de simular. `Twila\Credicarro\Customers` cadastra e atualiza dados pessoais, endereço e dados profissionais. Usa o `CredicarroClient` de [client](client.md).

## Modelos

```php
final class CustomersClient {                                          // $client->customers
    public function upsert(UpsertCustomerRequest $request, ?string $idempotencyKey = null): string; // POST v1/customer/unified -> id_cliente
    public function create(CreateCustomerRequest $request): string;                                 // POST v1/customer -> id_cliente
    public function upsertAddress(string $cpf, CustomerAddress $address): void;                     // POST v1/customer/address -> 202
    public function upsertProfessionalData(string $cpf, ProfessionalData $data): void;              // POST v1/customer/professional -> 202
}

final class UpsertCustomerRequest {
    public function __construct(
        string $cpf, string $firstName, string $lastName, string $email,
        string $phoneNumber,        // +55 (DD) 99999-9999
        string $dateOfBirth,        // ISO-8601 com offset: 1990-05-20T00:00:00-03:00
        CustomerAddress $address, ProfessionalData $professionalData
    );
}

final class CreateCustomerRequest { // só os seis dados pessoais
    public function __construct(string $cpf, string $firstName, string $lastName, string $email, string $phoneNumber, string $dateOfBirth);
}

final class CustomerAddress {
    public function __construct(
        string $street, string $neighborhood, string $city, string $state, string $postalCode,
        ?string $number = null, ?string $complement = null           // opcionais
    );
}

final class ProfessionalData {
    public function __construct(int $occupation /* OccupationType::* */, float $monthlyIncome);
}
```

`OccupationType`: `RETIRED = 1`, `PENSIONER = 2`, `EMPLOYEE = 3`, `SELF_EMPLOYED = 4`, `FREELANCER = 6`, `BUSINESS_OWNER = 7`, `UNKNOWN = -1` (não existe 5).

## Funcionalidades

- `upsert($request)` cadastra o cliente completo (dados pessoais, endereço e dados profissionais) numa chamada e devolve o `id_cliente` (`string`). **Sem chave, cria ou atualiza.** O CPF identifica o cliente nas demais chamadas; guardar o ID é opcional.
- `upsert($request, $idempotencyKey)` **só cria**: se o CPF já existe, a API responde `409 Cpf.CpfAlreadyAdded` (`CredicarroApiException`). Use para repetir uma criação com segurança; guarde a chave com o pedido e reaproveite-a nas repetições.
- `create($request)` envia só os seis dados pessoais (`POST v1/customer`); o SDK gera a chave de idempotência e repete em falhas transitórias. Complete endereço e ocupação depois.
- `upsertAddress($cpf, $address)` e `upsertProfessionalData($cpf, $data)` atualizam endereço e ocupação/renda de um CPF já cadastrado.

## Exemplo

(Fonte: `examples/php/customers.php`)

```php
$clienteId = $client->customers->upsert(new UpsertCustomerRequest(
    '12345678909', 'Maria', 'Souza', 'maria.souza@exemplo.com.br',
    '+55 (11) 99876-5432', '1990-05-20T00:00:00-03:00',
    new CustomerAddress('Av. Paulista', 'Bela Vista', 'São Paulo', 'SP', '01311000', '1578'),
    new ProfessionalData(OccupationType::EMPLOYEE, 6500.0)
));
```

## Erros e casos de borda

- **Regra crítica**: `upsert($request)` (sem chave) cria ou atualiza; `upsert($request, $chave)` só cria. Para atualizar um cliente existente, chame **sem** a chave. O SDK nunca gera a chave nessa rota e não repete `upsert($request)` em falha: se der timeout, consulte a situação antes de tentar de novo (ou repita com sua própria chave, sabendo que um CPF existente retorna `409`).
- Outros `409` na criação: `Email.EmailAlreadyAdded`, `Phone.PhoneAlreadyAdded` e `Account.IdempotencyKeyReused` (chave usada com outro conteúdo). Todos chegam como `CredicarroApiException`; trate por `getErrorCode()`.
- `phoneNumber` precisa estar exatamente no formato `+55 (DD) 99999-9999`; outro formato gera `CredicarroValidationException` com `Validation.Phone.Invalid`.
- `dateOfBirth` é uma `string` ISO-8601 com offset (`1990-05-20T00:00:00-03:00`). O cliente precisa ter de 18 a 75 anos (`Validation.BirthDate.BelowMinimumAge` / `AboveMaximumAge`).
- `cpf` aceita com ou sem pontuação (11 dígitos) e tem os dígitos verificadores validados. `postalCode` tem 8 dígitos, com ou sem hífen. Obrigatórios em `CustomerAddress`: `street`, `neighborhood`, `city`, `state`, `postalCode` (atenção à ordem dos argumentos do construtor).
- `monthlyIncome` em reais (`float`); para cálculos, use centavos inteiros ou `bcmath`.
- `upsertAddress` e `upsertProfessionalData` respondem `404 Customer.Account.NotFound` (`CredicarroApiException`) se o CPF não tem cadastro. Cadastre antes. Retornam `void` (a API responde `202` sem corpo).
- Antes de criar a proposta, o cadastro precisa ter endereço, ocupação e renda. Sem isso, `proposals->create` responde `422 Customer.Account.Incomplete` (`CredicarroBusinessRuleException`).
- Os dados enviados devem bater com os documentos do cliente; divergências de nome, CPF ou endereço podem causar recusa de documentos.
- Não registre CPF completo nem endereço em log. Veja [segurança](security.md).
