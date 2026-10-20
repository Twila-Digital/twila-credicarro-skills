from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Callable

from twila_credicarro import (
    CreateProposalRequest,
    DepositAccount,
    DocumentFile,
    DocumentType,
    ListRequest,
    PendingAction,
    ProposalDetails,
    ProposalDocumentUpload,
    ProposalParticipant,
    ProposalStatus,
    ProposalSummary,
    VehicleDetails,
)

from client import client, describe_error


def create_and_read(cpf: str, simulation_id: str) -> ProposalDetails:
    """Cria a proposta a partir do `simulation_id` da opção escolhida e lê o retrato dela."""
    proposal_id = client.proposals.create(CreateProposalRequest(cpf=cpf, simulation_id=simulation_id))
    return client.proposals.get(proposal_id)


def describe_status(proposal: ProposalDetails) -> str:
    """Valor novo da API nunca quebra: o enum cai em UNKNOWN e o valor bruto continua em status_raw/status_name."""
    if proposal.status is ProposalStatus.UNKNOWN:
        return f"status novo: {proposal.status_raw} ({proposal.status_name})"
    return proposal.status.name


def pending_actions_of(proposal: ProposalDetails) -> list[PendingAction]:
    """O que o integrador precisa fazer agora (só participantes com ActionOwner.INTEGRATOR)."""
    return proposal.get_pending_actions()


# --- Envio de documentos -----------------------------------------------------------------------------------


@dataclass(frozen=True)
class PendingUpload:
    """Um envio pendente. Grave este registro ANTES de chamar a API: a `idempotency_key` (UUID) pertence ao envio e é
    reaproveitada só para repetir esse mesmo envio. Nunca derive a chave do arquivo, do nome ou do tipo do documento."""

    proposal_id: str
    participant: ProposalParticipant
    document_type: DocumentType
    file_path: str
    idempotency_key: str = field(default_factory=lambda: str(uuid.uuid4()))


def new_pending_upload(
    proposal_id: str, participant: ProposalParticipant, document_type: DocumentType, file_path: str
) -> PendingUpload:
    """Cria um envio NOVO (chave nova). Use também na correção de um documento recusado (etapa 7)."""
    return PendingUpload(proposal_id, participant, document_type, file_path)


def send_pending_upload(pending: PendingUpload) -> None:
    """Pode ser chamado de novo com o MESMO `PendingUpload` (queda, reinício).

    A chave guardada evita envio duplicado.
    """
    file = DocumentFile.from_file(pending.file_path)  # valida nome, extensão, tamanho (10 MiB) e Base64
    client.proposals.upload_document(
        pending.proposal_id,
        ProposalDocumentUpload(participant=pending.participant, document_type=pending.document_type, file=file),
        idempotency_key=pending.idempotency_key,
    )


# --- Dados do veículo e conta de recebimento ---------------------------------------------------------------
# Os dados vêm SEMPRE do sistema do integrador (cadastro do veículo, conta do cliente): nada é digitado aqui.


def send_vehicle_details(proposal_id: str, details: VehicleDetails) -> None:
    client.proposals.send_vehicle_details(proposal_id, details)


def send_deposit_account(proposal_id: str, account: DepositAccount) -> None:
    """Só refinanciamento, na etapa DEPOSIT_ACCOUNT. `account.holder_cpf` precisa ser o CPF do comprador.
    Enviar de novo substitui a conta anterior."""
    client.proposals.send_deposit_account(proposal_id, account)


def list_pending_actions(proposal_id: str) -> list[PendingAction]:
    """Só lista o que falta fazer. Quem despacha cada ação (fila, job, tela) chama as funções de envio acima com os
    dados do sistema do integrador; este exemplo não envia nada por conta própria."""
    return client.proposals.get(proposal_id).get_pending_actions()


def enqueue_pending_actions(proposal_id: str, enqueue: Callable[[str, PendingAction], None]) -> list[PendingAction]:
    """Entrega cada ação pendente a `enqueue(proposal_id, action)` (sua fila ou tabela de tarefas). O consumidor da
    fila busca os dados reais (veículo, conta, arquivo por participante, `PendingUpload` persistido) e chama
    `send_vehicle_details`, `send_deposit_account` ou `send_pending_upload`."""
    actions = list_pending_actions(proposal_id)

    for action in actions:
        # Sem PII no log: só o id da proposta, o participante e o tipo da ação.
        print(f"ação pendente | Proposta: {proposal_id} | {action.participant.value} | {action.kind.value}")
        enqueue(proposal_id, action)

    return actions


# --- Listagem e rota v1 ------------------------------------------------------------------------------------


def list_page(page: int) -> tuple[list[ProposalSummary], bool]:
    result = client.proposals.list(ListRequest(page=page, page_size=20))  # ProposalSummary: sem etapas nem documentos
    return result.items, result.has_next


def create_v1_and_read(cpf: str, simulation_id: str) -> ProposalSummary:
    """Rota v1 (`client.v1.proposals`): devolve o resumo, não o retrato com etapas. Prefira `client.proposals`."""
    proposal_id = client.v1.proposals.create(CreateProposalRequest(cpf=cpf, simulation_id=simulation_id))
    return client.v1.proposals.get(proposal_id)


def safe_enqueue(proposal_id: str, enqueue: Callable[[str, PendingAction], None]) -> list[PendingAction]:
    try:
        return enqueue_pending_actions(proposal_id, enqueue)
    except Exception as error:
        print(f"falha ao acompanhar a proposta | Proposta: {proposal_id} | {describe_error(error)}")
        raise
