// Propostas: criação, consulta, pendências do integrador e envio de documentos com o SDK Twila.Credicarro.
using Credicarro;
using Credicarro.Proposals.Models;

namespace CredicarroExamples;

// Um envio de documento pendente. Persista este registro (banco, fila) ANTES de chamar a API:
// a IdempotencyKey é um UUID por envio, guardado junto dele, e só é reaproveitada nas retentativas desse mesmo envio.
public sealed record PendingUpload(
    Guid ProposalId, ProposalParticipant Participant, DocumentType DocumentType, string FilePath, string IdempotencyKey)
{
    // Envio novo: UUID novo. Na correção (etapa DocumentCorrection), crie OUTRO PendingUpload: nunca reaproveite a chave anterior
    // e nunca derive a chave de proposta/participante/tipo (a mesma chave com outro arquivo responde 409 Idempotency.KeyConflict).
    public static PendingUpload Create(Guid proposalId, ProposalParticipant participant, DocumentType type, string filePath) =>
        new(proposalId, participant, type, filePath, Guid.NewGuid().ToString());
}

// Fila do SEU sistema (banco, mensageria). O despachante só enfileira o que está pendente; quem trata cada item
// busca os dados no seu cadastro (veículo, conta bancária, arquivos), nunca em valores literais no código.
public interface IPendingActionQueue
{
    Task EnqueueAsync(Guid proposalId, PendingAction action, CancellationToken cancellationToken);
}

public static class ProposalsExample
{
    // A proposta nasce da opção de simulação escolhida (cada opção gera uma única proposta).
    // O SDK envia a Idempotency-Key sozinho.
    public static Task<Guid> CreateAsync(ICredicarroClient client, string cpf, Guid simulationId, CancellationToken ct) =>
        client.Proposals.CreateAsync(new CreateProposalRequest(cpf, simulationId), ct);

    // GetPendingActions() lista só o que cabe ao integrador (ActionOwner == Integrator).
    // Este método NÃO envia nada: apenas enfileira cada pendência. SendDocuments e CorrectDocuments trazem os tipos em
    // DocumentTypes (os Pending ou os Invalid; o motivo da recusa está em ProposalDocument.Reason).
    public static async Task DispatchPendingActionsAsync(
        ICredicarroClient client, Guid proposalId, IPendingActionQueue queue, CancellationToken ct)
    {
        var proposal = await client.Proposals.GetAsync(proposalId, ct);

        foreach (var action in proposal.GetPendingActions())
            await queue.EnqueueAsync(proposalId, action, ct);
    }

    // O mesmo vale para o webhook detalhado (evt.IsDetailed): evt.GetPendingActions() aplica a mesma regra sem outra consulta.
    // No evento simples a lista vem vazia: consulte a proposta, como acima.

    // Funções de envio: os dados chegam como parâmetros, vindos do sistema do integrador.
    public static Task SendVehicleDetailsAsync(ICredicarroClient client, Guid proposalId, VehicleDetails vehicle, CancellationToken ct) =>
        client.Proposals.SendVehicleDetailsAsync(proposalId, vehicle, ct);

    // Só refinanciamento; o titular precisa ser o cliente da proposta.
    public static Task SendDepositAccountAsync(ICredicarroClient client, Guid proposalId, DepositAccount account, CancellationToken ct) =>
        client.Proposals.SendDepositAccountAsync(proposalId, account, ct);

    // A chave vem do registro do envio, não de uma regra determinística. O SDK repete a chamada com a mesma chave.
    // O arquivo é lido uma vez e o mesmo byte[] serve a todas as tentativas.
    public static Task UploadAsync(ICredicarroClient client, PendingUpload upload, CancellationToken ct) =>
        client.Proposals.UploadDocumentAsync(
            upload.ProposalId,
            new ProposalDocumentUpload(upload.Participant, upload.DocumentType, DocumentFile.FromFile(upload.FilePath)),
            idempotencyKey: upload.IdempotencyKey,
            cancellationToken: ct);

    // Valores desconhecidos da API viram Unknown e preservam o original em ...Raw/...Name: não quebre num switch.
    public static void Print(ProposalDetails proposal)
    {
        Console.WriteLine($"{proposal.Number}: {proposal.Status} ({proposal.StatusRaw} {proposal.StatusName})");

        if (proposal.Buyer?.ActiveStep is { } step)
            Console.WriteLine($"Comprador: etapa {step.Step} / {step.Situation} / responsável {step.ActionOwner}");
    }

    // Rotas v1 (formato resumido, para integrações antigas).
    public static async Task<ProposalSummary> CreateAndGetV1Async(ICredicarroClient client, string cpf, Guid simulationId, CancellationToken ct)
    {
        var id = await client.V1.Proposals.CreateAsync(new CreateProposalRequest(cpf, simulationId), ct);
        return await client.V1.Proposals.GetAsync(id, ct);
    }
}
