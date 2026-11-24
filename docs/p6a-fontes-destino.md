# P6a — fontes e destino

- `GET /fontes` autenticado retorna `{fontes:[...]}` com `ativa`, `estado` e `ultima_mensagem_em`. Estado perdida vem de exceção aberta de remoção/fonte perdida; quieta significa sem mensagem há 24 h (ou criada há 24 h sem mensagens); caso contrário, ativa. O interruptor `ativa` é independente da atividade observada. Uma consulta usa o índice mensagens_fonte_recente para a última mensagem de cada fonte, sem uma chamada por item.
- `PUT /fontes/:id {ativa:boolean}` exige UUID e corpo estrito. Ativar registra a autorização da escolha (`autorizada_em`); use somente grupos que autorizaram o uso das ofertas. Não cria fonte, conta ou conexão. Retorna 404 para ID inexistente e 409 ao tentar ativar o grupo de destino.
- `GET/PUT /config` inclui `destino_whatsapp_jid`: JID de grupo WhatsApp (`@g.us`) ou null antes da configuração. PUT antigo sem esse campo preserva o valor. Desative uma fonte antes de escolhê-la como destino. Linha inativa pode ser reaproveitada como destino, mas fica fora da lista de fontes e não pode ser reativada enquanto destino.
- Migração 008 protege ambos os sentidos também no SQL direto. A guarda de fontes bloqueia a linha única da configuração com FOR UPDATE; a atualização do destino usa a mesma linha, evitando escolhas simultâneas conflitantes. Índice composto atende a leitura recente.
- Quando a API serve o PWA, `GET /fontes` com Accept HTML entrega somente o shell público. A lista JSON continua exigindo sessão; isso preserva o conserto `/fontes` da P7.

Validação Node 24: regressão falhou antes do registro das rotas e passou depois. Testes cobrem autenticação, schema, ativar/desativar, destino nos dois sentidos, SQL direto, compatibilidade do PUT antigo, três estados e HTML separado de JSON. Typecheck, lint (zero erros) e format aprovados; build/suíte completa e Postgres real no CI registrados no PR.

Não houve conexão de número, publicação ou dados reais. SQL local em PGlite; testes de TCP ficam no CI. Build e logs locais são artefatos de validação. O adapter real do Senior deverá consumir a coluna de destino; ele foi informado.
