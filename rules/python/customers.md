# Clientes (Python)

O cliente é o comprador. Ele é identificado pelo **CPF** em todas as chamadas; você não precisa guardar o `id_cliente`. O cadastro precisa estar completo (dados pessoais, endereço, ocupação e renda) antes de simular e criar a proposta. Acesse por `client.customers`, usando o cliente único de [client.md](client.md).

## Tipos

```python
from twila_credicarro import (
    CreateCustomerRequest, UpsertCustomerRequest, CustomerAddress, ProfessionalData, OccupationType,
)

class OccupationType(IntEnum):   # não existe 5
    RETIRED = 1; PENSIONER = 2; EMPLOYEE = 3; SELF_EMPLOYED = 4; FREELANCER = 6; BUSINESS_OWNER = 7; UNKNOWN = -1

@dataclass(frozen=True)
class CustomerAddress:
    street: str; neighborhood: str; city: str; state: str
    postal_code: str                       # 8 dígitos, com ou sem hífen
    number: Optional[str] = None; complement: Optional[str] = None

@dataclass(frozen=True)
class ProfessionalData:
    occupation: OccupationType; monthly_income: float   # renda mensal em reais

@dataclass(frozen=True)
class CreateCustomerRequest:
    cpf: str; first_name: str; last_name: str; email: str
    phone_number: str                      # exatamente "+55 (DD) 99999-9999"
    date_of_birth: Union[str, date, datetime]   # ISO-8601 com offset; cliente com 18 a 75 anos

@dataclass(frozen=True)
class UpsertCustomerRequest:               # os mesmos seis campos pessoais, mais:
    address: CustomerAddress; professional_data: ProfessionalData
```

## Interface

```python
class CustomersClient:
    def upsert(self, request: UpsertCustomerRequest, idempotency_key: Optional[str] = None) -> str: ...  # POST v1/customer/unified -> id_cliente
    def create(self, request: CreateCustomerRequest) -> str: ...                                          # POST v1/customer -> id_cliente
    def upsert_address(self, cpf: str, address: CustomerAddress) -> None: ...                             # POST v1/customer/address -> 202
    def upsert_professional_data(self, cpf: str, data: ProfessionalData) -> None: ...                     # POST v1/customer/professional -> 202
```

## Features

- **Prefira `upsert`:** cadastra tudo numa chamada e já deixa o cliente pronto para a proposta.
- **Regra crítica da chave:** `upsert` **sem** `idempotency_key` **cria ou atualiza** o cliente (upsert). **Com** a chave, **só cria**: CPF existente dá `409 Cpf.CpfAlreadyAdded`. Para atualizar um cadastro, **não passe a chave**.
- O SDK **nunca** gera a chave em `upsert`. Consequência: sem chave a chamada **não é repetida** em falha de rede ou `5xx`; com chave explícita ela passa a ser repetida, sempre com a mesma chave.
- `create` só cria e aceita os seis campos pessoais. O SDK já envia a `Idempotency-Key` sozinho e repete a chamada em falha transitória.
- `upsert_address` e `upsert_professional_data` também enviam a chave sozinhos e devolvem `202` sem corpo.
- `date_of_birth` aceita `str` ISO-8601 com offset, `date` ou `datetime`.

## Exemplo
(Fonte: `examples/python/customers.py`)

```python
id_cliente = client.customers.upsert(
    UpsertCustomerRequest(
        cpf="12345678909", first_name="Maria", last_name="Souza",
        email="maria.souza@exemplo.com.br", phone_number="+55 (11) 99876-5432",
        date_of_birth="1990-05-20T00:00:00-03:00",
        address=CustomerAddress(street="Av. Paulista", number="1578", neighborhood="Bela Vista",
                                city="São Paulo", state="SP", postal_code="01311000"),
        professional_data=ProfessionalData(occupation=OccupationType.EMPLOYEE, monthly_income=6500),
    )
)

# Só criar (com chave): se o CPF já existe, a API responde 409.
client.customers.upsert(request, idempotency_key)
```

## Erros e casos de borda

- `create` só cria. CPF, e-mail ou celular repetidos dão `409` (`Cpf.CpfAlreadyAdded`, `Email.EmailAlreadyAdded`, `Phone.PhoneAlreadyAdded`).
- `upsert_address` e `upsert_professional_data` exigem cadastro prévio; senão `404 Customer.Account.NotFound`.
- Validações (`400`, `CredicarroValidationError`, com o campo em `field`): `Validation.Cpf.Invalid`, `Validation.Phone.Invalid`, `Validation.ZipCode.Invalid`, `Validation.BirthDate.BelowMinimumAge`, `Validation.BirthDate.AboveMaximumAge`, `Validation.Field.InvalidOption` (ocupação).
- `postal_code` com 8 dígitos (com ou sem hífen); `monthly_income` maior que zero, em reais.
- Os dados precisam bater com os documentos enviados depois (nome, CPF, endereço); divergência causa recusa de documento.
- `create` não aceita endereço nem dados profissionais (a API recusa campos extras): use `upsert`, ou `upsert_address` e `upsert_professional_data` depois.
- Não registre o CPF completo em logs. Veja [segurança](security.md).
