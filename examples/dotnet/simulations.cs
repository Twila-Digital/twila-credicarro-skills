// Simulações: faixas, criação (v2 e v1), consulta e listagem com o SDK Twila.Credicarro.
using Credicarro;
using Credicarro.Simulations.Models;
using Credicarro.V1.Models;

namespace CredicarroExamples;

public static class SimulationsExample
{
    private const string StoreCnpj = "11.222.333/0001-81"; // formatado ou só números

    // Consulte a faixa antes de simular para evitar 422.
    public static async Task<IReadOnlyList<FinancingRangeOption>> FinancingRangeAsync(ICredicarroClient client, string plate, CancellationToken ct)
    {
        var range = await client.Simulations.GetFinancingRangeAsync(plate, StoreCnpj, ct);
        foreach (var option in range)
            Console.WriteLine($"{option.Term}x: entrada mínima R$ {option.MinimumDownPayment:N2}");
        return range;
    }

    public static Task<IReadOnlyList<RefinancingRangeOption>> RefinancingRangeAsync(ICredicarroClient client, string plate, CancellationToken ct) =>
        client.Simulations.GetRefinancingRangeAsync(plate, StoreCnpj, ct);

    // Faixa de retorno de comissão aceita por tipo de simulação. Consulte antes de informar CommissionReturn.
    public static Task<IReadOnlyList<CommissionReturn>> CommissionReturnsAsync(ICredicarroClient client, CancellationToken ct) =>
        client.Simulations.GetCommissionReturnsAsync(StoreCnpj, ct);

    // Uma opção por prazo elegível. O SDK envia a Idempotency-Key sozinho (a mesma em todas as tentativas).
    public static async Task<SimulationOption> SimulateFinancingAsync(ICredicarroClient client, CancellationToken ct)
    {
        var options = await client.Simulations.CreateFinancingAsync(new CreateFinancingSimulationRequest(
            Cpf: "12345678909",
            LicensePlate: "ABC1D23",
            VehicleAmount: 45000m,
            DownPayment: 9000m,
            State: "SP",
            IsZeroKm: false,
            StoreCnpj: StoreCnpj
            // CommissionReturn: 2 // opcional, dentro da faixa de GetCommissionReturnsAsync
            ), ct);

        foreach (var option in options)
            Console.WriteLine($"{option.Term}x de R$ {option.InstallmentAmount:N2} | CET a.m. {option.MonthlyCet}% | CET a.a. {option.AnnualCet}%");

        return options.OrderBy(o => o.InstallmentAmount).First(); // guarde o SimulationId da opção escolhida
    }

    public static Task<IReadOnlyList<SimulationOption>> SimulateRefinancingAsync(ICredicarroClient client, decimal requestedAmount, CancellationToken ct) =>
        client.Simulations.CreateRefinancingAsync(new CreateRefinancingSimulationRequest(
            Cpf: "12345678909",
            LicensePlate: "ABC1D23",
            RequestedAmount: requestedAmount, // dentro da faixa de GetRefinancingRangeAsync
            StoreCnpj: StoreCnpj), ct);

    public static async Task ReadAsync(ICredicarroClient client, Guid simulationId, CancellationToken ct)
    {
        var simulation = await client.Simulations.GetAsync(simulationId, ct);
        Console.WriteLine($"{simulation.Type}: {simulation.Term}x de R$ {simulation.InstallmentAmount:N2}");

        var page = await client.Simulations.ListAsync(new ListRequest(Page: 1, PageSize: 20), ct);
        Console.WriteLine($"{page.Items.Count} de {page.TotalCount} simulações (HasNext: {page.HasNext})");
    }

    // Rotas v1 (sem cnpjLoja), para integrações antigas. Prefira as rotas v2 acima.
    public static async Task<IReadOnlyList<SimulationOption>> SimulateFinancingV1Async(ICredicarroClient client, CancellationToken ct)
    {
        var range = await client.V1.Simulations.GetFinancingRangeAsync("ABC1D23", ct);
        return await client.V1.Simulations.CreateFinancingAsync(new CreateFinancingSimulationV1Request(
            Cpf: "12345678909", LicensePlate: "ABC1D23", VehicleAmount: 45000m, DownPayment: range[0].MinimumDownPayment, State: "SP", IsZeroKm: false), ct);
    }

    public static Task<IReadOnlyList<SimulationOption>> SimulateRefinancingV1Async(ICredicarroClient client, CancellationToken ct) =>
        client.V1.Simulations.CreateRefinancingAsync(
            new CreateRefinancingSimulationV1Request(Cpf: "12345678909", LicensePlate: "ABC1D23", RequestedAmount: 15000m), ct);
}
