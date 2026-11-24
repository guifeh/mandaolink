# MandaoLink — PWA e Telas de Configuração (Task J6)

Interface web móvel progressiva (PWA) para gerenciamento e configuração dos parâmetros operacionais do MandaoLink.

## Início e consertos (P7)

O painel abre no Início em `/`; rotas desconhecidas também mostram o Início. Os links antigos `/#operacao`, `/#pareamento`, `/#nicho`, `/#horarios` e `/#afiliado` continuam funcionando. Na navegação existente, Início é a primeira aba.

O semáforo combina um bloco de cor com uma frase de estado. Pausar exige confirmar “Pausar todos os envios?”; cancelar não envia a requisição. Retomar é direto. A lista de pendências lê `GET /pendencias`, separada do semáforo em `/operacao`, inclusive ao atualizar.

`/fontes` é provisória e explica como recuperar acesso ao grupo. `/ajuda` orienta sobre número bloqueado, grupo de destino, falhas e avisos novos. Número bloqueado não leva a repareamento. A API serve o shell nas navegações HTML desconhecidas; endpoints registrados continuam protegidos por sessão.

Ensaio visual com dados sintéticos: `npm run dev -w apps/pwa -- --host 127.0.0.1 --port 5177`, depois abra `/test/operations-browser.html`. A fixture fornece pendências diferentes de `/operacao`, registra chamadas em `window.p7.calls` e permite testar cancelamento/aceite com `window.p7.confirmPause`. Nenhuma conta é conectada.

---

## 1. Arquitetura e Estrutura

- **Framework:** React 19 + TypeScript + Vite.
- **PWA Plugin:** `vite-plugin-pwa` com suporte a Service Worker (`sw.js`), cache offline básico e manifesto de instalação (`manifest.webmanifest`).
- **Layout Mobile-First:** Design otimizado para celulares com barra de navegação inferior (Bottom Navigation) e áreas de toque mínimas de 48px.
- **Cliente HTTP:** `src/api/client.ts` integrado à API do MandaoLink com `credentials: 'include'` para tráfego seguro de cookies HttpOnly (`sessao`).

---

## 2. Telas de Configuração

1. **Filtro de Conteúdo (Nicho):**
   - **Palavras do nicho:** Termos que identificam e aprovam produtos (adicionar com Enter/botão, remoção individual por tag).
   - **Palavras proibidas:** Termos que descartam ofertas automaticamente com precedência total.
2. **Horários e Limites:**
   - **Horários de envio:** Janela permitida de postagem com validação de início anterior ao término.
   - **Limites de envio:** "Máximo por hora" e "Máximo por dia", com validação amigável de proporção.
3. **Conta de Afiliado:**
   - **Tag da Amazon:** Validação estrita no padrão oficial de associados (`xxx-20`) antes de persistir no backend.

---

## 3. Comandos de Desenvolvimento

```bash
# Executar em modo desenvolvimento
npm run dev -w apps/pwa

# Build de produção do PWA (TypeScript + Vite + Workbox)
npm run build -w apps/pwa

# Executar testes automatizados das telas de configuração
npm test -w apps/pwa
```
