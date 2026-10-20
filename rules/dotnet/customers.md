# Clientes (.NET)

`ICustomersClient` (como `client.Customers`) cadastra o comprador. O CPF identifica o cliente em todas as chamadas; você não precisa guardar o `id_cliente`.

## Modelos

```csharp
public enum OccupationType { Retired = 1, Pensioner = 2, Employee = 3, SelfEmployed = 4, Freelancer = 6, BusinessOwner = 7 } // não existe 5

public sealed record CustomerAddress(string Street, string Neighborhood, string City, string State, string PostalCode,
    string? Number = null, string? Complement = null);              // rua, bairro, cidade, estado, cep, numero, complemento
public sealed record ProfessionalData(OccupationType Occupation, decimal MonthlyIncome); // tipoOcupacao, renda

public sealed record UpsertCustomerRequest(string Cpf, string FirstName, string LastName, string Email, string PhoneNumber,
    DateTimeOffset DateOfBirth, CustomerAddress Address, ProfessionalData ProfessionalData);
    // cpf, nome, sobrenome, email, celular, dataDeNascimento, endereco, dadosProfissionais
public sealed record CreateCustomerRequest(string Cpf, string FirstName, string LastName, string Email, string PhoneNumber,
    DateTimeOffset DateOfBirth);                                     // só os 6 dados pessoais
```

## Interface

```csharp
public interface ICustomersClient
{
    Task<Guid> UpsertAsync(UpsertCustomerRequest request, string? idempotencyKey = null, CancellationToken cancellationToken = default);  // POST v1/customer/unified -> id_cliente
    Task<Guid> CreateAsync(CreateCustomerRequest request, string? idempotencyKey = null, CancellationToken cancellationToken = default);                                 // POST v1/customer -> id_cliente
    Task UpsertAddressAsync(string cpf, CustomerAddress address, string? idempotencyKey = null, CancellationToken cancellationToken = default);                          // POST v1/customer/address -> 202
    Task UpsertProfessionalDataAsync(string cpf, ProfessionalData data, string? idempotencyKey = null, CancellationToken cancellationToken = default);                   // POST v1/customer/professional -> 202
}
```

## Features

- **`UpsertAsync`:** prefira este método. Envia dados pessoais, endereço e dados profissionais e deixa o cliente pronto para a proposta.
- **Regra crítica da `idempotencyKey`:** **sem** chave (o padrão), `UpsertAsync` cria ou atualiza o cliente e o SDK **não repete** a chamada em falha de rede. **Com** chave, só cria, e o CPF existente responde `409 Cpf.CpfAlreadyAdded`. Para atualizar, não passe a chave.
- **`CreateAsync`:** só os dados pessoais, e só cria (CPF, e-mail ou celular repetido responde `409`). O SDK envia a chave sozinho e repete em falha transitória; passe `idempotencyKey` (1 a 200 caracteres ASCII imprimíveis) só se quiser controlá-la.
- **`UpsertAddressAsync` e `UpsertProfessionalDataAsync`:** exigem cliente já cadastrado e respondem `202` sem corpo. O SDK envia a chave sozinho (ou a sua, em `idempotencyKey`).
- `PhoneNumber` no formato exato `+55 (DD) 99999-9999`. `DateOfBirth` com offset (o SDK serializa em ISO-8601); cliente com 18 a 75 anos. `PostalCode` com 8 dígitos (hífen opcional). `State` é a sigla da UF.
- `MonthlyIncome` em reais, maior que zero. Use `decimal`.
- Os dados precisam bater com os documentos enviados depois (nome, CPF, endereço).

## Exemplo

(Fonte: `examples/dotnet/customers.cs`)

```csharp
var customerId = await client.Customers.UpsertAsync(new UpsertCustomerRequest(
    Cpf: "12345678909", FirstName: "Maria", LastName: "Souza", Email: "maria.souza@exemplo.com.br",
    PhoneNumber: "+55 (11) 99876-5432",
    DateOfBirth: new DateTimeOffset(1990, 5, 20, 0, 0, 0, TimeSpan.FromHours(-3)),
    Address: new CustomerAddress("Av. Paulista", "Bela Vista", "São Paulo", "SP", "01311000", Number: "1578"),
    ProfessionalData: new ProfessionalData(OccupationType.Employee, 6500.00m)),
    cancellationToken: ct);
```

## Erros e casos de borda

- `CredicarroValidationException` (`400`) com `Validation.Cpf.Invalid`, `Validation.Phone.Invalid`, `Validation.ZipCode.Invalid`, `Validation.BirthDate.BelowMinimumAge` e outros: o campo vem em `Field` (por exemplo, `endereco.cep`).
- `CredicarroApiException` com `404 Customer.Account.NotFound` em endereço e dados profissionais: cadastre o cliente antes.
- `409` com `Cpf.CpfAlreadyAdded`, `Email.EmailAlreadyAdded`, `Phone.PhoneAlreadyAdded` ou `Account.IdempotencyKeyReused` (chave reutilizada com outro conteúdo).
- Não registre CPF completo, e-mail nem celular em log. Veja [security.md](security.md).
