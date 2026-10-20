// Clientes: cadastro com o SDK Twila.Credicarro.
using Credicarro;
using Credicarro.Customers.Models;

namespace CredicarroExamples;

public static class CustomersExample
{
    // Sem idempotencyKey: cria o cliente ou atualiza o cadastro se o CPF já existir (upsert).
    // Por isso o SDK NÃO repete esta chamada sozinho em caso de falha de rede.
    public static Task<Guid> UpsertCustomerAsync(ICredicarroClient client, CancellationToken ct) =>
        client.Customers.UpsertAsync(new UpsertCustomerRequest(
            Cpf: "12345678909",
            FirstName: "Maria",
            LastName: "Souza",
            Email: "maria.souza@exemplo.com.br",
            PhoneNumber: "+55 (11) 99876-5432",
            DateOfBirth: new DateTimeOffset(1990, 5, 20, 0, 0, 0, TimeSpan.FromHours(-3)),
            Address: new CustomerAddress("Av. Paulista", "Bela Vista", "São Paulo", "SP", "01311000", Number: "1578"),
            ProfessionalData: new ProfessionalData(OccupationType.Employee, 6500.00m)),
            cancellationToken: ct);

    // Com idempotencyKey: só cria. CPF já cadastrado responde 409 (Cpf.CpfAlreadyAdded). O SDK repete com a mesma chave.
    public static Task<Guid> CreateOnlyAsync(ICredicarroClient client, UpsertCustomerRequest request, string idempotencyKey, CancellationToken ct) =>
        client.Customers.UpsertAsync(request, idempotencyKey, ct);

    // Só os dados pessoais (6 campos). Só cria: CPF, e-mail ou celular repetido responde 409.
    public static Task<Guid> CreatePersonalDataOnlyAsync(ICredicarroClient client, CancellationToken ct) =>
        client.Customers.CreateAsync(new CreateCustomerRequest(
            Cpf: "12345678909",
            FirstName: "Maria",
            LastName: "Souza",
            Email: "maria.souza@exemplo.com.br",
            PhoneNumber: "+55 (11) 99876-5432",
            DateOfBirth: new DateTimeOffset(1990, 5, 20, 0, 0, 0, TimeSpan.FromHours(-3))),
            cancellationToken: ct);

    // Endereço e dados profissionais exigem cliente já cadastrado (202 sem corpo).
    public static async Task UpdateAddressAndOccupationAsync(ICredicarroClient client, string cpf, CancellationToken ct)
    {
        await client.Customers.UpsertAddressAsync(
            cpf, new CustomerAddress("Rua Augusta", "Consolação", "São Paulo", "SP", "01304001", Number: "100", Complement: "Apto 12"), cancellationToken: ct);
        await client.Customers.UpsertProfessionalDataAsync(cpf, new ProfessionalData(OccupationType.BusinessOwner, 12000m), cancellationToken: ct);
    }
}
