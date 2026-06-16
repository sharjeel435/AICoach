import { createElement, useCallback, useEffect, useRef, useState } from "react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpen,
  BrainCircuit,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  CircleCheck,
  Clock3,
  Code2,
  Download,
  FileText,
  Gauge,
  Headphones,
  History,
  LayoutDashboard,
  Lightbulb,
  LoaderCircle,
  Menu,
  MessageSquareText,
  Mic,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  Sparkles,
  Square,
  Target,
  TrendingUp,
  Upload,
  Users,
  UserRound,
  Volume2,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";

const MODES = [
  {
    name: "Full interview",
    icon: BrainCircuit,
    description: "A balanced, adaptive interview across core competencies.",
  },
  {
    name: "Behavioral drill",
    icon: MessageSquareText,
    description: "Practice concise STAR stories and leadership signals.",
  },
  {
    name: "Role deep dive",
    icon: BriefcaseBusiness,
    description: "High-signal questions focused on role expertise.",
  },
  {
    name: "Rapid fire",
    icon: Zap,
    description: "Short, energetic answers under tighter time pressure.",
  },
];
const PERSONAS = [
  {
    name: "Friendly Interviewer",
    icon: UserRound,
    description: "Supportive prompts and confidence-building feedback.",
    focus: "Clarity · growth",
  },
  {
    name: "Strict Technical Interviewer",
    icon: Code2,
    description: "Direct criticism with technical detail and proof.",
    focus: "Accuracy · testing",
  },
  {
    name: "HR Recruiter",
    icon: MessageSquareText,
    description: "Communication, confidence, motivation, and culture fit.",
    focus: "Presence · fit",
  },
  {
    name: "Senior Engineering Manager",
    icon: BriefcaseBusiness,
    description:
      "Architecture, ownership, leadership, and production tradeoffs.",
    focus: "Leadership · systems",
  },
  {
    name: "FAANG-Style Interviewer",
    icon: Target,
    description: "High-bar depth, precision, edge cases, and scalability.",
    focus: "Depth · scale",
  },
];
const SAMPLE_FEEDBACK = {
  overall_score: 78,
  summary:
    "Your answer has a credible core. Make your ownership and measurable impact more explicit.",
  scores: {
    clarity: 82,
    depth: 75,
    relevance: 83,
    structure: 74,
    delivery: 77,
  },
  strengths: [
    "You used a specific professional situation.",
    "Your response sounded natural.",
    "Your decision process was understandable.",
  ],
  improvements: [
    "Lead with the result.",
    "Separate your actions from the team.",
    "Add a measurable outcome.",
  ],
  better_answer:
    "Lead with the outcome, establish the context briefly, explain the decision you owned, and close with the measurable result.",
  model_answer:
    "Activation had plateaued, so I led a two-week discovery sprint combining funnel analysis with twelve customer interviews. The evidence showed that users understood the product value but were not reaching the first meaningful outcome quickly enough. I prioritized a guided onboarding experiment, aligned the team on activation as the success metric, and launched to a controlled cohort. Activation increased 14% and time-to-value fell 21%. The experience taught me to turn uncertainty into a testable risk before debating solutions.",
  comparison_gaps: [
    "Ownership: the model answer names the exact decision and actions the candidate owned.",
    "Evidence: the model answer proves impact with a baseline and measurable result.",
    "Closure: the model answer ends with the outcome and a transferable lesson.",
  ],
  star: { situation: 82, task: 74, action: 78, result: 61 },
};
const DOCUMENT_TEXT_LIMIT = 30000;
const DOCUMENT_ACCEPT =
  ".pdf,.docx,.doc,.txt,.md,.markdown,.rtf,.csv,.json,.html,.htm";

function clampDocumentText(text) {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  return {
    text: normalized.slice(0, DOCUMENT_TEXT_LIMIT),
    truncated: normalized.length > DOCUMENT_TEXT_LIMIT,
  };
}

function fileExtension(file) {
  return file.name.split(".").pop()?.toLowerCase() || "";
}

async function extractPdfText(file) {
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() })
    .promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }
  return pages.join("\n\n");
}

async function extractDocxText(file) {
  const module = await import("mammoth/mammoth.browser");
  const mammoth = module.default || module;
  const result = await mammoth.extractRawText({
    arrayBuffer: await file.arrayBuffer(),
  });
  return result.value;
}

function stripRtf(text) {
  return text
    .replace(/\\par[d]?/g, "\n")
    .replace(/\\'[0-9a-fA-F]{2}/g, " ")
    .replace(/[{}]/g, "")
    .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

function stripHtml(text) {
  const document = new DOMParser().parseFromString(text, "text/html");
  return document.body.textContent || "";
}

function stripLegacyDocText(text) {
  return Array.from(text)
    .map((character) => {
      const code = character.charCodeAt(0);
      return code === 9 ||
        code === 10 ||
        code === 13 ||
        (code >= 32 && code <= 126)
        ? character
        : " ";
    })
    .join("")
    .replace(/\s{2,}/g, " ");
}

async function extractDocumentText(file) {
  const extension = fileExtension(file);
  if (extension === "pdf" || file.type === "application/pdf") {
    return extractPdfText(file);
  }
  if (
    extension === "docx" ||
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return extractDocxText(file);
  }
  const text = await file.text();
  if (extension === "rtf") return stripRtf(text);
  if (["html", "htm"].includes(extension)) return stripHtml(text);
  if (extension === "doc") return stripLegacyDocText(text);
  return text;
}

async function api(path, options = {}) {
  let response;
  const isFormData = options.body instanceof FormData;
  try {
    response = await fetch(`/api${path}`, {
      credentials: "same-origin",
      headers: {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...options.headers,
      },
      ...options,
    });
  } catch {
    throw new Error(
      "Cannot reach the API. Start the app with `npm run dev` and try again.",
    );
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail = Array.isArray(payload?.detail)
      ? payload.detail.map((item) => item.msg).join(", ")
      : payload?.detail;
    if (response.status === 404 && path.startsWith("/auth/")) {
      throw new Error(
        "This deployment is missing the API backend. Redeploy with the Vercel API routes and environment variables.",
      );
    }
    const error = new Error(detail || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function serverExtractDocument(file) {
  const body = new FormData();
  body.append("file", file);
  return api("/documents/extract", {
    method: "POST",
    body,
  });
}

function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const update = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");
    try {
      if (mode === "register") {
        const result = await api("/auth/register", {
          method: "POST",
          body: JSON.stringify(form),
        });
        setNotice(result.message);
        setMode("login");
        setForm((current) => ({ ...current, password: "" }));
      } else {
        const result = await api("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email: form.email, password: form.password }),
        });
        onAuthenticated(result.user);
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <main className="auth-page">
      <section className="auth-story">
        <img src="/aicoachy-mark.svg" alt="" />
        <span className="eyebrow">Private interview practice</span>
        <h1>
          Work on the answer
          <br />
          before it counts.
        </h1>
        <p>
          Practice realistic questions, review what you actually said, and build
          stronger examples over time.
        </p>
        <div className="auth-points">
          <span>
            <b>01</b> Your interview history stays in your workspace
          </span>
          <span>
            <b>02</b> Feedback works with or without an AI provider
          </span>
          <span>
            <b>03</b> Coaches only see accounts they are authorized to access
          </span>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <span className="eyebrow">
            {mode === "login" ? "Your workspace" : "New account"}
          </span>
          <h2>
            {mode === "login" ? "Welcome back." : "Create your workspace."}
          </h2>
          <p>
            {mode === "login"
              ? "Sign in to continue where you left off."
              : "You will start with a private candidate workspace."}
          </p>
          <form onSubmit={submit}>
            {mode === "register" && (
              <label>
                Full name
                <input
                  autoComplete="name"
                  value={form.name}
                  onChange={(event) => update("name", event.target.value)}
                  required
                  minLength={2}
                />
              </label>
            )}
            <label>
              Email address
              <input
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(event) => update("email", event.target.value)}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                value={form.password}
                onChange={(event) => update("password", event.target.value)}
                required
                minLength={mode === "register" ? 10 : 1}
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            {notice && <p className="form-success">{notice}</p>}
            <button className="primary" disabled={loading}>
              {loading && <LoaderCircle className="spin" size={16} />}
              {mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>
          {mode === "login" && (
            <p className="admin-login-note">
              Admin access uses the same sign-in form. The email must exactly
              match the server’s <code>ADMIN_EMAIL</code> setting.
            </p>
          )}
          <button
            className="auth-switch"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError("");
              setNotice("");
            }}
          >
            {mode === "login" ? "Create a new account" : "Back to sign in"}
          </button>
        </div>
      </section>
    </main>
  );
}

function App() {
  const [page, setPage] = useState("dashboard");
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [dashboard, setDashboard] = useState({
    stats: {},
    sessions: [],
    trend: [],
  });
  const [health, setHealth] = useState({ provider: "local" });
  const [roleOptions, setRoleOptions] = useState([]);
  const [setup, setSetup] = useState({
    role_title: "Product Manager",
    company: "",
    seniority: "Mid-level",
    mode: "Full interview",
    difficulty: "Adaptive",
    interviewer_style: "Balanced",
    persona: "Friendly Interviewer",
    total_questions: 6,
    resume_text: "",
    job_description: "",
  });
  const [target, setTarget] = useState(null);
  const [session, setSession] = useState(null);
  const [history, setHistory] = useState([]);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");

  const refreshDashboard = useCallback(async () => {
    if (!user) return;
    try {
      const [data, status] = await Promise.all([
        api(`/dashboard/${user.id}`),
        api("/health"),
      ]);
      setDashboard(data);
      setHealth(status);
    } catch (error) {
      if (error.status === 401) {
        setUser(null);
      }
      setHealth({ provider: "local" });
    }
  }, [user]);

  useEffect(() => {
    const restore = async () => {
      try {
        setUser(await api("/auth/me"));
      } catch {
        /* no active browser session */
      } finally {
        setAuthReady(true);
      }
    };
    restore();
  }, []);
  useEffect(() => {
    api("/roles")
      .then(setRoleOptions)
      .catch(() => setRoleOptions([]));
  }, []);
  useEffect(() => {
    refreshDashboard();
  }, [refreshDashboard]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(""), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

  const startSession = async () => {
    setLoading(true);
    try {
      let targetData = target;
      if (setup.resume_text.trim() || setup.job_description.trim()) {
        targetData = await api("/targets", {
          method: "POST",
          body: JSON.stringify({ profile_id: user.id, ...setup }),
        });
        setTarget(targetData);
      }
      const data = await api("/sessions", {
        method: "POST",
        body: JSON.stringify({
          profile_id: user.id,
          target_id: targetData?.id || null,
          ...setup,
        }),
      });
      setSession(data);
      setHistory([]);
      setPage("studio");
    } catch (error) {
      setToast(error.message);
    } finally {
      setLoading(false);
    }
  };

  const openReport = async (id) => {
    setLoading(true);
    try {
      const data = await api(`/sessions/${id}/report`);
      setReport(data);
      setPage("report");
    } catch (error) {
      setToast(error.message);
    } finally {
      setLoading(false);
    }
  };

  const finishSession = async () => {
    await refreshDashboard();
    await openReport(session.session_id);
  };

  const startWeaknessPractice = async (id) => {
    setLoading(true);
    try {
      const data = await api(`/sessions/${id}/weakness-practice`, {
        method: "POST",
      });
      setSession(data);
      setSetup((current) => ({
        ...current,
        role_title: report.session.role_title,
        difficulty: report.session.difficulty,
        persona: report.session.persona,
        mode: "Weakness practice",
      }));
      setHistory([]);
      setPage("studio");
    } catch (error) {
      setToast(error.message);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      // The local token is cleared even if the server is unavailable.
    }
    setUser(null);
    setPage("dashboard");
  };

  if (!authReady) {
    return (
      <div className="auth-loading">
        <LoaderCircle className="spin" />
      </div>
    );
  }
  if (!user) return <AuthScreen onAuthenticated={setUser} />;

  return (
    <div className="shell">
      <Sidebar
        page={page}
        setPage={setPage}
        provider={health.provider}
        onNew={() => setPage("setup")}
        user={user}
        onLogout={logout}
      />
      <div className="main-shell">
        <Topbar page={page} onNew={() => setPage("setup")} />
        {page === "dashboard" && (
          <Dashboard
            data={dashboard}
            onNew={() => setPage("setup")}
            onOpen={openReport}
          />
        )}
        {page === "setup" && (
          <Setup
            setup={setup}
            setSetup={setSetup}
            target={target}
            setTarget={setTarget}
            roleOptions={roleOptions}
            onStart={startSession}
            loading={loading}
          />
        )}
        {page === "studio" && session && (
          <Studio
            session={session}
            setSession={setSession}
            setup={setup}
            history={history}
            setHistory={setHistory}
            onFinish={finishSession}
          />
        )}
        {page === "history" && (
          <HistoryPage
            data={dashboard}
            onOpen={openReport}
            onNew={() => setPage("setup")}
          />
        )}
        {page === "admin" && user.roles.includes("admin") && <AdminUsers />}
        {page === "report" && report && (
          <Report
            report={report}
            onNew={() => setPage("setup")}
            onPractice={startWeaknessPractice}
            loading={loading}
          />
        )}
        {loading && page !== "setup" && (
          <div className="screen-loader">
            <LoaderCircle className="spin" />
          </div>
        )}
      </div>
      {toast && (
        <div className="toast">
          <CircleCheck size={17} /> {toast}
        </div>
      )}
    </div>
  );
}

function Sidebar({ page, setPage, provider, onNew, user, onLogout }) {
  const links = [
    ["dashboard", LayoutDashboard, "Overview"],
    ["setup", Plus, "New interview"],
    ["history", History, "Session history"],
  ];
  if (user.roles.includes("admin")) links.push(["admin", Users, "User access"]);
  return (
    <aside className="sidebar">
      <button className="brand" onClick={() => setPage("dashboard")}>
        <img src="/aicoachy-mark.svg" alt="" />
        <b>AICoachy</b>
      </button>
      <nav>
        <p>Workspace</p>
        {links.map(([id, icon, label]) => (
          <button
            key={id}
            className={page === id ? "active" : ""}
            onClick={() => (id === "setup" ? onNew() : setPage(id))}
          >
            {createElement(icon, { size: 18 })}
            {label}
          </button>
        ))}
        <p>Development</p>
        <button onClick={() => setPage("history")}>
          <BookOpen size={18} />
          Answer library
        </button>
        <button onClick={() => setPage("dashboard")}>
          <BarChart3 size={18} />
          Performance
        </button>
      </nav>
      <div className="provider-card">
        <span className={`provider-dot ${provider}`} />
        <div>
          <strong>
            {provider === "local"
              ? "Company interview prep"
              : `${provider} connected`}
          </strong>
          <small>
            {provider === "local"
              ? "Resume and job files supported"
              : "Enhanced AI coaching"}
          </small>
        </div>
      </div>
      <div className="profile-chip">
        <span>
          {user.name
            .split(/\s+/)
            .map((part) => part[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </span>
        <div>
          <strong>{user.name}</strong>
          <small>{user.roles.join(" · ")}</small>
        </div>
        <button className="logout-button" onClick={onLogout} title="Sign out">
          <Settings2 size={16} />
        </button>
      </div>
    </aside>
  );
}

function Topbar({ page, onNew }) {
  const titles = {
    dashboard: "Interview command center",
    setup: "Build your interview",
    studio: "Live interview studio",
    history: "Session history",
    report: "Performance report",
    admin: "User access",
  };
  return (
    <header className="topbar">
      <div className="topbar-title">
        <span className="mobile-menu">
          <Menu size={20} />
        </span>
        <div>
          <small>AICoachy workspace</small>
          <strong>{titles[page]}</strong>
        </div>
      </div>
      <button className="topbar-cta" onClick={onNew}>
        <Plus size={16} /> New interview
      </button>
    </header>
  );
}

function Dashboard({ data, onNew, onOpen }) {
  const stats = data.stats || {};
  const recent = data.sessions || [];
  return (
    <main className="page dashboard-page">
      <section className="welcome">
        <div>
          <span className="eyebrow">Interview preparation platform</span>
          <h1>
            Prepare with purpose.
            <br />
            Perform with confidence.
          </h1>
          <p>
            Run role-specific mock interviews, analyze every response, and build
            a measurable record of your progress.
          </p>
          <button className="primary" onClick={onNew}>
            Create interview <ArrowRight size={17} />
          </button>
        </div>
        <div className="readiness-card">
          <div className="readiness-top">
            <span>Interview readiness</span>
            <strong>
              {stats.average_score || 0}
              <small>/100</small>
            </strong>
          </div>
          <div
            className="readiness-ring"
            style={{ "--value": stats.average_score || 0 }}
          >
            <div>
              <span className="readiness-label">Current level</span>
              <strong>
                {stats.total_sessions ? "In progress" : "No baseline"}
              </strong>
              <span>{stats.questions_answered || 0} answers analyzed</span>
            </div>
          </div>
          <div className="readiness-foot">
            <span>
              <i className="green" />
              Clarity
            </span>
            <span>
              <i className="amber" />
              Impact
            </span>
            <span>
              <i />
              Delivery
            </span>
          </div>
        </div>
      </section>

      <section className="metric-grid">
        <Metric
          index="01"
          label="Questions answered"
          value={stats.questions_answered || 0}
          note="Across all practice sessions"
        />
        <Metric
          index="02"
          label="Average score"
          value={`${stats.average_score || 0}%`}
          note="Quality across five dimensions"
        />
        <Metric
          index="03"
          label="Personal best"
          value={`${stats.best_score || 0}%`}
          note={
            stats.best_score
              ? "Keep raising the floor"
              : "Your first benchmark awaits"
          }
        />
        <Metric
          index="04"
          label="Practice sessions"
          value={stats.total_sessions || 0}
          note="Saved automatically"
        />
      </section>

      <section className="dashboard-grid">
        <div className="panel progress-panel">
          <PanelHead
            kicker="Performance"
            title="Your practice trajectory"
            action="Last 8 sessions"
          />
          <TrendChart values={data.trend || []} />
          <div className="chart-caption">
            <span>
              <i />
              Overall score
            </span>
            <strong>
              {data.trend?.length
                ? `+${Math.max(0, data.trend.at(-1) - data.trend[0])} points`
                : "Complete a session to begin"}
            </strong>
          </div>
        </div>
        <div className="panel focus-panel">
          <PanelHead
            kicker="Recommended next"
            title="Your highest-value drill"
          />
          <span className="focus-label">Based on your recent answers</span>
          <h3>Make impact measurable</h3>
          <p>
            Practice closing every story with a baseline, a result, and why that
            result mattered.
          </p>
          <div className="focus-meta">
            <span>10 minutes</span>
            <span>Behavioral</span>
            <span>3 questions</span>
          </div>
          <button onClick={onNew}>
            Start focused drill <ChevronRight size={16} />
          </button>
        </div>
      </section>

      <section className="recent-section">
        <PanelHead
          kicker="Saved automatically"
          title="Recent sessions"
          action={`${recent.length} total`}
        />
        {recent.length ? (
          <SessionTable sessions={recent.slice(0, 5)} onOpen={onOpen} />
        ) : (
          <EmptySessions onNew={onNew} />
        )}
      </section>
    </main>
  );
}

function Metric({ index, label, value, note }) {
  return (
    <article className="metric">
      <div>
        <span className="metric-index">{index}</span>
        <small>{label}</small>
      </div>
      <strong>{value}</strong>
      <p>{note}</p>
    </article>
  );
}
function PanelHead({ kicker, title, action }) {
  return (
    <div className="panel-head">
      <div>
        <span>{kicker}</span>
        <h2>{title}</h2>
      </div>
      {action && <small>{action}</small>}
    </div>
  );
}
function TrendChart({ values }) {
  const points = values.length ? values : [42, 52, 49, 63, 67, 72, 76, 81];
  const coords = points
    .map(
      (value, index) =>
        `${(index / Math.max(points.length - 1, 1)) * 100},${100 - value}`,
    )
    .join(" ");
  return (
    <div className="trend-chart">
      <div className="grid-lines">
        <i />
        <i />
        <i />
        <i />
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity=".22" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,100 ${coords} 100,100`} fill="url(#chartFill)" />
        <polyline
          points={coords}
          fill="none"
          stroke="#2563eb"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

function Setup({
  setup,
  setSetup,
  target,
  setTarget,
  roleOptions,
  onStart,
  loading,
}) {
  const [step, setStep] = useState(1);
  const update = (key, value) => {
    setSetup((current) => ({ ...current, [key]: value }));
    setTarget(null);
  };
  return (
    <main className="page setup-page">
      <div className="setup-header">
        <span className="eyebrow">Interview setup</span>
        <h1>Configure a focused practice session.</h1>
        <p>
          Choose a role, add opportunity context, and set the interview format.
        </p>
      </div>
      <div className="stepper">
        {["Target role", "Job intelligence", "Interview style"].map(
          (label, index) => (
            <button
              key={label}
              className={
                step === index + 1 ? "active" : step > index + 1 ? "done" : ""
              }
              onClick={() => setStep(index + 1)}
            >
              <span>{step > index + 1 ? <Check size={14} /> : index + 1}</span>
              <div>
                <small>Step 0{index + 1}</small>
                <strong>{label}</strong>
              </div>
            </button>
          ),
        )}
      </div>
      <div className="builder-layout">
        <section className="builder-panel">
          {step === 1 && (
            <RoleStep setup={setup} update={update} roles={roleOptions} />
          )}
          {step === 2 && (
            <TargetStep setup={setup} update={update} target={target} />
          )}
          {step === 3 && <StyleStep setup={setup} update={update} />}
          <div className="builder-actions">
            <button
              className="secondary"
              disabled={step === 1}
              onClick={() => setStep((value) => value - 1)}
            >
              <ArrowLeft size={16} /> Back
            </button>
            {step < 3 ? (
              <button
                className="primary"
                onClick={() => setStep((value) => value + 1)}
              >
                Continue <ArrowRight size={16} />
              </button>
            ) : (
              <button className="primary" onClick={onStart} disabled={loading}>
                {loading ? (
                  <LoaderCircle className="spin" />
                ) : (
                  <Mic size={17} />
                )}{" "}
                Enter interview studio
              </button>
            )}
          </div>
        </section>
        <SessionPreview setup={setup} target={target} />
      </div>
    </main>
  );
}

function RoleStep({ setup, update, roles }) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? roles.filter((role) =>
        `${role.title} ${role.category}`.toLowerCase().includes(normalized),
      )
    : roles.filter((role) => role.featured);
  return (
    <div className="builder-content">
      <span className="section-number">01 / ROLE</span>
      <h2>What role are you pursuing?</h2>
      <p>Search the role directory or choose a common starting point.</p>
      <label className="role-search">
        Search more than {roles.length || 200} professions
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Try data scientist, nurse, finance manager, recruiter..."
        />
      </label>
      <div className="role-results-head">
        <span>
          {normalized ? `${filtered.length} matches` : "Common roles"}
        </span>
        {normalized && (
          <button onClick={() => setQuery("")}>Clear search</button>
        )}
      </div>
      <div className="role-grid">
        {filtered.slice(0, normalized ? 24 : 8).map((role) => (
          <button
            key={role.title}
            className={`role-choice ${setup.role_title === role.title ? "selected" : ""}`}
            onClick={() => update("role_title", role.title)}
          >
            <span className="role-code">
              {role.title
                .split(/\s+/)
                .map((word) => word[0])
                .slice(0, 3)
                .join("")}
            </span>
            <div>
              <strong>{role.title}</strong>
              <small>
                {role.category} · {role.blurb}
              </small>
            </div>
            {setup.role_title === role.title && (
              <span className="selection-state">Selected</span>
            )}
          </button>
        ))}
      </div>
      {normalized && !filtered.length && (
        <button
          className="custom-role"
          onClick={() => update("role_title", query.trim())}
        >
          Use “{query.trim()}” as a custom role
        </button>
      )}
      <div className="field-row">
        <label>
          Target company
          <input
            value={setup.company}
            onChange={(event) => update("company", event.target.value)}
            placeholder="e.g. Stripe, Google, a Series B startup"
          />
        </label>
        <label>
          Seniority
          <select
            value={setup.seniority}
            onChange={(event) => update("seniority", event.target.value)}
          >
            <option>Entry-level</option>
            <option>Mid-level</option>
            <option>Senior</option>
            <option>Staff / Lead</option>
            <option>Manager</option>
          </select>
        </label>
      </div>
    </div>
  );
}

function TargetStep({ setup, update }) {
  const [fileState, setFileState] = useState({});
  const extractWithFallback = async (file) => {
    try {
      const text = await extractDocumentText(file);
      const { text: normalized } = clampDocumentText(text);
      if (
        normalized.length >= 20 ||
        !["pdf", "docx"].includes(fileExtension(file))
      ) {
        return { text };
      }
      throw new Error("Browser extraction returned too little text.");
    } catch {
      const result = await serverExtractDocument(file);
      return {
        text: result.text,
        truncated: result.truncated,
        source: "server",
      };
    }
  };
  const loadFile = async (key, file) => {
    if (!file) return;
    setFileState((current) => ({
      ...current,
      [key]: { status: "loading", message: `Reading ${file.name}...` },
    }));
    try {
      const extracted = await extractWithFallback(file);
      const { text, truncated } = clampDocumentText(extracted.text);
      if (!text) {
        throw new Error("No readable text was found in that file.");
      }
      update(key, text);
      setFileState((current) => ({
        ...current,
        [key]: {
          status: "success",
          message: `${file.name} synced (${text.length} characters${truncated || extracted.truncated ? ", trimmed" : ""}).`,
        },
      }));
    } catch (error) {
      setFileState((current) => ({
        ...current,
        [key]: {
          status: "error",
          message:
            error.message ||
            "Could not read this file. Paste the text into the box instead.",
        },
      }));
    }
  };
  const updateText = (key, value) => {
    update(key, value.slice(0, DOCUMENT_TEXT_LIMIT));
    setFileState((current) => ({ ...current, [key]: null }));
  };
  return (
    <div className="builder-content">
      <span className="section-number">02 / INTELLIGENCE</span>
      <h2>Make it specific to the opportunity.</h2>
      <p>
        Paste the source material or upload a document. Everything stays on this
        machine unless you connect an AI provider.
      </p>
      <div className="document-grid">
        <label className="document-field">
          <span>
            <FileText size={18} /> Resume or experience notes{" "}
            <em>
              {setup.resume_text.length
                ? `${setup.resume_text.length} characters`
                : "Optional"}
            </em>
          </span>
          <textarea
            value={setup.resume_text}
            maxLength={DOCUMENT_TEXT_LIMIT}
            onChange={(event) =>
              updateText("resume_text", event.target.value)
            }
            placeholder="Paste your resume, key projects, or experience highlights…"
          />
          <input
            type="file"
            accept={DOCUMENT_ACCEPT}
            onChange={(event) => {
              loadFile("resume_text", event.target.files[0]);
              event.target.value = "";
            }}
          />
          <b>
            <Upload size={14} /> Import PDF, DOCX, or text
          </b>
          {fileState.resume_text?.message && (
            <small className={`file-state ${fileState.resume_text.status}`}>
              {fileState.resume_text.message}
            </small>
          )}
        </label>
        <label className="document-field">
          <span>
            <BriefcaseBusiness size={18} /> Job description{" "}
            <em>
              {setup.job_description.length
                ? `${setup.job_description.length} characters`
                : "Recommended"}
            </em>
          </span>
          <textarea
            value={setup.job_description}
            maxLength={DOCUMENT_TEXT_LIMIT}
            onChange={(event) =>
              updateText("job_description", event.target.value)
            }
            placeholder="Paste responsibilities, requirements, and company context…"
          />
          <input
            type="file"
            accept={DOCUMENT_ACCEPT}
            onChange={(event) => {
              loadFile("job_description", event.target.files[0]);
              event.target.value = "";
            }}
          />
          <b>
            <Upload size={14} /> Import PDF, DOCX, or text
          </b>
          {fileState.job_description?.message && (
            <small
              className={`file-state ${fileState.job_description.status}`}
            >
              {fileState.job_description.message}
            </small>
          )}
        </label>
      </div>
      <div className="privacy-strip">
        <CircleCheck size={17} />
        <div>
          <strong>Local-first by design</strong>
          <span>
            Your material is stored in the local SQLite database and is never
            required for the app to work.
          </span>
        </div>
      </div>
    </div>
  );
}

function StyleStep({ setup, update }) {
  return (
    <div className="builder-content">
      <span className="section-number">03 / FORMAT</span>
      <h2>Choose the pressure and pace.</h2>
      <p>
        Build a realistic simulation or isolate one skill for deliberate
        practice.
      </p>
      <div className="mode-grid">
        {MODES.map((mode, index) => (
          <button
            key={mode.name}
            className={setup.mode === mode.name ? "selected" : ""}
            onClick={() => update("mode", mode.name)}
          >
            <small className="option-number">0{index + 1}</small>
            <strong>{mode.name}</strong>
            <span>{mode.description}</span>
            {setup.mode === mode.name && (
              <span className="selected-word">Selected</span>
            )}
          </button>
        ))}
      </div>
      <div className="persona-heading">
        <span className="section-number">INTERVIEWER PERSONA</span>
        <h3>Who should challenge you?</h3>
        <p>
          The persona changes question tone, scoring strictness, and coaching
          language.
        </p>
      </div>
      <div className="persona-grid">
        {PERSONAS.map((persona, index) => (
          <button
            key={persona.name}
            className={setup.persona === persona.name ? "selected" : ""}
            onClick={() => update("persona", persona.name)}
          >
            <span className="persona-number">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div>
              <strong>{persona.name}</strong>
              <small>{persona.description}</small>
              <em>{persona.focus}</em>
            </div>
            {setup.persona === persona.name && (
              <span className="selection-state">Selected</span>
            )}
          </button>
        ))}
      </div>
      <div className="field-row three">
        <label>
          Difficulty
          <select
            value={setup.difficulty}
            onChange={(event) => update("difficulty", event.target.value)}
          >
            <option>Supportive</option>
            <option>Adaptive</option>
            <option>Challenging</option>
          </select>
        </label>
        <label>
          Interview style
          <select
            value={setup.interviewer_style}
            onChange={(event) =>
              update("interviewer_style", event.target.value)
            }
          >
            <option>Balanced</option>
            <option>Friendly coach</option>
            <option>Strict recruiter</option>
            <option>Executive panel</option>
          </select>
        </label>
        <label>
          Questions
          <select
            value={setup.total_questions}
            onChange={(event) =>
              update("total_questions", Number(event.target.value))
            }
          >
            <option value={3}>3 questions</option>
            <option value={5}>5 questions</option>
            <option value={6}>6 questions</option>
            <option value={8}>8 questions</option>
          </select>
        </label>
      </div>
    </div>
  );
}

function SessionPreview({ setup, target }) {
  const analysis = target?.analysis;
  const resumeLoaded = setup.resume_text.trim().length > 0;
  const jobLoaded = setup.job_description.trim().length > 0;
  return (
    <aside className="preview-card">
      <span className="preview-kicker">Session preview</span>
      <div className="preview-role-code">
        {setup.role_title
          .split(/\s+/)
          .map((word) => word[0])
          .join("")}
      </div>
      <h3>{setup.role_title}</h3>
      <p>
        {setup.company || "Open company practice"} · {setup.seniority}
      </p>
      <div className="preview-list">
        <span>
          <small>Format</small>
          {setup.mode}
        </span>
        <span>
          <small>Difficulty</small>
          {setup.difficulty} difficulty
        </span>
        <span>
          <small>Length</small>
          {setup.total_questions} questions
        </span>
        <span>
          <small>Response</small>
          Voice and text enabled
        </span>
        <span>
          <small>Resume</small>
          {resumeLoaded ? "Synced" : "Not added"}
        </span>
        <span>
          <small>Job file</small>
          {jobLoaded ? "Synced" : "Not added"}
        </span>
      </div>
      {analysis ? (
        <div className="match-card">
          <strong>{analysis.match_score}% match</strong>
          <p>{analysis.positioning}</p>
        </div>
      ) : resumeLoaded || jobLoaded ? (
        <div className="preview-note synced">
          <CircleCheck size={17} />
          <p>
            Uploaded context is synced. Start the interview to generate
            role-specific questions and gap analysis.
          </p>
        </div>
      ) : (
        <div className="preview-note">
          <WandSparkles size={17} />
          <p>
            Add a resume and job description to unlock opportunity-specific
            questions and gap analysis.
          </p>
        </div>
      )}
    </aside>
  );
}

function analyzeAnswer(answer, role) {
  const text = answer.trim();
  const lowered = text.toLowerCase();
  const words = text ? text.split(/\s+/).length : 0;
  const hasExample =
    /\b(for example|for instance|when i|in my|at my|a project|a time)\b/.test(
      lowered,
    );
  const hasTradeoff =
    /\b(trade-?off|however|constraint|alternative|instead|balanced)\b/.test(
      lowered,
    );
  const hasImpact =
    /\b(\d+%?|\bresult|\bimpact|increased|reduced|saved|grew|improved)\b/.test(
      lowered,
    );
  const hasStar =
    /\b(situation|task|action|result)\b/.test(lowered) ||
    (/\b(when|challenge|context)\b/.test(lowered) &&
      /\bi (led|built|created|owned|decided|implemented)\b/.test(lowered) &&
      hasImpact);
  const hasTesting =
    /\b(test|tested|testing|validation|verified|experiment)\b/.test(lowered);
  const hasProduction =
    /\b(production|monitoring|observability|rollout|incident|reliability|deployment)\b/.test(
      lowered,
    );
  const hasEdges =
    /\b(edge case|failure mode|fallback|retry|limit|scalab|latency|security)\w*\b/.test(
      lowered,
    );
  const weakPhrases =
    lowered.match(/\b(i think|maybe|not sure|basically)\b/g) || [];
  const technicalRole = role === "Software Engineer";
  const hints = [];
  if (words < 70) hints.push("Answer is too short");
  if (!hasExample) hints.push("Add a real example");
  if (!hasTradeoff) hints.push("Add tradeoffs");
  if (!hasImpact) hints.push("Add measurable impact");
  if (!hasStar) hints.push("Use STAR structure");
  if (technicalRole && !hasTesting) hints.push("Mention testing");
  if (technicalRole && !hasProduction)
    hints.push("Mention production handling");
  if (technicalRole && !hasEdges) hints.push("Mention edge cases");
  if (weakPhrases.length)
    hints.push(`Avoid weak phrases: ${[...new Set(weakPhrases)].join(", ")}`);
  return {
    hints: hints.slice(0, 5),
    statuses: [
      [
        "Answer length",
        words >= 90 ? "Strong" : words >= 45 ? "Developing" : "Too short",
        words >= 90,
      ],
      ["Structure", hasStar ? "STAR visible" : "Needs structure", hasStar],
      ["Example", hasExample ? "Specific" : "Missing", hasExample],
      [
        "Confidence",
        weakPhrases.length ? "Hedged" : text ? "Direct" : "Waiting",
        text && !weakPhrases.length,
      ],
      [
        "Technical depth",
        hasTradeoff && (!technicalRole || hasTesting || hasProduction)
          ? "Evidence present"
          : "Add depth",
        hasTradeoff && (!technicalRole || hasTesting || hasProduction),
      ],
    ],
  };
}

function LiveCoach({ answer, role }) {
  const analysis = analyzeAnswer(answer, role);
  return (
    <aside className="live-coach">
      <div className="live-coach-head">
        <span>
          <Sparkles size={15} /> Real-time answer coach
        </span>
        <small>Local analysis · no API call</small>
      </div>
      <div className="coach-status-grid">
        {analysis.statuses.map(([label, value, ready]) => (
          <div key={label} className={ready ? "ready" : ""}>
            <span>{label}</span>
            <strong>
              {ready ? <CircleCheck size={13} /> : <Activity size={13} />}
              {value}
            </strong>
          </div>
        ))}
      </div>
      <div className="coach-hints">
        {analysis.hints.length ? (
          analysis.hints.map((hint) => (
            <p key={hint}>
              <Lightbulb size={13} />
              {hint}
            </p>
          ))
        ) : (
          <p className="complete">
            <CircleCheck size={13} />
            Your answer covers the core coaching signals.
          </p>
        )}
      </div>
    </aside>
  );
}

function Studio({ session, setSession, setup, history, setHistory, onFinish }) {
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [delivery, setDelivery] = useState(null);
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const recognitionRef = useRef(null);
  const timerRef = useRef(null);
  const number = history.length + 1;

  useEffect(
    () => () => {
      recognitionRef.current?.stop();
      clearInterval(timerRef.current);
    },
    [],
  );
  const toggleVoice = () => {
    if (listening) {
      recognitionRef.current?.stop();
      clearInterval(timerRef.current);
      setListening(false);
      return;
    }
    const Recognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setError(
        "Voice input requires Chrome or Edge. Typing remains available.",
      );
      return;
    }
    const recognition = new Recognition();
    let committed = answer;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal)
          committed += `${committed ? " " : ""}${text}`;
        else interim += text;
      }
      setAnswer(`${committed}${interim ? ` ${interim}` : ""}`);
    };
    recognition.onend = () => {
      setListening(false);
      clearInterval(timerRef.current);
    };
    recognition.onerror = () =>
      setError("The microphone stopped. Your transcript is still here.");
    recognition.start();
    recognitionRef.current = recognition;
    setListening(true);
    setError("");
    timerRef.current = setInterval(
      () => setSeconds((value) => value + 1),
      1000,
    );
  };
  const submit = async () => {
    if (answer.trim().length < 30) {
      setError(
        "Develop the answer a little further before requesting feedback.",
      );
      return;
    }
    recognitionRef.current?.stop();
    clearInterval(timerRef.current);
    setLoading(true);
    setError("");
    try {
      const data = await api(`/sessions/${session.session_id}/answers`, {
        method: "POST",
        body: JSON.stringify({
          question: session.question,
          answer,
          question_number: number,
          duration_seconds: seconds,
        }),
      });
      setFeedback(data.feedback);
      setDelivery(data.delivery);
      setSession((current) => ({
        ...current,
        next_question: data.next_question,
        next_question_type: data.next_question_type,
        completed: data.completed,
      }));
    } catch {
      setFeedback(SAMPLE_FEEDBACK);
      setDelivery({
        word_count: answer.split(/\s+/).length,
        words_per_minute: 128,
        filler_count: 1,
        pace_label: "Measured",
        concision_score: 82,
      });
    } finally {
      setLoading(false);
    }
  };
  const next = () => {
    const nextHistory = [
      ...history,
      { question: session.question, answer, feedback, delivery },
    ];
    setHistory(nextHistory);
    if (session.completed || nextHistory.length >= session.total_questions) {
      onFinish();
      return;
    }
    setSession((current) => ({
      ...current,
      question: current.next_question,
      question_type: current.next_question_type,
    }));
    setAnswer("");
    setFeedback(null);
    setDelivery(null);
    setSeconds(0);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return (
    <main className="studio-page">
      <div className="studio-progress">
        <span
          style={{ width: `${(number / session.total_questions) * 100}%` }}
        />
      </div>
      <div className="studio-bar">
        <div>
          <span className="live-dot" /> Live practice
        </div>
        <strong>{setup.role_title}</strong>
        <span>
          Question {number} of {session.total_questions}
        </span>
      </div>
      <div className="studio-layout">
        <section className="interviewer">
          <div className="interviewer-meta">
            <span className="interviewer-avatar">AI</span>
            <div>
              <strong>{session.persona || setup.persona}</strong>
              <small>
                {session.question_type} · {setup.difficulty}
              </small>
            </div>
          </div>
          {session.is_weakness_practice && (
            <span className="weakness-badge">
              <Target size={13} /> Weakness Practice Session
            </span>
          )}
          <div className="question-block">
            <span>Question {String(number).padStart(2, "0")}</span>
            <h1>{session.question}</h1>
            <button
              onClick={() => {
                speechSynthesis.cancel();
                speechSynthesis.speak(
                  new SpeechSynthesisUtterance(session.question),
                );
              }}
            >
              <Volume2 size={16} /> Listen to question
            </button>
          </div>
          <div className="studio-tip">
            <Lightbulb size={18} />
            <div>
              <strong>Think before you fill the silence.</strong>
              <p>
                A two-second pause sounds more confident than a rushed opening.
                Lead with your answer, then support it.
              </p>
            </div>
          </div>
        </section>
        <section className="response-workspace">
          {feedback ? (
            <Feedback
              feedback={feedback}
              delivery={delivery}
              answer={answer}
              question={session.question}
              onNext={next}
              final={number >= session.total_questions}
            />
          ) : (
            <>
              <div className="response-head">
                <div>
                  <span>Your response</span>
                  <small>
                    {answer.trim() ? answer.trim().split(/\s+/).length : 0}{" "}
                    words · {formatTime(seconds)}
                  </small>
                </div>
                <button
                  className={listening ? "recording" : ""}
                  onClick={toggleVoice}
                >
                  {listening ? (
                    <Square size={14} fill="currentColor" />
                  ) : (
                    <Mic size={16} />
                  )}
                  {listening ? "Stop" : "Answer with voice"}
                </button>
              </div>
              <div className={`transcript ${listening ? "listening" : ""}`}>
                {listening && (
                  <div className="listening-strip">
                    <span />
                    Listening to your answer
                    <div className="wave">
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                    </div>
                  </div>
                )}
                <textarea
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  placeholder="Take a breath, then begin. Your transcript will appear here…"
                />
                <div className="transcript-foot">
                  <span>
                    <Activity size={14} /> Live delivery analysis
                  </span>
                  {answer && (
                    <button onClick={() => setAnswer("")}>
                      <X size={14} /> Clear
                    </button>
                  )}
                </div>
              </div>
              <LiveCoach answer={answer} role={setup.role_title} />
              {error && <p className="form-error">{error}</p>}
              <div className="live-signals">
                <Signal
                  label="Pace"
                  value={listening ? "Listening…" : "Ready"}
                />
                <Signal
                  label="Answer length"
                  value={
                    answer.split(/\s+/).filter(Boolean).length < 60
                      ? "Developing"
                      : "Strong"
                  }
                />
                <Signal label="Privacy" value="Local session" />
              </div>
              <button
                className="primary submit-response"
                disabled={loading || !answer.trim()}
                onClick={submit}
              >
                {loading ? (
                  <>
                    <LoaderCircle className="spin" /> Analyzing five dimensions…
                  </>
                ) : (
                  <>
                    Analyze my answer <ArrowRight size={17} />
                  </>
                )}
              </button>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function Signal({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function formatTime(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function Feedback({ feedback, delivery, answer, question, onNext, final }) {
  const scores = Object.entries(feedback.scores || {});
  return (
    <div className="feedback">
      <div className="feedback-hero">
        <div
          className="score-dial"
          style={{ "--score": feedback.overall_score }}
        >
          <strong>{feedback.overall_score}</strong>
          <span>overall</span>
        </div>
        <div>
          <span className="eyebrow">Coaching analysis</span>
          <h2>
            {feedback.overall_score >= 85
              ? "A compelling, interview-ready answer."
              : feedback.overall_score >= 72
                ? "Strong foundation. Sharpen the proof."
                : "Good raw material. Build the structure."}
          </h2>
          <p>{feedback.summary}</p>
        </div>
      </div>
      <div className="dimension-grid">
        {scores.map(([name, value]) => (
          <div key={name}>
            <span>
              {name}
              <strong>{value}</strong>
            </span>
            <i>
              <b style={{ width: `${value}%` }} />
            </i>
          </div>
        ))}
      </div>
      {delivery && (
        <div className="delivery-row">
          <Delivery
            icon={Gauge}
            label="Speaking pace"
            value={`${delivery.words_per_minute} wpm`}
            note={delivery.pace_label}
          />
          <Delivery
            icon={Pause}
            label="Filler words"
            value={delivery.filler_count}
            note={delivery.filler_count <= 2 ? "Controlled" : "Reduce"}
          />
          <Delivery
            icon={MessageSquareText}
            label="Answer length"
            value={delivery.word_count}
            note="words"
          />
          <Delivery
            icon={Zap}
            label="Concision"
            value={`${delivery.concision_score}%`}
            note="focus"
          />
        </div>
      )}
      <div className="coaching-columns">
        <FeedbackList
          positive
          title="Signals that landed"
          items={feedback.strengths}
        />
        <FeedbackList
          title="Highest-value improvements"
          items={feedback.improvements}
        />
      </div>
      <AnswerComparison
        question={question}
        answer={answer}
        modelAnswer={feedback.model_answer || feedback.better_answer}
        gaps={feedback.comparison_gaps || feedback.improvements}
      />
      <details className="stronger-answer">
        <summary>
          <span>
            <WandSparkles size={17} /> How to build your next version
          </span>
          <ChevronRight size={17} />
        </summary>
        <p>{feedback.better_answer}</p>
      </details>
      <button className="primary submit-response" onClick={onNext}>
        {final ? "Open full performance report" : "Continue to next question"}{" "}
        <ArrowRight size={17} />
      </button>
    </div>
  );
}
function AnswerComparison({ question, answer, modelAnswer, gaps }) {
  return (
    <section className="answer-comparison">
      <div className="comparison-head">
        <div>
          <span className="eyebrow">Instant model answer</span>
          <h3>See what an excellent answer does differently.</h3>
        </div>
        <span className="model-badge">
          <Sparkles size={14} /> Exact question
        </span>
      </div>
      <p className="comparison-question">{question}</p>
      <div className="comparison-grid">
        <article className="candidate-answer">
          <div className="answer-label">
            <span>Your answer</span>
            <small>Current version</small>
          </div>
          <p>{answer}</p>
        </article>
        <article className="model-answer">
          <div className="answer-label">
            <span>
              <WandSparkles size={15} /> Model answer
            </span>
            <small>10/10 example</small>
          </div>
          <p>{modelAnswer}</p>
          <em>
            Use the technique and structure. Keep your own experience truthful.
          </em>
        </article>
      </div>
      <div className="gap-analysis">
        <strong>What creates the gap</strong>
        <div>
          {gaps.map((gap, index) => (
            <p key={gap}>
              <span>{index + 1}</span>
              {gap}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
function Delivery({ icon, label, value, note }) {
  return (
    <div>
      {createElement(icon, { size: 16 })}
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
function FeedbackList({ title, items, positive = false }) {
  return (
    <div className={`feedback-list ${positive ? "positive" : ""}`}>
      <h3>
        {positive ? <CircleCheck size={18} /> : <Target size={18} />}
        {title}
      </h3>
      {items.map((item) => (
        <p key={item}>
          <span>{positive ? "✓" : "→"}</span>
          {item}
        </p>
      ))}
    </div>
  );
}

function Report({ report, onNew, onPractice, loading }) {
  const { session, answers, averages } = report;
  const resume = report.resume_improvement || {};
  const download = async () => {
    const response = await fetch(`/api/sessions/${session.id}/export`, {
      credentials: "same-origin",
    });
    if (!response.ok) return;
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `aicoachy-${session.role_title.toLowerCase().replace(/\s+/g, "-")}-report.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  return (
    <main className="page report-page">
      <section className="report-heading">
        <div>
          <span className="eyebrow">
            Session complete · {session.role_title}
          </span>
          <h1>
            Your performance,
            <br />
            made actionable.
          </h1>
          <p>
            You completed {answers.length} questions. Here is the evidence, not
            just a score.
          </p>
        </div>
        <div className="report-actions">
          <button
            className="weakness-action"
            onClick={() => onPractice(session.id)}
            disabled={loading}
          >
            {loading ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Target size={16} />
            )}
            Practice My Weak Areas
          </button>
          <button className="secondary" onClick={download}>
            <Download size={16} /> Export report
          </button>
          <button className="primary" onClick={onNew}>
            <RotateCcw size={16} /> Practice again
          </button>
        </div>
      </section>
      <section className="report-summary">
        <div className="report-score">
          <span>Overall performance</span>
          <strong>{report.overall_score}</strong>
          <small>/ 100</small>
          <p>
            {report.overall_score >= 80
              ? "Interview ready"
              : "Promising foundation"}
          </p>
        </div>
        <div className="radar-wrap">
          <Radar scores={averages} />
        </div>
        <div className="report-insights">
          <div>
            <span className="success">
              <TrendingUp />
            </span>
            <p>
              Strongest competency<strong>{report.top_strength}</strong>
            </p>
          </div>
          <div>
            <span className="focus">
              <Target />
            </span>
            <p>
              Priority improvement<strong>{report.focus_area}</strong>
            </p>
          </div>
          <div>
            <span>
              <MessageSquareText />
            </span>
            <p>
              Answers analyzed<strong>{answers.length} complete</strong>
            </p>
          </div>
        </div>
      </section>
      <section className="report-grid">
        <div className="panel">
          <PanelHead kicker="Competencies" title="How your answers performed" />
          {Object.entries(averages).map(([name, value]) => (
            <div className="report-bar" key={name}>
              <span>
                {name}
                <strong>{value}</strong>
              </span>
              <i>
                <b style={{ width: `${value}%` }} />
              </i>
            </div>
          ))}
        </div>
        <div className="panel action-plan">
          <PanelHead kicker="Next seven days" title="Your practice plan" />
          {report.recommendations.map((item, index) => (
            <div key={item}>
              <span>0{index + 1}</span>
              <p>{item}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="replay-section">
        <PanelHead
          kicker="Interview replay"
          title="The complete decision trail"
          action={`${answers.length} moments`}
        />
        <div className="replay-timeline">
          {answers.map((item) => (
            <article className="replay-card" key={item.question_number}>
              <div className="timeline-marker">
                <span>{String(item.question_number).padStart(2, "0")}</span>
              </div>
              <div className="replay-content">
                <div className="replay-meta">
                  <span>
                    {formatTime(item.delivery.duration_seconds || 0)} spent
                  </span>
                  <strong>{item.feedback.overall_score}/100</strong>
                </div>
                <h3>{item.question}</h3>
                <div className="replay-answer">
                  <small>Your answer</small>
                  <p>{item.answer}</p>
                </div>
                <div className="replay-insights">
                  <div>
                    <span>Main weakness</span>
                    <p>{item.main_weakness}</p>
                  </div>
                  <div>
                    <span>Main improvement</span>
                    <p>{item.main_improvement}</p>
                  </div>
                </div>
                <details>
                  <summary>
                    View improved answer <ChevronRight size={15} />
                  </summary>
                  <p>{item.improved_answer}</p>
                </details>
                {item.follow_up_question && (
                  <div className="follow-up-review">
                    <MessageSquareText size={14} />
                    <p>
                      <span>Follow-up</span>
                      {item.follow_up_question}
                    </p>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="resume-improvement">
        <div className="resume-improvement-head">
          <div>
            <span className="eyebrow">Resume improvement suggestions</span>
            <h2>Turn interview evidence into stronger positioning.</h2>
          </div>
          <span>
            <FileText size={18} /> Role-aligned
          </span>
        </div>
        <div className="resume-grid">
          <ResumeInsight
            title="Demonstrated skills"
            items={resume.demonstrated_skills}
            positive
          />
          <ResumeInsight title="Missing skills" items={resume.missing_skills} />
          <ResumeInsight
            title="Recommended keywords"
            items={resume.missing_keywords}
            tags
          />
          <ResumeInsight title="Project ideas" items={resume.project_ideas} />
        </div>
        <div className="resume-bullets">
          <h3>Suggested resume bullets</h3>
          {(resume.suggested_bullets || []).map((item) => (
            <p key={item}>
              <Sparkles size={14} />
              {item}
            </p>
          ))}
        </div>
      </section>
      <section className="answer-review">
        <PanelHead
          kicker="Answer evidence"
          title="Question-by-question review"
          action={`${answers.length} responses`}
        />
        {answers.map((item) => (
          <details key={item.question_number}>
            <summary>
              <span>
                <b>0{item.question_number}</b>
                <div>
                  <small>{item.feedback.overall_score}/100</small>
                  <strong>{item.question}</strong>
                </div>
              </span>
              <ChevronRight />
            </summary>
            <div className="review-body">
              <div>
                <h4>Your answer</h4>
                <p>{item.answer}</p>
              </div>
              <div>
                <h4>Coach’s read</h4>
                <p>{item.feedback.summary}</p>
                <ul>
                  {item.feedback.improvements.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </div>
            </div>
          </details>
        ))}
      </section>
    </main>
  );
}

function ResumeInsight({ title, items = [], positive = false, tags = false }) {
  return (
    <article className={`resume-insight ${positive ? "positive" : ""}`}>
      <h3>{title}</h3>
      <div className={tags ? "keyword-tags" : ""}>
        {items.map((item) =>
          tags ? (
            <span key={item}>{item}</span>
          ) : (
            <p key={item}>
              <Check size={13} />
              {item}
            </p>
          ),
        )}
      </div>
    </article>
  );
}

function Radar({ scores }) {
  const labels = ["clarity", "depth", "relevance", "structure", "delivery"];
  const angles = labels.map(
    (_, index) => -Math.PI / 2 + (index * Math.PI * 2) / labels.length,
  );
  const point = (value, angle) =>
    `${50 + Math.cos(angle) * value * 0.4},${50 + Math.sin(angle) * value * 0.4}`;
  const polygon = labels
    .map((label, index) => point(scores[label] || 0, angles[index]))
    .join(" ");
  return (
    <svg className="radar" viewBox="0 0 100 100">
      {[20, 40, 60, 80, 100].map((level) => (
        <polygon
          key={level}
          points={angles.map((angle) => point(level, angle)).join(" ")}
        />
      ))}
      {angles.map((angle, index) => (
        <line
          key={index}
          x1="50"
          y1="50"
          x2={50 + Math.cos(angle) * 40}
          y2={50 + Math.sin(angle) * 40}
        />
      ))}
      <polygon className="radar-score" points={polygon} />
      {labels.map((label, index) => (
        <text
          key={label}
          x={50 + Math.cos(angles[index]) * 48}
          y={50 + Math.sin(angles[index]) * 46}
        >
          {label.slice(0, 3).toUpperCase()}
        </text>
      ))}
    </svg>
  );
}

function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");
  const load = useCallback(async () => {
    try {
      setUsers(await api("/admin/users"));
    } catch (requestError) {
      setError(requestError.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const toggleRole = async (profile, role) => {
    const roles = profile.roles.includes(role)
      ? profile.roles.filter((item) => item !== role)
      : [...profile.roles, role];
    if (!roles.length) return;
    setSaving(profile.id);
    setError("");
    try {
      const updated = await api(`/admin/users/${profile.id}/roles`, {
        method: "PUT",
        body: JSON.stringify({ roles }),
      });
      setUsers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving("");
    }
  };
  return (
    <main className="page admin-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">Access control</span>
          <h1>Users and workspace roles.</h1>
          <p>
            Assign multiple roles without exposing credentials or weakening
            candidate data isolation.
          </p>
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
      <section className="user-management">
        <div className="user-management-head">
          <span>User</span>
          <span>Roles</span>
          <span>Status</span>
        </div>
        {users.map((profile) => (
          <article key={profile.id}>
            <div className="managed-user">
              <span>{profile.name.slice(0, 2).toUpperCase()}</span>
              <div>
                <strong>{profile.name}</strong>
                <small>{profile.email}</small>
              </div>
            </div>
            <div className="role-toggles">
              {["candidate", "coach", "admin"].map((role) => (
                <button
                  key={role}
                  className={profile.roles.includes(role) ? "active" : ""}
                  disabled={saving === profile.id}
                  onClick={() => toggleRole(profile, role)}
                >
                  {profile.roles.includes(role) && <Check size={12} />}
                  {role}
                </button>
              ))}
            </div>
            <span className="access-status">
              {saving === profile.id ? "Saving..." : "Active"}
            </span>
          </article>
        ))}
      </section>
    </main>
  );
}

function HistoryPage({ data, onOpen, onNew }) {
  return (
    <main className="page history-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">Practice history</span>
          <h1>Review your interview sessions.</h1>
          <p>
            Revisit feedback, compare scores, and track the quality of your
            preparation over time.
          </p>
        </div>
        <button className="primary" onClick={onNew}>
          <Plus size={16} /> New interview
        </button>
      </div>
      {data.sessions?.length ? (
        <SessionTable sessions={data.sessions} onOpen={onOpen} />
      ) : (
        <EmptySessions onNew={onNew} />
      )}
    </main>
  );
}
function SessionTable({ sessions, onOpen }) {
  return (
    <div className="session-table">
      <div className="table-head">
        <span>Interview</span>
        <span>Format</span>
        <span>Progress</span>
        <span>Score</span>
        <span />
      </div>
      {sessions.map((session) => (
        <button key={session.id} onClick={() => onOpen(session.id)}>
          <span className="session-role">
            <i>{session.role_title.slice(0, 2).toUpperCase()}</i>
            <div>
              <strong>{session.role_title}</strong>
              <small>
                {new Date(session.created_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </small>
            </div>
          </span>
          <span>{session.mode}</span>
          <span>
            {session.answer_count} / {session.total_questions} answers
          </span>
          <span>
            <b className={session.score >= 80 ? "high" : ""}>
              {session.score || "—"}
            </b>
          </span>
          <span>
            <ChevronRight size={17} />
          </span>
        </button>
      ))}
    </div>
  );
}
function EmptySessions({ onNew }) {
  return (
    <div className="empty-state">
      <span>
        <Mic />
      </span>
      <h3>Your first interview starts here.</h3>
      <p>Choose a role and create a meaningful performance baseline.</p>
      <button className="primary" onClick={onNew}>
        Build an interview
      </button>
    </div>
  );
}

export default App;
