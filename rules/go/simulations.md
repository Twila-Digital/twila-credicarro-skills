# Simulações (Go)

`SimulationsClient` (como `client.Simulations`) consulta as faixas e cria simulações de financiamento e de refinanciamento. A resposta traz **uma opção por prazo elegível**; a opção escolhida pelo cliente vira a proposta. As rotas v1 (sem `cnpjLoja`) ficam em `client.V1.Simulations`.

## Structs e tipos

```go
type FinancingRangeOption struct { Term int; MinimumDownPayment float64 }                    // prazo, valor_minimo_entrada
type RefinancingRangeOption struct { Term int; MinimumAmount, MaximumAmount float64 }         // valor_minimo_refinanciavel / valor_maximo_refinanciavel

type CreateFinancingSimulationRequest struct {
    Cpf, LicensePlate string
    VehicleAmount, DownPayment float64 // DownPayment: zero quando não há entrada; menor que VehicleAmount
    State string                       // uf do registro do veículo
    IsZeroKm bool
    CommissionReturn *int              // retornoComissao: opcional, nil usa a taxa padrão
    StoreCnpj string                   // formatado ou só números
}
type CreateRefinancingSimulationRequest struct {
    Cpf, LicensePlate string; RequestedAmount float64
    CommissionReturn *int // retornoComissao: opcional
    StoreCnpj string
}

type CommissionReturnType int    // CommissionReturnTypeFinancing=1, Refinancing=2, Unknown=-1
type CommissionReturnTarget int  // CommissionReturnTargetStore=1, Organization=2, Unknown=-1
type CommissionReturn struct {
    Type CommissionReturnType; Target CommissionReturnTarget
    MinimumReturn, MaximumReturn int
    AllowDefaultRate bool // loja aceita simular sem informar CommissionReturn
}

type SimulationOption struct {
    SimulationID string
    RequestedAmount float64; Term int; InstallmentAmount float64
    TacAmount, BoletoAmount, InsuranceAmount, IofAmount, IofRate float64
    TotalCreditAmount, TotalDebtAmount float64
    MonthlyCet, AnnualCet, MonthlyInterestRate, AnnualInterestRate float64
    ApproximateDailyRetention *float64 // nil quando não se aplica
}

type SimulationType int // SimulationTypeFinancing=1, Refinancing=2, AmountSimulation=3, Unknown=-1
type Simulation struct {
    SimulationID string; Term int; InstallmentAmount, RequestedAmount, DownPayment, AssetAmount, TacAmount float64
    NegotiatedInterestRate, RegistrationAmount float64; State string
    Type SimulationType; TypeRaw string
    Transaction SimulationTransaction; Interest, Cet SimulationRates; Iof SimulationIof; Vehicle SimulationVehicle
    CustomerCpf, CreatedAt string
}

// Rotas v1: as mesmas requisições, sem StoreCnpj.
type V1CreateFinancingSimulationRequest struct { Cpf, LicensePlate string; VehicleAmount, DownPayment float64; State string; IsZeroKm bool }
type V1CreateRefinancingSimulationRequest struct { Cpf, LicensePlate string; RequestedAmount float64 }
```

## Métodos

```go
func (c *SimulationsClient) GetFinancingRange(ctx context.Context, licensePlate, storeCnpj string) ([]FinancingRangeOption, error)     // GET v2/proposal/simulation/range/financing
func (c *SimulationsClient) GetRefinancingRange(ctx context.Context, licensePlate, storeCnpj string) ([]RefinancingRangeOption, error) // GET v2/proposal/simulation/range/refinancing
func (c *SimulationsClient) GetCommissionReturns(ctx context.Context, storeCnpj string) ([]CommissionReturn, error) // GET v2/proposal/simulation/commission-returns
func (c *SimulationsClient) CreateFinancing(ctx context.Context, req CreateFinancingSimulationRequest, opts ...RequestOption) ([]SimulationOption, error)     // POST v2/proposal/simulation/financing
func (c *SimulationsClient) CreateRefinancing(ctx context.Context, req CreateRefinancingSimulationRequest, opts ...RequestOption) ([]SimulationOption, error) // POST v2/proposal/simulation/refinancing
func (c *SimulationsClient) Get(ctx context.Context, simulationID string) (*Simulation, error)                       // GET v1/proposal/simulation/{id}
func (c *SimulationsClient) List(ctx context.Context, req *ListRequest) (*PagedResult[Simulation], error)           // GET v1/proposal/simulation

// client.V1.Simulations
func (c *V1SimulationsClient) GetFinancingRange(ctx context.Context, licensePlate string) ([]FinancingRangeOption, error)
func (c *V1SimulationsClient) GetRefinancingRange(ctx context.Context, licensePlate string) ([]RefinancingRangeOption, error)
func (c *V1SimulationsClient) CreateFinancing(ctx context.Context, req V1CreateFinancingSimulationRequest, opts ...RequestOption) ([]SimulationOption, error)
func (c *V1SimulationsClient) CreateRefinancing(ctx context.Context, req V1CreateRefinancingSimulationRequest, opts ...RequestOption) ([]SimulationOption, error)
```

## Features

- Cadastre o cliente antes (veja [customers.md](customers.md)). No refinanciamento, o endereço fornece a UF quando a placa não a traz.
- Use as rotas v2 com `StoreCnpj` (formatado ou só números). A loja precisa estar vinculada ao parceiro e não pode ter contrato de intermediação. As rotas `client.V1.Simulations` existem para integrações antigas; use as v2.
- Financiamento: `DownPayment` pode ser `0` (campo `float64` sempre é enviado), deve ser menor que `VehicleAmount` e precisa deixar ao menos 10% do veículo para financiar. `State` tem 2 letras.
- Refinanciamento: `RequestedAmount` precisa estar dentro da faixa de `GetRefinancingRange`. Consulte a faixa antes de simular para evitar `422`.
- Mostre o CET ao cliente (`MonthlyCet` e `AnnualCet`).
- `CommissionReturn` (`retornoComissao`) é opcional: consulte a faixa aceita com `GetCommissionReturns(ctx, storeCnpj)` antes de informar um valor. `nil` usa a taxa padrão (quando a loja permitir, ver `AllowDefaultRate`). Só existe nas rotas v2.
- Guarde o `SimulationID` da opção escolhida: ele vira o `SimulationID` da proposta, e cada opção gera uma única proposta.
- **Idempotência:** o SDK envia a `Idempotency-Key` sozinho e a repete em todas as tentativas. Passe `WithIdempotencyKey` só se você persiste uma chave por operação.
- `Get` e `List` devolvem o retrato completo de simulações já criadas. `Type` vem do nome e cai em `SimulationTypeUnknown` para valor novo (o texto original fica em `TypeRaw`).

## Exemplo

(Fonte: `examples/go/simulations.go`)

```go
rangeOptions, err := client.Simulations.GetFinancingRange(ctx, "ABC1D23", "11.222.333/0001-81")
options, err := client.Simulations.CreateFinancing(ctx, credicarro.CreateFinancingSimulationRequest{
    Cpf: "12345678909", LicensePlate: "ABC1D23", VehicleAmount: 45000, DownPayment: 9000,
    State: "SP", IsZeroKm: false, StoreCnpj: "11.222.333/0001-81",
})
```

## Erros e casos de borda

- `404 Customer.Account.NotFound`: cliente sem cadastro. `404 Store.Integration.NotFound`: `StoreCnpj` inexistente ou de outro parceiro.
- `*BusinessRuleError` (`422`): `Store.Integration.Intermediation`, `Simulation.Terms.Unavailable`, `Proposal.DownPaymentInvalid`, `Proposal.RequestAmountInvalid`, `Simulation.Refinancing.AmountOutOfRange`, `Simulation.Refinancing.UfUnavailable`, `Store.CommissionReturn.NotConfigured`, `Store.CommissionReturn.OutOfRange`.
- `409 Proposal.SimulationIdempotencyConflict`: chave reutilizada com outro conteúdo.
- `*ValidationError` (`400`): `Validation.DownPayment.NotBelowVehicleAmount`, `Validation.LicensePlate.Invalid`, `Validation.Cnpj.Invalid`.
- `simulationID` que não é UUID e `licensePlate` ou `storeCnpj` vazios voltam como `*ConfigurationError`, sem chamar a API.
- `ApproximateDailyRetention` é `nil` quando não se aplica: teste antes de usar. Em `Simulation.Vehicle`, `Year`, `Value` e `IsZeroKm` também são ponteiros.
