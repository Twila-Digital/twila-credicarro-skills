// Clientes: cadastro com o SDK Go do Credicarro.
package main

import (
	"context"

	credicarro "github.com/Twila-Digital/twila-credicarro-go-sdk"
)

func sampleUpsertRequest() credicarro.UpsertCustomerRequest {
	return credicarro.UpsertCustomerRequest{
		Cpf:         "12345678909",
		FirstName:   "Maria",
		LastName:    "Souza",
		Email:       "maria.souza@exemplo.com.br",
		PhoneNumber: "+55 (11) 99876-5432",
		DateOfBirth: "1990-05-20T00:00:00-03:00", // ISO-8601 com offset
		Address: credicarro.CustomerAddress{
			Street: "Av. Paulista", Number: "1578", Neighborhood: "Bela Vista",
			City: "São Paulo", State: "SP", PostalCode: "01311000",
		},
		ProfessionalData: credicarro.ProfessionalData{Occupation: credicarro.OccupationTypeEmployee, MonthlyIncome: 6500},
	}
}

// upsertCustomer, sem WithIdempotencyKey, cria o cliente ou atualiza o cadastro se o CPF já existir (upsert).
// Por isso o SDK NÃO repete esta chamada sozinho em caso de falha de rede.
func upsertCustomer(ctx context.Context, client *credicarro.Client) (string, error) {
	return client.Customers.Upsert(ctx, sampleUpsertRequest())
}

// createOnlyCustomer, com WithIdempotencyKey, só cria. CPF já cadastrado responde 409 (Cpf.CpfAlreadyAdded).
// O SDK repete a chamada com a mesma chave.
func createOnlyCustomer(ctx context.Context, client *credicarro.Client, idempotencyKey string) (string, error) {
	return client.Customers.Upsert(ctx, sampleUpsertRequest(), credicarro.WithIdempotencyKey(idempotencyKey))
}

// createPersonalDataOnly envia só os dados pessoais (6 campos). Só cria: CPF, e-mail ou celular repetido responde 409.
func createPersonalDataOnly(ctx context.Context, client *credicarro.Client) (string, error) {
	return client.Customers.Create(ctx, credicarro.CreateCustomerRequest{
		Cpf:         "12345678909",
		FirstName:   "Maria",
		LastName:    "Souza",
		Email:       "maria.souza@exemplo.com.br",
		PhoneNumber: "+55 (11) 99876-5432",
		DateOfBirth: "1990-05-20T00:00:00-03:00",
	})
}

// updateAddressAndOccupation exige cliente já cadastrado (202 sem corpo).
func updateAddressAndOccupation(ctx context.Context, client *credicarro.Client, cpf string) error {
	err := client.Customers.UpsertAddress(ctx, cpf, credicarro.CustomerAddress{
		Street: "Rua Augusta", Number: "100", Complement: "Apto 12", Neighborhood: "Consolação",
		City: "São Paulo", State: "SP", PostalCode: "01304001",
	})
	if err != nil {
		return err
	}
	return client.Customers.UpsertProfessionalData(ctx, cpf, credicarro.ProfessionalData{
		Occupation: credicarro.OccupationTypeBusinessOwner, MonthlyIncome: 12000,
	})
}
