# MandaoLink — PWA e Telas de Configuração (Task J6)

Interface web móvel progressiva (PWA) para gerenciamento e configuração dos parâmetros operacionais do MandaoLink.

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
