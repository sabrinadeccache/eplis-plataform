# EPLIS Trainer — Atualizações ao SRS v1.0

> Correções e adições identificadas ao comparar o SRS original com as especificações
> oficiais do EPLIS (Fase 1, Fase 2, Manual do Examinando/Doc 9835). Usar este documento
> como changelog até o SRS ser formalmente revisado para v1.1.

## Novos requisitos

**RF-52** — O sistema deve suportar o campo `operational_profile` (`TWR`, `APP`, `ACC`,
`AFIS`, `FIS`, `COpM`, `ab_initio`) em `users`, definindo qual versão de prova da Fase 2
o candidato recebe. *Fase: F1 (junto com RF-05/RF-06).*

**RF-53** — O sistema deve versionar os itens de `phase2_prompts` por
`operational_profile`, sorteando o conteúdo de cada parte a partir do pool do perfil do
candidato (Parte 1: 4 itens; Parte 2: 10 itens em ordem crescente de complexidade;
Parte 3: 4 itens; Parte 4: 1 imagem) — mesma lógica de banco de itens já usada na Fase 1.
*Fase: F2 (banco) / F5 (seleção em runtime).*

**RF-54** — No modo `official`, o sistema deve conceder ao candidato no máximo 20
segundos para iniciar sua resposta após a apresentação de cada item; se o candidato não
iniciar dentro desse prazo, o sistema deve avançar automaticamente para o próximo item.
*Fase: F5.*

**RF-55** — O sistema deve diferenciar a regra de repetição/esclarecimento por parte da
entrevista: nas Partes 1, 3 e 4, o candidato pode solicitar repetição OU esclarecimento
de vocabulário (1x cada, com repetição extra liberada após esclarecimento); na Parte 2,
apenas repetição da frase é permitida — esclarecimento de vocabulário não é oferecido,
pois a compreensão do item sem ajuda é o que está sendo avaliado. *Fase: F5.*

**RF-56** — O sistema deve manter `simulation_attempts.current_state`,
`.current_part` e `.current_item_index` atualizados a cada transição da entrevista, para
permitir retomar uma tentativa `official` interrompida sem reconstruir a posição a
partir do histórico de `phase2_responses`. *Fase: F5.*

## Requisitos existentes alterados

**RF-12 (esclarecimento)** — O tempo de reescuta do áudio na Fase 1 (segunda escuta
opcional) ocorre **dentro** da janela de 1 minuto de resposta, não é tempo adicional.
Ajustar a implementação do cronômetro de acordo — não somar tempo extra ao conceder a
reescuta.

**RF-31 (substituído por RF-55)** — O RF-31 original tratava a regra de repetição de
forma genérica para toda a Fase 2. O Manual do Examinando (item 1.2.3) mostra que a
Parte 2 tem regra mais restrita (sem esclarecimento de vocabulário). RF-55 substitui
RF-31.

**RF-49 (complementado por RF-53)** — O cadastro de prompts da Fase 2 no painel
administrativo deve incluir o campo de perfil operacional, hoje ausente na Tabela 5 do
SPD apesar de citado como premissa estratégica na seção 3.

## Justificativa

Essas correções vêm das especificações oficiais do EPLIS (documentos "Especificações da
Fase 1", "Especificações das Tarefas da Fase 2" e "Manual do Examinando", que traduzem e
citam diretamente o Doc 9835 da OACI). Antes desses documentos, o SPD/SRS haviam sido
escritos com base em entendimento geral do exame, sem esses detalhes operacionais finos
— por isso não é uma falha de design, é uma lacuna de informação agora resolvida.
