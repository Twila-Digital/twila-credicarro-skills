from __future__ import annotations

from typing import Optional

from twila_credicarro import (
    CreateCustomerRequest,
    CredicarroApiError,
    CustomerAddress,
    OccupationType,
    ProfessionalData,
    UpsertCustomerRequest,
)

from client import client

CADASTRO = UpsertCustomerRequest(
    cpf="12345678909",
    first_name="Maria",
    last_name="Souza",
    email="maria.souza@exemplo.com.br",
    phone_number="+55 (11) 99876-5432",  # exatamente neste formato
    date_of_birth="1990-05-20T00:00:00-03:00",  # ISO-8601 com offset; cliente entre 18 e 75 anos
    address=CustomerAddress(
        street="Av. Paulista",
        number="1578",
        neighborhood="Bela Vista",
        city="São Paulo",
        state="SP",
        postal_code="01311000",
    ),
    professional_data=ProfessionalData(occupation=OccupationType.EMPLOYEE, monthly_income=6500),
)


def upsert_customer(request: UpsertCustomerRequest = CADASTRO) -> str:
    """Sem chave: CRIA ou ATUALIZA (upsert). O SDK não gera chave aqui e não repete a chamada se ela falhar."""
    return client.customers.upsert(request)  # id_cliente


def create_customer_only(request: UpsertCustomerRequest, idempotency_key: str) -> Optional[str]:
    """Com chave explícita: SÓ CRIA (CPF existente => 409 Cpf.CpfAlreadyAdded) e a chamada passa a ser repetida
    com a mesma chave."""
    try:
        return client.customers.upsert(request, idempotency_key)
    except CredicarroApiError as error:
        if error.error_code == "Cpf.CpfAlreadyAdded":
            return None  # já existe
        raise


def create_personal_data() -> str:
    """Só os seis dados pessoais (POST v1/customer). CPF, e-mail ou celular repetidos dão 409."""
    pessoais = CreateCustomerRequest(
        cpf=CADASTRO.cpf,
        first_name=CADASTRO.first_name,
        last_name=CADASTRO.last_name,
        email=CADASTRO.email,
        phone_number=CADASTRO.phone_number,
        date_of_birth=CADASTRO.date_of_birth,
    )
    return client.customers.create(pessoais)


def update_address(cpf: str, address: CustomerAddress) -> None:
    """Atualiza só o endereço de um cliente já cadastrado (202, sem corpo)."""
    client.customers.upsert_address(cpf, address)


def update_professional_data(cpf: str, data: ProfessionalData) -> None:
    """Atualiza só ocupação e renda de um cliente já cadastrado (202, sem corpo)."""
    client.customers.upsert_professional_data(cpf, data)

