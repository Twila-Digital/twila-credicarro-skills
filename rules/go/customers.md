# Clientes (Go)

`CustomersClient` (como `client.Customers`) cadastra o comprador. O CPF identifica o cliente em todas as chamadas; você não precisa guardar o `id_cliente`.

## Structs e tipos

```go
type OccupationType int // OccupationTypeRetired=1, Pensioner=2, Employee=3, SelfEmployed=4, Freelancer=6, BusinessOwner=7 (não existe 5)

type CustomerAddress struct {
    Street, Number, Complement, Neighborhood, City, State, PostalCode string // rua, numero, complemento, bairro, cidade, estado, cep
}
type ProfessionalData struct {
    Occupation    OccupationType // tipoOcupacao
    MonthlyIncome float64        // renda, em reais
}

type UpsertCustomerRequest struct {
    Cpf, FirstName, LastName, Email, PhoneNumber string // cpf, nome, sobrenome, email, celular
    DateOfBirth      string           // dataDeNascimento, ISO-8601 com offset (1990-05-20T00:00:00-03:00)
    Address          CustomerAddress  // endereco
    ProfessionalData ProfessionalData // dadosProfissionais
}
type CreateCustomerRequest struct { // só os 6 dados pessoais
    Cpf, FirstName, LastName, Email, PhoneNumber, DateOfBirth string
}
```

## Métodos

```go
func (c *CustomersClient) Upsert(ctx context.Context, req UpsertCustomerRequest, opts ...RequestOption) (string, error) // POST v1/customer/unified -> id_cliente
func (c *CustomersClient) Create(ctx context.Context, req CreateCustomerRequest, opts ...RequestOption) (string, error) // POST v1/customer -> id_cliente
func (c *CustomersClient) UpsertAddress(ctx context.Context, cpf string, address CustomerAddress, opts ...RequestOption) error          // POST v1/customer/address -> 202
func (c *CustomersClient) UpsertProfessionalData(ctx context.Context, cpf string, data ProfessionalData, opts ...RequestOption) error // POST v1/customer/professional -> 202
```

## Features

- **`Upsert`:** prefira este método. Envia dados pessoais, endereço e dados profissionais e deixa o cliente pronto para a proposta.
- **Regra crítica da chave:** **sem** `WithIdempotencyKey` (o padrão), `Upsert` cria ou atualiza o cliente e o SDK **não repete** a chamada em falha de rede. **Com** a chave, só cria, e o CPF existente responde `409 Cpf.CpfAlreadyAdded`. Para atualizar, não passe a chave.
- **`Create`:** só os dados pessoais, e só cria (CPF, e-mail ou celular repetido responde `409`). O SDK envia a chave sozinho e repete em falha transitória.
- **`UpsertAddress` e `UpsertProfessionalData`:** exigem cliente já cadastrado e respondem `202` sem corpo. O SDK envia a chave sozinho.
- `PhoneNumber` no formato exato `+55 (DD) 99999-9999`. `DateOfBirth` em ISO-8601 com offset; cliente com 18 a 75 anos. `PostalCode` com 8 dígitos (hífen opcional). `State` é a sigla da UF.
- `MonthlyIncome` em reais, maior que zero.
- Os dados precisam bater com os documentos enviados depois (nome, CPF, endereço).

## Exemplo

(Fonte: `examples/go/customers.go`)

```go
customerID, err := client.Customers.Upsert(ctx, credicarro.UpsertCustomerRequest{
    Cpf: "12345678909", FirstName: "Maria", LastName: "Souza", Email: "maria.souza@exemplo.com.br",
    PhoneNumber: "+55 (11) 99876-5432", DateOfBirth: "1990-05-20T00:00:00-03:00",
    Address: credicarro.CustomerAddress{
        Street: "Av. Paulista", Number: "1578", Neighborhood: "Bela Vista",
        City: "São Paulo", State: "SP", PostalCode: "01311000",
    },
    ProfessionalData: credicarro.ProfessionalData{Occupation: credicarro.OccupationTypeEmployee, MonthlyIncome: 6500},
})
```

## Erros e casos de borda

- `*ValidationError` (`400`) com `Validation.Cpf.Invalid`, `Validation.Phone.Invalid`, `Validation.ZipCode.Invalid`, `Validation.BirthDate.BelowMinimumAge` e outros: o campo vem em `Field` (por exemplo, `endereco.cep`).
- `*APIError` com `404 Customer.Account.NotFound` em endereço e dados profissionais: cadastre o cliente antes.
- `409` com `Cpf.CpfAlreadyAdded`, `Email.EmailAlreadyAdded`, `Phone.PhoneAlreadyAdded` ou `Account.IdempotencyKeyReused` (chave reutilizada com outro conteúdo).
- `cpf` vazio em `UpsertAddress` e `UpsertProfessionalData` volta como `*ConfigurationError`, sem chamar a API.
- Não registre CPF completo, e-mail nem celular em log. Veja [security.md](security.md).
