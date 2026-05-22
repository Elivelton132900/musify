# 🎵 Musify Backend

Backend para redescoberta de músicas “esquecidas” através da comparação de histórico de escuta entre **Spotify** e **Last.fm**.  
Utiliza **BullMQ** e **Redis** para processamento assíncrono de tarefas longas, cache de resultados e endpoints REST para gerenciamento de jobs (criar, consultar status, cancelar, excluir).

## ✨ Funcionalidades

- **Integração com Spotify**
  - Login via OAuth
  - Busca de top tracks (`short_term`, `medium_term`, `long_term`)
  - Busca de músicas curtidas (`loved_tracks`)
  - Comparação entre dois períodos para encontrar músicas não mais ouvidas

- **Integração com Last.fm**
  - Busca de scrobbles recentes com intervalos de data flexíveis
  - Filtro de músicas não ouvidas nos últimos N dias
  - Deduplicação, limite distinto por artista, filtro por playcount

- **Fusão (Spotify × Last.fm)**
  - Combina as músicas curtidas do Spotify com o histórico do Last.fm para encontrar músicas verdadeiramente esquecidas
  - Compara as curtidas do Spotify contra o histórico do Last.fm

- **Sistema de Filas (Jobs)**
  - Tarefas assíncronas com BullMQ + Redis
  - Estados do job: `waiting`, `active`, `completed`, `failed`
  - Cancelamento e exclusão graciosos
  - Cache automático (Redis) de resultados intermediários para acelerar requisições repetidas

- **Segurança**
  - Autenticação JWT para sessões do Spotify (cookie httpOnly)
  - Proteção CSRF em endpoints modificadores
  - Validação de entrada com `celebrate`/Joi
  - Restrição baseada no usuário para cancelamento/exclusão de jobs

## ✅ Testes
- Jest
- Vitest
- Supertest
- Testes unitários
- Testes de integração de APIs
  
## 🧱 Tecnologias

- **Runtime**: Node.js (ES2022)
- **Linguagem**: TypeScript
- **Framework**: Express
- **Filas**: BullMQ
- **Cache/Banco de dados**: Redis (IORedis)
- **APIs externas**: Spotify Web API, Last.fm API
- **Autenticação**: JWT, cookies httpOnly
- **Validação**: Celebrate (Joi)
- **Outros**: Axios, dayjs, zlib (compressão)

## 📁 Estrutura de pastas (resumida)

- `src/`
  - `controllers/` – Lógica dos endpoints
  - `models/` – Interfaces, classes e schemas Joi
  - `middlewares/` – Autenticação, CSRF, validação de datas, prevenção de jobs duplicados
  - `queues/` – Definição das filas BullMQ
  - `services/` – Regras de negócio (SpotifyService, LastFmFetcherService)
  - `utils/` – Utilitários (mappers, funções auxiliares, requisições seguras)
  - `workers/` – Processadores de fila (Spotify, Last.fm, Fusion)
  - `infra/` – Conexão com Redis
  - `routes/` – Definição das rotas Express

## 🚀 Configuração e execução

### Pré‑requisitos

- Node.js 20+
- Redis (local ou remoto)
- Contas de desenvolvedor no [Spotify](https://developer.spotify.com/) e [Last.fm](https://www.last.fm/api/account/create)

### Como obter as credenciais

- **Spotify**: Crie uma aplicação em [Spotify Developer Dashboard](https://developer.spotify.com/dashboard). Anote o `Client ID` e `Client Secret`. Adicione `http://localhost:3000/callbackspotify` (ou a URL do ngrok) como Redirect URI.
- **Last.fm**: Acesse [Last.fm API](https://www.last.fm/api/account/create) e gere sua `API Key` e `Shared Secret`.

### Variáveis de ambiente

Crie um arquivo `.env` na raiz com as seguintes variáveis:

```env
SPOTIFY_CLIENT_ID=seu_client_id
SPOTIFY_CLIENT_SECRET=seu_client_secret
SPOTIFY_REDIRECT_URI_LOGIN=http://localhost:3000/callbackspotify

LAST_FM_API_KEY=sua_api_key
LAST_FM_SHARED_SECRET=seu_shared_secret

JWT_SECRET=uma_chave_secreta_forte

REDIS_HOST=localhost
REDIS_PORT=6379
```

### Instalação das dependências

npm install

### Por que usar ngrok?

- **Callbacks OAuth**: O Spotify e o Last.fm exigem uma URI de redirecionamento pública e acessível via HTTPS.
- **Testes com frontend remoto**: Permite que um aplicativo frontend (ex: React, mobile) em outra rede acesse sua API.

### Como configurar

1. **Instale o ngrok**  
   Baixe em [ngrok.com](https://ngrok.com/) e siga as instruções de instalação.

2. **Inicie o servidor local**  
   npm run start
3. Exponha sua porta 3000
   No terminal, digite ngrok http 3000
   Você verá uma URL pública como https://abc123.ngrok-free.dev.
   Exemplo de uso: https://abc123.ngrok-free.dev/spotify/loved-tracks/comparison-jobs (endpoint de comparação de jobs)
4. No arquivo .env, altere SPOTIFY_REDIRECT_URI_LOGIN para usar a URL do ngrok. Exemplo: SPOTIFY_REDIRECT_URI_LOGIN=https://abc123.ngrok-free.dev/callbackspotify
5. Ajuste o CORS (se necessário). Exemplo: app.use(
   cors({
   origin: "https://abc123.ngrok-free.dev/",
   credentials: true, // permite envio de cookies
   }),
   )

## Workers separados (opcional)

### Cada worker pode ser executado individualmente para escalabilidade:

```
npm run worker:rediscover-spotify     # Apenas Spotify
npm run worker:rediscover-last-fm     # Apenas Last.fm
npm run worker:rediscover-fusion      # Fusão entre os dois
```

## 🔌 Endpoints principais

## Autenticação Spotify

| Método | Rota               | Descrição                         |
| ------ | ------------------ | --------------------------------- |
| GET    | `/loginspotify`    | Redireciona para login do Spotify |
| GET    | `/callbackspotify` | Callback OAuth, seta cookie       |

### Spotify – Comparação entre períodos

| Método | Rota                                       | Descrição                         |
| ------ | ------------------------------------------ | --------------------------------- |
| POST   | `/spotify/loved-tracks/comparison-jobs`    | Cria job comparando dois períodos |
| GET    | `/spotify/loved-tracks/jobs/:jobId`        | Status e resultado do job         |
| POST   | `/spotify/loved-tracks/jobs/:jobId/cancel` | Cancela job em andamento          |
| DELETE | `/spotify/loved-tracks/jobs/:jobId`        | Exclui job (se não estiver ativo) |

## Last.fm – Redescobrir músicas não ouvidas

| Método | Rota                                      | Descrição                                         |
| ------ | ----------------------------------------- | ------------------------------------------------- |
| POST   | `/lastfm/loved-tracks/jobs`               | Cria job com intervalo de datas e dias de análise |
| GET    | `/lastfm/loved-tracks/jobs/:jobId`        | Consulta status                                   |
| POST   | `/lastfm/loved-tracks/jobs/:jobId/cancel` | Cancela job                                       |
| DELETE | `/lastfm/loved-tracks/jobs/:jobId`        | Exclui job                                        |

## Exemplo de corpo da Requisição

```json
{
  "fetchInDays": 30,
  "distinct": 5,
  "comparisonFrom": "2025-06-01",
  "comparisonTo": "2025-06-01",
  "candidateFrom": "2026-01-01",
  "candidateTo": "2026-05-19",
  "lastFmUser": "meu_usuario"
}
```

## Fusão (Spotify Loved Tracks × Last.fm)

| Método | Rota                                                      | Descrição                                     |
| ------ | --------------------------------------------------------- | --------------------------------------------- |
| POST   | `/fusion/loved-tracks/jobs`                               | Cria job que compara loved tracks com Last.fm |
| GET    | `/fusion/loved-tracks/jobs/:jobId`                        | Status do job                                 |
| POST   | `/fusion/loved-tracks/jobs/:jobId/cancel`                 | Cancela job                                   |
| DELETE | `/fusion/loved-tracks/jobs/:jobId/:lastFmUser/:spotifyId` | Exclui job (valida usuário)                   |

## Exemplo de corpo:

```
{
  "compare": {
    "firstCompare": "long_term",
    "secondCompare": "loved_tracks"
  },
  "lastFmUser": "meu_usuario"
}
```

## 🧠 Como funciona o processamento

1. O cliente envia uma requisição para criar um job.
2. O job é enfileirado no BullMQ.
3. O worker correspondente executa:
   Busca dados das APIs (Spotify/Last.fm) com paginação e tolerância a falhas.
   Utiliza Redis como cache para evitar chamadas repetidas nas mesmas faixas/períodos.
   Aplica lógica de diferença entre conjuntos (ex: músicas que existiam no período antigo mas não no recente).
   No caso da fusão, cruza as loved tracks do Spotify com o histórico do Last.fm para filtrar as realmente não escutadas.

4. O resultado fica disponível via endpoint de consulta.
5. O cliente pode cancelar ou excluir jobs (cancelamento aborta a execução ativa).


## Em breve vídeo demonstrando funcionamento da API.
