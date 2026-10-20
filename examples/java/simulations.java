package br.com.parceiro.credicarro;

// Snippet de referência (SDK Java do Credicarro). Usa o CredicarroClient de client.java.
// Em um projeto real, salve este arquivo como SimulationsExample.java.

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import twila.credicarro.CredicarroClient;
import twila.credicarro.ListRequest;
import twila.credicarro.PagedResult;
import twila.credicarro.simulations.model.CreateFinancingSimulationRequest;
import twila.credicarro.simulations.model.CreateRefinancingSimulationRequest;
import twila.credicarro.simulations.model.FinancingRangeOption;
import twila.credicarro.simulations.model.RefinancingRangeOption;
import twila.credicarro.simulations.model.Simulation;
import twila.credicarro.simulations.model.SimulationOption;
import twila.credicarro.v1.V1CreateFinancingSimulationRequest;

public final class SimulationsExample {

    private static final String STORE_CNPJ = "11.222.333/0001-81"; // loja de integração (formatado ou só números)

    private SimulationsExample() {
    }

    /** Prazos disponíveis e a entrada mínima de cada um, antes de simular. */
    public static List<FinancingRangeOption> financingRange(CredicarroClient client) {
        return client.simulations().getFinancingRange("ABC1D23", STORE_CNPJ);
    }

    public static List<RefinancingRangeOption> refinancingRange(CredicarroClient client) {
        return client.simulations().getRefinancingRange("ABC1D23", STORE_CNPJ);
    }

    /** O SDK gera e reaproveita a Idempotency-Key nas retentativas desta chamada. Uma opção por prazo. */
    public static List<SimulationOption> createFinancing(CredicarroClient client) {
        return client.simulations().createFinancing(CreateFinancingSimulationRequest.builder()
                .cpf("12345678909")
                .licensePlate("ABC1D23")
                .vehicleAmount(new BigDecimal("45000.00"))
                .downPayment(new BigDecimal("5000.00"))
                .state("SP")
                .isZeroKm(false)
                .storeCnpj(STORE_CNPJ)
                .build());
    }

    public static List<SimulationOption> createRefinancing(CredicarroClient client) {
        return client.simulations().createRefinancing(CreateRefinancingSimulationRequest.builder()
                .cpf("12345678909")
                .licensePlate("ABC1D23")
                .requestedAmount(new BigDecimal("20000.00"))
                .storeCnpj(STORE_CNPJ)
                .build());
    }

    public static void printOptions(List<SimulationOption> options) {
        for (SimulationOption option : options) {
            System.out.printf("%dx de %s | CET a.m. %s%% | CET a.a. %s%% | simulação %s%n",
                    option.getTerm(), option.getInstallmentAmount(), option.getMonthlyCet(), option.getAnnualCet(),
                    option.getSimulationId());
        }
    }

    /** Consulta uma simulação já feita (GET v1/proposal/simulation/{id}). */
    public static Simulation get(CredicarroClient client, UUID simulationId) {
        return client.simulations().get(simulationId);
    }

    public static PagedResult<Simulation> list(CredicarroClient client) {
        return client.simulations().list(ListRequest.of(1, 20));
    }

    /** Rotas v1: sem o CNPJ da loja. Para integrações novas, prefira a v2 acima. */
    public static List<SimulationOption> createFinancingV1(CredicarroClient client) {
        return client.v1().simulations().createFinancing(V1CreateFinancingSimulationRequest.builder()
                .cpf("12345678909")
                .licensePlate("ABC1D23")
                .vehicleAmount(new BigDecimal("45000.00"))
                .downPayment(new BigDecimal("5000.00"))
                .state("SP")
                .isZeroKm(false)
                .build());
    }

    public static List<FinancingRangeOption> financingRangeV1(CredicarroClient client) {
        return client.v1().simulations().getFinancingRange("ABC1D23");
    }
}
