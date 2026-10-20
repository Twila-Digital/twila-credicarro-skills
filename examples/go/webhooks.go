// Webhooks: cadastro pela API e endpoint net/http seguro, com o SDK Go do Credicarro.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sync"

	credicarro "github.com/Twila-Digital/twila-credicarro-go-sdk"
)

// maxWebhookBodyBytes limita o corpo aceito no endpoint de webhook (1 MiB).
const maxWebhookBodyBytes = 1 << 20

type webhookJob struct {
	ProposalID     string
	IdempotencyKey string
}

// webhookConfig: Secret vem de CREDICARRO_WEBHOOK_SECRET (obrigatório; sem ele a aplicação não sobe).
// ExpectedAuthorization vem de CREDICARRO_WEBHOOK_AUTHORIZATION, valor completo do header Authorization
// ("Basic ..." ou "Bearer ..."); configure quando o tipo de autenticação for Basic ou Jwt.
type webhookConfig struct {
	Secret                string
	ExpectedAuthorization string
}

func webhookConfigFromEnv() (webhookConfig, error) {
	cfg := webhookConfig{
		Secret:                os.Getenv("CREDICARRO_WEBHOOK_SECRET"),
		ExpectedAuthorization: os.Getenv("CREDICARRO_WEBHOOK_AUTHORIZATION"),
	}
	if cfg.Secret == "" {
		return cfg, errors.New("CREDICARRO_WEBHOOK_SECRET é obrigatório")
	}
	return cfg, nil
}

// registerProposalWebhook: guarde SigningSecret na hora (cofre ou variável de ambiente): ele só vem nesta resposta.
func registerProposalWebhook(ctx context.Context, client *credicarro.Client, credentialBase64 string) (*credicarro.CreateWebhookResult, error) {
	result, err := client.Webhooks.Create(ctx, credicarro.CreateWebhookRequest{
		Type:               credicarro.WebhookTypeProposal,
		URL:                "https://parceiro.com.br/webhooks/credicarro",
		AuthenticationType: credicarro.WebhookAuthenticationTypeBasic,
		Credential:         credentialBase64, // Basic: Base64 de usuario:senha; Jwt: o token
	})
	if err != nil {
		return nil, err
	}
	fmt.Println("webhook cadastrado:", result.WebhookID)
	return result, nil
}

func manageWebhooks(ctx context.Context, client *credicarro.Client) error {
	page, err := client.Webhooks.List(ctx, &credicarro.ListRequest{Page: 1, PageSize: 20})
	if err != nil {
		return err
	}

	inactive := credicarro.WebhookStatusInactive
	for _, webhook := range page.Items {
		fmt.Println(webhook.ID, webhook.TypeRaw, webhook.StatusRaw)
		if err := client.Webhooks.Update(ctx, webhook.ID, credicarro.UpdateWebhookRequest{
			Type: webhook.Type, URL: webhook.URL, Status: &inactive,
		}); err != nil {
			return err
		}
	}
	return nil
}

func deleteWebhook(ctx context.Context, client *credicarro.Client, webhookID string) error {
	return client.Webhooks.Delete(ctx, webhookID)
}

// webhookHandler valida, deduplica, enfileira e só então responde 2xx (limite de entrega de 15 s).
// O sync.Map do exemplo vale para uma instância; em produção use Redis ou banco com expiração.
func webhookHandler(cfg webhookConfig, jobs chan<- webhookJob, seen *sync.Map) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "método não permitido", http.StatusMethodNotAllowed)
			return
		}

		// 1. Authorization (Basic/Jwt) cadastrado no webhook, comparado em tempo constante pelo SDK.
		if cfg.ExpectedAuthorization != "" &&
			!credicarro.VerifyWebhookAuthorization(r.Header.Get("Authorization"), cfg.ExpectedAuthorization) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// 2. Corpo bruto, limitado a 1 MiB, antes de qualquer desserialização.
		if r.ContentLength > maxWebhookBodyBytes {
			http.Error(w, "corpo grande demais", http.StatusRequestEntityTooLarge)
			return
		}
		rawBody, err := io.ReadAll(io.LimitReader(r.Body, maxWebhookBodyBytes+1))
		if err != nil {
			http.Error(w, "corpo ilegível", http.StatusBadRequest)
			return
		}
		if len(rawBody) > maxWebhookBodyBytes {
			http.Error(w, "corpo grande demais", http.StatusRequestEntityTooLarge)
			return
		}

		// 3. Assinatura HMAC + tolerância de 5 minutos (0 = padrão do SDK) e decodificação. Inválido: 401 sem detalhes.
		event, err := credicarro.ParseWebhookEvent(rawBody, r.Header.Get("X-CrediCarro-Signature"), cfg.Secret, 0)
		if err != nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// 4. Deduplicação pelo Idempotency-Key ({id_mensagem}:{id_webhook}, igual em todas as retentativas).
		key := r.Header.Get("Idempotency-Key")
		if key != "" {
			if _, duplicate := seen.LoadOrStore(key, struct{}{}); duplicate {
				w.WriteHeader(http.StatusOK) // entrega repetida
				return
			}
		}

		// 5. Envio sem bloqueio: fila cheia responde 503 na hora e a Credicarro retenta.
		select {
		case jobs <- webhookJob{ProposalID: event.ProposalID, IdempotencyKey: key}:
			w.WriteHeader(http.StatusOK) // 2xx só depois de enfileirar
		default:
			if key != "" {
				seen.Delete(key) // desfaz a deduplicação para a retentativa
			}
			w.WriteHeader(http.StatusServiceUnavailable)
		}
	}
}

// runWebhookWorker consulta a proposta (as entregas chegam fora de ordem) e age sobre o estado mais recente.
// Falha ou pânico por job é registrado (só id e tipo do erro) e o laço segue.
func runWebhookWorker(ctx context.Context, client *credicarro.Client, jobs <-chan webhookJob) {
	for {
		select {
		case <-ctx.Done():
			return
		case job := <-jobs:
			processWebhookJob(ctx, client, job)
		}
	}
}

func processWebhookJob(ctx context.Context, client *credicarro.Client, job webhookJob) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("webhook | Proposta: %s | Pânico: %T", job.ProposalID, r)
		}
	}()

	proposal, err := client.Proposals.Get(ctx, job.ProposalID)
	if err != nil {
		log.Printf("webhook | Proposta: %s | Erro: %T", job.ProposalID, err) // sem payload nem dados pessoais
		return
	}
	for _, action := range proposal.PendingActions() {
		log.Printf("webhook | Proposta: %s | %s -> %s", proposal.ID, action.Participant, action.Kind)
	}
}

// startWebhookServer liga tudo. Falha na inicialização sem o segredo.
func startWebhookServer(ctx context.Context, client *credicarro.Client) error {
	cfg, err := webhookConfigFromEnv()
	if err != nil {
		return err
	}

	jobs := make(chan webhookJob, 1000)
	go runWebhookWorker(ctx, client, jobs)

	mux := http.NewServeMux()
	mux.Handle("/webhooks/credicarro", webhookHandler(cfg, jobs, &sync.Map{}))
	return http.ListenAndServe(":8080", mux)
}
