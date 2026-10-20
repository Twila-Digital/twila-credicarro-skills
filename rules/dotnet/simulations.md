# Simulações (.NET)

`ISimulationsClient` (como `client.Simulations`) consulta as faixas e cria simulações de financiamento e de refinanciamento. A resposta traz **uma opção por prazo elegível**; a opção escolhida pelo cliente vira a proposta. As rotas v1 (sem `cnpjLoja`) ficam em `client.V1.Simulations`.

## Modelos

```csharp
public sealed record FinancingRangeOption(int Term, decimal MinimumDownPayment);                         // prazo, valor_minimo_entrada
public sealed record RefinancingRangeOption(int Term, decimal MinimumAmount, decimal MaximumAmount);   // valor_minimo_refinanciavel / valor_maximo_refinanciavel

public sealed record CreateFinancingSimulationRequest(string Cpf, string LicensePlate, decimal VehicleAmount,
    decimal DownPayment, string State, bool IsZeroKm, string StoreCnpj);
    // cpf, placa, valorVeiculo, valorEntrada, uf, isVeiculoZeroKm, cnpjLoja
public sealed record CreateRefinancingSimulationRequest(string Cpf, string LicensePlate, decimal RequestedAmount, string StoreCnpj);
    // cpf, placa, valorSolicitado, cnpjLoja

public sealed record SimulationOption(Guid SimulationId, decimal RequestedAmount, int Term, decimal InstallmentAmount,
    decimal TacAmount, decimal BoletoAmount, decimal InsuranceAmount, decimal IofAmount, decimal IofRate,
    decimal TotalCreditAmount, decimal TotalDebtAmount, decimal MonthlyCet, decimal AnnualCet,
    decimal MonthlyInterestRate, decimal AnnualInterestRate, decimal? ApproximateDailyRetention);

public enum SimulationType { Financing = 1, Refinancing = 2, AmountSimulation = 3, Unknown = -1 }
public sealed record Simulation(Guid SimulationId, int Term, decimal InstallmentAmount, decimal RequestedAmount,
    decimal DownPayment, decimal AssetAmount, decimal TacAmount, decimal NegotiatedInterestRate, decimal RegistrationAmount,
    string? State, SimulationType Type, SimulationTransaction? Transaction, SimulationInterest? Interest, SimulationCet? Cet,
    SimulationIof? Iof, SimulationVehicle? Vehicle, string? CustomerCpf, DateTimeOffset? CreatedAt);

// Rotas v1 (namespace Credicarro.V1.Models): as mesmas requisições, sem StoreCnpj.
public sealed record CreateFinancingSimulationV1Request(string Cpf, string LicensePlate, decimal VehicleAmount,
    decimal DownPayment, string State, bool IsZeroKm);
public sealed record CreateRefinancingSimulationV1Request(string Cpf, string LicensePlate, decimal RequestedAmount);
```

## Interface

```csharp
public interface ISimulationsClient
{
    Task<IReadOnlyList<FinancingRangeOption>> GetFinancingRangeAsync(string licensePlate, string storeCnpj, CancellationToken cancellationToken = default);     // GET v2/proposal/simulation/range/financing
    Task<IReadOnlyList<RefinancingRangeOption>> GetRefinancingRangeAsync(string licensePlate, string storeCnpj, CancellationToken cancellationToken = default); // GET v2/proposal/simulation/range/refinancing
    Task<IReadOnlyList<SimulationOption>> CreateFinancingAsync(CreateFinancingSimulationRequest request, CancellationToken cancellationToken = default);       // POST v2/proposal/simulation/financing
    Task<IReadOnlyList<SimulationOption>> CreateRefinancingAsync(CreateRefinancingSimulationRequest request, CancellationToken cancellationToken = default);   // POST v2/proposal/simulation/refinancing
    Task<Simulation> GetAsync(Guid simulationId, CancellationToken cancellationToken = default);                       // GET v1/proposal/simulation/{id}
    Task<PagedResult<Simulation>> ListAsync(ListRequest? request = null, CancellationToken cancellationToken = default); // GET v1/proposal/simulation
}

public interface IV1SimulationsClient   // client.V1.Simulations
{
    Task<IReadOnlyList<FinancingRangeOption>> GetFinancingRangeAsync(string licensePlate, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<RefinancingRangeOption>> GetRefinancingRangeAsync(string licensePlate, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<SimulationOption>> CreateFinancingAsync(CreateFinancingSimulationV1Request request, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<SimulationOption>> CreateRefinancingAsync(CreateRefinancingSimulationV1Request request, CancellationToken cancellationToken = default);
}
```

## Features

- Cadastre o cliente antes (veja [customers.md](customers.md)). No refinanciamento, o endereço fornece a UF quando a placa não a traz.
- Use as rotas v2 com `StoreCnpj` (formatado ou só números). A loja precisa estar vinculada ao parceiro e não pode ter contrato de intermediação. As rotas `client.V1.Simulations` existem para integrações antigas; use as v2.
- Financiamento: `DownPayment` pode ser `0`, deve ser menor que `VehicleAmount` e precisa deixar ao menos 10% do veículo para financiar. `State` tem 2 letras.
- Refinanciamento: `RequestedAmount` precisa estar dentro da faixa de `GetRefinancingRangeAsync`. Consulte a faixa antes de simular para evitar `422`.
- Mostre o CET ao cliente (`MonthlyCet` e `AnnualCet`).
- Guarde o `SimulationId` da opção escolhida: ele vira o `SimulationId` da proposta, e cada opção gera uma única proposta.
- **Idempotência:** o SDK envia a `Idempotency-Key` sozinho e a repete em todas as tentativas. Não gere a sua.
- `ListAsync` e `GetAsync` devolvem o retrato completo de simulações já criadas (`Simulation`). `Type` vem do nome e cai em `SimulationType.Unknown` para valor novo.

## Exemplo

(Fonte: `examples/dotnet/simulations.cs`)

```csharp
var range = await client.Simulations.GetFinancingRangeAsync("ABC1D23", "11.222.333/0001-81", ct);
var options = await client.Simulations.CreateFinancingAsync(new CreateFinancingSimulationRequest(
    Cpf: "12345678909", LicensePlate: "ABC1D23", VehicleAmount: 45000m, DownPayment: 9000m,
    State: "SP", IsZeroKm: false, StoreCnpj: "11.222.333/0001-81"), ct);
var chosen = options.OrderBy(o => o.InstallmentAmount).First();
```

## Erros e casos de borda

- `404 Customer.Account.NotFound`: cliente sem cadastro. `404 Store.Integration.NotFound`: `StoreCnpj` inexistente ou de outro parceiro.
- `CredicarroBusinessRuleException` (`422`): `Store.Integration.Intermediation`, `Simulation.Terms.Unavailable`, `Proposal.DownPaymentInvalid`, `Proposal.RequestAmountInvalid`, `Simulation.Refinancing.AmountOutOfRange`, `Simulation.Refinancing.UfUnavailable`.
- `409 Proposal.SimulationIdempotencyConflict`: chave reutilizada com outro conteúdo.
- `CredicarroValidationException` (`400`): `Validation.DownPayment.NotBelowVehicleAmount`, `Validation.LicensePlate.Invalid`, `Validation.Cnpj.Invalid`.
- `ApproximateDailyRetention` é `null` quando não se aplica: mantenha o campo nulo.
- Em `Simulation`, `Transaction`, `Interest`, `Cet`, `Iof` e `Vehicle` podem vir `null`; teste antes de acessar.
