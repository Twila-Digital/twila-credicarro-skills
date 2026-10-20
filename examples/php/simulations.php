<?php
// Snippet de referência (SDK PHP do Credicarro). Usa credicarroClient() de client.php.
declare(strict_types=1);

namespace Parceiro\Credicarro;

use Twila\Credicarro\CredicarroClient;
use Twila\Credicarro\ListRequest;
use Twila\Credicarro\PagedResult;
use Twila\Credicarro\Simulations\CreateFinancingSimulationRequest;
use Twila\Credicarro\Simulations\CreateRefinancingSimulationRequest;
use Twila\Credicarro\Simulations\FinancingRangeOption;
use Twila\Credicarro\Simulations\RefinancingRangeOption;
use Twila\Credicarro\Simulations\Simulation;
use Twila\Credicarro\Simulations\SimulationOption;

const STORE_CNPJ = '11222333000181'; // loja de integração (formatado ou só números)

/** @return FinancingRangeOption[] prazos disponíveis e a entrada mínima de cada um, antes de simular */
function financingRange(CredicarroClient $client): array
{
    return $client->simulations->getFinancingRange('ABC1D23', STORE_CNPJ);
}

/** @return RefinancingRangeOption[] */
function refinancingRange(CredicarroClient $client): array
{
    return $client->simulations->getRefinancingRange('ABC1D23', STORE_CNPJ);
}

/** O SDK gera e reaproveita a Idempotency-Key nas retentativas desta chamada. Uma opção por prazo.
 * @return SimulationOption[]
 */
function createFinancing(CredicarroClient $client): array
{
    return $client->simulations->createFinancing(new CreateFinancingSimulationRequest(
        '12345678909',   // cpf
        'ABC1D23',       // placa
        45000.0,         // valor do veículo
        5000.0,          // entrada
        'SP',            // UF
        false,           // veículo zero km?
        STORE_CNPJ       // cnpjLoja (obrigatório na v2)
    ));
}

/** @return SimulationOption[] */
function createRefinancing(CredicarroClient $client): array
{
    return $client->simulations->createRefinancing(
        new CreateRefinancingSimulationRequest('12345678909', 'ABC1D23', 20000.0, STORE_CNPJ)
    );
}

/** @param SimulationOption[] $options */
function printOptions(array $options): void
{
    foreach ($options as $option) {
        echo "{$option->term}x de {$option->installmentAmount} | CET a.m. {$option->monthlyCet}% | "
            . "CET a.a. {$option->annualCet}% | simulação {$option->simulationId}" . PHP_EOL;
    }
}

/** Consulta uma simulação já feita (GET v1/proposal/simulation/{id}). */
function getSimulation(CredicarroClient $client, string $simulationId): Simulation
{
    return $client->simulations->get($simulationId);
}

function listSimulations(CredicarroClient $client): PagedResult
{
    return $client->simulations->list(new ListRequest(1, 20));
}

/**
 * Rotas v1: sem o CNPJ da loja (storeCnpj fica de fora). Para integrações novas, prefira a v2 acima.
 * @return SimulationOption[]
 */
function createFinancingV1(CredicarroClient $client): array
{
    return $client->v1->simulations->createFinancing(
        new CreateFinancingSimulationRequest('12345678909', 'ABC1D23', 45000.0, 5000.0, 'SP', false)
    );
}

/** @return FinancingRangeOption[] */
function financingRangeV1(CredicarroClient $client): array
{
    return $client->v1->simulations->getFinancingRange('ABC1D23');
}
