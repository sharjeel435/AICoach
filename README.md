# Bravely — AI Interview Coach

A polished interview practice app with role-specific questions, voice input,
session progress, and detailed AI feedback.

## Run locally

```powershell
npm install
pip install -r backend/requirements.txt
Copy-Item .env.example .env
```

Add an Anthropic API key to `.env` for live Claude feedback. Without a key, the
app uses its built-in demo evaluator and remains fully usable.

Start the API:

```powershell
uvicorn backend.main:app --reload
```

In a second terminal, start the React app:

```powershell
npm run dev
```

Open `http://localhost:5173`.

## Features

- Four role-specific interview tracks
- Six-question guided sessions
- Browser speech-to-text and spoken questions
- Feedback across clarity, depth, relevance, and structure
- Specific strengths, improvements, and a stronger-answer example
- End-of-session score and answer review
- Responsive mobile and desktop layouts
