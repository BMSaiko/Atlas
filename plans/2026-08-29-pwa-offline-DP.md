# DP — PWA installable + offline

**Card:** q4xf8vn3 · **Coluna:** todo · **Branch sugerida:** \`feature/atlas-q4xf8vn3\` (de \`dev\` — merge SEMPRE para dev, nunca main)

## Objetivo
Tornar o Atlas **instalável** (PWA/App) e capaz de **carregar o shell offline**: manifest Web App + service worker que pré-cacheia os assets de produção. Os **dados continuam a vir da API** — offline carrega apenas a UI/shell, não os dados (conforme o card).

## Contexto / estado atual
- SPA **vanilla TypeScript + Vite 6** (\`vite ^6.4.3\`), zero framework, runtime sem libs.
- Build → \`dist/\` (JS/CSS com hash + \`index.html\`); assets públicos em \`public/\` (\`favicon.svg\`, \`icons/\` — 60 órbites SVG).
- **API embutida no Vite** (\`server/api.ts\`): dados locais em JSON por slug, servidos em \`/api/*\` (mesmo origin). Não é uma SPA de "dados estáticos".
- Hoje **não existe manifest, nem service worker, nem meta theme-color** → a app não é instalável. \`index.html\` só tem viewport + fonts + favicon.
- Fontes externas da **Google Fonts** via \`<link>\` cross-origin em \`index.html\`.
- O card já fixa a stack: \`vite-plugin-pwa\` (uma dep dev).

## Abordagem proposta (mínima, lazy)
Adicionar \`vite-plugin-pwa\` com Workbox default: **precache automático do app shell** (index.html + JS/CSS hasheados + assets \`public/\`) e **manifest gerado** + registo automático do SW. **Sem** cache de API no core — dados continuam a depender da rede (decisão do card: "offline só lê cache").

### Passos
1. \`npm i -D vite-plugin-pwa\` (~0.21, compatível com Vite 6) — única dep nova.
2. **\`vite.config.ts\`** — \`import { VitePWA } from 'vite-plugin-pwa'\`, adicionar aos \`plugins[]\`:
   - \`registerType: 'autoUpdate'\` (atualiza o SW sem prompt ao BMS),
   - \`manifest\`: \`name:'ATLAS'\`, \`short_name:'ATLAS'\`, \`start_url:'/'\`, \`display:'standalone'\`, \`background_color\`/\`theme_color\` das tokens atuais, \`icons\` (SVG + PNG 192/512),
   - \`workbox: { globPatterns: ['**/*.{js,css,html,svg,png,ico}', 'icons/**'] }\` (precache do shell + orbs),
   - \`injectRegister: 'auto'\` (sem \`navigator.serviceWorker\` manual — ponytail).
3. **\`public/icons/\`** — garantir **PNG 192 e 512** para o manifest (hoje há só SVG; gerar 2 PNGs a partir de \`favicon.svg\` e comitar, ou gerar no build). Se os browsers aceitarem SVG-only, mantém-se; senão os PNGs são o caminho seguro.
4. **\`index.html\`** — o plugin injeta \`<link rel="manifest">\` e meta \`theme-color\` automaticamente; confirmar/ajustar no build.
5. Validar sobre o **build**: \`npm run build\` → \`dist/\` deve conter \`manifest.webmanifest\` + \`sw.js\` (+ \`workbox-*.js\`); \`npm run preview\` para testar o SW (o **dev server não serve SW** por omissão).

### Ficheiros afetados
\`vite.config.ts\`, \`package.json\` (dep), \`public/icons/\` (PNGs p/ manifest) + **gerados** em \`dist/\` (\`manifest.webmanifest\`, \`sw.js\`, \`workbox-*.js\`). **Não toca** em \`src/\` (runtime) nem na API.

### Fora de scope (anotação, não implementar já)
Runtime cache *network-first* dos GET \`/api/w/*\` para leitura offline dos últimos dados — o card diz explicitamente "offline só lê cache"; fica como upgrade futuro se o BMS quiser dados offline.

## Critérios de aceite
- **Instalável**: A2HS/Lighthouse satisfeito — manifest sem erros; ícones 192/512 presentes (instalar a app a partir do \`preview\`).
- **Shell offline**: DevTools → Offline → reload carrega a UI completa; os fetches de \`/api\` falham de forma relaxada (já há \`.catch()\` no \`api.ts\`), sem crash.
- **Com rede ON**: comportamento idêntico ao atual (SW ativo não parte nada).
- **Auto-update**: novo build aplica a nova versão sem prompt/duplo control.
- \`npm run typecheck\` e \`npm run build\` verdes; porta/API continua 5173 no preview.
- Vacuum: \`grep -c '<<<<<<<'\` = 0 antes do merge.

## Riscos / considerações
- **Google Fonts (cross-origin)**: offline as fonts falham graciosamente (fallback para fonte system). Cache de respostas *opaque* de fonts externas é frágil no Workbox → fora de scope, aceite.
- **Dados offline**: fora de scope (API = rede). Se BMS quiser leitura offline, o próximo passo é runtime cache network-first de \`/api\` — mesmo plugin, +código (decisão explícita).
- **autoUpdate vs prompt**: escolho \`autoUpdate\` (sem chatear). Quem quiser controlo de versão → \`registerType:'prompt'\` + UI (mais código; decisão explícita).
- **Ícones**: alguns browsers exigem PNG 192/512 para instalar; gerar os 2 PNGs é o caminho seguro (não depender só de SVG).
- **Testar sempre no preview, não no dev**: o dev server não regista o SW — validar SW só sobre o build.
- **Workbox precache de \`data/\`**: garantir que \`globPatterns\` NÃO apanha ficheiros JSON de dados (são API, não assets) nem duplicados de \`dist\`/`data`.
