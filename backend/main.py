import json
import os
import re
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("DATABASE_PATH", BASE_DIR / "coach.db"))
app = FastAPI(title="Bravely Interview Intelligence API", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ROLE_DATA = {
    "Product Manager": {
        "skills": ["Product strategy", "Customer discovery", "Prioritization", "Stakeholder leadership", "Metrics"],
        "questions": [
            ("Behavioral", "Tell me about a consequential product decision you made with incomplete information."),
            ("Strategy", "A core product metric has plateaued for two quarters. How would you diagnose and respond?"),
            ("Leadership", "Describe a time you aligned stakeholders who strongly disagreed on product direction."),
            ("Execution", "Tell me about a launch that did not go to plan and what you changed."),
            ("Customer", "How have you used research to overturn a roadmap assumption?"),
            ("Trade-off", "Describe a difficult trade-off between user value, revenue, and engineering effort."),
            ("Prioritization", "How would you decide what not to build when every request appears urgent?"),
            ("Reflection", "What product decision would you make differently today, and why?"),
        ],
    },
    "Software Engineer": {
        "skills": ["System design", "Problem solving", "Reliability", "Collaboration", "Technical judgment"],
        "questions": [
            ("Technical", "Walk me through a difficult technical problem you solved and how you decomposed it."),
            ("System design", "How would you design a notification service that remains reliable during traffic spikes?"),
            ("Incident", "Describe a production incident you helped resolve and the prevention work that followed."),
            ("Collaboration", "Tell me about a technical direction you disagreed with and how the team decided."),
            ("Quality", "How have you balanced shipping speed, maintainability, and technical debt?"),
            ("Performance", "Tell me about a system you improved for performance or reliability."),
            ("Ownership", "Describe a project where the requirements were ambiguous. How did you create clarity?"),
            ("Growth", "Tell me about feedback that materially changed how you engineer software."),
        ],
    },
    "Marketing Manager": {
        "skills": ["Campaign strategy", "Customer insight", "Analytics", "Brand", "Cross-functional influence"],
        "questions": [
            ("Campaign", "Tell me about a campaign that underperformed and how you improved it."),
            ("Strategy", "How would you build a go-to-market plan for a product entering a crowded category?"),
            ("Analytics", "Describe a time data challenged your original marketing hypothesis."),
            ("Customer", "How have you turned customer insight into a campaign strategy?"),
            ("Leadership", "Tell me about a time sales and marketing priorities were misaligned."),
            ("Brand", "How have you protected brand consistency while moving quickly across channels?"),
            ("Experimentation", "Describe an experiment you scaled and the evidence behind that decision."),
            ("Budget", "Tell me about a marketing investment you had to defend or stop."),
        ],
    },
    "UX Designer": {
        "skills": ["User research", "Interaction design", "Design rationale", "Collaboration", "Outcomes"],
        "questions": [
            ("Case study", "Walk me through a complex design problem and how you reduced ambiguity."),
            ("Research", "Tell me about a design decision you changed because of user research."),
            ("Critique", "Describe difficult feedback on your work and how you responded."),
            ("Constraints", "Tell me about a compromise caused by technical or business constraints."),
            ("Impact", "How have you measured whether a design was successful after launch?"),
            ("Influence", "Describe a time you advocated for the user when stakeholders disagreed."),
            ("Process", "How do you decide when a design is ready to ship?"),
            ("Reflection", "Tell me about a design that failed and what it changed about your process."),
        ],
    },
}

FILLERS = ["um", "uh", "like", "basically", "actually", "you know", "sort of", "kind of"]
ACTION_WORDS = ["led", "built", "created", "decided", "analyzed", "designed", "implemented", "negotiated", "launched", "improved"]
RESULT_WORDS = ["result", "impact", "increased", "decreased", "reduced", "grew", "saved", "conversion", "revenue", "learned"]


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def db():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def init_db() -> None:
    with db() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS profiles (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS targets (
                id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, role_title TEXT NOT NULL,
                company TEXT, seniority TEXT, resume_text TEXT, job_description TEXT,
                analysis_json TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, target_id TEXT,
                role_title TEXT NOT NULL, mode TEXT NOT NULL, difficulty TEXT NOT NULL,
                interviewer_style TEXT NOT NULL, total_questions INTEGER NOT NULL,
                current_question TEXT NOT NULL, current_type TEXT NOT NULL,
                status TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT
            );
            CREATE TABLE IF NOT EXISTS answers (
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL, question_number INTEGER NOT NULL,
                question TEXT NOT NULL, answer TEXT NOT NULL, feedback_json TEXT NOT NULL,
                delivery_json TEXT NOT NULL, created_at TEXT NOT NULL
            );
            """
        )


init_db()


class ProfileRequest(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: str = Field(default="", max_length=160)


class TargetRequest(BaseModel):
    profile_id: str = "local-user"
    role_title: str
    company: str = ""
    seniority: str = "Mid-level"
    resume_text: str = Field(default="", max_length=30000)
    job_description: str = Field(default="", max_length=30000)


class SessionRequest(BaseModel):
    profile_id: str = "local-user"
    target_id: str | None = None
    role_title: str
    mode: str = "Full interview"
    difficulty: str = "Adaptive"
    interviewer_style: str = "Balanced"
    total_questions: int = Field(default=6, ge=3, le=8)


class AnswerRequest(BaseModel):
    question: str
    answer: str = Field(min_length=20, max_length=12000)
    question_number: int
    duration_seconds: int = Field(default=0, ge=0, le=3600)
    confidence: float = Field(default=0.8, ge=0, le=1)


def row_json(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def keywords(text: str, limit: int = 10) -> list[str]:
    stop = {
        "and", "the", "with", "for", "that", "this", "from", "your", "you", "our", "are",
        "will", "have", "has", "into", "about", "role", "team", "work", "years", "using",
    }
    terms = re.findall(r"[A-Za-z][A-Za-z+#.-]{2,}", text.lower())
    counts: dict[str, int] = {}
    for term in terms:
        if term not in stop:
            counts[term] = counts.get(term, 0) + 1
    return [term for term, _ in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:limit]]


def analyze_target(request: TargetRequest) -> dict[str, Any]:
    role = ROLE_DATA.get(request.role_title, ROLE_DATA["Product Manager"])
    jd_terms = keywords(request.job_description)
    resume_terms = set(keywords(request.resume_text, 30))
    matched = [term for term in jd_terms if term in resume_terms]
    gaps = [term for term in jd_terms if term not in resume_terms][:6]
    match_score = 58 if not jd_terms else min(96, 52 + round(len(matched) / max(len(jd_terms), 1) * 44))
    focus = gaps[:3] + [skill for skill in role["skills"] if skill.lower() not in resume_terms][:3]
    return {
        "match_score": match_score,
        "matched_keywords": matched[:6],
        "skill_gaps": gaps,
        "focus_areas": focus[:5],
        "likely_questions": [
            f"How has your experience prepared you to own {item}?"
            for item in (focus[:3] or role["skills"][:3])
        ],
        "positioning": (
            f"Position yourself as a {request.seniority.lower()} {request.role_title} who connects "
            "decisions to measurable outcomes and communicates trade-offs clearly."
        ),
    }


def delivery_metrics(answer: str, duration_seconds: int, confidence: float) -> dict[str, Any]:
    words = re.findall(r"\b[\w'-]+\b", answer)
    lowered = answer.lower()
    filler_counts = {filler: len(re.findall(rf"\b{re.escape(filler)}\b", lowered)) for filler in FILLERS}
    filler_counts = {key: value for key, value in filler_counts.items() if value}
    duration = duration_seconds or max(20, round(len(words) / 2.2))
    wpm = round(len(words) / (duration / 60)) if duration else 0
    pace_score = max(35, 100 - abs(wpm - 135) // 2)
    filler_total = sum(filler_counts.values())
    concision = max(45, min(98, 90 - max(0, len(words) - 230) // 4))
    return {
        "word_count": len(words),
        "duration_seconds": duration,
        "words_per_minute": wpm,
        "pace_label": "Measured" if 105 <= wpm <= 165 else ("Fast" if wpm > 165 else "Slow"),
        "pace_score": pace_score,
        "filler_count": filler_total,
        "filler_words": filler_counts,
        "concision_score": concision,
        "confidence_score": round(confidence * 100),
    }


def local_feedback(answer: str, delivery: dict[str, Any], role_title: str, target: dict[str, Any] | None) -> dict[str, Any]:
    lowered = answer.lower()
    word_count = delivery["word_count"]
    action_hits = sum(1 for word in ACTION_WORDS if re.search(rf"\b{word}\b", lowered))
    result_hits = sum(1 for word in RESULT_WORDS if re.search(rf"\b{word}\b", lowered))
    has_metric = bool(re.search(r"\d+[%x]?|\bpercent\b|\bquarter\b|\bweeks?\b", lowered))
    situation = bool(re.search(r"\bwhen\b|\bat the time\b|\bchallenge\b|\bcontext\b", lowered))
    ownership = bool(re.search(r"\bi (led|built|created|decided|owned|proposed|implemented|analyzed)\b", lowered))

    clarity = min(96, 58 + word_count // 8 + delivery["concision_score"] // 10)
    depth = min(95, 55 + word_count // 7 + action_hits * 3 + result_hits * 3)
    relevance = min(95, 68 + (7 if ownership else 0) + (5 if target else 0))
    structure = min(96, 54 + (8 if situation else 0) + (12 if ownership else 0) + (12 if result_hits else 0))
    delivery_score = round((delivery["pace_score"] + delivery["concision_score"] + max(40, 100 - delivery["filler_count"] * 7)) / 3)
    overall = round((clarity + depth + relevance + structure + delivery_score) / 5)

    improvements = []
    if not ownership:
        improvements.append("Make your individual ownership unmistakable by using a precise 'I' statement.")
    if not has_metric:
        improvements.append("Add a number, baseline, or observable outcome to prove the impact.")
    if not result_hits:
        improvements.append("Complete the story with the result, lesson, and what changed afterward.")
    if word_count < 70:
        improvements.append("Develop the example with one more decision point or trade-off.")
    if delivery["filler_count"] > 2:
        improvements.append("Replace filler words with a short pause to sound more deliberate.")
    improvements.append("Open with a concise headline so the interviewer knows where the story is going.")

    strengths = [
        "Your response stays connected to a concrete professional situation.",
        "The answer sounds natural rather than memorized.",
        "You communicate a decision-making process the interviewer can evaluate.",
    ]
    if ownership:
        strengths[0] = "Your personal ownership is visible through specific actions."
    if has_metric:
        strengths[1] = "You support your story with measurable evidence."

    target_note = ""
    if target and target.get("focus_areas"):
        target_note = f" For this target, connect the story more directly to {target['focus_areas'][0]}."

    return {
        "overall_score": overall,
        "summary": (
            f"This is a credible {role_title} answer with a solid core. Your next gain comes from "
            f"tightening the opening and making the final impact undeniable.{target_note}"
        ),
        "scores": {
            "clarity": clarity, "depth": depth, "relevance": relevance,
            "structure": structure, "delivery": delivery_score,
        },
        "strengths": strengths,
        "improvements": improvements[:3],
        "better_answer": (
            "Lead with the outcome in one sentence. Set the context briefly, name the decision you "
            "personally owned, and explain the two most important actions and the trade-off behind "
            "them. Close with a measurable result and the lesson you carried into your next project."
        ),
        "star": {
            "situation": 82 if situation else 58,
            "task": 84 if ownership else 62,
            "action": min(95, 62 + action_hits * 8),
            "result": 88 if has_metric and result_hits else (72 if result_hits else 52),
        },
    }


async def provider_json(system: str, prompt: str) -> dict[str, Any] | None:
    ollama_url = os.getenv("OLLAMA_URL", "").rstrip("/")
    if ollama_url:
        async with httpx.AsyncClient(timeout=90) as client:
            response = await client.post(
                f"{ollama_url}/api/chat",
                json={
                    "model": os.getenv("OLLAMA_MODEL", "qwen2.5:7b"),
                    "stream": False,
                    "format": "json",
                    "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                },
            )
            response.raise_for_status()
            return json.loads(response.json()["message"]["content"])

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if api_key:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
                json={
                    "model": os.getenv("CLAUDE_MODEL", "claude-sonnet-4-20250514"),
                    "max_tokens": 1600,
                    "system": system,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            response.raise_for_status()
            text = response.json()["content"][0]["text"]
            match = re.search(r"\{.*\}", text, re.S)
            return json.loads(match.group(0)) if match else None
    return None


def get_target(connection: sqlite3.Connection, target_id: str | None) -> dict[str, Any] | None:
    if not target_id:
        return None
    row = connection.execute("SELECT analysis_json FROM targets WHERE id = ?", (target_id,)).fetchone()
    return json.loads(row["analysis_json"]) if row else None


def next_question(session: dict[str, Any], answer: str, score: int, number: int, target: dict[str, Any] | None) -> tuple[str, str]:
    role = ROLE_DATA.get(session["role_title"], ROLE_DATA["Product Manager"])
    lowered = answer.lower()
    if number < session["total_questions"] and score < 70:
        if not re.search(r"\d", answer):
            return "Follow-up", "What measurable result came from that work, and how did you know it mattered?"
        if not re.search(r"\bi (led|built|created|decided|owned|implemented)\b", lowered):
            return "Follow-up", "What did you personally own in that situation, separate from the team?"
    if target and number == 2 and target.get("skill_gaps"):
        gap = target["skill_gaps"][0]
        return "Targeted", f"This role emphasizes {gap}. Tell me about an experience that demonstrates your capability there."
    index = min(number, len(role["questions"]) - 1)
    return role["questions"][index]


@app.get("/api/health")
def health() -> dict[str, Any]:
    provider = "ollama" if os.getenv("OLLAMA_URL") else ("claude" if os.getenv("ANTHROPIC_API_KEY") else "local")
    return {"status": "ok", "provider": provider, "database": str(DB_PATH.name)}


@app.get("/api/roles")
def roles() -> list[dict[str, Any]]:
    return [{"title": title, **data} for title, data in ROLE_DATA.items()]


@app.post("/api/profiles")
def create_profile(request: ProfileRequest) -> dict[str, Any]:
    profile_id = "local-user"
    with db() as connection:
        connection.execute(
            "INSERT OR REPLACE INTO profiles (id, name, email, created_at) VALUES (?, ?, ?, ?)",
            (profile_id, request.name, request.email, now()),
        )
    return {"id": profile_id, **request.model_dump()}


@app.post("/api/targets")
def create_target(request: TargetRequest) -> dict[str, Any]:
    target_id = str(uuid.uuid4())
    analysis = analyze_target(request)
    with db() as connection:
        connection.execute(
            """INSERT INTO targets
            (id, profile_id, role_title, company, seniority, resume_text, job_description, analysis_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                target_id, request.profile_id, request.role_title, request.company, request.seniority,
                request.resume_text, request.job_description, json.dumps(analysis), now(),
            ),
        )
    return {"id": target_id, **request.model_dump(), "analysis": analysis}


@app.post("/api/sessions")
def create_session(request: SessionRequest) -> dict[str, Any]:
    role = ROLE_DATA.get(request.role_title, ROLE_DATA["Product Manager"])
    question_type, question = role["questions"][0]
    session_id = str(uuid.uuid4())
    with db() as connection:
        connection.execute(
            """INSERT INTO sessions
            (id, profile_id, target_id, role_title, mode, difficulty, interviewer_style,
             total_questions, current_question, current_type, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)""",
            (
                session_id, request.profile_id, request.target_id, request.role_title, request.mode,
                request.difficulty, request.interviewer_style, request.total_questions,
                question, question_type, now(),
            ),
        )
    return {
        "session_id": session_id, "question": question, "question_type": question_type,
        "total_questions": request.total_questions, "provider": health()["provider"],
    }


@app.post("/api/sessions/{session_id}/answers")
async def evaluate_answer(session_id: str, request: AnswerRequest) -> dict[str, Any]:
    with db() as connection:
        row = connection.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Session not found")
        session = row_json(row)
        target = get_target(connection, session["target_id"])

    delivery = delivery_metrics(request.answer, request.duration_seconds, request.confidence)
    feedback = local_feedback(request.answer, delivery, session["role_title"], target)
    system = (
        "You are a rigorous executive interview coach. Return JSON only. Preserve keys overall_score, "
        "summary, scores (clarity, depth, relevance, structure, delivery), strengths, improvements, "
        "better_answer, and star (situation, task, action, result). Scores are integers from 0 to 100."
    )
    prompt = json.dumps({
        "role": session["role_title"], "mode": session["mode"], "style": session["interviewer_style"],
        "target_analysis": target, "question": request.question, "answer": request.answer,
        "delivery": delivery, "baseline_feedback": feedback,
    })
    try:
        ai_feedback = await provider_json(system, prompt)
        if ai_feedback and all(key in ai_feedback for key in ("overall_score", "scores", "strengths", "improvements")):
            feedback = {**feedback, **ai_feedback}
    except (httpx.HTTPError, json.JSONDecodeError, KeyError, TypeError):
        pass

    question_type, following = next_question(
        session, request.answer, int(feedback["overall_score"]), request.question_number, target
    )
    completed = request.question_number >= session["total_questions"]
    with db() as connection:
        connection.execute(
            """INSERT INTO answers
            (id, session_id, question_number, question, answer, feedback_json, delivery_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                str(uuid.uuid4()), session_id, request.question_number, request.question,
                request.answer, json.dumps(feedback), json.dumps(delivery), now(),
            ),
        )
        connection.execute(
            """UPDATE sessions SET current_question = ?, current_type = ?, status = ?,
            completed_at = ? WHERE id = ?""",
            (following, question_type, "completed" if completed else "active", now() if completed else None, session_id),
        )
    return {
        "feedback": feedback, "delivery": delivery, "next_question": following,
        "next_question_type": question_type, "completed": completed,
    }


def session_report(connection: sqlite3.Connection, session_id: str) -> dict[str, Any]:
    session_row = connection.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
    if not session_row:
        raise HTTPException(status_code=404, detail="Session not found")
    session = row_json(session_row)
    answer_rows = connection.execute(
        "SELECT * FROM answers WHERE session_id = ? ORDER BY question_number", (session_id,)
    ).fetchall()
    answers = []
    score_totals: dict[str, list[int]] = {}
    for row in answer_rows:
        feedback = json.loads(row["feedback_json"])
        delivery = json.loads(row["delivery_json"])
        for key, value in feedback["scores"].items():
            score_totals.setdefault(key, []).append(int(value))
        answers.append({
            "question_number": row["question_number"], "question": row["question"],
            "answer": row["answer"], "feedback": feedback, "delivery": delivery,
        })
    averages = {key: round(sum(values) / len(values)) for key, values in score_totals.items()} if answers else {}
    overall = round(sum(item["feedback"]["overall_score"] for item in answers) / len(answers)) if answers else 0
    return {
        "session": session, "answers": answers, "overall_score": overall, "averages": averages,
        "top_strength": max(averages, key=averages.get).title() if averages else "Not available",
        "focus_area": min(averages, key=averages.get).title() if averages else "Not available",
        "recommendations": [
            "Build a bank of five stories with clear metrics and distinct leadership signals.",
            "Practice a 15-second headline before each detailed answer.",
            "Repeat your lowest-scoring competency in a focused drill.",
        ],
    }


@app.get("/api/sessions/{session_id}/report")
def get_report(session_id: str) -> dict[str, Any]:
    with db() as connection:
        return session_report(connection, session_id)


@app.get("/api/dashboard/{profile_id}")
def dashboard(profile_id: str) -> dict[str, Any]:
    with db() as connection:
        rows = connection.execute(
            """SELECT s.*, COUNT(a.id) AS answer_count
            FROM sessions s LEFT JOIN answers a ON a.session_id = s.id
            WHERE s.profile_id = ? GROUP BY s.id ORDER BY s.created_at DESC""",
            (profile_id,),
        ).fetchall()
        sessions = []
        scores = []
        for row in rows:
            item = row_json(row)
            answer_scores = connection.execute(
                "SELECT feedback_json FROM answers WHERE session_id = ?", (item["id"],)
            ).fetchall()
            item_scores = [json.loads(answer["feedback_json"])["overall_score"] for answer in answer_scores]
            item["score"] = round(sum(item_scores) / len(item_scores)) if item_scores else 0
            scores.extend(item_scores)
            sessions.append(item)
        return {
            "sessions": sessions,
            "stats": {
                "total_sessions": len(sessions),
                "questions_answered": sum(item["answer_count"] for item in sessions),
                "average_score": round(sum(scores) / len(scores)) if scores else 0,
                "best_score": max(scores) if scores else 0,
            },
            "trend": [item["score"] for item in reversed(sessions[:8]) if item["score"]],
        }


@app.get("/api/sessions/{session_id}/export", response_class=PlainTextResponse)
def export_report(session_id: str) -> str:
    with db() as connection:
        report = session_report(connection, session_id)
    session = report["session"]
    lines = [
        f"# Bravely Interview Report: {session['role_title']}",
        "", f"Overall score: {report['overall_score']}/100",
        f"Strongest area: {report['top_strength']}", f"Focus area: {report['focus_area']}", "",
        "## Competency scores",
    ]
    lines.extend(f"- {key.title()}: {value}/100" for key, value in report["averages"].items())
    for item in report["answers"]:
        lines.extend([
            "", f"## Question {item['question_number']}", item["question"], "",
            f"Score: {item['feedback']['overall_score']}/100", item["feedback"]["summary"], "",
            "Improvements:",
            *[f"- {point}" for point in item["feedback"]["improvements"]],
        ])
    return "\n".join(lines)
