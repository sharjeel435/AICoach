import json
import os
import re
import uuid
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv()

app = FastAPI(title="Bravely Interview Coach API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SESSIONS: dict[str, dict[str, Any]] = {}

QUESTION_BANK = {
    "Product Manager": [
        "Tell me about a time you had to make an important product decision with incomplete information. What did you do, and what happened?",
        "Describe a feature you chose not to build. How did you reach that decision and bring stakeholders along?",
        "Tell me about a product launch that did not go as planned. How did you respond?",
        "How have you used customer research to change a product roadmap?",
        "Describe a difficult trade-off you made between user needs and business goals.",
        "Tell me about a time you influenced a team without direct authority.",
    ],
    "Software Engineer": [
        "Tell me about a difficult technical problem you solved. How did you break it down?",
        "Describe a time you disagreed with a technical direction. What did you do?",
        "Walk me through a production incident you helped resolve and what changed afterward.",
        "Tell me about a system you improved for performance, reliability, or maintainability.",
        "How have you balanced shipping quickly with paying down technical debt?",
        "Describe a time you helped another engineer grow.",
    ],
    "Marketing Manager": [
        "Tell me about a campaign that underperformed. How did you diagnose and improve it?",
        "Describe how you turned a customer insight into a marketing strategy.",
        "Tell me about a time you had to defend a marketing investment with data.",
        "How have you kept a brand consistent across teams or channels?",
        "Describe a successful experiment and what made it worth scaling.",
        "Tell me about a time sales and marketing priorities were misaligned.",
    ],
    "UX Designer": [
        "Tell me about a design decision you changed because of user research.",
        "Describe a time you received difficult feedback on your work. How did you respond?",
        "Walk me through a complex design problem and how you reduced ambiguity.",
        "Tell me about a compromise you made because of technical or business constraints.",
        "How have you measured whether a design was successful after launch?",
        "Describe a time you advocated for the user when stakeholders disagreed.",
    ],
}


class SessionRequest(BaseModel):
    role_id: str
    role_title: str
    total_questions: int = Field(default=6, ge=1, le=10)


class AnswerRequest(BaseModel):
    question: str
    answer: str = Field(min_length=20, max_length=10000)
    question_number: int
    role_title: str


def local_feedback(answer: str) -> dict[str, Any]:
    words = answer.split()
    has_numbers = bool(re.search(r"\d|percent|increased|decreased|grew|reduced", answer, re.I))
    has_actions = bool(re.search(r"\b(I led|I created|I decided|I analyzed|I built|I worked)\b", answer, re.I))
    has_result = bool(re.search(r"\b(result|outcome|impact|learned|ultimately|as a result)\b", answer, re.I))

    clarity = min(92, 62 + len(words) // 7 + (6 if has_actions else 0))
    depth = min(90, 58 + len(words) // 6 + (7 if has_result else 0))
    relevance = min(91, 70 + len(words) // 12)
    structure = min(90, 61 + (9 if has_actions else 0) + (10 if has_result else 0))
    overall = round((clarity + depth + relevance + structure) / 4)

    improvements = []
    if not has_numbers:
        improvements.append("Add a measurable result so the impact is easy to understand.")
    if not has_actions:
        improvements.append("Separate your own actions from what the broader team did.")
    if not has_result:
        improvements.append("Close the story with the outcome and what you learned.")
    improvements.append("Open with a one-sentence headline before adding context.")

    return {
        "overall_score": overall,
        "summary": (
            "Your answer has a credible core and gives the interviewer useful context. "
            "The strongest next step is to make your ownership and the final impact more explicit."
        ),
        "scores": {
            "clarity": clarity,
            "depth": depth,
            "relevance": relevance,
            "structure": structure,
        },
        "strengths": [
            "You used a specific situation instead of speaking only in generalities.",
            "Your answer shows how you think through a real workplace challenge.",
            "The tone feels grounded and conversational.",
        ],
        "improvements": improvements[:3],
        "better_answer": (
            "I would lead with the outcome, then briefly set the context. I would explain the "
            "specific decision I owned, the two or three actions I took, and the trade-off behind "
            "them. I would close with a measurable result and one lesson that shaped how I work now."
        ),
    }


async def claude_json(system: str, prompt: str) -> dict[str, Any] | None:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return None

    async with httpx.AsyncClient(timeout=45) as client:
        response = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": os.getenv("CLAUDE_MODEL", "claude-sonnet-4-20250514"),
                "max_tokens": 1400,
                "temperature": 0.4,
                "system": system,
                "messages": [{"role": "user", "content": prompt}],
            },
        )
        response.raise_for_status()
        text = response.json()["content"][0]["text"]
        match = re.search(r"\{.*\}", text, re.S)
        return json.loads(match.group(0)) if match else None


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "mode": "claude" if os.getenv("ANTHROPIC_API_KEY") else "demo"}


@app.post("/api/sessions")
def create_session(request: SessionRequest) -> dict[str, Any]:
    questions = QUESTION_BANK.get(request.role_title, QUESTION_BANK["Product Manager"])
    session_id = str(uuid.uuid4())
    SESSIONS[session_id] = {
        "role": request.role_title,
        "questions": questions,
        "answers": [],
        "total_questions": request.total_questions,
    }
    return {
        "session_id": session_id,
        "question": questions[0],
        "question_type": "Behavioral",
        "total_questions": request.total_questions,
        "demo_mode": not bool(os.getenv("ANTHROPIC_API_KEY")),
    }


@app.post("/api/sessions/{session_id}/answers")
async def evaluate_answer(session_id: str, request: AnswerRequest) -> dict[str, Any]:
    session = SESSIONS.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    system = (
        "You are an incisive, encouraging interview coach. Evaluate the candidate's answer for "
        "clarity, depth, relevance, and structure. Be specific, practical, and honest. Return only "
        "valid JSON with keys: overall_score (integer), summary (string), scores (object with clarity, "
        "depth, relevance, structure integers), strengths (3 strings), improvements (3 strings), "
        "better_answer (string)."
    )
    prompt = (
        f"Role: {request.role_title}\nQuestion: {request.question}\n"
        f"Candidate answer: {request.answer}"
    )

    try:
        feedback = await claude_json(system, prompt) or local_feedback(request.answer)
    except (httpx.HTTPError, KeyError, json.JSONDecodeError):
        feedback = local_feedback(request.answer)

    session["answers"].append({"question": request.question, "answer": request.answer, "feedback": feedback})
    questions = session["questions"]
    next_index = min(request.question_number, len(questions) - 1)

    return {
        "feedback": feedback,
        "next_question": questions[next_index],
    }
