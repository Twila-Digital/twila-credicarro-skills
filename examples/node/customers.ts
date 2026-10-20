import {
  CredicarroApiError,
  OccupationType,
  type CustomerAddress,
  type ProfessionalData,
  type UpsertCustomerRequest,
} from '@twila/credicarro';
import { client } from './client';

const cadastro: UpsertCustomerRequest = {
  cpf: '12345678909',
  firstName: 'Maria',
  lastName: 'Souza',
  email: 'maria.souza@exemplo.com.br',
  phoneNumber: '+55 (11) 99876-5432', // exatamente neste formato
  dateOfBirth: '1990-05-20T00:00:00-03:00', // ISO-8601 com offset; cliente entre 18 e 75 anos
  address: {
    street: 'Av. Paulista',
    number: '1578',
    neighborhood: 'Bela Vista',
    city: 'São Paulo',
    state: 'SP',
    postalCode: '01311000',
  },
  professionalData: { occupation: OccupationType.Employee, monthlyIncome: 6500 },
};

/** Sem chave: CRIA ou ATUALIZA (upsert). O SDK não gera chave aqui e não repete a chamada se ela falhar. */
export async function upsertCustomer(request: UpsertCustomerRequest = cadastro): Promise<string> {
  return client.customers.upsert(request); // id_cliente
}

/** Com chave explícita: SÓ CRIA (CPF existente => 409 Cpf.CpfAlreadyAdded) e a chamada passa a ser repetida com a mesma chave. */
export async function createCustomerOnly(request: UpsertCustomerRequest, idempotencyKey: string): Promise<string | undefined> {
  try {
    return await client.customers.upsert(request, idempotencyKey);
  } catch (error) {
    if (error instanceof CredicarroApiError && error.errorCode === 'Cpf.CpfAlreadyAdded') return undefined; // já existe
    throw error;
  }
}

/** Só os seis dados pessoais (POST v1/customer). CPF, e-mail ou celular repetidos dão 409. */
export async function createPersonalData(): Promise<string> {
  const { address: _address, professionalData: _professionalData, ...pessoais } = cadastro;
  return client.customers.create(pessoais);
}

/** Atualiza só o endereço de um cliente já cadastrado (202, sem corpo). */
export async function updateAddress(cpf: string, address: CustomerAddress): Promise<void> {
  await client.customers.upsertAddress(cpf, address);
}

/** Atualiza só ocupação e renda de um cliente já cadastrado (202, sem corpo). */
export async function updateProfessionalData(cpf: string, data: ProfessionalData): Promise<void> {
  await client.customers.upsertProfessionalData(cpf, data);
}
