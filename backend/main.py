import json
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import Cookie, Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("DATABASE_PATH", BASE_DIR / "coach.db"))
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if origin.strip()
]
app = FastAPI(title="AICoachy Interview Intelligence API", version="2.0.0")


def validate_server_secrets() -> None:
    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if bool(supabase_url) != bool(supabase_key):
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured together")
    if supabase_key and (
        supabase_key.startswith("sb_publishable_")
        or supabase_key.startswith("replace_")
        or supabase_key == "your_service_role_key"
    ):
        raise RuntimeError(
            "SUPABASE_SERVICE_ROLE_KEY must contain a server-side service role key, not a publishable key"
        )


validate_server_secrets()
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=[
        host.strip()
        for host in os.getenv("ALLOWED_HOSTS", "localhost,127.0.0.1,testserver").split(",")
        if host.strip()
    ],
)


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        origin = request.headers.get("origin")
        uses_cookie = bool(request.cookies.get("aicoachy_session"))
        uses_bearer = request.headers.get("authorization", "").startswith("Bearer ")
        if uses_cookie and not uses_bearer and origin and origin not in ALLOWED_ORIGINS:
            return JSONResponse(status_code=403, content={"detail": "Untrusted request origin"})
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), geolocation=(), payment=()"
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' "
        "https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; "
        "script-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; "
        "base-uri 'self'; frame-ancestors 'none'"
    )
    if os.getenv("COOKIE_SECURE", "false").lower() == "true":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    if request.url.path.startswith("/api/auth/"):
        response.headers["Cache-Control"] = "no-store"
    return response

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

ROLE_CATEGORIES = {
    "Engineering": [
        "Software Engineer", "Frontend Engineer", "Backend Engineer", "Full Stack Engineer",
        "Mobile Engineer", "iOS Engineer", "Android Engineer", "DevOps Engineer",
        "Site Reliability Engineer", "Cloud Engineer", "Platform Engineer", "Infrastructure Engineer",
        "Security Engineer", "Application Security Engineer", "Network Engineer", "Systems Engineer",
        "Embedded Systems Engineer", "Firmware Engineer", "QA Engineer", "Test Automation Engineer",
        "Solutions Engineer", "Sales Engineer", "Engineering Manager", "Director of Engineering",
        "VP of Engineering", "Chief Technology Officer", "Technical Lead", "Staff Engineer",
        "Principal Engineer", "Machine Learning Engineer", "AI Engineer", "Data Engineer",
        "Analytics Engineer", "Database Administrator", "Blockchain Engineer", "Game Developer",
    ],
    "Product and Design": [
        "Product Manager", "Associate Product Manager", "Senior Product Manager", "Technical Product Manager",
        "Growth Product Manager", "Platform Product Manager", "AI Product Manager", "Product Operations Manager",
        "Director of Product", "VP of Product", "Chief Product Officer", "Product Owner",
        "Program Manager", "Technical Program Manager", "Project Manager", "Scrum Master",
        "UX Designer", "UI Designer", "Product Designer", "UX Researcher",
        "Interaction Designer", "Service Designer", "Visual Designer", "Design Systems Designer",
        "Content Designer", "UX Writer", "Design Manager", "Creative Director",
    ],
    "Data and Research": [
        "Data Analyst", "Business Intelligence Analyst", "Data Scientist", "Senior Data Scientist",
        "Research Scientist", "Applied Scientist", "Statistician", "Quantitative Analyst",
        "Operations Research Analyst", "Economist", "Market Research Analyst", "Insights Analyst",
        "Product Analyst", "Marketing Analyst", "Risk Analyst", "Fraud Analyst",
        "GIS Analyst", "Bioinformatics Scientist", "Clinical Data Manager", "Research Associate",
    ],
    "Marketing and Communications": [
        "Marketing Manager", "Digital Marketing Manager", "Growth Marketing Manager", "Product Marketing Manager",
        "Content Marketing Manager", "Brand Manager", "Performance Marketing Manager", "Lifecycle Marketing Manager",
        "SEO Specialist", "SEM Specialist", "Social Media Manager", "Community Manager",
        "Content Strategist", "Copywriter", "Technical Writer", "Communications Manager",
        "Public Relations Manager", "Media Planner", "Demand Generation Manager", "Marketing Operations Manager",
        "Event Marketing Manager", "Partnerships Manager", "Influencer Marketing Manager", "Chief Marketing Officer",
    ],
    "Sales and Customer": [
        "Sales Development Representative", "Business Development Representative", "Account Executive",
        "Senior Account Executive", "Enterprise Account Executive", "Sales Manager", "Regional Sales Manager",
        "Director of Sales", "VP of Sales", "Chief Revenue Officer", "Account Manager",
        "Key Account Manager", "Customer Success Manager", "Customer Success Director", "Implementation Manager",
        "Onboarding Specialist", "Customer Support Specialist", "Technical Support Engineer", "Support Manager",
        "Solutions Consultant", "Revenue Operations Manager", "Sales Operations Analyst", "Renewals Manager",
    ],
    "Finance and Operations": [
        "Financial Analyst", "Senior Financial Analyst", "Investment Analyst", "Investment Banker",
        "Portfolio Manager", "Credit Analyst", "Treasury Analyst", "Controller",
        "Accountant", "Auditor", "Tax Consultant", "Finance Manager",
        "Director of Finance", "VP of Finance", "Chief Financial Officer", "Operations Analyst",
        "Operations Manager", "Business Operations Manager", "Strategy Manager", "Management Consultant",
        "Business Analyst", "Process Improvement Manager", "Procurement Manager", "Supply Chain Analyst",
        "Supply Chain Manager", "Logistics Manager", "Inventory Manager", "Vendor Manager",
    ],
    "People and Legal": [
        "HR Recruiter", "Technical Recruiter", "Executive Recruiter", "Talent Acquisition Manager",
        "Human Resources Generalist", "HR Business Partner", "People Operations Manager", "Compensation Analyst",
        "Learning and Development Manager", "Employee Relations Manager", "Director of People",
        "Chief People Officer", "Legal Counsel", "Corporate Counsel", "Compliance Analyst",
        "Compliance Manager", "Privacy Officer", "Contract Manager", "Paralegal", "Policy Analyst",
    ],
    "Healthcare and Science": [
        "Registered Nurse", "Nurse Practitioner", "Physician Assistant", "Medical Doctor",
        "Pharmacist", "Clinical Research Coordinator", "Clinical Research Associate", "Public Health Analyst",
        "Healthcare Administrator", "Medical Science Liaison", "Laboratory Technician", "Biomedical Engineer",
        "Biologist", "Chemist", "Microbiologist", "Environmental Scientist", "Food Scientist",
        "Quality Assurance Specialist", "Regulatory Affairs Specialist", "Epidemiologist",
    ],
    "Education and Public Service": [
        "Teacher", "University Lecturer", "Professor", "Instructional Designer",
        "Curriculum Developer", "Academic Advisor", "School Counselor", "Education Program Manager",
        "Nonprofit Program Manager", "Fundraising Manager", "Grant Writer", "Social Worker",
        "Case Manager", "Government Program Analyst", "Urban Planner", "Foreign Service Officer",
        "Police Officer", "Emergency Management Specialist", "Public Administrator", "Policy Advisor",
    ],
    "Media, Hospitality and Trades": [
        "Journalist", "Editor", "Video Producer", "Film Producer", "Photographer",
        "Motion Designer", "Animator", "Sound Engineer", "Event Producer", "Restaurant Manager",
        "Hotel Manager", "Executive Chef", "Retail Store Manager", "Merchandiser", "Buyer",
        "Real Estate Agent", "Property Manager", "Construction Project Manager", "Civil Engineer",
        "Mechanical Engineer", "Electrical Engineer", "Chemical Engineer", "Architect", "Interior Designer",
        "Industrial Designer", "Manufacturing Engineer", "Quality Engineer", "Maintenance Manager",
    ],
}
ROLE_CATALOG = [
    {"title": title, "category": category}
    for category, titles in ROLE_CATEGORIES.items()
    for title in titles
]

PERSONAS = {
    "Friendly Interviewer": {
        "tone": "Warm, patient, and encouraging",
        "focus": ["clarity", "confidence", "growth"],
        "opening": "Take your time and walk me through",
        "feedback": "supportive and practical",
        "score_adjustment": 3,
    },
    "Strict Technical Interviewer": {
        "tone": "Direct, exacting, and technically rigorous",
        "focus": ["technical accuracy", "testing", "edge cases"],
        "opening": "Be precise and justify",
        "feedback": "direct, detailed, and unsparing",
        "score_adjustment": -4,
    },
    "HR Recruiter": {
        "tone": "Professional and people-focused",
        "focus": ["communication", "confidence", "culture fit"],
        "opening": "Help me understand",
        "feedback": "clear, encouraging, and communication-focused",
        "score_adjustment": 1,
    },
    "Senior Engineering Manager": {
        "tone": "Strategic, pragmatic, and leadership-focused",
        "focus": ["architecture", "ownership", "tradeoffs", "production thinking"],
        "opening": "Explain the decision and tradeoffs behind",
        "feedback": "executive, pragmatic, and ownership-focused",
        "score_adjustment": -2,
    },
    "FAANG-Style Interviewer": {
        "tone": "Structured, probing, and high-bar",
        "focus": ["depth", "precision", "edge cases", "scalability", "structured reasoning"],
        "opening": "Structure your reasoning and analyze",
        "feedback": "concise, high-bar, and evidence-driven",
        "score_adjustment": -5,
    },
}

WEAKNESS_QUESTIONS = {
    "clarity": "Give a concise two-minute explanation of a complex decision you made and why it mattered.",
    "depth": "Describe a difficult problem, then go one level deeper on the reasoning that shaped your solution.",
    "technical accuracy": "Walk through a technical decision and defend its correctness, assumptions, and limitations.",
    "structure": "Answer using a clear situation, task, action, and measurable result.",
    "confidence": "Describe a decision you owned under uncertainty and state your recommendation without hedging.",
    "system design": "Design a production-ready service for this role, including scale, failure modes, and observability.",
    "behavioral STAR": "Tell me about a setback using a complete STAR story with a measurable result.",
    "communication": "Explain a complex disagreement to a non-technical stakeholder and show how you reached alignment.",
}

FILLERS = ["um", "uh", "like", "basically", "actually", "you know", "sort of", "kind of"]
ACTION_WORDS = ["led", "built", "created", "decided", "analyzed", "designed", "implemented", "negotiated", "launched", "improved"]
RESULT_WORDS = ["result", "impact", "increased", "decreased", "reduced", "grew", "saved", "conversion", "revenue", "learned"]


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def db():
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 10000")
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
                id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, created_at TEXT NOT NULL,
                password_hash TEXT, roles_json TEXT NOT NULL DEFAULT '["candidate"]'
            );
            CREATE TABLE IF NOT EXISTS auth_tokens (
                token_hash TEXT PRIMARY KEY, profile_id TEXT NOT NULL,
                created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
                FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS auth_attempts (
                identity TEXT PRIMARY KEY, failed_count INTEGER NOT NULL DEFAULT 0,
                first_failed_at TEXT NOT NULL, locked_until TEXT
            );
            CREATE TABLE IF NOT EXISTS targets (
                id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, role_title TEXT NOT NULL,
                company TEXT, seniority TEXT, resume_text TEXT, job_description TEXT,
                analysis_json TEXT NOT NULL, created_at TEXT NOT NULL,
                FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, target_id TEXT,
                role_title TEXT NOT NULL, mode TEXT NOT NULL, difficulty TEXT NOT NULL,
                interviewer_style TEXT NOT NULL, total_questions INTEGER NOT NULL,
                current_question TEXT NOT NULL, current_type TEXT NOT NULL,
                status TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT,
                persona TEXT NOT NULL DEFAULT 'Friendly Interviewer',
                linked_parent_session_id TEXT,
                practice_focus TEXT NOT NULL DEFAULT '[]',
                is_weakness_practice INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
                FOREIGN KEY(target_id) REFERENCES targets(id) ON DELETE SET NULL,
                FOREIGN KEY(linked_parent_session_id) REFERENCES sessions(id) ON DELETE SET NULL
            );
            CREATE TABLE IF NOT EXISTS answers (
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL, question_number INTEGER NOT NULL,
                question TEXT NOT NULL, answer TEXT NOT NULL, feedback_json TEXT NOT NULL,
                delivery_json TEXT NOT NULL, created_at TEXT NOT NULL,
                follow_up_question TEXT,
                FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                UNIQUE(session_id, question_number)
            );
            CREATE TABLE IF NOT EXISTS session_summaries (
                session_id TEXT PRIMARY KEY,
                resume_improvement_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique
                ON profiles(lower(email));
            CREATE INDEX IF NOT EXISTS auth_tokens_profile_idx
                ON auth_tokens(profile_id);
            CREATE INDEX IF NOT EXISTS auth_tokens_expiry_idx
                ON auth_tokens(expires_at);
            CREATE INDEX IF NOT EXISTS sessions_profile_created_idx
                ON sessions(profile_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS answers_session_number_idx
                ON answers(session_id, question_number);
            CREATE INDEX IF NOT EXISTS targets_profile_idx
                ON targets(profile_id);
            CREATE TRIGGER IF NOT EXISTS targets_profile_guard
            BEFORE INSERT ON targets
            WHEN NOT EXISTS (SELECT 1 FROM profiles WHERE id = NEW.profile_id)
            BEGIN
                SELECT RAISE(ABORT, 'target profile does not exist');
            END;
            CREATE TRIGGER IF NOT EXISTS sessions_owner_guard
            BEFORE INSERT ON sessions
            WHEN NOT EXISTS (SELECT 1 FROM profiles WHERE id = NEW.profile_id)
              OR (
                NEW.target_id IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM targets
                    WHERE id = NEW.target_id AND profile_id = NEW.profile_id
                )
              )
            BEGIN
                SELECT RAISE(ABORT, 'session ownership constraint failed');
            END;
            CREATE TRIGGER IF NOT EXISTS answers_session_guard
            BEFORE INSERT ON answers
            WHEN NOT EXISTS (SELECT 1 FROM sessions WHERE id = NEW.session_id)
            BEGIN
                SELECT RAISE(ABORT, 'answer session does not exist');
            END;
            CREATE TRIGGER IF NOT EXISTS profiles_delete_cascade
            AFTER DELETE ON profiles
            BEGIN
                DELETE FROM targets WHERE profile_id = OLD.id;
                DELETE FROM sessions WHERE profile_id = OLD.id;
                DELETE FROM auth_tokens WHERE profile_id = OLD.id;
            END;
            CREATE TRIGGER IF NOT EXISTS sessions_delete_cascade
            AFTER DELETE ON sessions
            BEGIN
                DELETE FROM answers WHERE session_id = OLD.id;
                DELETE FROM session_summaries WHERE session_id = OLD.id;
                UPDATE sessions SET linked_parent_session_id = NULL
                WHERE linked_parent_session_id = OLD.id;
            END;
            """
        )
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA synchronous = NORMAL")
        connection.execute("DELETE FROM auth_tokens WHERE expires_at <= ?", (now(),))
        session_columns = {row["name"] for row in connection.execute("PRAGMA table_info(sessions)")}
        for column, definition in {
            "persona": "TEXT NOT NULL DEFAULT 'Friendly Interviewer'",
            "linked_parent_session_id": "TEXT",
            "practice_focus": "TEXT NOT NULL DEFAULT '[]'",
            "is_weakness_practice": "INTEGER NOT NULL DEFAULT 0",
        }.items():
            if column not in session_columns:
                connection.execute(f"ALTER TABLE sessions ADD COLUMN {column} {definition}")
        answer_columns = {row["name"] for row in connection.execute("PRAGMA table_info(answers)")}
        if "follow_up_question" not in answer_columns:
            connection.execute("ALTER TABLE answers ADD COLUMN follow_up_question TEXT")
        profile_columns = {row["name"] for row in connection.execute("PRAGMA table_info(profiles)")}
        if "password_hash" not in profile_columns:
            connection.execute("ALTER TABLE profiles ADD COLUMN password_hash TEXT")
        if "roles_json" not in profile_columns:
            connection.execute(
                """ALTER TABLE profiles ADD COLUMN roles_json
                TEXT NOT NULL DEFAULT '["candidate"]'"""
            )
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"SQLite integrity check failed: {integrity}")
    try:
        os.chmod(DB_PATH, 0o600)
    except OSError:
        pass


init_db()


class RegisterRequest(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: str = Field(min_length=5, max_length=160)
    password: str = Field(min_length=10, max_length=128)


class LoginRequest(BaseModel):
    email: str = Field(min_length=5, max_length=160)
    password: str = Field(min_length=1, max_length=128)


class RoleUpdateRequest(BaseModel):
    roles: list[str] = Field(min_length=1)


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
    persona: str = "Friendly Interviewer"
    total_questions: int = Field(default=6, ge=3, le=8)
    linked_parent_session_id: str | None = None
    practice_focus: list[str] = Field(default_factory=list)
    is_weakness_practice: bool = False


class AnswerRequest(BaseModel):
    question: str
    answer: str = Field(min_length=20, max_length=12000)
    question_number: int
    duration_seconds: int = Field(default=0, ge=0, le=3600)
    confidence: float = Field(default=0.8, ge=0, le=1)


def row_json(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


ALLOWED_ROLES = {"candidate", "coach", "admin"}


def password_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${salt.hex()}${digest.hex()}"


def password_matches(password: str, encoded: str | None) -> bool:
    if not encoded:
        return False
    try:
        algorithm, salt_hex, digest_hex = encoded.split("$", 2)
        if algorithm != "scrypt":
            return False
        candidate = password_hash(password, bytes.fromhex(salt_hex)).split("$", 2)[2]
        return hmac.compare_digest(candidate, digest_hex)
    except (ValueError, TypeError):
        return False


def public_user(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    data = dict(row)
    return {
        "id": data["id"],
        "name": data["name"],
        "email": data["email"],
        "roles": json.loads(data.get("roles_json") or '["candidate"]'),
    }


def configured_admin_emails() -> set[str]:
    values = [os.getenv("ADMIN_EMAIL", ""), os.getenv("ADMIN_EMAILS", "")]
    emails = {
        item.strip().lower()
        for value in values
        for item in value.split(",")
        if item.strip()
    }
    return {
        email
        for email in emails
        if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email)
    }


def ensure_admin_role(connection: sqlite3.Connection, row: sqlite3.Row) -> sqlite3.Row:
    if row["email"].lower() not in configured_admin_emails():
        return row
    roles = json.loads(row["roles_json"] or '["candidate"]')
    if "admin" not in roles:
        roles.append("admin")
        connection.execute(
            "UPDATE profiles SET roles_json = ? WHERE id = ?",
            (json.dumps(roles), row["id"]),
        )
        row = connection.execute("SELECT * FROM profiles WHERE id = ?", (row["id"],)).fetchone()
    return row


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def normalized_email(email: str) -> str:
    value = email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
        raise HTTPException(status_code=422, detail="Enter a valid email address")
    return value


def check_login_lock(connection: sqlite3.Connection, identity: str) -> None:
    row = connection.execute(
        "SELECT locked_until FROM auth_attempts WHERE identity = ?", (identity,)
    ).fetchone()
    if row and row["locked_until"] and row["locked_until"] > now():
        raise HTTPException(
            status_code=429,
            detail="Too many failed sign-in attempts. Try again in 15 minutes.",
        )


def record_login_failure(connection: sqlite3.Connection, identity: str) -> None:
    row = connection.execute(
        "SELECT failed_count, first_failed_at FROM auth_attempts WHERE identity = ?",
        (identity,),
    ).fetchone()
    current = datetime.now(timezone.utc)
    if not row or current - datetime.fromisoformat(row["first_failed_at"]) > timedelta(minutes=15):
        failed_count = 1
        first_failed_at = current.isoformat()
    else:
        failed_count = row["failed_count"] + 1
        first_failed_at = row["first_failed_at"]
    locked_until = (current + timedelta(minutes=15)).isoformat() if failed_count >= 5 else None
    connection.execute(
        """INSERT INTO auth_attempts (identity, failed_count, first_failed_at, locked_until)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(identity) DO UPDATE SET failed_count = excluded.failed_count,
        first_failed_at = excluded.first_failed_at, locked_until = excluded.locked_until""",
        (identity, failed_count, first_failed_at, locked_until),
    )


def current_user(
    authorization: str | None = Header(default=None),
    aicoachy_session: str | None = Cookie(default=None),
) -> dict[str, Any]:
    token = aicoachy_session
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    digest = token_digest(token)
    with db() as connection:
        row = connection.execute(
            """SELECT p.* FROM auth_tokens t JOIN profiles p ON p.id = t.profile_id
            WHERE t.token_hash = ? AND t.expires_at > ?""",
            (digest, now()),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
    return public_user(row)


def require_roles(*allowed: str):
    def dependency(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
        if not set(user["roles"]).intersection(allowed):
            raise HTTPException(status_code=403, detail="You do not have permission for this action")
        return user
    return dependency


def require_owner(profile_id: str, user: dict[str, Any]) -> None:
    if profile_id != user["id"] and not set(user["roles"]).intersection({"coach", "admin"}):
        raise HTTPException(status_code=403, detail="You can only access your own workspace")


def owned_session(connection: sqlite3.Connection, session_id: str, user: dict[str, Any]) -> sqlite3.Row:
    row = connection.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    require_owner(row["profile_id"], user)
    return row


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


def role_data(role_title: str) -> dict[str, Any]:
    if role_title in ROLE_DATA:
        return ROLE_DATA[role_title]
    lowered = role_title.lower()
    if any(term in lowered for term in ("engineer", "developer", "architect", "technical", "security", "data")):
        skills = ["Technical judgment", "Problem solving", "Reliability", "Collaboration", "Execution"]
    elif any(term in lowered for term in ("manager", "director", "chief", "vp", "lead", "owner")):
        skills = ["Leadership", "Strategy", "Execution", "Stakeholder management", "Measurable outcomes"]
    elif any(term in lowered for term in ("designer", "writer", "creative", "editor", "producer")):
        skills = ["Craft", "Audience insight", "Collaboration", "Decision rationale", "Outcomes"]
    elif any(term in lowered for term in ("sales", "account", "customer", "recruiter", "marketing")):
        skills = ["Communication", "Customer insight", "Influence", "Prioritization", "Results"]
    else:
        skills = ["Role expertise", "Problem solving", "Communication", "Ownership", "Results"]
    return {
        "skills": skills,
        "questions": [
            ("Experience", f"Tell me about a challenging situation that best demonstrates your readiness for a {role_title} role."),
            ("Judgment", f"Describe an important decision you made in your work as a {role_title}. What tradeoffs did you consider?"),
            ("Execution", "Tell me about a goal you owned from planning through delivery."),
            ("Collaboration", "Describe a time you had to align people with different priorities."),
            ("Problem solving", "Walk me through a difficult problem you diagnosed and resolved."),
            ("Impact", "What professional achievement are you most proud of, and how did you measure its impact?"),
            ("Growth", "Tell me about feedback that changed how you approach your work."),
            ("Role depth", f"What separates an excellent {role_title} from an average one?"),
        ],
    }


def analyze_target(request: TargetRequest) -> dict[str, Any]:
    role = role_data(request.role_title)
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


def build_model_answer(question: str, role_title: str, target: dict[str, Any] | None) -> str:
    focus = target.get("focus_areas", [])[0] if target and target.get("focus_areas") else None
    lowered = question.lower()

    if role_title == "Software Engineer":
        if "design" in lowered or "system" in lowered:
            answer = (
                "I would start by clarifying scale, delivery guarantees, latency targets, and failure modes. "
                "I would separate ingestion from delivery with a durable queue, keep notification preferences "
                "and templates in dedicated services, and make workers idempotent so retries are safe. I would "
                "partition by recipient, apply provider-specific rate limits, and use exponential backoff with a "
                "dead-letter queue. I would measure queue age, delivery success, duplicate rate, and provider "
                "latency. I would begin with the simplest architecture that meets current volume, then add "
                "regional redundancy and partitioning when the evidence justifies it."
            )
        else:
            answer = (
                "Our checkout API was breaching its latency target during peak traffic, which was causing failed "
                "orders. I owned the diagnosis and rollout. Tracing showed that repeated inventory calls were the "
                "main bottleneck, so I introduced request coalescing, added a short-lived cache, and shipped the "
                "change behind a feature flag with rollback thresholds. Over six weeks, p95 latency fell from "
                "1.8 seconds to 620 milliseconds and checkout failures dropped 28%. The key lesson was to define "
                "the operational success and rollback metrics before changing the architecture."
            )
    elif role_title == "Marketing Manager":
        answer = (
            "A product-launch campaign was generating traffic but trial conversion was 35% below target. I led a "
            "funnel review and found that our broad message was attracting low-intent visitors. I worked with "
            "customer research and sales to segment the audience, rewrote the landing page around the highest-value "
            "use case, and shifted budget toward two channels with stronger activation. Within four weeks, "
            "trial-to-qualified-lead conversion increased 22% while cost per qualified lead fell 16%. I learned to "
            "optimize for the downstream business event, not the most visible top-of-funnel metric."
        )
    elif role_title == "UX Designer":
        answer = (
            "Research showed that new administrators were abandoning setup because our workflow reflected the "
            "internal data model rather than their mental model. I owned the redesign and aligned product and "
            "engineering around task completion as the primary measure. I mapped the critical journey, tested "
            "three prototypes with eight users, and simplified the flow from seven decisions to four guided steps. "
            "After launch, setup completion increased 19% and median completion time fell by three minutes. The "
            "project reinforced that a strong design rationale connects observed behavior, constraints, and a "
            "measurable user outcome."
        )
    else:
        answer = (
            "Activation had plateaued, but the team had competing explanations and limited evidence. I led a "
            "two-week discovery sprint to make the decision explicit. We combined funnel analysis with twelve "
            "customer interviews and learned that users understood the product value but were not reaching the "
            "first meaningful outcome quickly enough. I prioritized a guided onboarding experiment over three "
            "larger roadmap requests, aligned sales and engineering on the success metric, and launched it to a "
            "controlled cohort. Activation increased 14% and time-to-value fell 21%. The decision taught me to "
            "frame uncertainty as a testable risk and agree on the evidence before debating solutions."
        )

    if focus:
        answer += f" For a role emphasizing {focus}, I would also make that capability explicit in the discussion."
    return answer


def persona_question(question: str, persona_name: str) -> str:
    if persona_name == "Friendly Interviewer":
        return question
    additions = {
        "Strict Technical Interviewer": "Be precise: state assumptions, technical details, and how you verified the result.",
        "HR Recruiter": "Make your communication, motivation, and contribution to the team clear.",
        "Senior Engineering Manager": "Include the architecture, ownership, production impact, and tradeoffs behind your decision.",
        "FAANG-Style Interviewer": "Structure your reasoning and cover edge cases, scalability, and limits.",
    }
    return f"{question} {additions.get(persona_name, '')}".strip()


def apply_persona_feedback(feedback: dict[str, Any], persona_name: str) -> dict[str, Any]:
    persona = PERSONAS.get(persona_name, PERSONAS["Friendly Interviewer"])
    adjustment = persona["score_adjustment"]
    scores = {
        key: max(0, min(100, int(value) + adjustment))
        for key, value in feedback["scores"].items()
    }
    feedback["scores"] = scores
    feedback["overall_score"] = round(sum(scores.values()) / len(scores))
    focus = ", ".join(persona["focus"][:3])
    if persona_name == "Friendly Interviewer":
        feedback["summary"] = f"You have a useful foundation here. {feedback['summary']} Keep building the answer around {focus}."
    elif persona_name == "Strict Technical Interviewer":
        feedback["summary"] = f"High-bar technical review: {feedback['summary']} The missing proof is in {focus}."
        feedback["improvements"].insert(0, "State assumptions explicitly and defend the technical correctness of each decision.")
    elif persona_name == "HR Recruiter":
        feedback["summary"] = f"Recruiter read: {feedback['summary']} Make your communication, motivation, and culture contribution easier to hear."
    elif persona_name == "Senior Engineering Manager":
        feedback["summary"] = f"Engineering leadership read: {feedback['summary']} Show architecture judgment, ownership, tradeoffs, and production consequences."
        feedback["improvements"].insert(0, "Connect the decision to operational risk, team ownership, and the tradeoff you accepted.")
    else:
        feedback["summary"] = f"High-bar structured review: {feedback['summary']} Go deeper on precision, edge cases, scalability, and reasoning."
        feedback["improvements"].insert(0, "Structure the answer, test edge cases, and quantify the solution's scaling limits.")
    feedback["improvements"] = feedback["improvements"][:3]
    feedback["persona"] = persona_name
    feedback["persona_focus"] = persona["focus"]
    return feedback


def local_feedback(
    question: str, answer: str, delivery: dict[str, Any], role_title: str,
    target: dict[str, Any] | None, persona_name: str = "Friendly Interviewer"
) -> dict[str, Any]:
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

    comparison_gaps = []
    if not ownership:
        comparison_gaps.append("Ownership: the model answer names the exact decision and actions the candidate owned.")
    if not has_metric:
        comparison_gaps.append("Evidence: the model answer proves impact with a baseline and measurable result.")
    if not result_hits:
        comparison_gaps.append("Closure: the model answer ends with the outcome and a transferable lesson.")
    if word_count < 70:
        comparison_gaps.append("Depth: the model answer includes a decision, trade-off, and implementation detail.")
    comparison_gaps.append("Structure: the model answer leads with a clear narrative and removes nonessential context.")

    feedback = {
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
        "model_answer": build_model_answer(question, role_title, target),
        "comparison_gaps": comparison_gaps[:4],
        "star": {
            "situation": 82 if situation else 58,
            "task": 84 if ownership else 62,
            "action": min(95, 62 + action_hits * 8),
            "result": 88 if has_metric and result_hits else (72 if result_hits else 52),
        },
    }
    return apply_persona_feedback(feedback, persona_name)


async def supabase_request(method: str, table: str, payload: dict[str, Any], match: str = "") -> Any:
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        return None
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation,resolution=merge-duplicates",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.request(
            method, f"{url}/rest/v1/{table}{match}", headers=headers, json=payload
        )
        response.raise_for_status()
        return response.json() if response.content else None


async def sync_supabase_session(session_id: str, request: SessionRequest, created_at: str) -> None:
    payload = {
        "id": session_id,
        "profile_id": request.profile_id,
        "target_id": request.target_id,
        "role_title": request.role_title,
        "mode": request.mode,
        "difficulty": request.difficulty,
        "interviewer_style": request.interviewer_style,
        "persona": request.persona,
        "total_questions": request.total_questions,
        "linked_parent_session_id": request.linked_parent_session_id,
        "practice_focus": request.practice_focus,
        "is_weakness_practice": request.is_weakness_practice,
        "status": "active",
        "created_at": created_at,
    }
    try:
        await supabase_request("POST", "interview_sessions", payload)
    except httpx.HTTPError:
        pass


async def provider_json(system: str, prompt: str) -> dict[str, Any] | None:
    api_key = os.getenv("OPENAI_API_KEY")
    if api_key:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": os.getenv("OPENAI_MODEL", "gpt-4"),
                    "response_format": {"type": "json_object"},
                    "temperature": 0.2,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": prompt},
                    ],
                },
            )
            response.raise_for_status()
            return json.loads(response.json()["choices"][0]["message"]["content"])

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

    return None


def get_target(connection: sqlite3.Connection, target_id: str | None) -> dict[str, Any] | None:
    if not target_id:
        return None
    row = connection.execute("SELECT analysis_json FROM targets WHERE id = ?", (target_id,)).fetchone()
    return json.loads(row["analysis_json"]) if row else None


def next_question(session: dict[str, Any], answer: str, score: int, number: int, target: dict[str, Any] | None) -> tuple[str, str]:
    role = role_data(session["role_title"])
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
    provider = "openai" if os.getenv("OPENAI_API_KEY") else ("ollama" if os.getenv("OLLAMA_URL") else "local")
    return {"status": "ok", "provider": provider, "database": str(DB_PATH.name)}


@app.get("/api/roles")
def roles() -> list[dict[str, Any]]:
    return [
        {
            **item,
            "featured": item["title"] in ROLE_DATA,
            "blurb": ", ".join(role_data(item["title"])["skills"][:3]),
        }
        for item in ROLE_CATALOG
    ]


@app.post("/api/auth/register")
def register(request: RegisterRequest) -> dict[str, Any]:
    email = normalized_email(request.email)
    profile_id = str(uuid.uuid4())
    roles = ["candidate"]
    if email in configured_admin_emails():
        roles.append("admin")
    with db() as connection:
        if connection.execute("SELECT 1 FROM profiles WHERE lower(email) = ?", (email,)).fetchone():
            raise HTTPException(status_code=409, detail="An account with this email already exists")
        connection.execute(
            """INSERT INTO profiles
            (id, name, email, password_hash, roles_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?)""",
            (profile_id, request.name.strip(), email, password_hash(request.password), json.dumps(roles), now()),
        )
    return {"message": "Account created. You can now sign in."}


@app.post("/api/auth/login")
def login(request: LoginRequest, response: Response) -> dict[str, Any]:
    email = normalized_email(request.email)
    with db() as connection:
        check_login_lock(connection, email)
        row = connection.execute(
            "SELECT * FROM profiles WHERE lower(email) = ?", (email,)
        ).fetchone()
        if not row or not password_matches(request.password, row["password_hash"]):
            record_login_failure(connection, email)
            connection.commit()
            raise HTTPException(status_code=401, detail="Invalid email or password")
        row = ensure_admin_role(connection, row)
        connection.execute("DELETE FROM auth_attempts WHERE identity = ?", (email,))
        connection.execute("DELETE FROM auth_tokens WHERE profile_id = ? AND expires_at <= ?", (row["id"], now()))
        active_tokens = connection.execute(
            "SELECT token_hash FROM auth_tokens WHERE profile_id = ? ORDER BY created_at DESC",
            (row["id"],),
        ).fetchall()
        for stale in active_tokens[9:]:
            connection.execute("DELETE FROM auth_tokens WHERE token_hash = ?", (stale["token_hash"],))
        token = secrets.token_urlsafe(48)
        expires_at = datetime.fromtimestamp(
            datetime.now(timezone.utc).timestamp() + 60 * 60 * 24 * 14, timezone.utc
        ).isoformat()
        connection.execute(
            "INSERT INTO auth_tokens (token_hash, profile_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (token_digest(token), row["id"], now(), expires_at),
        )
    response.set_cookie(
        "aicoachy_session",
        token,
        max_age=60 * 60 * 24 * 14,
        httponly=True,
        secure=os.getenv("COOKIE_SECURE", "false").lower() == "true",
        samesite="strict",
        path="/",
    )
    return {"user": public_user(row)}


@app.get("/api/auth/me")
def me(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return user


@app.post("/api/auth/logout")
def logout(
    response: Response,
    authorization: str | None = Header(default=None),
    aicoachy_session: str | None = Cookie(default=None),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, str]:
    del user
    token = aicoachy_session
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
    with db() as connection:
        connection.execute(
            "DELETE FROM auth_tokens WHERE token_hash = ?",
            (token_digest(token),),
        )
    response.delete_cookie("aicoachy_session", path="/", samesite="strict")
    return {"message": "Signed out"}


@app.get("/api/admin/users")
def list_users(user: dict[str, Any] = Depends(require_roles("admin"))) -> list[dict[str, Any]]:
    del user
    with db() as connection:
        return [public_user(row) for row in connection.execute("SELECT * FROM profiles ORDER BY created_at")]


@app.put("/api/admin/users/{profile_id}/roles")
def update_user_roles(
    profile_id: str,
    request: RoleUpdateRequest,
    user: dict[str, Any] = Depends(require_roles("admin")),
) -> dict[str, Any]:
    roles = list(dict.fromkeys(request.roles))
    if not set(roles).issubset(ALLOWED_ROLES):
        raise HTTPException(status_code=422, detail="Roles must be candidate, coach, or admin")
    if profile_id == user["id"] and "admin" not in roles:
        raise HTTPException(status_code=400, detail="You cannot remove your own admin role")
    with db() as connection:
        connection.execute("UPDATE profiles SET roles_json = ? WHERE id = ?", (json.dumps(roles), profile_id))
        row = connection.execute("SELECT * FROM profiles WHERE id = ?", (profile_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return public_user(row)


@app.post("/api/targets")
def create_target(request: TargetRequest, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    request.profile_id = user["id"]
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
async def create_session(
    request: SessionRequest, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    request.profile_id = user["id"]
    if request.persona not in PERSONAS:
        raise HTTPException(status_code=422, detail="Unknown interviewer persona")
    role = role_data(request.role_title)
    if request.is_weakness_practice and request.practice_focus:
        focus = request.practice_focus[0]
        question_type, question = f"Weakness: {focus.title()}", WEAKNESS_QUESTIONS.get(focus, WEAKNESS_QUESTIONS["depth"])
    else:
        question_type, question = role["questions"][0]
    question = persona_question(question, request.persona)
    session_id = str(uuid.uuid4())
    created_at = now()
    with db() as connection:
        connection.execute(
            """INSERT INTO sessions
            (id, profile_id, target_id, role_title, mode, difficulty, interviewer_style,
             total_questions, current_question, current_type, status, created_at, persona,
             linked_parent_session_id, practice_focus, is_weakness_practice)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)""",
            (
                session_id, request.profile_id, request.target_id, request.role_title, request.mode,
                request.difficulty, request.interviewer_style, request.total_questions,
                question, question_type, created_at, request.persona, request.linked_parent_session_id,
                json.dumps(request.practice_focus), int(request.is_weakness_practice),
            ),
        )
    await sync_supabase_session(session_id, request, created_at)
    return {
        "session_id": session_id, "question": question, "question_type": question_type,
        "total_questions": request.total_questions, "provider": health()["provider"],
        "persona": request.persona, "is_weakness_practice": request.is_weakness_practice,
        "practice_focus": request.practice_focus,
    }


@app.post("/api/sessions/{session_id}/answers")
async def evaluate_answer(
    session_id: str, request: AnswerRequest, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    with db() as connection:
        row = owned_session(connection, session_id, user)
        session = row_json(row)
        target = get_target(connection, session["target_id"])

    delivery = delivery_metrics(request.answer, request.duration_seconds, request.confidence)
    feedback = local_feedback(
        request.question, request.answer, delivery, session["role_title"], target, session["persona"]
    )
    persona = PERSONAS.get(session["persona"], PERSONAS["Friendly Interviewer"])
    system = (
        f"You are acting as {session['persona']}: {persona['tone']}. Your feedback is {persona['feedback']}. "
        "Return JSON only. Preserve keys overall_score, "
        "summary, scores (clarity, depth, relevance, structure, delivery), strengths, improvements, "
        "better_answer, model_answer, comparison_gaps, and star (situation, task, action, result). "
        "The model_answer must answer the exact interview question with a realistic, concise, excellent "
        "example for this role. comparison_gaps must contain 3 or 4 specific strings contrasting the "
        "candidate response with the model answer. Scores are integers from 0 to 100."
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
    if session["is_weakness_practice"] and request.question_number < session["total_questions"]:
        focus = json.loads(session["practice_focus"] or "[]")
        weakness = focus[request.question_number % len(focus)] if focus else "depth"
        question_type = f"Weakness: {weakness.title()}"
        following = WEAKNESS_QUESTIONS.get(weakness, WEAKNESS_QUESTIONS["depth"])
    following = persona_question(following, session["persona"])
    completed = request.question_number >= session["total_questions"]
    with db() as connection:
        connection.execute(
            """INSERT INTO answers
            (id, session_id, question_number, question, answer, feedback_json, delivery_json, created_at,
             follow_up_question)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                str(uuid.uuid4()), session_id, request.question_number, request.question,
                request.answer, json.dumps(feedback), json.dumps(delivery), now(),
                None if completed else following,
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
            "follow_up_question": row["follow_up_question"],
            "main_weakness": feedback.get("improvements", ["Add more evidence."])[0],
            "main_improvement": feedback.get("better_answer", ""),
            "improved_answer": feedback.get("model_answer", feedback.get("better_answer", "")),
        })
    averages = {key: round(sum(values) / len(values)) for key, values in score_totals.items()} if answers else {}
    overall = round(sum(item["feedback"]["overall_score"] for item in answers) / len(answers)) if answers else 0
    resume_improvement = build_resume_improvement(session, answers, averages)
    connection.execute(
        """INSERT INTO session_summaries
        (session_id, resume_improvement_json, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
        resume_improvement_json = excluded.resume_improvement_json,
        updated_at = excluded.updated_at""",
        (session_id, json.dumps(resume_improvement), now(), now()),
    )
    return {
        "session": session, "answers": answers, "overall_score": overall, "averages": averages,
        "top_strength": max(averages, key=averages.get).title() if averages else "Not available",
        "focus_area": min(averages, key=averages.get).title() if averages else "Not available",
        "recommendations": [
            "Build a bank of five stories with clear metrics and distinct leadership signals.",
            "Practice a 15-second headline before each detailed answer.",
            "Repeat your lowest-scoring competency in a focused drill.",
        ],
        "resume_improvement": resume_improvement,
    }


def build_resume_improvement(
    session: dict[str, Any], answers: list[dict[str, Any]], averages: dict[str, int]
) -> dict[str, Any]:
    text = " ".join(item["answer"] for item in answers).lower()
    role = role_data(session["role_title"])
    demonstrated = [
        skill for skill in role["skills"]
        if any(term in text for term in skill.lower().split())
    ]
    if averages:
        demonstrated.extend(
            key.title() for key, value in averages.items() if value >= 78 and key.title() not in demonstrated
        )
    demonstrated = demonstrated[:6]
    missing = [skill for skill in role["skills"] if skill not in demonstrated][:5]
    metric = "measurable business or reliability result"
    bullets = []
    for item in answers[:3]:
        action = re.sub(r"\s+", " ", item["answer"]).strip()
        excerpt = " ".join(action.split()[:22]).rstrip(".,")
        bullets.append(f"Led {excerpt.lower()}, delivering a {metric}.")
    while len(bullets) < 3:
        skill = (missing or role["skills"])[len(bullets) % len(missing or role["skills"])]
        bullets.append(f"Demonstrated {skill.lower()} by leading a cross-functional initiative with a quantified outcome.")
    return {
        "demonstrated_skills": demonstrated or ["Communication", "Problem solving"],
        "missing_skills": missing or ["More quantified role-specific evidence"],
        "weak_resume_areas": [
            "Bullets need clearer ownership and scope.",
            "Impact should include baselines, metrics, or operational outcomes.",
        ],
        "suggested_bullets": bullets,
        "missing_keywords": missing + ["ownership", "measurable impact", "cross-functional"],
        "project_ideas": [
            f"Build and document a production-quality {session['role_title'].lower()} case study with measurable outcomes.",
            f"Create a portfolio project demonstrating {missing[0] if missing else role['skills'][0]} under realistic constraints.",
            "Publish a short retrospective covering decisions, tradeoffs, testing, and results.",
        ],
    }


@app.get("/api/sessions/{session_id}/report")
async def get_report(
    session_id: str, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    with db() as connection:
        owned_session(connection, session_id, user)
        report = session_report(connection, session_id)
    try:
        await supabase_request(
            "POST",
            "session_summaries",
            {
                "session_id": session_id,
                "resume_improvement_json": report["resume_improvement"],
                "updated_at": now(),
            },
        )
    except httpx.HTTPError:
        pass
    return report


@app.post("/api/sessions/{session_id}/weakness-practice")
async def create_weakness_practice(
    session_id: str, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    with db() as connection:
        owned_session(connection, session_id, user)
        report = session_report(connection, session_id)
    session = report["session"]
    averages = report["averages"]
    focus = [key for key, _ in sorted(averages.items(), key=lambda item: item[1])[:3]]
    answer_text = " ".join(item["answer"].lower() for item in report["answers"])
    if not re.search(r"\b(test|tested|testing)\b", answer_text):
        focus.append("technical accuracy")
    if not re.search(r"\b(result|impact|increased|reduced|saved|\d+%)\b", answer_text):
        focus.append("behavioral STAR")
    focus = list(dict.fromkeys(focus))[:4] or ["clarity", "depth", "structure"]
    request = SessionRequest(
        profile_id=session["profile_id"],
        target_id=session["target_id"],
        role_title=session["role_title"],
        mode="Weakness practice",
        difficulty=session["difficulty"],
        interviewer_style=session["interviewer_style"],
        persona=session["persona"],
        total_questions=min(5, max(3, len(focus) + 1)),
        linked_parent_session_id=session_id,
        practice_focus=focus,
        is_weakness_practice=True,
    )
    return await create_session(request, user)


@app.get("/api/dashboard/{profile_id}")
def dashboard(profile_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    require_owner(profile_id, user)
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
def export_report(
    session_id: str, user: dict[str, Any] = Depends(current_user)
) -> str:
    with db() as connection:
        owned_session(connection, session_id, user)
        report = session_report(connection, session_id)
    session = report["session"]
    lines = [
        f"# AICoachy Interview Report: {session['role_title']}",
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
