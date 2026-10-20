// Propostas: criação, consulta, pendências do integrador e envio de documentos com o SDK Go do Credicarro.
package main

import (
	"context"
	"crypto/rand"
	"fmt"

	credicarro "github.com/Twila-Digital/twila-credicarro-go-sdk"
)

// pendingUpload é um envio de documento pendente. Persista este registro (banco, fila) ANTES de chamar a API:
// IdempotencyKey é um UUID por envio, guardado junto dele, e só é reaproveitado nas retentativas desse mesmo envio.
type pendingUpload struct {
	ProposalID     string
	Participant    credicarro.ProposalParticipant
	DocumentType   credicarro.DocumentType
	FilePath       string
	IdempotencyKey string
}

// newPendingUpload cria um envio com UUID novo. Na correção (etapa DocumentCorrection), crie OUTRO pendingUpload:
// nunca reaproveite a chave anterior e nunca derive a chave de proposta/participante/tipo
// (a mesma chave com outro arquivo responde 409 Idempotency.KeyConflict).
func newPendingUpload(proposalID string, participant credicarro.ProposalParticipant, documentType credicarro.DocumentType, filePath string) pendingUpload {
	return pendingUpload{
		ProposalID: proposalID, Participant: participant, DocumentType: documentType,
		FilePath: filePath, IdempotencyKey: newUUID(),
	}
}

// newUUID gera um UUID v4 (use github.com/google/uuid se já for dependência do seu projeto).
func newUUID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

// createProposal: a proposta nasce da opção de simulação escolhida (cada opção gera uma única proposta).
// O SDK envia a Idempotency-Key sozinho.
func createProposal(ctx context.Context, client *credicarro.Client, cpf, simulationID string) (string, error) {
	return client.Proposals.Create(ctx, credicarro.CreateProposalRequest{Cpf: cpf, SimulationID: simulationID})
}

// pendingActionHandlers reúne as funções de envio do SEU sistema. O despachante não conhece nenhum dado:
// cada função busca no banco/fila do integrador o que precisa (veículo, conta, arquivo por participante e tipo,
// pendingUpload persistido) e devolve ok=false quando ainda não tem o dado.
type pendingActionHandlers struct {
	FindUpload  func(proposalID string, participant credicarro.ProposalParticipant, documentType credicarro.DocumentType) (pendingUpload, bool)
	VehicleData func(proposalID string) (credicarro.VehicleDetails, bool)
	DepositData func(proposalID string) (credicarro.DepositAccount, bool)
}

// processPendingActions: PendingActions() lista só o que cabe ao integrador (ActionOwner == Integrator).
func processPendingActions(ctx context.Context, client *credicarro.Client, proposalID string, handlers pendingActionHandlers) error {
	proposal, err := client.Proposals.Get(ctx, proposalID)
	if err != nil {
		return err
	}

	for _, action := range proposal.PendingActions() {
		switch action.Kind {
		case credicarro.PendingActionSendDocuments, credicarro.PendingActionCorrectDocuments:
			// Na correção, DocumentTypes são os Invalid; o motivo está em ProposalDocumentState.Reason.
			for _, documentType := range action.DocumentTypes {
				if upload, ok := handlers.FindUpload(proposalID, action.Participant, documentType); ok {
					if err := uploadDocument(ctx, client, upload); err != nil {
						return err
					}
				}
			}
		case credicarro.PendingActionSendVehicleDetails:
			if details, ok := handlers.VehicleData(proposalID); ok {
				err = client.Proposals.SendVehicleDetails(ctx, proposalID, details)
			}
		case credicarro.PendingActionSendDepositAccount: // só refinanciamento; o titular precisa ser o cliente
			if account, ok := handlers.DepositData(proposalID); ok {
				err = client.Proposals.SendDepositAccount(ctx, proposalID, account)
			}
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// uploadDocument usa a chave guardada no registro do envio, não uma regra determinística.
// O SDK repete a chamada com a mesma chave.
func uploadDocument(ctx context.Context, client *credicarro.Client, upload pendingUpload) error {
	file, err := credicarro.NewDocumentFileFromFile(upload.FilePath, "") // *ConfigurationError se nome, extensão ou tamanho forem inválidos
	if err != nil {
		return err
	}

	return client.Proposals.UploadDocument(ctx, upload.ProposalID, credicarro.ProposalDocumentUpload{
		Participant:  upload.Participant,
		DocumentType: upload.DocumentType,
		File:         file,
	}, credicarro.WithIdempotencyKey(upload.IdempotencyKey))
}

// printProposal: valores desconhecidos da API viram ...Unknown e preservam o original em ...Raw/...Name.
func printProposal(proposal *credicarro.ProposalDetails) {
	fmt.Printf("%d: %v (%d %s)\n", proposal.Number, proposal.Status, proposal.StatusRaw, proposal.StatusName)

	if buyer := proposal.Buyer; buyer != nil && buyer.ActiveStep != nil {
		fmt.Printf("Comprador: etapa %v / %v / responsável %v\n", buyer.ActiveStep.Step, buyer.ActiveStep.Situation, buyer.ActiveStep.ActionOwner)
	}
}

// createAndGetV1 usa as rotas v1 (formato resumido, para integrações antigas).
func createAndGetV1(ctx context.Context, client *credicarro.Client, cpf, simulationID string) (*credicarro.ProposalSummary, error) {
	id, err := client.V1.Proposals.Create(ctx, credicarro.CreateProposalRequest{Cpf: cpf, SimulationID: simulationID})
	if err != nil {
		return nil, err
	}
	return client.V1.Proposals.Get(ctx, id)
}
