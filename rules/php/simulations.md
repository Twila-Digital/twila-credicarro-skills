# Simulações (PHP)

A simulação calcula as condições de crédito para um cliente, um veículo e uma loja. A resposta traz **uma opção para cada prazo elegível**, cada uma com seu `simulationId`. A opção que o cliente escolher vira a proposta. `Twila\Credicarro\Simulations` (e `$client->v1->simulations` para as rotas v1) usa o `CredicarroClient` de [client](client.md).

## Modelos

```php
final class SimulationsClient {                                        // $client->simulations: v2 (rotas por loja) + leituras v1
    public function getFinancingRange(string $licensePlate, string $storeCnpj): array;    // FinancingRangeOption[]
    public function getRefinancingRange(string $licensePlate, string $storeCnpj): array;  // RefinancingRangeOption[]
    public function createFinancing(CreateFinancingSimulationRequest $request): array;    // SimulationOption[] (storeCnpj obrigatório)
    public function createRefinancing(CreateRefinancingSimulationRequest $request): array;// SimulationOption[] (storeCnpj obrigatório)
    public function get(string $simulationId): Simulation;                                // GET v1/proposal/simulation/{id}
    public function list(?ListRequest $request = null): PagedResult;                      // items: Simulation[]
}

final class V1SimulationsClient {                                      // $client->v1->simulations: sem CNPJ da loja
    public function getFinancingRange(string $licensePlate): array;
    public function getRefinancingRange(string $licensePlate): array;
    public function createFinancing(CreateFinancingSimulationRequest $request): array;    // deixe storeCnpj de fora
    public function createRefinancing(CreateRefinancingSimulationRequest $request): array;
}

final class CreateFinancingSimulationRequest {
    public function __construct(
        string $cpf, string $licensePlate, float $vehicleAmount, float $downPayment,
        string $state,          // UF, 2 letras
        bool $isZeroKm,
        ?string $storeCnpj = null
    );
}

final class CreateRefinancingSimulationRequest {
    public function __construct(string $cpf, string $licensePlate, float $requestedAmount, ?string $storeCnpj = null);
}

final class FinancingRangeOption   { public $term; public $minimumDownPayment; }
final class RefinancingRangeOption { public $term; public $minimumAmount; public $maximumAmount; }

final class SimulationOption {
    public $simulationId; public $requestedAmount; public $term; public $installmentAmount;
    public $tacAmount; public $boletoAmount; public $insuranceAmount; public $iofAmount; public $iofRate;
    public $totalCreditAmount; public $totalDebtAmount;
    public $monthlyCet; public $annualCet; public $monthlyInterestRate; public $annualInterestRate;
    public $approximateDailyRetention; // pode ser null
}

final class Simulation { // GET v1/proposal/simulation/{id}
    public $simulationId; public $term; public $installmentAmount; public $requestedAmount;
    public $downPayment; public $assetAmount; public $tacAmount; public $negotiatedInterestRate;
    public $registrationAmount; public $state;
    public $type; public $typeRaw;     // SimulationType::FINANCING | REFINANCING | AMOUNT_SIMULATION | UNKNOWN
    public $transaction;               // SimulationTransaction: totalCredit, totalDebit (pode ser null)
    public $interest; public $cet;     // SimulationInterest / SimulationCet: monthlyRate, annualRate
    public $iof;                       // SimulationIof: amount, rate
    public $vehicle;                   // SimulationVehicle: brand, model, version, year, value, licensePlate, isZeroKm, chassis, renavam, color
    public $customerCpf; public $createdAt;
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
- `createFinancing` / `createRefinancing` devolvem a lista de `SimulationOption`, uma por prazo elegível. O SDK gera a `Idempotency-Key` e a reaproveita nas retentativas. Na v2, `storeCnpj` é obrigatório: sem ele o SDK lança `CredicarroValidationException` (`Validation.Field.Required`).
- `get($simulationId)` e `list(...)` consultam simulações já feitas (`Simulation`, com veículo, CET, IOF e juros).
- As rotas **v1** (`$client->v1->simulations`) não usam o CNPJ da loja (mesmos objetos de requisição, sem `storeCnpj`). Para integrações novas, use a v2.

## Exemplo

(Fonte: `examples/php/simulations.php`)

```php
$faixa = $client->simulations->getFinancingRange('ABC1D23', '11222333000181');

$opcoes = $client->simulations->createFinancing(new CreateFinancingSimulationRequest(
    '12345678909', 'ABC1D23', 45000.0, 5000.0, 'SP', false, '11222333000181'
));

foreach ($opcoes as $opcao) {
    echo "{$opcao->term}x de {$opcao->installmentAmount} (CET a.a. {$opcao->annualCet}%)" . PHP_EOL;
}
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
- Mostre `monthlyCet` e `annualCet` ao cliente: o CET reúne juros, tarifas e impostos.
- Valores monetários e percentuais são `float`, em reais; para cálculos, use centavos inteiros ou `bcmath`. `approximateDailyRetention` pode ser `null`; `createdAt` é uma `string` ISO-8601.
