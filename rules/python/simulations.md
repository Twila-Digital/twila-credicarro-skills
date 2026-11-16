# Simulações (Python)

A simulação calcula as condições de crédito para um cliente, um veículo e uma loja. A resposta traz **uma opção por prazo elegível**, cada uma com um `simulation_id`. A opção que o cliente escolher vira a proposta. Acesse por `client.simulations` (rotas v2, com `store_cnpj`) e `client.v1.simulations` (rotas v1, sem `store_cnpj`), usando o cliente único de [client.md](client.md).

## Tipos

```python
from twila_credicarro import (
    FinancingRangeOption, RefinancingRangeOption,
    CreateFinancingSimulationRequest, CreateRefinancingSimulationRequest,
    CreateFinancingSimulationV1Request, CreateRefinancingSimulationV1Request,
    CreateFinancingWithoutCpfRequest, CreateRefinancingWithoutCpfRequest,
    FinancingWithoutCpfOption, RefinancingWithoutCpfOption,
    SimulationOption, Simulation, SimulationType,
)

@dataclass(frozen=True)
class FinancingRangeOption: term: int; minimum_down_payment: float
@dataclass(frozen=True)
class RefinancingRangeOption: term: int; minimum_amount: float; maximum_amount: float

@dataclass(frozen=True)
class CreateFinancingSimulationRequest:
    cpf: str; license_plate: str; vehicle_amount: float
    down_payment: float        # pode ser 0, mas precisa deixar >= 10% do veículo para financiar
    state: str                 # UF com 2 letras
    is_zero_km: bool
    store_cnpj: str            # formatado ou só números
@dataclass(frozen=True)
class CreateRefinancingSimulationRequest: cpf: str; license_plate: str; requested_amount: float; store_cnpj: str
# V1: os mesmos campos, sem store_cnpj
#   CreateFinancingSimulationV1Request(cpf, license_plate, vehicle_amount, down_payment, state, is_zero_km)
#   CreateRefinancingSimulationV1Request(cpf, license_plate, requested_amount)

# Sem CPF (client.v1.simulations): só placa, valor e UF
@dataclass(frozen=True)
class CreateFinancingWithoutCpfRequest:
    license_plate: str; vehicle_amount: float; state: str
    down_payment: Optional[float] = None    # omitido = entrada mínima da taxa da loja (não vai no JSON)
@dataclass(frozen=True)
class CreateRefinancingWithoutCpfRequest: license_plate: str; requested_amount: float; state: str   # todos obrigatórios

@dataclass(frozen=True)
class SimulationOption:
    simulation_id: str; requested_amount: float; term: int; installment_amount: float
    tac_amount: float; boleto_amount: float; insurance_amount: float; iof_amount: float; iof_rate: float
    total_credit_amount: float; total_debt_amount: float
    monthly_cet: float; annual_cet: float; monthly_interest_rate: float; annual_interest_rate: float
    approximate_daily_retention: Optional[float] = None     # ausente quando não se aplica

# Opções sem CPF: lista, sem simulation_id
@dataclass(frozen=True)
class FinancingWithoutCpfOption:
    requested_amount: float; term: int; installment_amount: float
    tac_amount: float; boleto_amount: float; insurance_amount: float; iof_amount: float; iof_rate: float
    total_credit_amount: float; total_debt_amount: float
    monthly_cet: float; annual_cet: float; monthly_interest_rate: float; annual_interest_rate: float
    minimum_down_payment: float
    approximate_daily_retention: Optional[float] = None
@dataclass(frozen=True)
class RefinancingWithoutCpfOption:   # mesmos campos, com a faixa refinanciável no lugar da entrada mínima
    requested_amount: float; term: int; installment_amount: float
    tac_amount: float; boleto_amount: float; insurance_amount: float; iof_amount: float; iof_rate: float
    total_credit_amount: float; total_debt_amount: float
    monthly_cet: float; annual_cet: float; monthly_interest_rate: float; annual_interest_rate: float
    minimum_amount: float; maximum_amount: float
    approximate_daily_retention: Optional[float] = None

# Simulação consultada (get e list): outro formato; quase todos os campos são Optional
@dataclass(frozen=True)
class Simulation:
    simulation_id: str
    term; installment_amount; requested_amount; down_payment; asset_amount; tac_amount
    negotiated_interest_rate; registration_amount; state
    type: SimulationType       # FINANCING | REFINANCING | AMOUNT_SIMULATION | UNKNOWN (type_name guarda o texto)
    transaction: Optional[SimulationTransaction]   # total_credit, total_debit
    interest: Optional[SimulationRates]            # monthly_rate, annual_rate
    cet: Optional[SimulationRates]
    iof: Optional[SimulationIof]                   # amount, rate
    vehicle: Optional[SimulationVehicle]           # brand, model, version, year, value, license_plate, is_zero_km, chassis, renavam, color
    customer_cpf: Optional[str]; created_at: Optional[datetime]
```

## Interface

```python
class SimulationsClient:   # client.simulations
    def get_financing_range(self, license_plate: str, store_cnpj: str) -> list[FinancingRangeOption]: ...     # GET v2/proposal/simulation/range/financing
    def get_refinancing_range(self, license_plate: str, store_cnpj: str) -> list[RefinancingRangeOption]: ... # GET v2/proposal/simulation/range/refinancing
    def create_financing(self, request: CreateFinancingSimulationRequest) -> list[SimulationOption]: ...       # POST v2/proposal/simulation/financing
    def create_refinancing(self, request: CreateRefinancingSimulationRequest) -> list[SimulationOption]: ...   # POST v2/proposal/simulation/refinancing
    def get(self, simulation_id: Identifier) -> Simulation: ...                                                # GET v1/proposal/simulation/{id}
    def list(self, request: Optional[ListRequest] = None) -> PagedResult[Simulation]: ...                      # GET v1/proposal/simulation

class V1SimulationsClient:  # client.v1.simulations: rotas v1, sem store_cnpj
    def get_financing_range(self, license_plate: str) -> list[FinancingRangeOption]: ...
    def get_refinancing_range(self, license_plate: str) -> list[RefinancingRangeOption]: ...
    def create_financing(self, request: CreateFinancingSimulationV1Request) -> list[SimulationOption]: ...
    def create_refinancing(self, request: CreateRefinancingSimulationV1Request) -> list[SimulationOption]: ...
    def create_financing_without_cpf(self, request: CreateFinancingWithoutCpfRequest) -> list[FinancingWithoutCpfOption]: ...      # POST v1/proposal/simulation/financing/without-cpf
    def create_refinancing_without_cpf(self, request: CreateRefinancingWithoutCpfRequest) -> list[RefinancingWithoutCpfOption]: ...  # POST v1/proposal/simulation/refinancing/without-cpf
```

## Features

- Consulte a faixa (`get_financing_range`, `get_refinancing_range`) antes de simular: ela diz a entrada mínima ou o valor refinanciável de cada prazo.
- O SDK envia a `Idempotency-Key` das simulações sozinho (a mesma em todas as tentativas); você não passa chave.
- Use o `simulation_id` da opção escolhida em `client.proposals.create`. Cada opção gera **uma única proposta** e expira.
- As rotas v1 (`client.v1.simulations`) não têm `store_cnpj`: a loja de integração é a vinculada ao parceiro. Prefira as rotas v2; use a v1 só em integrações antigas. Numa integração v1, crie e consulte a proposta por `client.v1.proposals`.
- **Simulação rápida sem CPF** (`create_financing_without_cpf` e `create_refinancing_without_cpf`, só em `v1`): calcula as parcelas só com placa, valor do veículo (ou valor solicitado) e UF, sem cliente cadastrado e na loja de integração do parceiro. Nada é gravado: as opções não têm `simulation_id` e **não servem para criar proposta** (para isso, simule com o CPF). Não usa `Idempotency-Key` e é segura para repetir. No financiamento a entrada é opcional: omitida, a API usa a entrada mínima da taxa da loja. No refinanciamento só voltam os prazos em cuja faixa o valor cabe. Cada opção traz `minimum_down_payment` (financiamento) ou `minimum_amount` e `maximum_amount` (refinanciamento).
- `get` e `list` devolvem `Simulation` (consulta), formato diferente de `SimulationOption`. `list` usa paginação explícita (`PagedResult[Simulation]`).
- Mostre o CET (`monthly_cet`, `annual_cet`) ao cliente: é o número certo para comparar opções.

## Exemplo
(Fonte: `examples/python/simulations.py`)

```python
faixa = client.simulations.get_financing_range("ABC1D23", "11.222.333/0001-81")

opcoes = client.simulations.create_financing(
    CreateFinancingSimulationRequest(
        cpf="12345678909", license_plate="ABC1D23", vehicle_amount=45000, down_payment=5000,
        state="SP", is_zero_km=False, store_cnpj="11.222.333/0001-81",
    )
)
escolhida = next((o for o in opcoes if o.term == 48), None)   # escolhida.simulation_id cria a proposta

# Rota v1: sem store_cnpj
opcoes_v1 = client.v1.simulations.create_refinancing(
    CreateRefinancingSimulationV1Request(cpf="12345678909", license_plate="ABC1D23", requested_amount=20000)
)

# Sem CPF: só placa, valor e UF. Nada é gravado e a opção não tem simulation_id (não cria proposta)
sem_cpf = client.v1.simulations.create_financing_without_cpf(
    CreateFinancingWithoutCpfRequest(license_plate="ABC1D23", vehicle_amount=45000, state="SP")
)
refin_sem_cpf = client.v1.simulations.create_refinancing_without_cpf(
    CreateRefinancingWithoutCpfRequest(license_plate="ABC1D23", requested_amount=20000, state="SP")
)
```

## Erros e casos de borda

- O cliente precisa estar cadastrado: senão `404 Customer.Account.NotFound`.
- `store_cnpj` precisa estar vinculado ao parceiro: `404 Store.Integration.NotFound`; loja com intermediação: `422 Store.Integration.Intermediation`.
- Financiamento: nenhum prazo aceita a entrada: `422 Proposal.DownPaymentInvalid`. Consulte `get_financing_range` antes.
- Refinanciamento: `requested_amount` fora da faixa: `422 Proposal.RequestAmountInvalid` ou `Simulation.Refinancing.AmountOutOfRange`; UF não identificada: `422 Simulation.Refinancing.UfUnavailable`.
- Sem prazos para o veículo: `422 Simulation.Terms.Unavailable`.
- `get` de simulação de outro parceiro: `404 Simulation.Access.NotFound`.
- Simulação sem CPF: `400` `Validation.Field.Required` (UF ausente), `Validation.Uf.Invalid` e `Validation.LicensePlate.Invalid`; `403`; `404` `Store.Integration.NotFound` e `Fipe.VehiclePlateNotFound`; `422` `Proposal.DownPaymentInvalid` (entrada abaixo do mínimo), `Proposal.RequestAmountInvalid` (valor fora da faixa), `Store.Integration.Intermediation` e `Simulation.Terms.Unavailable`. Não há `404 Customer.Account.NotFound` nem conflito de `Idempotency-Key`: não há cliente nem chave.
- Todos os `422` chegam como `CredicarroBusinessRuleError`; trate pelo `error_code`.
- `409 Proposal.SimulationIdempotencyConflict` indica chave reusada com outro corpo; como o SDK gera a chave por chamada, só aparece se você desligar `disable_automatic_idempotency_key` e reaproveitar chaves por conta própria.
- `Simulation.type` pode vir como `SimulationType.UNKNOWN` se a API ganhar um tipo novo; não lance erro.
- Campos de `Simulation` podem ser `None`: não assuma que `vehicle`, `iof` ou `cet` estão sempre presentes.
