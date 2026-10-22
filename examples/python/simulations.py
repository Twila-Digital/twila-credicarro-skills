from __future__ import annotations

from twila_credicarro import (
    CommissionReturn,
    CreateFinancingSimulationRequest,
    CreateFinancingSimulationV1Request,
    CreateRefinancingSimulationRequest,
    CreateRefinancingSimulationV1Request,
    FinancingRangeOption,
    ListRequest,
    RefinancingRangeOption,
    SimulationOption,
)

from client import client

LOJA_CNPJ = "11.222.333/0001-81"  # formatado ou só números; precisa estar vinculado ao seu parceiro


def financing_range(license_plate: str) -> list[FinancingRangeOption]:
    """Entrada mínima por prazo. Consulte antes de simular para não cair em Proposal.DownPaymentInvalid."""
    return client.simulations.get_financing_range(license_plate, LOJA_CNPJ)  # [term, minimum_down_payment]


def refinancing_range(license_plate: str) -> list[RefinancingRangeOption]:
    """Faixa refinanciável por prazo."""
    return client.simulations.get_refinancing_range(license_plate, LOJA_CNPJ)  # [term, minimum_amount, maximum_amount]


def commission_returns() -> list[CommissionReturn]:
    """Faixa de retorno de comissão aceita por tipo de simulação. Consulte antes de informar commission_return."""
    return client.simulations.get_commission_returns(LOJA_CNPJ)


def simulate_financing(cpf: str, license_plate: str) -> list[SimulationOption]:
    """Uma opção por prazo elegível. O cliente precisa estar cadastrado. O SDK envia a Idempotency-Key sozinho."""
    return client.simulations.create_financing(
        CreateFinancingSimulationRequest(
            cpf=cpf,
            license_plate=license_plate,
            vehicle_amount=45000,
            down_payment=5000,
            state="SP",
            is_zero_km=False,
            store_cnpj=LOJA_CNPJ,
            # commission_return=2,  # opcional, dentro da faixa de commission_returns()
        )
    )


def simulate_refinancing(cpf: str, license_plate: str) -> list[SimulationOption]:
    return client.simulations.create_refinancing(
        CreateRefinancingSimulationRequest(
            cpf=cpf, license_plate=license_plate, requested_amount=20000, store_cnpj=LOJA_CNPJ
        )
    )


def describe_options(options: list[SimulationOption]) -> list[str]:
    """Mostre o CET ao cliente: é o número certo para comparar opções."""
    return [
        f"{o.term}x de R$ {o.installment_amount:.2f} | CET {o.monthly_cet}% a.m. / {o.annual_cet}% a.a."
        for o in options
    ]


def pick_by_term(options: list[SimulationOption], term: int) -> SimulationOption | None:
    """A opção escolhida pelo cliente: o `simulation_id` dela cria a proposta (cada opção gera uma única proposta)."""
    return next((o for o in options if o.term == term), None)


def read_simulations(simulation_id: str) -> bool:
    """Consulta uma simulação já criada (v1) e lista as simulações com paginação explícita."""
    simulation = client.simulations.get(simulation_id)  # simulation.type: FINANCING | REFINANCING | AMOUNT_SIMULATION
    page = client.simulations.list(ListRequest(page=1, page_size=20))
    print(f"{simulation.type.name} | {len(page.items)} de {page.total_count}")
    return page.has_next


def simulate_financing_v1(cpf: str, license_plate: str) -> list[SimulationOption]:
    """Rotas v1: sem `store_cnpj` (a loja de integração é a vinculada ao parceiro). Prefira as rotas v2 acima."""
    faixa = client.v1.simulations.get_financing_range(license_plate)
    print(f"prazos com entrada mínima: {len(faixa)}")

    return client.v1.simulations.create_financing(
        CreateFinancingSimulationV1Request(
            cpf=cpf,
            license_plate=license_plate,
            vehicle_amount=45000,
            down_payment=5000,
            state="SP",
            is_zero_km=False,
        )
    )


def simulate_refinancing_v1(cpf: str, license_plate: str) -> list[SimulationOption]:
    return client.v1.simulations.create_refinancing(
        CreateRefinancingSimulationV1Request(cpf=cpf, license_plate=license_plate, requested_amount=20000)
    )
