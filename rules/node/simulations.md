# Simulações (Node.js)

A simulação calcula as condições de crédito para um cliente, um veículo e uma loja. A resposta traz **uma opção por prazo elegível**, cada uma com um `simulationId`. A opção que o cliente escolher vira a proposta. Acesse por `client.simulations` (rotas v2, com `storeCnpj`) e `client.v1.simulations` (rotas v1, sem `storeCnpj`), usando o cliente único de [client.md](client.md).

## Tipos

```typescript
import type {
  FinancingRangeOption, RefinancingRangeOption,
  CreateFinancingSimulationRequest, CreateRefinancingSimulationRequest,
  CreateFinancingSimulationRequestV1, CreateRefinancingSimulationRequestV1,
  SimulationOption, Simulation, SimulationType,
  CreateFinancingWithoutCpfRequest, CreateRefinancingWithoutCpfRequest,
  FinancingWithoutCpfOption, RefinancingWithoutCpfOption,
} from '@twila/credicarro';

interface FinancingRangeOption { term: number; minimumDownPayment: number }
interface RefinancingRangeOption { term: number; minimumAmount: number; maximumAmount: number }

interface CreateFinancingSimulationRequest {
  cpf: string; licensePlate: string; vehicleAmount: number;
  downPayment: number;      // pode ser 0, mas precisa deixar >= 10% do veículo para financiar
  state: string;            // UF com 2 letras
  isZeroKm: boolean;
  storeCnpj: string;        // formatado ou só números
}
interface CreateRefinancingSimulationRequest { cpf: string; licensePlate: string; requestedAmount: number; storeCnpj: string }
type CreateFinancingSimulationRequestV1 = Omit<CreateFinancingSimulationRequest, 'storeCnpj'>;
type CreateRefinancingSimulationRequestV1 = Omit<CreateRefinancingSimulationRequest, 'storeCnpj'>;

// Sem CPF (client.v1.simulations): só placa, valor e UF
interface CreateFinancingWithoutCpfRequest { licensePlate: string; vehicleAmount: number; downPayment?: number; state: string }  // downPayment omitido = entrada mínima da taxa da loja
interface CreateRefinancingWithoutCpfRequest { licensePlate: string; requestedAmount: number; state: string }                 // todos obrigatórios

interface SimulationOption {
  simulationId: string; requestedAmount: number; term: number; installmentAmount: number;
  tacAmount: number; boletoAmount: number; insuranceAmount: number; iofAmount: number; iofRate: number;
  totalCreditAmount: number; totalDebtAmount: number;
  monthlyCet: number; annualCet: number; monthlyInterestRate: number; annualInterestRate: number;
  approximateDailyRetention?: number;   // omitido quando não se aplica
}

// Opções sem CPF: lista, sem simulationId
interface FinancingWithoutCpfOption {
  requestedAmount: number; term: number; installmentAmount: number;
  tacAmount: number; boletoAmount: number; insuranceAmount: number; iofAmount: number; iofRate: number;
  totalCreditAmount: number; totalDebtAmount: number;
  monthlyCet: number; annualCet: number; monthlyInterestRate: number; annualInterestRate: number;
  approximateDailyRetention?: number;
  minimumDownPayment: number;
}
interface RefinancingWithoutCpfOption {   // mesmos campos, com a faixa refinanciável do prazo no lugar da entrada mínima
  requestedAmount: number; term: number; installmentAmount: number;
  tacAmount: number; boletoAmount: number; insuranceAmount: number; iofAmount: number; iofRate: number;
  totalCreditAmount: number; totalDebtAmount: number;
  monthlyCet: number; annualCet: number; monthlyInterestRate: number; annualInterestRate: number;
  approximateDailyRetention?: number;
  minimumAmount: number; maximumAmount: number;
}

// Simulação consultada (get e list): outro formato
interface Simulation {
  simulationId: string; term: number; installmentAmount: number; requestedAmount: number;
  downPayment: number; assetAmount: number; tacAmount: number; negotiatedInterestRate: number; registrationAmount: number;
  state: string; type: SimulationType;    // Financing | Refinancing | AmountSimulation | Unknown
  transaction?: { totalCredit: number; totalDebit: number };
  interest?: { monthlyRate: number; annualRate: number };
  cet?: { monthlyRate: number; annualRate: number };
  iof?: { amount: number; rate: number };
  vehicle?: { brand: string; model: string; version: string; year?: number; value?: number; licensePlate: string; isZeroKm?: boolean; chassis: string; renavam: string; color: string };
  customerCpf?: string; createdAt: string;
}
```

## Interface

```typescript
interface SimulationsClient {   // client.simulations
  getFinancingRange(licensePlate: string, storeCnpj: string): Promise<FinancingRangeOption[]>;     // GET v2/proposal/simulation/range/financing
  getRefinancingRange(licensePlate: string, storeCnpj: string): Promise<RefinancingRangeOption[]>; // GET v2/proposal/simulation/range/refinancing
  createFinancing(request: CreateFinancingSimulationRequest): Promise<SimulationOption[]>;         // POST v2/proposal/simulation/financing
  createRefinancing(request: CreateRefinancingSimulationRequest): Promise<SimulationOption[]>;     // POST v2/proposal/simulation/refinancing
  get(simulationId: string): Promise<Simulation>;                                                  // GET v1/proposal/simulation/{id}
  list(request?: ListRequest): Promise<PagedResult<Simulation>>;                                   // GET v1/proposal/simulation
}

interface V1SimulationsClient {  // client.v1.simulations: rotas v1, sem storeCnpj
  getFinancingRange(licensePlate: string): Promise<FinancingRangeOption[]>;
  getRefinancingRange(licensePlate: string): Promise<RefinancingRangeOption[]>;
  createFinancing(request: CreateFinancingSimulationRequestV1): Promise<SimulationOption[]>;
  createRefinancing(request: CreateRefinancingSimulationRequestV1): Promise<SimulationOption[]>;
  createFinancingWithoutCpf(request: CreateFinancingWithoutCpfRequest): Promise<FinancingWithoutCpfOption[]>;       // POST v1/proposal/simulation/financing/without-cpf
  createRefinancingWithoutCpf(request: CreateRefinancingWithoutCpfRequest): Promise<RefinancingWithoutCpfOption[]>; // POST v1/proposal/simulation/refinancing/without-cpf
}
```

## Features

- Consulte a faixa (`getFinancingRange`, `getRefinancingRange`) antes de simular: ela diz a entrada mínima ou o valor refinanciável de cada prazo.
- O SDK envia a `Idempotency-Key` das simulações sozinho (a mesma em todas as tentativas); você não passa chave.
- Use o `simulationId` da opção escolhida em `client.proposals.create`. Cada opção gera **uma única proposta** e expira.
- As rotas v1 (`client.v1.simulations`) não têm `storeCnpj`: a loja de integração é a vinculada ao parceiro. Prefira as rotas v2; use a v1 só em integrações antigas. Numa integração v1, crie e consulte a proposta por `client.v1.proposals`.
- **Simulação rápida sem CPF** (`createFinancingWithoutCpf` e `createRefinancingWithoutCpf`, só em `v1`): calcula as parcelas só com placa, valor do veículo (ou valor solicitado) e UF, sem cliente cadastrado e na loja de integração do parceiro. Nada é gravado: as opções não têm `simulationId` e **não servem para criar proposta** (para isso, simule com o CPF). Não usa `Idempotency-Key` e é segura para repetir. No financiamento a entrada é opcional: omitida, a API usa a entrada mínima da taxa da loja. No refinanciamento só voltam os prazos em cuja faixa o valor cabe. Cada opção traz `minimumDownPayment` (financiamento) ou `minimumAmount` e `maximumAmount` (refinanciamento).
- `get` e `list` devolvem `Simulation` (consulta), formato diferente de `SimulationOption`. `list` usa paginação explícita (`PagedResult<Simulation>`).
- Mostre o CET (`monthlyCet`, `annualCet`) ao cliente: é o número certo para comparar opções.

## Exemplo
(Fonte: `examples/node/simulations.ts`)

```typescript
const faixa = await client.simulations.getFinancingRange('ABC1D23', '11.222.333/0001-81');

const opcoes = await client.simulations.createFinancing({
  cpf: '12345678909', licensePlate: 'ABC1D23', vehicleAmount: 45000, downPayment: 5000,
  state: 'SP', isZeroKm: false, storeCnpj: '11.222.333/0001-81',
});
const escolhida = opcoes.find((opcao) => opcao.term === 48);   // opcao.simulationId cria a proposta

// Rota v1: sem storeCnpj
const opcoesV1 = await client.v1.simulations.createRefinancing({ cpf: '12345678909', licensePlate: 'ABC1D23', requestedAmount: 20000 });

// Sem CPF: só placa, valor e UF. Nada é gravado e a opção não tem simulationId (não cria proposta)
const semCpf = await client.v1.simulations.createFinancingWithoutCpf({ licensePlate: 'ABC1D23', vehicleAmount: 45000, state: 'SP' });
const refinSemCpf = await client.v1.simulations.createRefinancingWithoutCpf({ licensePlate: 'ABC1D23', requestedAmount: 20000, state: 'SP' });
```

## Erros e casos de borda

- O cliente precisa estar cadastrado: senão `404 Customer.Account.NotFound`.
- `storeCnpj` precisa estar vinculado ao parceiro: `404 Store.Integration.NotFound`; loja com intermediação: `422 Store.Integration.Intermediation`.
- Financiamento: nenhum prazo aceita a entrada: `422 Proposal.DownPaymentInvalid`. Consulte `getFinancingRange` antes.
- Refinanciamento: `requestedAmount` fora da faixa: `422 Proposal.RequestAmountInvalid` ou `Simulation.Refinancing.AmountOutOfRange`; UF não identificada: `422 Simulation.Refinancing.UfUnavailable`.
- Sem prazos para o veículo: `422 Simulation.Terms.Unavailable`.
- `get` de simulação de outro parceiro: `404 Simulation.Access.NotFound`.
- Simulação sem CPF: `400` `Validation.Field.Required` (UF ausente), `Validation.Uf.Invalid` e `Validation.LicensePlate.Invalid`; `403`; `404` `Store.Integration.NotFound` e `Fipe.VehiclePlateNotFound`; `422` `Proposal.DownPaymentInvalid` (entrada abaixo do mínimo), `Proposal.RequestAmountInvalid` (valor fora da faixa), `Store.Integration.Intermediation` e `Simulation.Terms.Unavailable`. Não há `404 Customer.Account.NotFound` nem conflito de `Idempotency-Key`: não há cliente nem chave.
- Todos os `422` chegam como `CredicarroBusinessRuleError`; trate pelo `errorCode`.
- `409 Proposal.SimulationIdempotencyConflict` indica chave reusada com outro corpo; como o SDK gera a chave por chamada, só aparece se você desligar `disableAutomaticIdempotencyKey` e reaproveitar chaves por conta própria.
- `Simulation.type` pode vir como `SimulationType.Unknown` se a API ganhar um tipo novo; não lance erro.
