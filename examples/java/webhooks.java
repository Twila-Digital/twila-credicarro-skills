package br.com.parceiro.credicarro;

// Snippet de referência (SDK Java do Credicarro; o endpoint usa JDK 17+ e Spring Boot 3).
// Usa o CredicarroClient de client.java. Em um projeto real, salve cada classe em um arquivo com o nome dela.

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import twila.credicarro.CredicarroClient;
import twila.credicarro.ListRequest;
import twila.credicarro.PagedResult;
import twila.credicarro.proposals.model.PendingAction;
import twila.credicarro.proposals.model.ProposalDetails;
import twila.credicarro.webhooks.CredicarroWebhookEvent;
import twila.credicarro.webhooks.model.CreateWebhookRequest;
import twila.credicarro.webhooks.model.CreateWebhookResult;
import twila.credicarro.webhooks.model.ProposalWebhookEvent;
import twila.credicarro.webhooks.model.UpdateWebhookRequest;
import twila.credicarro.webhooks.model.Webhook;
import twila.credicarro.webhooks.model.WebhookAuthenticationType;
import twila.credicarro.webhooks.model.WebhookStatus;
import twila.credicarro.webhooks.model.WebhookType;

public final class WebhooksExample {

    private WebhooksExample() {
    }

    /**
     * Cadastra o webhook de propostas. A credencial (Base64 de usuario:senha para Basic, ou o token JWT) vem de
     * configuração. O signingSecret só aparece nesta resposta: guarde-o agora em um cofre de segredos.
     * A rota de cadastro não aceita Idempotency-Key e o SDK não a repete: antes de tentar de novo, consulte list().
     */
    public static String register(CredicarroClient client, String url, String credential) {
        CreateWebhookResult result = client.webhooks().create(CreateWebhookRequest.builder()
                .type(WebhookType.PROPOSAL)
                .url(url) // https público
                .authenticationType(WebhookAuthenticationType.BASIC)
                .credential(credential)
                .build());
        return result.getSigningSecret();
    }

    public static PagedResult<Webhook> list(CredicarroClient client) {
        return client.webhooks().list(ListRequest.of(1, 20)); // não devolve credencial nem segredo
    }

    /** Troca tipo, URL e status; a autenticação não muda (para trocá-la, exclua e cadastre outro). */
    public static void deactivate(CredicarroClient client, UUID webhookId, String url) {
        client.webhooks().update(webhookId, UpdateWebhookRequest.builder()
                .type(WebhookType.PROPOSAL)
                .url(url)
                .status(WebhookStatus.INACTIVE)
                .build());
    }

    public static void remove(CredicarroClient client, UUID webhookId) {
        client.webhooks().delete(webhookId);
    }
}

/** O cliente do Credicarro como bean singleton, fechado no shutdown da aplicação. */
@Configuration
class CredicarroConfiguration {
    @Bean(destroyMethod = "close")
    CredicarroClient credicarroClient() {
        return ClientExample.create();
    }
}

@RestController
class CredicarroWebhookController {
    private static final int MAX_BODY = 1024 * 1024; // a Credicarro só confirma respostas/corpos de até 1 MiB

    private final String secret;
    private final String expectedAuthorization; // opcional: valor completo do header Authorization (Basic/Bearer)
    private final CredicarroClient client;
    // Produção: deduplicação em Redis/banco com TTL, não em memória.
    private final Set<String> seen = ConcurrentHashMap.newKeySet();
    // Fila limitada: quando enche, o execute lança RejectedExecutionException e respondemos 503.
    private final ThreadPoolExecutor worker =
            new ThreadPoolExecutor(4, 4, 0L, TimeUnit.SECONDS, new ArrayBlockingQueue<>(1000));

    CredicarroWebhookController(CredicarroClient client) {
        this.secret = System.getenv("CREDICARRO_WEBHOOK_SECRET");
        if (secret == null || secret.trim().isEmpty()) { // falha na inicialização: nunca valide com segredo vazio
            throw new IllegalStateException("Variável de ambiente ausente: CREDICARRO_WEBHOOK_SECRET");
        }
        this.expectedAuthorization = System.getenv("CREDICARRO_WEBHOOK_AUTHORIZATION");
        this.client = client;
    }

    @PostMapping("/webhooks/credicarro")
    ResponseEntity<Void> receive(HttpServletRequest request, // sem @RequestBody: o Spring não lê o corpo por nós
                                 @RequestHeader(value = "X-CrediCarro-Signature", required = false) String signature,
                                 @RequestHeader(value = "Idempotency-Key", required = false) String key,
                                 @RequestHeader(value = "Authorization", required = false) String authorization)
            throws IOException {
        // 1) Rejeita logo pelo Content-Length (-1 = desconhecido, ex.: chunked).
        if (request.getContentLengthLong() > MAX_BODY) return ResponseEntity.status(413).build();
        // 2) Autenticação por header (Basic/JWT do cadastro), antes de ler qualquer byte do corpo.
        if (expectedAuthorization != null && !expectedAuthorization.trim().isEmpty()
                && !CredicarroWebhookEvent.verifyAuthorization(authorization, expectedAuthorization)) { // tempo constante
            return ResponseEntity.status(401).build();
        }
        // 3) Leitura limitada: no máximo 1 MiB + 1 byte, mesmo com chunked ou Content-Length mentiroso.
        byte[] bytes;
        try (InputStream in = request.getInputStream()) {
            bytes = in.readNBytes(MAX_BODY + 1);
        }
        if (bytes.length > MAX_BODY) return ResponseEntity.status(413).build();
        // 4) Assinatura contra o corpo bruto, antes de desserializar. O SDK confere HMAC-SHA256 em tempo constante
        //    e a janela de 5 minutos; segredo vazio nunca valida.
        String rawBody = new String(bytes, StandardCharsets.UTF_8);
        if (!CredicarroWebhookEvent.verifySignature(rawBody, signature, secret)) {
            return ResponseEntity.status(401).build();
        }
        // 5) Deduplica pela Idempotency-Key da entrega.
        if (key != null && !seen.add(key)) return ResponseEntity.noContent().build(); // entrega repetida
        try {
            worker.execute(() -> process(rawBody)); // só responde 2xx depois de enfileirar; limite de 15 s por entrega
        } catch (RejectedExecutionException e) {
            if (key != null) seen.remove(key);
            return ResponseEntity.status(503).build(); // a Credicarro retenta
        }
        return ResponseEntity.noContent().build();
    }

    private void process(String rawBody) {
        String id = "desconhecida";
        try {
            // Já verificado acima: aqui basta ler o evento, sem checar a assinatura de novo.
            ProposalWebhookEvent event = CredicarroWebhookEvent.parseUnverified(rawBody);
            id = String.valueOf(event.getProposalId());
            // Entregas podem chegar fora de ordem: consulte a proposta para o estado mais recente.
            ProposalDetails current = client.proposals().get(event.getProposalId());
            for (PendingAction action : current.getPendingActions()) {
                System.out.println(action.getParticipant() + " -> " + action.getKind());
            }
        } catch (Exception e) {
            // Só o id da proposta e o tipo do erro: nada de payload, CPF, token ou segredo.
            System.err.println("Falha ao processar webhook | proposta: " + id + " | erro: " + e.getClass().getSimpleName());
        }
    }
}
