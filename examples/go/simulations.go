// Simulações: faixas, criação (v2 e v1), consulta e listagem com o SDK Go do Credicarro.
package main

import (
	"context"
	"fmt"
	"sort"

	credicarro "github.com/Twila-Digital/twila-credicarro-go-sdk"
)

const exampleStoreCnpj = "11.222.333/0001-81" // formatado ou só números

// financingRange consulta a faixa antes de simular para evitar 422.
func financingRange(ctx context.Context, client *credicarro.Client, plate string) ([]credicarro.FinancingRangeOption, error) {
	options, err := client.Simulations.GetFinancingRange(ctx, plate, exampleStoreCnpj)
	if err != nil {
		return nil, err
	}
	for _, option := range options {
		fmt.Printf("%dx: entrada mínima R$ %.2f\n", option.Term, option.MinimumDownPayment)
	}
	return options, nil
}

func refinancingRange(ctx context.Context, client *credicarro.Client, plate string) ([]credicarro.RefinancingRangeOption, error) {
	return client.Simulations.GetRefinancingRange(ctx, plate, exampleStoreCnpj)
}

// commissionReturns consulta a faixa de retorno de comissão aceita por tipo de simulação. Consulte antes de informar CommissionReturn.
func commissionReturns(ctx context.Context, client *credicarro.Client) ([]credicarro.CommissionReturn, error) {
	return client.Simulations.GetCommissionReturns(ctx, exampleStoreCnpj)
}

// simulateFinancing devolve uma opção por prazo elegível. O SDK envia a Idempotency-Key sozinho (a mesma em todas as tentativas).
func simulateFinancing(ctx context.Context, client *credicarro.Client) (credicarro.SimulationOption, error) {
	options, err := client.Simulations.CreateFinancing(ctx, credicarro.CreateFinancingSimulationRequest{
		Cpf:           "12345678909",
		LicensePlate:  "ABC1D23",
		VehicleAmount: 45000,
		DownPayment:   9000, // zero quando não há entrada; menor que VehicleAmount
		State:         "SP",
		IsZeroKm:      false,
		StoreCnpj:     exampleStoreCnpj,
		// CommissionReturn: &retorno, // opcional, dentro da faixa de GetCommissionReturns
	})
	if err != nil || len(options) == 0 {
		return credicarro.SimulationOption{}, err
	}

	for _, option := range options {
		fmt.Printf("%dx de R$ %.2f | CET a.m. %.2f%% | CET a.a. %.2f%%\n", option.Term, option.InstallmentAmount, option.MonthlyCet, option.AnnualCet)
	}

	sort.Slice(options, func(i, j int) bool { return options[i].InstallmentAmount < options[j].InstallmentAmount })
	return options[0], nil // guarde o SimulationID da opção escolhida
}

func simulateRefinancing(ctx context.Context, client *credicarro.Client, requestedAmount float64) ([]credicarro.SimulationOption, error) {
	return client.Simulations.CreateRefinancing(ctx, credicarro.CreateRefinancingSimulationRequest{
		Cpf:             "12345678909",
		LicensePlate:    "ABC1D23",
		RequestedAmount: requestedAmount, // dentro da faixa de GetRefinancingRange
		StoreCnpj:       exampleStoreCnpj,
	})
}

// readSimulations consulta uma simulação e lista as demais (sem auto-paginação).
func readSimulations(ctx context.Context, client *credicarro.Client, simulationID string) error {
	simulation, err := client.Simulations.Get(ctx, simulationID)
	if err != nil {
		return err
	}
	fmt.Printf("%v: %dx de R$ %.2f\n", simulation.Type, simulation.Term, simulation.InstallmentAmount)

	page, err := client.Simulations.List(ctx, &credicarro.ListRequest{Page: 1, PageSize: 20})
	if err != nil {
		return err
	}
	fmt.Printf("%d de %d simulações (HasNext: %t)\n", len(page.Items), page.TotalCount, page.HasNext)
	return nil
}

// simulateFinancingV1 usa as rotas v1 (sem cnpjLoja), para integrações antigas. Prefira as rotas v2 acima.
func simulateFinancingV1(ctx context.Context, client *credicarro.Client) ([]credicarro.SimulationOption, error) {
	rangeOptions, err := client.V1.Simulations.GetFinancingRange(ctx, "ABC1D23")
	if err != nil || len(rangeOptions) == 0 {
		return nil, err
	}
	return client.V1.Simulations.CreateFinancing(ctx, credicarro.V1CreateFinancingSimulationRequest{
		Cpf: "12345678909", LicensePlate: "ABC1D23", VehicleAmount: 45000,
		DownPayment: rangeOptions[0].MinimumDownPayment, State: "SP", IsZeroKm: false,
	})
}

func simulateRefinancingV1(ctx context.Context, client *credicarro.Client) ([]credicarro.SimulationOption, error) {
	return client.V1.Simulations.CreateRefinancing(ctx, credicarro.V1CreateRefinancingSimulationRequest{
		Cpf: "12345678909", LicensePlate: "ABC1D23", RequestedAmount: 15000,
	})
}
