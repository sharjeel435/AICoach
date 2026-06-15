# AICoachy - AI Interview Intelligence

AICoachy is a local-first interview coaching workspace. It creates targeted
mock interviews, accepts voice or typed answers, analyzes answer quality and
delivery, adapts follow-up questions, and saves detailed performance reports.

The complete product works without an API key. Optionally, connect GPT-4 or
a free local Ollama model for deeper language-model feedback.

## Product capabilities

- Professional command-center dashboard with progress trends
- Secure registration and login with revocable HttpOnly cookie sessions
- Multi-role access control for candidates, coaches, and administrators
- Admin user-management screen for assigning multiple roles
- Product, engineering, marketing, and UX interview tracks
- Resume and job-description targeting
- Keyword match, skill-gap, positioning, and likely-question analysis
- Full interview, behavioral drill, role deep-dive, and rapid-fire modes
- Five interviewer personas that change question tone, scoring strictness, and feedback language
- Frontend-only real-time answer coaching with structure, confidence, depth, and evidence signals
- Supportive, adaptive, and challenging difficulty levels
- Browser voice transcription and spoken interview questions
- Adaptive follow-ups when an answer lacks ownership, evidence, or outcomes
- Scoring for clarity, depth, relevance, structure, and delivery
- Instant exact-question model answers with side-by-side comparison
- Specific gap analysis showing what separates the response from a 10/10 example
- Speaking pace, filler-word, length, and concision analytics
- STAR component analysis and stronger-answer coaching
- Persistent SQLite sessions, answers, targets, scores, and history
- Radar reports, competency trends, answer review, and Markdown export
- Professional interview replay timeline with timing, weaknesses, improvements, and follow-ups
- One-click weakness practice sessions linked to the original interview
- Interview-derived resume skills, missing keywords, bullet suggestions, and project ideas
- Responsive desktop and mobile design

## Run locally

Install dependencies:

```powershell
npm install
python -m pip install -r backend/requirements.txt
```

Start the complete development environment:

```powershell
npm run dev
```

This launches both FastAPI on `http://localhost:8000` and Vite on
`http://localhost:5173`. To run them separately:

```powershell
npm run dev:api
npm run dev:web
```

Open `http://localhost:5173`.

## Free local AI with Ollama

AICoachy does not require Ollama, but it can use it for richer adaptive feedback.

1. Install Ollama from `https://ollama.com`.
2. Download a model:

```powershell
ollama pull qwen2.5:7b
```

3. Create `.env`:

```env
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b
DATABASE_PATH=backend/coach.db
```

Restart the API. The provider indicator in the sidebar will show `ollama
connected`.

## OpenAI GPT-4

Create `.env` and keep the key on the FastAPI server:

```env
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4
ADMIN_EMAIL=admin@example.com
```

The browser never receives the OpenAI key. When both OpenAI and Ollama are
configured, OpenAI is used first. Without either provider, the deterministic
local coaching engine remains fully functional.

Never put real credentials in `.env.example`, frontend variables, source files,
or Docker images. Keep local secrets in `.env`, which is ignored by Git and
Docker. In production, configure `OPENAI_API_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` through the hosting platform's encrypted secret
manager. Enable GitHub secret scanning and push protection for the repository.

Set `COOKIE_SECURE=true` when serving the application over HTTPS.
Set `ALLOWED_ORIGINS` and `ALLOWED_HOSTS` to the exact production domains.

`ADMIN_EMAIL` grants the `admin` role when that email registers. Administrators
can assign any combination of `candidate`, `coach`, and `admin` roles. Candidate
data is owner-scoped; coaches and administrators can access other workspaces
through authorized API calls.

## Optional Supabase persistence

SQLite remains the default and requires no hosted account. Supabase can be
enabled as an additional persistence destination for interview sessions and
generated session summaries.

1. Run [`backend/supabase_migration.sql`](backend/supabase_migration.sql) in
   the Supabase SQL editor.
2. Add these server-only values to `.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

3. Restart FastAPI.

Only FastAPI reads the service-role key. It is never included in the Vite
bundle or exposed to browser code. The migration uses UUID parent session IDs
because AICoachy's existing session identifiers are UUIDs.

The Supabase migration enables and forces Row Level Security, revokes table
access from `anon` and `authenticated`, and leaves access exclusively to the
FastAPI service-role connection. Use encrypted storage for the SQLite volume or
the Supabase project when encryption at rest is required.

## Docker

```powershell
docker compose up --build
```

Open `http://localhost:8080`. Interview data is persisted in the
`coach-data` Docker volume.

## Architecture

- `React 19` and `Vite 8` for the application interface
- `FastAPI` for targeting, coaching, analytics, reports, and exports
- Salted scrypt password hashing and hashed, revocable 14-day HttpOnly sessions
- `SQLite` for durable local persistence
- Optional Supabase REST persistence, called exclusively by FastAPI
- `Web Speech API` for browser speech-to-text
- Built-in deterministic coaching engine for no-key operation
- Optional OpenAI GPT-4 and Ollama provider adapters

## Verification

```powershell
npm run lint
npm run build
python -m compileall backend
```
