import { type FinancingWithoutCpfOption, type RefinancingWithoutCpfOption, type SimulationOption } from '@twila/credicarro';
import { client } from './client';

const LOJA_CNPJ = '11.222.333/0001-81'; // formatado ou só números; precisa estar vinculado ao seu parceiro

/** Entrada mínima por prazo. Consulte antes de simular para não cair em Proposal.DownPaymentInvalid. */
export async function financingRange(licensePlate: string) {
  return client.simulations.getFinancingRange(licensePlate, LOJA_CNPJ); // [{ term, minimumDownPayment }]
}

/** Faixa refinanciável por prazo. */
export async function refinancingRange(licensePlate: string) {
  return client.simulations.getRefinancingRange(licensePlate, LOJA_CNPJ); // [{ term, minimumAmount, maximumAmount }]
}

/** Uma opção por prazo elegível. O cliente precisa estar cadastrado. O SDK envia a Idempotency-Key sozinho. */
export async function simulateFinancing(cpf: string, licensePlate: string): Promise<SimulationOption[]> {
  return client.simulations.createFinancing({
    cpf,
    licensePlate,
    vehicleAmount: 45000,
    downPayment: 5000,
    state: 'SP',
    isZeroKm: false,
    storeCnpj: LOJA_CNPJ,
  });
}

export async function simulateRefinancing(cpf: string, licensePlate: string): Promise<SimulationOption[]> {
  return client.simulations.createRefinancing({ cpf, licensePlate, requestedAmount: 20000, storeCnpj: LOJA_CNPJ });
}

/** Mostre o CET ao cliente: é o número certo para comparar opções. */
export function describeOptions(options: SimulationOption[]): string[] {
  return options.map(
    (option) => `${option.term}x de R$ ${option.installmentAmount.toFixed(2)} | CET ${option.monthlyCet}% a.m. / ${option.annualCet}% a.a.`,
  );
}

/** A opção escolhida pelo cliente: o `simulationId` dela cria a proposta (cada opção gera uma única proposta). */
export function pickByTerm(options: SimulationOption[], term: number): SimulationOption | undefined {
  return options.find((option) => option.term === term);
}

/** Consulta uma simulação já criada (v1) e lista as simulações com paginação explícita. */
export async function readSimulations(simulationId: string) {
  const simulation = await client.simulations.get(simulationId); // simulation.type: Financing | Refinancing | AmountSimulation
  const page = await client.simulations.list({ page: 1, pageSize: 20 });
  return { simulation, page, hasMore: page.hasNext };
}

/** Rotas v1: sem `storeCnpj` (a loja de integração é a vinculada ao parceiro). Prefira as rotas v2 acima. */
export async function simulateFinancingV1(cpf: string, licensePlate: string): Promise<SimulationOption[]> {
  const range = await client.v1.simulations.getFinancingRange(licensePlate);
  console.log(`prazos com entrada mínima: ${range.length}`);

  return client.v1.simulations.createFinancing({
    cpf,
    licensePlate,
    vehicleAmount: 45000,
    downPayment: 5000,
    state: 'SP',
    isZeroKm: false,
  });
}

export async function simulateRefinancingV1(cpf: string, licensePlate: string): Promise<SimulationOption[]> {
  return client.v1.simulations.createRefinancing({ cpf, licensePlate, requestedAmount: 20000 });
}

/** Simulação rápida sem CPF (v1): só placa, valor do veículo e UF. Nada é gravado e a opção não tem `simulationId`: não cria proposta. */
export async function simulateFinancingWithoutCpf(licensePlate: string): Promise<FinancingWithoutCpfOption[]> {
  // `downPayment` é opcional: omitido, a API usa a entrada mínima da taxa da loja.
  const options = await client.v1.simulations.createFinancingWithoutCpf({ licensePlate, vehicleAmount: 45000, state: 'SP' });
  options.forEach((option) => console.log(`${option.term}x de R$ ${option.installmentAmount.toFixed(2)} (entrada mínima ${option.minimumDownPayment})`));

  return options;
}

/** Só voltam os prazos em cuja faixa o valor cabe; cada opção traz a faixa (`minimumAmount` a `maximumAmount`). */
export async function simulateRefinancingWithoutCpf(licensePlate: string): Promise<RefinancingWithoutCpfOption[]> {
  return client.v1.simulations.createRefinancingWithoutCpf({ licensePlate, requestedAmount: 20000, state: 'SP' });
}
