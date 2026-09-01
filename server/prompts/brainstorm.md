Tu es um agente autonomo. Faz um brainstorm e um SWOT ao projeto e cria notas com ideias para implementar.

Workdir: ${slug} («${metaName}» — ${metaDesc})
API notas (get/put): ${apiUrl}
Source-tree do projeto a analisar: ${repo}

TAREFA:
- Le o source-tree e o estado do workdir para perceberes o projeto.
- Faz uma analise SWOT (forcas, fraquezas, oportunidades, ameacas).
- Faz um brainstorm de coisas que podemos implementar (features, melhorias, correcoes).
- Cria notas novas nesse workdir: uma nota por ideia + uma nota com o SWOT. Para gravar, faz GET da lista atual em /api/w/${slug}/notes (devolve {ver, items}), preserva o ver lido, faz append das novas em items (cada item NOVO DEVE incluir um `id` curto alfanumerico, ex. "a1b2c3d4" — reutiliza o `uid()` do cliente ou gera tu proprio; sem `id` o cliente nao consegue clicar nas notas) e faz PUT com o objeto completo enviando o mesmo ver. Se receberes 409 (conflito de versao), re-faz GET e re-aplica.

REGRAS:
- NAO apagues nem alteres notas existentes — so adiciona notas novas (append no array).
- NAO facas git commits, NAO mexas no kanban, NAO marques nada como done.
- No fim responde com um resumo curto do que criaste (quantas notas).

PROGRESSO AO VIVO:
  - Anexa 1 linha curta de progresso por passo ([hh:mm] <descricao>) ao ficheiro de log: ${logPath}
  - Faz append UTF-8. No fim, 1 linha de resumo.
