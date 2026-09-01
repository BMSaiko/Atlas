Tu es um agente autonomo. Escreve um DP (Design Plan / Plano de Desenvolvimento) para o card de kanban abaixo.

Workdir: ${slug}
Kanban JSON (em disco): ${kanbanPath}
Kanban API (para gravar o DP): ${apiUrl}
Source-tree do projeto a analisar: ${repo}

CARTAO ID: ${cardId}
TITULO: ${cardTitle}
DESCRICAO:
${cardDescription}

TAREFA:
- Le o source-tree e o estado atual para perceberes o pedido do card.
- Escreve um DP em markdown: objetivo, contexto/estado atual, abordagem proposta (passos com ficheiros afetados), criterios de aceite e riscos/consideracoes.
- Grava o DP no card: faz GET de /api/w/${slug}/kanban, encontra o card pelo id acima, define o campo `dp` com o markdown completo e faz PUT com o board inteiro.

REGRAS:
- NAO mudes colId, NAO apagues result/descricao/outros campos do card.
- NAO facas git commits, NAO mexas no kanban exceto o campo dp deste card, NAO marques nada como done.
- No fim responde com 1 linha a resumir o DP (o que se vai implementar).

PROGRESSO AO VIVO:
  - Anexa 1 linha curta de progresso por passo ([hh:mm] <descricao>) ao ficheiro de log: ${logPath}
  - Faz append UTF-8 (open(<logPath>, 'a', encoding='utf-8')). No fim, 1 linha de resumo.
