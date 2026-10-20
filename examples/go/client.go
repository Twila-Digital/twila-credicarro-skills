// Cliente: instalação, configuração por variáveis de ambiente, paginação e tratamento de erros com o SDK Go do Credicarro.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"

	credicarro "github.com/Twila-Digital/twila-credicarro-go-sdk"
)

// newCredicarroClient cria o cliente a partir das variáveis de ambiente. Crie UM por processo e reaproveite-o:
// ele guarda o token em cache e o estado do circuit breaker, e é seguro para uso concorrente.
// CREDICARRO_ENVIRONMENT: "staging" ou "production" (padrão do SDK).
func newCredicarroClient() (*credicarro.Client, error) {
	environment := credicarro.EnvironmentProduction
	if os.Getenv("CREDICARRO_ENVIRONMENT") == "staging" {
		environment = credicarro.EnvironmentStaging
	}

	// Os padrões de resiliência já servem. Ajuste só com motivo.
	resilience := credicarro.DefaultResilienceOptions()
	resilience.MaxRetryAttempts = 3

	// Devolve *credicarro.ConfigurationError se faltar credencial (a mensagem nunca traz o valor).
	return credicarro.NewClient(credicarro.ClientOptions{
		ClientID:     os.Getenv("CREDICARRO_CLIENT_ID"),
		ClientSecret: os.Getenv("CREDICARRO_CLIENT_SECRET"),
		Environment:  environment,
		Resilience:   &resilience,
		// HTTPClient: opcional (proxy, transporte próprio). O SDK usa uma cópia e sempre desliga os redirects.
	})
}

// listAllProposals pagina manualmente: PageSize de 1 a 100; siga enquanto HasNext for true.
func listAllProposals(ctx context.Context, client *credicarro.Client) ([]credicarro.ProposalSummary, error) {
	var all []credicarro.ProposalSummary

	for page := 1; ; page++ {
		result, err := client.Proposals.List(ctx, &credicarro.ListRequest{Page: page, PageSize: 100})
		if err != nil {
			return nil, err
		}
		all = append(all, result.Items...)
		if !result.HasNext {
			return all, nil
		}
	}
}

// createProposalHandlingErrors mostra a hierarquia de erros: erros são valores; use errors.As do mais específico ao mais genérico.
// Registre só dados não sensíveis (Detail e Body podem repetir dados pessoais enviados).
func createProposalHandlingErrors(ctx context.Context, client *credicarro.Client, cpf, simulationID string) (string, error) {
	proposalID, err := client.Proposals.Create(ctx, credicarro.CreateProposalRequest{Cpf: cpf, SimulationID: simulationID})
	if err == nil {
		return proposalID, nil
	}

	var rule *credicarro.BusinessRuleError
	var rateLimit *credicarro.RateLimitError
	var apiErr *credicarro.APIError
	var timeout *credicarro.TimeoutError
	var auth *credicarro.AuthenticationError

	switch {
	case errors.As(err, &rule) && rule.ErrorCode == "Proposal.SimulationAlreadyExpired":
		return "", nil // refaça a simulação
	case errors.As(err, &rateLimit):
		log.Printf("Limite de requisições | Aguardar: %s", rateLimit.RetryAfter)
	case errors.As(err, &apiErr): // também captura ValidationError e BusinessRuleError
		log.Printf("Erro da API | Status: %d | Codigo: %s | Campo: %s", apiErr.StatusCode, apiErr.ErrorCode, apiErr.Field)
	case errors.As(err, &timeout): // falha de rede, timeout, ou circuit breaker aberto (causa sanitizada)
		log.Printf("Falha de rede, timeout ou circuit breaker aberto | Erro: %T", err)
	case errors.As(err, &auth):
		log.Printf("Credenciais rejeitadas | Status: %d | Codigo: %s", auth.StatusCode, auth.ErrorCode)
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		// o cancelamento do contexto do chamador volta como está, nunca como TimeoutError
	}
	return "", err
}

func printFirstPage(ctx context.Context, client *credicarro.Client) {
	page, err := client.Proposals.List(ctx, nil) // nil = primeira página, 10 itens
	if err != nil {
		log.Fatalf("listar propostas: %T", err)
	}
	for _, proposal := range page.Items {
		fmt.Println(proposal.ID, proposal.Number, proposal.StatusName)
	}
}
