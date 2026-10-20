# Glossário

## Autenticação

- **Client ID / Client Secret**: credenciais do integrador, uma dupla por ambiente (staging/produção), usadas para gerar o token.
- **Token de acesso**: Bearer token de curta duração (`token_de_acesso`), enviado em `Authorization: Bearer <token>`. Reaproveite até `expira_em`.
- **Escopo**: permissão concedida ao token (`credicarro.integration.access/full`).

## Participantes

- **Cliente / comprador**: a pessoa que pede o crédito, identificada pelo CPF. Na proposta, `comprador`.
- **Loja**: o estabelecimento que vende o veículo ou atende o cliente, identificado pelo CNPJ (`cnpjLoja`). Precisa estar vinculada ao parceiro.
- **Vendedor**: participante opcional da proposta, com a mesma estrutura do comprador.
- **Integrador / parceiro**: quem consome a API — o sistema da loja ou de um parceiro.

## Crédito e veículos

- **Financiamento**: crédito para o cliente comprar um veículo na loja.
- **Refinanciamento**: crédito em que o cliente usa um veículo próprio como garantia; o valor cai na conta de recebimento.
- **Entrada** (`valorEntrada`): valor pago à vista no financiamento. Pode ser zero, mas precisa deixar ao menos 10% do veículo para financiar.
- **Faixa financiável**: entrada mínima por prazo para uma placa.
- **Faixa refinanciável**: valor mínimo e máximo por prazo para uma placa.
- **Prazo**: quantidade de parcelas mensais.
- **TAC**: tarifa de cadastro da operação.
- **IOF**: Imposto sobre Operações Financeiras.
- **CET**: Custo Efetivo Total — juros, tarifas, impostos e seguros juntos. É o número para o cliente comparar opções.
- **Renavam**: registro do veículo, até 11 dígitos com dígito verificador.
- **Chassi**: identificação do veículo, 17 caracteres, sem I, O e Q.
- **ATPV**: Autorização para Transferência de Propriedade do Veículo (exigida no financiamento de veículo registrado no RS).
- **Laudo ECV**: laudo de uma Empresa Credenciada de Vistoria.
- **UF**: estado de registro do veículo (`SP`).

## Proposta

- **Simulação**: cálculo das condições de crédito; retorna uma opção (`id_simulacao`) por prazo elegível. Cada opção gera no máximo uma proposta.
- **Proposta**: a solicitação de crédito criada a partir de uma opção de simulação.
- **Etapa ativa** (`status_ativo`): onde cada participante está agora, com a situação e o responsável pela ação.
- **Responsável pela ação**: quem precisa agir — `CLIENTE`, `INTEGRADOR`, `CREDICARRO` ou `NENHUM`.
- **Biometria**: confirmação da identidade do cliente por reconhecimento facial, feita por link (`link_biometria`).
- **Conta de recebimento**: conta no CPF do cliente onde o crédito do refinanciamento é depositado.

## API e webhooks

- **Problem Details**: formato de erro com `tipo` (código estável), `titulo`, `status`, `detalhe` e `campo`.
- **Idempotency-Key**: header que permite repetir uma requisição sem duplicar a operação.
- **Webhook**: notificação HTTP que a Credicarro envia quando uma proposta muda.
- **Segredo de assinatura** (`segredo_assinatura`): chave do HMAC-SHA256 do header `X-CrediCarro-Signature`. Aparece só no cadastro do webhook.
- **Replay**: reenvio malicioso de uma notificação antiga — mitigado recusando `t` antigo.
- **Staging**: ambiente de testes, isolado da produção.
