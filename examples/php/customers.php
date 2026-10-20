<?php
// Snippet de referência (SDK PHP do Credicarro). Usa credicarroClient() de client.php.
declare(strict_types=1);

namespace Parceiro\Credicarro;

use Twila\Credicarro\CredicarroClient;
use Twila\Credicarro\Customers\CreateCustomerRequest;
use Twila\Credicarro\Customers\CustomerAddress;
use Twila\Credicarro\Customers\OccupationType;
use Twila\Credicarro\Customers\ProfessionalData;
use Twila\Credicarro\Customers\UpsertCustomerRequest;
use Twila\Credicarro\Errors\CredicarroApiException;

function sampleCustomer(): UpsertCustomerRequest
{
    return new UpsertCustomerRequest(
        '12345678909',
        'Maria',
        'Souza',
        'maria.souza@exemplo.com.br',
        '+55 (11) 99876-5432',        // formato exato: +55 (DD) 99999-9999
        '1990-05-20T00:00:00-03:00',  // ISO-8601 com offset
        new CustomerAddress('Av. Paulista', 'Bela Vista', 'São Paulo', 'SP', '01311000', '1578'), // número e complemento são opcionais
        new ProfessionalData(OccupationType::EMPLOYEE, 6500.0)
    );
}

/** Sem chave: CPF novo é criado e CPF existente é atualizado. É o caminho para manter o cadastro em dia. */
function createOrUpdateCustomer(CredicarroClient $client): string
{
    return $client->customers->upsert(sampleCustomer()); // devolve o id_cliente
}

/**
 * Com chave, a rota SÓ cria: CPF já cadastrado responde 409 Cpf.CpfAlreadyAdded. Use quando precisar
 * repetir uma criação com segurança. Guarde a chave com o pedido de cadastro e reaproveite-a nas repetições.
 */
function createCustomerOnly(CredicarroClient $client, string $idempotencyKey): string
{
    try {
        return $client->customers->upsert(sampleCustomer(), $idempotencyKey);
    } catch (CredicarroApiException $e) {
        if ($e->getStatusCode() === 409 && $e->getErrorCode() === 'Cpf.CpfAlreadyAdded') {
            // O cliente já existe: atualize chamando upsert sem chave.
            return $client->customers->upsert(sampleCustomer());
        }
        throw $e;
    }
}

/** Só os seis dados pessoais (POST v1/customer). Endereço e ocupação ficam para as chamadas abaixo. */
function createPersonalDataOnly(CredicarroClient $client): string
{
    return $client->customers->create(new CreateCustomerRequest(
        '12345678909',
        'Maria',
        'Souza',
        'maria.souza@exemplo.com.br',
        '+55 (11) 99876-5432',
        '1990-05-20T00:00:00-03:00'
    ));
}

/** O cliente é identificado pelo CPF; 404 Customer.Account.NotFound se ainda não existir. */
function updateAddressAndOccupation(CredicarroClient $client, string $cpf): void
{
    $client->customers->upsertAddress($cpf, new CustomerAddress('Rua Augusta', 'Consolação', 'São Paulo', 'SP', '01305000'));
    $client->customers->upsertProfessionalData($cpf, new ProfessionalData(OccupationType::SELF_EMPLOYED, 8200.0));
}
