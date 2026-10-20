package br.com.parceiro.credicarro;

// Snippet de referência (SDK Java do Credicarro). Usa o CredicarroClient de client.java.
// Em um projeto real, salve cada tipo em um arquivo com o nome dele.

import java.nio.file.Path;
import java.util.UUID;
import twila.credicarro.CredicarroClient;
import twila.credicarro.ListRequest;
import twila.credicarro.PagedResult;
import twila.credicarro.proposals.model.CreateProposalRequest;
import twila.credicarro.proposals.model.DepositAccount;
import twila.credicarro.proposals.model.DocumentFile;
import twila.credicarro.proposals.model.DocumentType;
import twila.credicarro.proposals.model.PendingAction;
import twila.credicarro.proposals.model.ProposalDetails;
import twila.credicarro.proposals.model.ProposalDocumentUpload;
import twila.credicarro.proposals.model.ProposalParticipant;
import twila.credicarro.proposals.model.ProposalSummary;
import twila.credicarro.proposals.model.VehicleDetails;

public final class ProposalsExample {

    private ProposalsExample() {
    }

    /**
     * Um envio de documento pendente. Persista este objeto (banco/fila) ANTES de enviar: a chave é gerada
     * uma vez por envio e reaproveitada só nas retentativas dele. Na correção de um documento recusado,
     * crie um envio novo (chave nova). Nunca derive a chave do arquivo, do CPF ou do ID da proposta.
     * O arquivo é o do participante e do tipo certos, escolhido pelo sistema do integrador.
     */
    public static final class PendingUpload {
        final UUID proposalId;
        final ProposalParticipant participant;
        final DocumentType documentType;
        final Path file;
        final String idempotencyKey = UUID.randomUUID().toString();

        public PendingUpload(UUID proposalId, ProposalParticipant participant, DocumentType documentType, Path file) {
            this.proposalId = proposalId;
            this.participant = participant;
            this.documentType = documentType;
            this.file = file;
        }
    }

    /** Fila de trabalho do sistema do integrador (banco/mensageria). O despachante só enfileira. */
    public interface WorkQueue {
        void enqueue(UUID proposalId, PendingAction action);
    }

    /** O CPF vem do cadastro do cliente no sistema do integrador. */
    public static UUID create(CredicarroClient client, String customerCpf, UUID simulationId) {
        // O SDK gera uma Idempotency-Key por chamada e a reaproveita nas retentativas.
        return client.proposals().create(CreateProposalRequest.builder()
                .cpf(customerCpf)
                .simulationId(simulationId)
                .build());
    }

    public static void sendDocument(CredicarroClient client, PendingUpload pending) {
        // DocumentFile valida nome, extensão (.pdf/.jpg/.jpeg/.png) e tamanho (1 byte a 10 MiB) antes do envio.
        client.proposals().uploadDocument(pending.proposalId, ProposalDocumentUpload.builder()
                .participant(pending.participant)
                .documentType(pending.documentType)
                .file(DocumentFile.fromFile(pending.file))
                .build(), pending.idempotencyKey);
    }

    /**
     * Consulta a proposta e ENFILEIRA o que depende do integrador (ActionOwner.INTEGRATOR). Não envia nada aqui:
     * cada ação é tratada por um worker que busca os dados reais (arquivos por participante, veículo, conta) no
     * sistema do integrador e chama sendDocument, sendVehicleDetails ou sendDepositAccount.
     */
    public static void dispatchPendingActions(CredicarroClient client, UUID proposalId, WorkQueue queue) {
        ProposalDetails proposal = client.proposals().get(proposalId);

        // Compare pelo enum; valor novo da API vira UNKNOWN e o original fica em getStatusRaw()/getStatusName().
        System.out.println(proposal.getStatus() + " (" + proposal.getStatusName() + ")");

        for (PendingAction action : proposal.getPendingActions())
            queue.enqueue(proposalId, action); // SEND_DOCUMENTS, CORRECT_DOCUMENTS (chave nova), SEND_VEHICLE_DETAILS, SEND_DEPOSIT_ACCOUNT
    }

    /** Etapa VEHICLE_DETAILS. Os dados vêm do sistema do integrador. Reenviar substitui, então a repetição é segura. */
    public static void sendVehicleDetails(CredicarroClient client, UUID proposalId, VehicleDetails details) {
        client.proposals().sendVehicleDetails(proposalId, details);
    }

    /** Só refinanciamento, etapa DEPOSIT_ACCOUNT; a conta (do comprador) vem do sistema do integrador. */
    public static void sendDepositAccount(CredicarroClient client, UUID proposalId, DepositAccount account) {
        client.proposals().sendDepositAccount(proposalId, account);
    }

    public static PagedResult<ProposalSummary> list(CredicarroClient client) {
        return client.proposals().list(ListRequest.of(1, 20)); // v1: status em inglês no resumo
    }

    /** Rotas v1 (sem o retrato de etapas): create e get devolvem/recebem o resumo. */
    public static ProposalSummary createAndGetV1(CredicarroClient client, String customerCpf, UUID simulationId) {
        UUID id = client.v1().proposals().create(CreateProposalRequest.builder()
                .cpf(customerCpf)
                .simulationId(simulationId)
                .build());
        return client.v1().proposals().get(id);
    }
}
