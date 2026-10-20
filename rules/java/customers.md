# Clientes (Java)

O cliente (comprador) precisa estar cadastrado antes de simular. `twila.credicarro.customers` cadastra e atualiza dados pessoais, endereço e dados profissionais. Usa o `CredicarroClient` de [client](client.md).

## Modelos

```java
public interface CustomersClient {
    UUID upsert(UpsertCustomerRequest request);                      // POST v1/customer/unified
    UUID upsert(UpsertCustomerRequest request, String idempotencyKey);
    UUID create(CreateCustomerRequest request);                      // POST v1/customer
    void upsertAddress(String cpf, CustomerAddress address);         // POST v1/customer/address -> 202
    void upsertProfessionalData(String cpf, ProfessionalData professionalData); // POST v1/customer/professional -> 202
}

@Value @Builder
public class UpsertCustomerRequest {
    String cpf;
    String firstName;
    String lastName;
    String email;
    String phoneNumber;            // +55 (DD) 99999-9999
    OffsetDateTime dateOfBirth;
    CustomerAddress address;
    ProfessionalData professionalData;
}

@Value @Builder
public class CreateCustomerRequest { // só os seis dados pessoais
    String cpf; String firstName; String lastName; String email; String phoneNumber; OffsetDateTime dateOfBirth;
}

@Value @Builder
public class CustomerAddress {
    String street; String number; String complement; // number e complement são opcionais
    String neighborhood; String city; String state; String postalCode;
}

@Value @Builder
public class ProfessionalData {
    OccupationType occupation;
    BigDecimal monthlyIncome;
}
```

`OccupationType`: `RETIRED(1)`, `PENSIONER(2)`, `EMPLOYEE(3)`, `SELF_EMPLOYED(4)`, `FREELANCER(6)`, `BUSINESS_OWNER(7)`, `UNKNOWN(-1)` (não existe 5).

## Funcionalidades

- `upsert(request)` cadastra o cliente completo (dados pessoais, endereço e dados profissionais) numa chamada e devolve o `id_cliente` (`UUID`). **Sem chave, cria ou atualiza.** O CPF identifica o cliente nas demais chamadas; guardar o `UUID` é opcional.
- `upsert(request, idempotencyKey)` **só cria**: se o CPF já existe, a API responde `409 Cpf.CpfAlreadyAdded` (`CredicarroApiException`). Use para repetir uma criação com segurança; guarde a chave com o pedido e reaproveite-a nas repetições.
- `create(request)` envia só os seis dados pessoais (`POST v1/customer`); o SDK gera a chave de idempotência e repete em falhas transitórias. Complete endereço e ocupação depois.
- `upsertAddress(cpf, address)` e `upsertProfessionalData(cpf, data)` atualizam endereço e ocupação/renda de um CPF já cadastrado.

## Exemplo

(Fonte: `examples/java/customers.java`)

```java
UUID clienteId = client.customers().upsert(UpsertCustomerRequest.builder()
        .cpf("12345678909").firstName("Maria").lastName("Souza")
        .email("maria.souza@exemplo.com.br").phoneNumber("+55 (11) 99876-5432")
        .dateOfBirth(OffsetDateTime.of(1990, 5, 20, 0, 0, 0, 0, ZoneOffset.of("-03:00")))
        .address(CustomerAddress.builder().street("Av. Paulista").number("1578")
                .neighborhood("Bela Vista").city("São Paulo").state("SP").postalCode("01311000").build())
        .professionalData(ProfessionalData.builder()
                .occupation(OccupationType.EMPLOYEE).monthlyIncome(new BigDecimal("6500.00")).build())
        .build());
```

## Erros e casos de borda

- **Regra crítica**: `upsert(request)` (sem chave) cria ou atualiza; `upsert(request, chave)` só cria. Para atualizar um cliente existente, chame **sem** a chave. O SDK nunca gera a chave nessa rota e não repete `upsert(request)` em falha: se der timeout, consulte a situação antes de tentar de novo (ou repita com sua própria chave, sabendo que um CPF existente retorna `409`).
- Outros `409` na criação: `Email.EmailAlreadyAdded`, `Phone.PhoneAlreadyAdded` e `Account.IdempotencyKeyReused` (chave usada com outro conteúdo). Todos chegam como `CredicarroApiException`; trate por `getErrorCode()`.
- `phoneNumber` precisa estar exatamente no formato `+55 (DD) 99999-9999`; outro formato gera `CredicarroValidationException` com `Validation.Phone.Invalid`.
- `dateOfBirth` é `OffsetDateTime` (o SDK envia em ISO-8601 com offset). O cliente precisa ter de 18 a 75 anos (`Validation.BirthDate.BelowMinimumAge` / `AboveMaximumAge`).
- `cpf` aceita com ou sem pontuação (11 dígitos) e tem os dígitos verificadores validados. `postalCode` tem 8 dígitos, com ou sem hífen. Obrigatórios em `CustomerAddress`: `street`, `neighborhood`, `city`, `state`, `postalCode`.
- `monthlyIncome` em reais, `BigDecimal`.
- `upsertAddress` e `upsertProfessionalData` respondem `404 Customer.Account.NotFound` (`CredicarroApiException`) se o CPF não tem cadastro. Cadastre antes. Retornam `void` (a API responde `202` sem corpo).
- Antes de criar a proposta, o cadastro precisa ter endereço, ocupação e renda. Sem isso, `proposals().create` responde `422 Customer.Account.Incomplete` (`CredicarroBusinessRuleException`).
- Os dados enviados devem bater com os documentos do cliente; divergências de nome, CPF ou endereço podem causar recusa de documentos.
- Não registre CPF completo nem endereço em log. Veja [segurança](security.md).
