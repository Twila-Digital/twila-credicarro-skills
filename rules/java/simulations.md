# Simulações (Java)

A simulação calcula as condições de crédito para um cliente, um veículo e uma loja. A resposta traz **uma opção para cada prazo elegível**, cada uma com seu `simulationId`. A opção que o cliente escolher vira a proposta. `twila.credicarro.simulations` (e `twila.credicarro.v1` para as rotas v1) usa o `CredicarroClient` de [client](client.md).

## Modelos

```java
public interface SimulationsClient {                                  // v2 (rotas por loja) + leituras v1
    List<FinancingRangeOption> getFinancingRange(String licensePlate, String storeCnpj);
    List<RefinancingRangeOption> getRefinancingRange(String licensePlate, String storeCnpj);
    List<SimulationOption> createFinancing(CreateFinancingSimulationRequest request);
    List<SimulationOption> createRefinancing(CreateRefinancingSimulationRequest request);
    Simulation get(UUID simulationId);                                // GET v1/proposal/simulation/{id}
    PagedResult<Simulation> list();                                   // padrão: página 1, 10 itens
    PagedResult<Simulation> list(ListRequest request);
}

public interface V1SimulationsClient {                                // client.v1().simulations(): sem CNPJ da loja
    List<FinancingRangeOption> getFinancingRange(String licensePlate);
    List<RefinancingRangeOption> getRefinancingRange(String licensePlate);
    List<SimulationOption> createFinancing(V1CreateFinancingSimulationRequest request);
    List<SimulationOption> createRefinancing(V1CreateRefinancingSimulationRequest request);
}

@Value @Builder
public class CreateFinancingSimulationRequest {
    String cpf; String licensePlate; BigDecimal vehicleAmount; BigDecimal downPayment;
    String state;        // UF, 2 letras
    boolean isZeroKm;    // builder: .isZeroKm(false)
    String storeCnpj;
}

@Value @Builder
public class CreateRefinancingSimulationRequest {
    String cpf; String licensePlate; BigDecimal requestedAmount; String storeCnpj;
}
// V1CreateFinancingSimulationRequest / V1CreateRefinancingSimulationRequest: os mesmos campos, sem storeCnpj.

@Value public class FinancingRangeOption   { int term; BigDecimal minimumDownPayment; }
@Value public class RefinancingRangeOption { int term; BigDecimal minimumAmount; BigDecimal maximumAmount; }

@Value
public class SimulationOption {
    UUID simulationId; BigDecimal requestedAmount; Integer term; BigDecimal installmentAmount;
    BigDecimal tacAmount; BigDecimal boletoAmount; BigDecimal insuranceAmount;
    BigDecimal iofAmount; BigDecimal iofRate;
    BigDecimal totalCreditAmount; BigDecimal totalDebtAmount;
    BigDecimal monthlyCet; BigDecimal annualCet; BigDecimal monthlyInterestRate; BigDecimal annualInterestRate;
    BigDecimal approximateDailyRetention; // pode ser null
}

@Value
public class Simulation { // GET v1/proposal/simulation/{id}
    UUID simulationId; Long term; BigDecimal installmentAmount; BigDecimal requestedAmount;
    BigDecimal downPayment; BigDecimal assetAmount; BigDecimal tacAmount;
    BigDecimal negotiatedInterestRate; BigDecimal registrationAmount; String state;
    SimulationType type;                      // FINANCING, REFINANCING, AMOUNT_SIMULATION, UNKNOWN
    SimulationTransaction transaction;        // getTotalCredit(), getTotalDebit()
    SimulationRate interest; SimulationRate cet; // getMonthlyRate(), getAnnualRate()
    SimulationIof iof;                        // getAmount(), getRate()
    SimulationVehicle vehicle;                // brand, model, version, year, value, licensePlate, zeroKm, chassis, renavam, color
    String customerCpf; OffsetDateTime createdAt;
}
```

| Campo | Financiamento | Refinanciamento |
| --- | :---: | :---: |
| `cpf`, `licensePlate` | sim | sim |
| `storeCnpj` (v2) | sim | sim |
| `vehicleAmount`, `downPayment`, `state`, `isZeroKm` | sim | não |
| `requestedAmount` | não | sim |

## Funcionalidades

- `getFinancingRange` / `getRefinancingRange` devolvem os prazos possíveis para a placa e a loja antes de simular: a entrada mínima (financiamento) ou a faixa de valor (refinanciamento) de cada prazo.
- `createFinancing` / `createRefinancing` devolvem a lista de `SimulationOption`, uma por prazo elegível. O SDK gera a `Idempotency-Key` e a reaproveita nas retentativas.
- `get(simulationId)` e `list(...)` consultam simulações já feitas (`Simulation`, com veículo, CET, IOF e juros).
- As rotas **v1** (`client.v1().simulations()`) não recebem o CNPJ da loja. Para integrações novas, use a v2.

## Exemplo

(Fonte: `examples/java/simulations.java`)

```java
List<FinancingRangeOption> faixa = client.simulations().getFinancingRange("ABC1D23", "11.222.333/0001-81");

List<SimulationOption> opcoes = client.simulations().createFinancing(CreateFinancingSimulationRequest.builder()
        .cpf("12345678909").licensePlate("ABC1D23")
        .vehicleAmount(new BigDecimal("45000.00")).downPayment(new BigDecimal("5000.00"))
        .state("SP").isZeroKm(false).storeCnpj("11.222.333/0001-81")
        .build());

for (SimulationOption opcao : opcoes)
    System.out.printf("%dx de %s (CET a.a. %s%%)%n", opcao.getTerm(), opcao.getInstallmentAmount(), opcao.getAnnualCet());
```

## Erros e casos de borda

- `storeCnpj` aceita CNPJ formatado ou só números. Erro de formato: `CredicarroValidationException` com `Validation.Cnpj.Invalid`.
- `404 Store.Integration.NotFound`: a loja não existe ou não está vinculada ao seu cadastro de parceiro. `404 Customer.Account.NotFound`: cadastre o cliente antes (veja [clientes](customers.md)). Ambos chegam como `CredicarroApiException`.
- `422` (`CredicarroBusinessRuleException`): `Store.Integration.Intermediation` (loja com contrato de intermediação, que não serve para a integração), `Simulation.Terms.Unavailable` (sem prazos para o veículo), `Proposal.DownPaymentInvalid` (nenhum prazo aceita a entrada), `Proposal.RequestAmountInvalid` (entrada que deixa menos de 10% do veículo para financiar, ou valor fora da faixa).
- Refinanciamento: `Simulation.Refinancing.AmountOutOfRange` (valor fora da faixa de todos os prazos) e `Simulation.Refinancing.UfUnavailable` (sem UF na placa nem no endereço do cliente).
- `downPayment` pode ser `0`, mas precisa ser menor que `vehicleAmount` (`Validation.DownPayment.NotBelowVehicleAmount`). `vehicleAmount` deve ser maior que zero.
- `licensePlate` aceita o padrão antigo (`ABC-1234`) e Mercosul (`ABC1D23`). `state` tem 2 letras.
- `409 Proposal.SimulationIdempotencyConflict`: a `Idempotency-Key` já foi usada com outro conteúdo. Você não informa a chave nas simulações; o SDK gera uma por chamada, então o conflito só aparece se a mesma chamada lógica mudar de conteúdo entre tentativas.
- Só os prazos elegíveis voltam. Se a lista vier vazia ou o prazo desejado não aparecer, ajuste entrada ou valor.
- Use um `simulationId` de simulações feitas pela integração. Uma simulação fora de loja gera `Simulation.Access.NotFromStore` ao criar a proposta.
- Mostre `getMonthlyCet()` e `getAnnualCet()` ao cliente: o CET reúne juros, tarifas e impostos.
- Campos monetários e percentuais são `BigDecimal`, em reais. `getApproximateDailyRetention()` pode ser `null`. Em `Simulation`, `getTerm()` é `Long` e `SimulationVehicle` expõe `getZeroKm()` (`Boolean`, pode ser `null`).
