# MandaoLink — Core: Conjunto de Referência e Runner (Task J2)

Este pacote contém o conjunto de referência inicial (fixtures) com casos sintéticos rotulados e um runner de avaliação para aferir a taxa de acerto do pipeline de quality gates (G0 a G9).

---

## 1. Estrutura do Conjunto de Referência (`fixtures/reference-cases.json`)

O arquivo JSON contém **42 casos de teste sintéticos**, todos devidamente marcados como `"tipo": "exemplo"` e com identificadores e ASINs falsos (ex: `B0EXEMPL01`), respeitando as diretrizes de não inventar produtos reais.

### Cenários Cobertos:
- **Aprovadas (Nicho Carro - 14 casos):**
  - Suporte veicular magnético, carregador USB-C veicular, dashcam veicular, aspirador automotivo, cera de carnaúba, calibrador de pneus digital, organizador de porta-malas, capa protetora de banco pet, kit de lâmpadas automotivas H4, aromatizador veicular, kit reparo de pneu, luva de lavagem, aditivo de radiador e retrovisor panorâmico.
- **G0 (Fonte Válida):** fonte desativada/inativa (`"fonte inativa"`) e mensagem antiga com mais de 30 min (`"mensagem antiga"`).
- **G1 (Link Suportado):** ausência de URL (`"sem link"`).
- **G2 (Resolução e Loja):** lojas não suportadas (Shopee, Magalu, AliExpress) e links que não resolvem / 404 / loop (`"loja não suportada"`, `"link não resolve"`).
- **G3 (Deduplicação):** mesmo ASIN já divulgado na janela de 24 horas (`"repetida"`).
- **G4 (Dados do Produto):** produto esgotado / indisponível na Amazon (`"indisponível"`).
- **G5 (Nicho Carro e Palavras Bloqueadas):** produtos fora do nicho (smartphones, livros, maquiagens, fones bluetooth, tênis) e falsos positivos contendo palavras bloqueadas (carrinho de bebê, carrinho de controle remoto, jogos) (`"fora do nicho"`, `"palavra bloqueada"`).
- **G6 (Oferta Vigente):** preço na Amazon aumentou acima da tolerância permitida de 5% (`"oferta vencida"`).
- **G7 (Link de Afiliado):** ASIN corrompido ou tag inválida (`"falha ao gerar link"`).
- **G8 (Template da Mensagem):** template renderizado com links residuais de terceiros ou sem o link oficial (`"mensagem inválida"`).
- **G9 (Validade no Envio):** tempo na fila de envio estourou o TTL de 2 horas (`"vencida na fila"`).

---

## 2. Como Usar o Runner de Avaliação

O runner recebe uma função que representa o pipeline (ou parte dele) e afere a taxa de acerto contra o conjunto de referência.

### Exemplo de Uso:

```typescript
import { runReferenceSuite, formatEvaluationReport } from '@mandaolink/core';

const report = await runReferenceSuite(async (caso) => {
  // Executa seu pipeline real de gates
  const resultado = await meuPipelineDeGates(caso);
  return {
    rotulo: resultado.enviar ? 'enviar' : 'nao_enviar',
    motivo: resultado.motivo, // Ex: 'repetida', 'fora do nicho', etc.
    gate: resultado.gate,     // Ex: 'G3', 'G5'
  };
});

console.log(formatEvaluationReport(report));
```

### Métricas Reportadas:
- **`taxaAcertoRotulo`:** Porcentagem de decisões corretas (`enviar` vs `nao_enviar`).
- **`taxaAcertoMotivo`:** Porcentagem de motivos idênticos aos esperados para reprovações.
- **`falsosPositivos`:** Mensagens que não deveriam ser enviadas, mas foram aprovadas.
- **`falsosNegativos`:** Mensagens válidas que foram indevidamente descartadas.
- **`porGate`:** Acurácia detalhada gate a gate.
- **`discrepancias`:** Lista de discrepâncias com o caso, valor esperado e valor obtido.

---

## 3. Executando os Testes

Para rodar os testes do pacote:
```bash
npm test -w packages/core
```
Ou na raiz do monorepo:
```bash
npm test
```
