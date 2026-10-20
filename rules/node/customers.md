# Clientes (Node.js)

O cliente é o comprador. Ele é identificado pelo **CPF** em todas as chamadas; você não precisa guardar o `id_cliente`. O cadastro precisa estar completo (dados pessoais, endereço, ocupação e renda) antes de simular e criar a proposta. Acesse por `client.customers`, usando o cliente único de [client.md](client.md).

## Tipos

```typescript
import { OccupationType, type CreateCustomerRequest, type UpsertCustomerRequest, type CustomerAddress, type ProfessionalData } from '@twila/credicarro';

enum OccupationType { Retired = 1, Pensioner = 2, Employee = 3, SelfEmployed = 4, Freelancer = 6, BusinessOwner = 7, Unknown = -1 } // não existe 5

interface CustomerAddress {
  street: string; number?: string; complement?: string;
  neighborhood: string; city: string; state: string;
  postalCode: string;                  // 8 dígitos, com ou sem hífen
}
interface ProfessionalData { occupation: OccupationType; monthlyIncome: number } // renda mensal em reais

interface CreateCustomerRequest {
  cpf: string; firstName: string; lastName: string; email: string;
  phoneNumber: string;                 // exatamente "+55 (DD) 99999-9999"
  dateOfBirth: string | Date;          // ISO-8601 com offset; cliente com 18 a 75 anos
}
interface UpsertCustomerRequest extends CreateCustomerRequest { address: CustomerAddress; professionalData: ProfessionalData }
```

## Interface

```typescript
interface CustomersClient {
  upsert(request: UpsertCustomerRequest, idempotencyKey?: string): Promise<string>; // POST v1/customer/unified -> id_cliente
  create(request: CreateCustomerRequest): Promise<string>;                          // POST v1/customer -> id_cliente
  upsertAddress(cpf: string, address: CustomerAddress): Promise<void>;              // POST v1/customer/address -> 202
  upsertProfessionalData(cpf: string, data: ProfessionalData): Promise<void>;       // POST v1/customer/professional -> 202
}
```

## Features

- **Prefira `upsert`:** cadastra tudo numa chamada e já deixa o cliente pronto para a proposta.
- **Regra crítica da chave:** `upsert` **sem** `idempotencyKey` **cria ou atualiza** o cliente (upsert). **Com** a chave, **só cria**: CPF existente dá `409 Cpf.CpfAlreadyAdded`. Para atualizar um cadastro, **não passe a chave**.
- O SDK **nunca** gera a chave em `upsert`. Consequência: sem chave a chamada **não é repetida** em falha de rede ou `5xx`; com chave explícita ela passa a ser repetida, sempre com a mesma chave.
- `create` só cria e aceita os seis campos pessoais. O SDK já envia a `Idempotency-Key` sozinho e repete a chamada em falha transitória.
- `upsertAddress` e `upsertProfessionalData` também enviam a chave sozinhos e devolvem `202` sem corpo.
- `dateOfBirth` aceita `string` ISO-8601 com offset ou `Date`.

## Exemplo
(Fonte: `examples/node/customers.ts`)

```typescript
const idCliente = await client.customers.upsert({
  cpf: '12345678909',
  firstName: 'Maria',
  lastName: 'Souza',
  email: 'maria.souza@exemplo.com.br',
  phoneNumber: '+55 (11) 99876-5432',
  dateOfBirth: '1990-05-20T00:00:00-03:00',
  address: { street: 'Av. Paulista', number: '1578', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', postalCode: '01311000' },
  professionalData: { occupation: OccupationType.Employee, monthlyIncome: 6500 },
});

// Só criar (com chave): se o CPF já existe, a API responde 409.
await client.customers.upsert(request, idempotencyKey);
```

## Erros e casos de borda

- `create` só cria. CPF, e-mail ou celular repetidos dão `409` (`Cpf.CpfAlreadyAdded`, `Email.EmailAlreadyAdded`, `Phone.PhoneAlreadyAdded`).
- `upsertAddress` e `upsertProfessionalData` exigem cadastro prévio; senão `404 Customer.Account.NotFound`.
- Validações (`400`, `CredicarroValidationError`, com o campo em `field`): `Validation.Cpf.Invalid`, `Validation.Phone.Invalid`, `Validation.ZipCode.Invalid`, `Validation.BirthDate.BelowMinimumAge`, `Validation.BirthDate.AboveMaximumAge`, `Validation.Field.InvalidOption` (ocupação).
- `postalCode` com 8 dígitos (com ou sem hífen); `monthlyIncome` maior que zero, em reais.
- Os dados precisam bater com os documentos enviados depois (nome, CPF, endereço); divergência causa recusa de documento.
- `create` não aceita `address` nem `professionalData` (a API recusa campos extras): use `upsert`, ou `upsertAddress` e `upsertProfessionalData` depois.
- Não registre o CPF completo em logs. Veja [segurança](security.md).
