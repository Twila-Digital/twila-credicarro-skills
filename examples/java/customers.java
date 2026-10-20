package br.com.parceiro.credicarro;

// Snippet de referência (SDK Java do Credicarro). Usa o CredicarroClient de client.java.
// Em um projeto real, salve este arquivo como CustomersExample.java.

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import twila.credicarro.CredicarroClient;
import twila.credicarro.customers.model.CreateCustomerRequest;
import twila.credicarro.customers.model.CustomerAddress;
import twila.credicarro.customers.model.OccupationType;
import twila.credicarro.customers.model.ProfessionalData;
import twila.credicarro.customers.model.UpsertCustomerRequest;
import twila.credicarro.errors.CredicarroApiException;

public final class CustomersExample {

    private CustomersExample() {
    }

    public static UpsertCustomerRequest sampleCustomer() {
        return UpsertCustomerRequest.builder()
                .cpf("12345678909")
                .firstName("Maria")
                .lastName("Souza")
                .email("maria.souza@exemplo.com.br")
                .phoneNumber("+55 (11) 99876-5432") // formato exato: +55 (DD) 99999-9999
                .dateOfBirth(OffsetDateTime.of(1990, 5, 20, 0, 0, 0, 0, ZoneOffset.of("-03:00")))
                .address(CustomerAddress.builder()
                        .street("Av. Paulista")
                        .number("1578") // opcional
                        .neighborhood("Bela Vista")
                        .city("São Paulo")
                        .state("SP")
                        .postalCode("01311000")
                        .build())
                .professionalData(ProfessionalData.builder()
                        .occupation(OccupationType.EMPLOYEE)
                        .monthlyIncome(new BigDecimal("6500.00"))
                        .build())
                .build();
    }

    /** Sem chave: CPF novo é criado e CPF existente é atualizado. É o caminho para manter o cadastro em dia. */
    public static UUID createOrUpdate(CredicarroClient client) {
        return client.customers().upsert(sampleCustomer());
    }

    /**
     * Com chave, a rota SÓ cria: CPF já cadastrado responde 409 Cpf.CpfAlreadyAdded. Use quando precisar
     * repetir uma criação com segurança. Guarde a chave com o pedido de cadastro e reaproveite-a nas repetições.
     */
    public static UUID createOnly(CredicarroClient client, String idempotencyKey) {
        try {
            return client.customers().upsert(sampleCustomer(), idempotencyKey);
        } catch (CredicarroApiException ex) {
            if (ex.getStatusCode() == 409 && "Cpf.CpfAlreadyAdded".equals(ex.getErrorCode())) {
                // O cliente já existe: atualize chamando upsert sem chave.
                return client.customers().upsert(sampleCustomer());
            }
            throw ex;
        }
    }

    /** Só os seis dados pessoais (POST v1/customer). Endereço e ocupação ficam para as chamadas abaixo. */
    public static UUID createPersonalDataOnly(CredicarroClient client) {
        return client.customers().create(CreateCustomerRequest.builder()
                .cpf("12345678909")
                .firstName("Maria")
                .lastName("Souza")
                .email("maria.souza@exemplo.com.br")
                .phoneNumber("+55 (11) 99876-5432")
                .dateOfBirth(OffsetDateTime.of(1990, 5, 20, 0, 0, 0, 0, ZoneOffset.of("-03:00")))
                .build());
    }

    /** O cliente é identificado pelo CPF; 404 Customer.Account.NotFound se ainda não existir. */
    public static void updateAddressAndOccupation(CredicarroClient client, String cpf) {
        client.customers().upsertAddress(cpf, CustomerAddress.builder()
                .street("Rua Augusta")
                .neighborhood("Consolação")
                .city("São Paulo")
                .state("SP")
                .postalCode("01305000")
                .build());

        client.customers().upsertProfessionalData(cpf, ProfessionalData.builder()
                .occupation(OccupationType.SELF_EMPLOYED)
                .monthlyIncome(new BigDecimal("8200.00"))
                .build());
    }
}
