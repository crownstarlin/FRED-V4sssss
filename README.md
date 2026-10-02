# FRED V4 — Online Deployment Ready

Final planned FRED release for now. Black-and-white personal AI assistant foundation.

## Local run
Requires Node.js 18+.

```bash
npm install
npm start
```

Open `http://localhost:8787`.

## Production deployment
This package is prepared for a Node web-service host. The server binds to `0.0.0.0` and uses the host-provided `PORT`, which is required by hosts such as Render. It also exposes `/api/health` for health checks.

### Option A — Render
1. Put the contents of this folder in a GitHub repository.
2. In Render, create a **Web Service** from that repository.
3. Render can use the included `render.yaml`; alternatively use build command `npm install` and start command `npm start`.
4. Add `AI_API_KEY` and `AI_MODEL` in Render's Environment settings. Do not commit secret values. Render supports environment variables/secrets specifically for this purpose.
5. The health check is `/api/health`.
6. Render will provide a public `onrender.com` URL.

### Option B — Railway
1. Put the contents of this folder in a GitHub repository.
2. Create a Railway service from the repository.
3. Add `AI_API_KEY`, `AI_MODEL`, and optionally `AI_BASE_URL` under the service Variables.
4. Generate a public domain for the service.

Railway makes service variables available to the running application and recommends keeping secrets in variables rather than source code.

## AI setup
Copy `.env.example` to `.env` for local development and set:

```text
AI_API_KEY=your_secret_key
AI_MODEL=your_model_name
AI_BASE_URL=https://api.openai.com/v1
```

Never put secret keys in `public/`, browser JavaScript, or a public GitHub repository. Environment variables are read by the Node server at runtime.

## Endpoints
- `GET /api/health` — liveness/health check
- `GET /api/ready` — readiness check; returns 503 until an AI provider is configured
- `GET /api/config` — non-secret feature/config status
- `POST /api/chat` — AI gateway + calculator
- `POST /api/upload` — image-upload connection point
- `POST /api/action` — Android native-action connection point

## Included
- AI gateway
- local device memory foundation
- calculator
- voice input/output where browser supports it
- image upload connection point
- Android native-action bridge foundation
- agent/task, web research and vision connection points
- PWA shell
- backend diagnostics
- production host/port support
- graceful shutdown
- basic security headers
- Render + Railway deployment configuration
