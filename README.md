# AICoachy - AI Interview Intelligence

AICoachy is a local-first interview coaching workspace. It creates targeted
mock interviews, accepts voice or typed answers, analyzes answer quality and
delivery, adapts follow-up questions, and saves detailed performance reports.

The complete product works without an API key. Optionally, connect a free local
Ollama model or Claude for deeper language-model feedback.

## Product capabilities

- Professional command-center dashboard with progress trends
- Product, engineering, marketing, and UX interview tracks
- Resume and job-description targeting
- Keyword match, skill-gap, positioning, and likely-question analysis
- Full interview, behavioral drill, role deep-dive, and rapid-fire modes
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
- Responsive desktop and mobile design

## Run locally

Install dependencies:

```powershell
npm install
python -m pip install -r backend/requirements.txt
```

Start the API:

```powershell
python -m uvicorn backend.main:app --reload
```

Start the React application in a second terminal:

```powershell
npm run dev
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

## Docker

```powershell
docker compose up --build
```

Open `http://localhost:8080`. Interview data is persisted in the
`coach-data` Docker volume.

## Architecture

- `React 19` and `Vite 8` for the application interface
- `FastAPI` for targeting, coaching, analytics, reports, and exports
- `SQLite` for durable local persistence
- `Web Speech API` for browser speech-to-text
- Built-in deterministic coaching engine for no-key operation
- Optional Ollama and Anthropic provider adapters

## Verification

```powershell
npm run lint
npm run build
python -m compileall backend
```
