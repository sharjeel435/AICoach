import { createElement, useCallback, useEffect, useRef, useState } from "react";
import {
  Activity, ArrowLeft, ArrowRight, BarChart3, BookOpen, BrainCircuit, BriefcaseBusiness,
  Check, ChevronRight, CircleCheck, Clock3, Code2, Download, FileText, Gauge, Headphones,
  History, LayoutDashboard, Lightbulb, LoaderCircle, Menu, MessageSquareText, Mic, Pause,
  Play, Plus, RotateCcw, Settings2, Sparkles, Square, Target, TrendingUp, Upload, UserRound,
  Volume2, WandSparkles, X, Zap,
} from "lucide-react";

const PROFILE_ID = "local-user";
const ROLE_META = {
  "Product Manager": { icon: Target, tone: "coral", blurb: "Strategy, discovery, prioritization, and influence." },
  "Software Engineer": { icon: Code2, tone: "blue", blurb: "Systems, technical judgment, ownership, and collaboration." },
  "Marketing Manager": { icon: TrendingUp, tone: "gold", blurb: "Growth, customer insight, analytics, and storytelling." },
  "UX Designer": { icon: Sparkles, tone: "violet", blurb: "Research, design rationale, outcomes, and collaboration." },
};
const MODES = [
  { name: "Full interview", icon: BrainCircuit, description: "A balanced, adaptive interview across core competencies." },
  { name: "Behavioral drill", icon: MessageSquareText, description: "Practice concise STAR stories and leadership signals." },
  { name: "Role deep dive", icon: BriefcaseBusiness, description: "High-signal questions focused on role expertise." },
  { name: "Rapid fire", icon: Zap, description: "Short, energetic answers under tighter time pressure." },
];
const SAMPLE_FEEDBACK = {
  overall_score: 78,
  summary: "Your answer has a credible core. Make your ownership and measurable impact more explicit.",
  scores: { clarity: 82, depth: 75, relevance: 83, structure: 74, delivery: 77 },
  strengths: ["You used a specific professional situation.", "Your response sounded natural.", "Your decision process was understandable."],
  improvements: ["Lead with the result.", "Separate your actions from the team.", "Add a measurable outcome."],
  better_answer: "Lead with the outcome, establish the context briefly, explain the decision you owned, and close with the measurable result.",
  star: { situation: 82, task: 74, action: 78, result: 61 },
};

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || "Request failed");
  return response.json();
}

function App() {
  const [page, setPage] = useState("dashboard");
  const [dashboard, setDashboard] = useState({ stats: {}, sessions: [], trend: [] });
  const [health, setHealth] = useState({ provider: "local" });
  const [setup, setSetup] = useState({
    role_title: "Product Manager", company: "", seniority: "Mid-level", mode: "Full interview",
    difficulty: "Adaptive", interviewer_style: "Balanced", total_questions: 6,
    resume_text: "", job_description: "",
  });
  const [target, setTarget] = useState(null);
  const [session, setSession] = useState(null);
  const [history, setHistory] = useState([]);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");

  const refreshDashboard = useCallback(async () => {
    try {
      const [data, status] = await Promise.all([
        api(`/dashboard/${PROFILE_ID}`), api("/health"),
      ]);
      setDashboard(data);
      setHealth(status);
    } catch {
      setHealth({ provider: "local" });
    }
  }, []);

  useEffect(() => { refreshDashboard(); }, [refreshDashboard]);
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
          method: "POST", body: JSON.stringify({ profile_id: PROFILE_ID, ...setup }),
        });
        setTarget(targetData);
      }
      const data = await api("/sessions", {
        method: "POST",
        body: JSON.stringify({ profile_id: PROFILE_ID, target_id: targetData?.id || null, ...setup }),
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

  return (
    <div className="shell">
      <Sidebar page={page} setPage={setPage} provider={health.provider} onNew={() => setPage("setup")} />
      <div className="main-shell">
        <Topbar page={page} onNew={() => setPage("setup")} />
        {page === "dashboard" && <Dashboard data={dashboard} onNew={() => setPage("setup")} onOpen={openReport} />}
        {page === "setup" && <Setup setup={setup} setSetup={setSetup} target={target} setTarget={setTarget} onStart={startSession} loading={loading} />}
        {page === "studio" && session && (
          <Studio session={session} setSession={setSession} setup={setup} history={history} setHistory={setHistory} onFinish={finishSession} />
        )}
        {page === "history" && <HistoryPage data={dashboard} onOpen={openReport} onNew={() => setPage("setup")} />}
        {page === "report" && report && <Report report={report} onNew={() => setPage("setup")} />}
        {loading && page !== "setup" && <div className="screen-loader"><LoaderCircle className="spin" /></div>}
      </div>
      {toast && <div className="toast"><CircleCheck size={17} /> {toast}</div>}
    </div>
  );
}

function Sidebar({ page, setPage, provider, onNew }) {
  const links = [
    ["dashboard", LayoutDashboard, "Overview"], ["setup", Plus, "New interview"],
    ["history", History, "Session history"],
  ];
  return (
    <aside className="sidebar">
      <button className="brand" onClick={() => setPage("dashboard")}><img src="/aicoachy-mark.svg" alt="" /><b>AICoachy</b></button>
      <nav>
        <p>Workspace</p>
        {links.map(([id, icon, label]) => (
          <button key={id} className={page === id ? "active" : ""} onClick={() => id === "setup" ? onNew() : setPage(id)}>
            {createElement(icon, { size: 18 })}{label}
          </button>
        ))}
        <p>Development</p>
        <button onClick={() => setPage("history")}><BookOpen size={18} />Answer library</button>
        <button onClick={() => setPage("dashboard")}><BarChart3 size={18} />Performance</button>
      </nav>
      <div className="provider-card">
        <span className={`provider-dot ${provider}`} />
        <div><strong>{provider === "local" ? "Local intelligence" : `${provider} connected`}</strong><small>{provider === "local" ? "Private, no API key" : "Enhanced AI coaching"}</small></div>
      </div>
      <div className="profile-chip"><span>SS</span><div><strong>Sharjeel</strong><small>Personal workspace</small></div><Settings2 size={16} /></div>
    </aside>
  );
}

function Topbar({ page, onNew }) {
  const titles = { dashboard: "Interview command center", setup: "Build your interview", studio: "Live interview studio", history: "Session history", report: "Performance report" };
  return (
    <header className="topbar">
      <div className="topbar-title"><span className="mobile-menu"><Menu size={20} /></span><div><small>AICoachy workspace</small><strong>{titles[page]}</strong></div></div>
      <button className="topbar-cta" onClick={onNew}><Plus size={16} /> New interview</button>
    </header>
  );
}

function Dashboard({ data, onNew, onOpen }) {
  const stats = data.stats || {};
  const recent = data.sessions || [];
  return (
    <main className="page dashboard-page">
      <section className="welcome">
        <div><span className="eyebrow">Interview preparation platform</span><h1>Prepare with purpose.<br />Perform with confidence.</h1><p>Run role-specific mock interviews, analyze every response, and build a measurable record of your progress.</p><button className="primary" onClick={onNew}>Create interview <ArrowRight size={17} /></button></div>
        <div className="readiness-card">
          <div className="readiness-top"><span>Interview readiness</span><strong>{stats.average_score || 0}<small>/100</small></strong></div>
          <div className="readiness-ring" style={{ "--value": stats.average_score || 0 }}><div><BrainCircuit /><strong>{stats.total_sessions ? "In progress" : "No baseline"}</strong><span>{stats.questions_answered || 0} answers analyzed</span></div></div>
          <div className="readiness-foot"><span><i className="green" />Clarity</span><span><i className="amber" />Impact</span><span><i />Delivery</span></div>
        </div>
      </section>

      <section className="metric-grid">
        <Metric icon={MessageSquareText} label="Questions answered" value={stats.questions_answered || 0} note="Across all practice sessions" />
        <Metric icon={Gauge} label="Average score" value={`${stats.average_score || 0}%`} note="Quality across five dimensions" />
        <Metric icon={TrendingUp} label="Personal best" value={`${stats.best_score || 0}%`} note={stats.best_score ? "Keep raising the floor" : "Your first benchmark awaits"} />
        <Metric icon={Clock3} label="Practice sessions" value={stats.total_sessions || 0} note="Saved automatically" />
      </section>

      <section className="dashboard-grid">
        <div className="panel progress-panel">
          <PanelHead kicker="Performance" title="Your practice trajectory" action="Last 8 sessions" />
          <TrendChart values={data.trend || []} />
          <div className="chart-caption"><span><i />Overall score</span><strong>{data.trend?.length ? `+${Math.max(0, data.trend.at(-1) - data.trend[0])} points` : "Complete a session to begin"}</strong></div>
        </div>
        <div className="panel focus-panel">
          <PanelHead kicker="Recommended next" title="Your highest-value drill" />
          <span className="focus-icon"><Target /></span><h3>Make impact measurable</h3>
          <p>Practice closing every story with a baseline, a result, and why that result mattered.</p>
          <div className="focus-meta"><span>10 minutes</span><span>Behavioral</span><span>3 questions</span></div>
          <button onClick={onNew}>Start focused drill <ChevronRight size={16} /></button>
        </div>
      </section>

      <section className="recent-section">
        <PanelHead kicker="Saved automatically" title="Recent sessions" action={`${recent.length} total`} />
        {recent.length ? <SessionTable sessions={recent.slice(0, 5)} onOpen={onOpen} /> : <EmptySessions onNew={onNew} />}
      </section>
    </main>
  );
}

function Metric({ icon, label, value, note }) {
  return <article className="metric"><div><span>{createElement(icon, { size: 18 })}</span><small>{label}</small></div><strong>{value}</strong><p>{note}</p></article>;
}
function PanelHead({ kicker, title, action }) {
  return <div className="panel-head"><div><span>{kicker}</span><h2>{title}</h2></div>{action && <small>{action}</small>}</div>;
}
function TrendChart({ values }) {
  const points = values.length ? values : [42, 52, 49, 63, 67, 72, 76, 81];
  const coords = points.map((value, index) => `${(index / Math.max(points.length - 1, 1)) * 100},${100 - value}`).join(" ");
  return <div className="trend-chart"><div className="grid-lines"><i /><i /><i /><i /></div><svg viewBox="0 0 100 100" preserveAspectRatio="none"><defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2563eb" stopOpacity=".22" /><stop offset="100%" stopColor="#2563eb" stopOpacity="0" /></linearGradient></defs><polygon points={`0,100 ${coords} 100,100`} fill="url(#chartFill)" /><polyline points={coords} fill="none" stroke="#2563eb" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg></div>;
}

function Setup({ setup, setSetup, target, setTarget, onStart, loading }) {
  const [step, setStep] = useState(1);
  const update = (key, value) => { setSetup((current) => ({ ...current, [key]: value })); setTarget(null); };
  return (
    <main className="page setup-page">
      <div className="setup-header"><span className="eyebrow">Interview setup</span><h1>Configure a focused practice session.</h1><p>Choose a role, add opportunity context, and set the interview format.</p></div>
      <div className="stepper">{["Target role", "Job intelligence", "Interview style"].map((label, index) => <button key={label} className={step === index + 1 ? "active" : step > index + 1 ? "done" : ""} onClick={() => setStep(index + 1)}><span>{step > index + 1 ? <Check size={14} /> : index + 1}</span><div><small>Step 0{index + 1}</small><strong>{label}</strong></div></button>)}</div>
      <div className="builder-layout">
        <section className="builder-panel">
          {step === 1 && <RoleStep setup={setup} update={update} />}
          {step === 2 && <TargetStep setup={setup} update={update} target={target} />}
          {step === 3 && <StyleStep setup={setup} update={update} />}
          <div className="builder-actions">
            <button className="secondary" disabled={step === 1} onClick={() => setStep((value) => value - 1)}><ArrowLeft size={16} /> Back</button>
            {step < 3 ? <button className="primary" onClick={() => setStep((value) => value + 1)}>Continue <ArrowRight size={16} /></button> : <button className="primary" onClick={onStart} disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <Mic size={17} />} Enter interview studio</button>}
          </div>
        </section>
        <SessionPreview setup={setup} target={target} />
      </div>
    </main>
  );
}

function RoleStep({ setup, update }) {
  return <div className="builder-content"><span className="section-number">01 / ROLE</span><h2>What role are you pursuing?</h2><p>Choose the closest match. You can sharpen it with a real job description next.</p><div className="role-grid">{Object.entries(ROLE_META).map(([name, meta]) => { const Icon = meta.icon; return <button key={name} className={`role-choice ${setup.role_title === name ? "selected" : ""}`} onClick={() => update("role_title", name)}><span className={meta.tone}><Icon size={20} /></span><div><strong>{name}</strong><small>{meta.blurb}</small></div>{setup.role_title === name && <CircleCheck size={19} />}</button>; })}</div><div className="field-row"><label>Target company<input value={setup.company} onChange={(event) => update("company", event.target.value)} placeholder="e.g. Stripe, Google, a Series B startup" /></label><label>Seniority<select value={setup.seniority} onChange={(event) => update("seniority", event.target.value)}><option>Entry-level</option><option>Mid-level</option><option>Senior</option><option>Staff / Lead</option><option>Manager</option></select></label></div></div>;
}

function TargetStep({ setup, update }) {
  const loadFile = (key, file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => update(key, String(reader.result));
    reader.readAsText(file);
  };
  return <div className="builder-content"><span className="section-number">02 / INTELLIGENCE</span><h2>Make it specific to the opportunity.</h2><p>Paste the source material. Everything stays on this machine unless you connect an AI provider.</p><div className="document-grid"><label className="document-field"><span><FileText size={18} /> Resume or experience notes <em>{setup.resume_text.length ? `${setup.resume_text.length} characters` : "Optional"}</em></span><textarea value={setup.resume_text} onChange={(event) => update("resume_text", event.target.value)} placeholder="Paste your resume, key projects, or experience highlights…" /><input type="file" accept=".txt,.md" onChange={(event) => loadFile("resume_text", event.target.files[0])} /><b><Upload size={14} /> Import .txt or .md</b></label><label className="document-field"><span><BriefcaseBusiness size={18} /> Job description <em>{setup.job_description.length ? `${setup.job_description.length} characters` : "Recommended"}</em></span><textarea value={setup.job_description} onChange={(event) => update("job_description", event.target.value)} placeholder="Paste responsibilities, requirements, and company context…" /><input type="file" accept=".txt,.md" onChange={(event) => loadFile("job_description", event.target.files[0])} /><b><Upload size={14} /> Import .txt or .md</b></label></div><div className="privacy-strip"><CircleCheck size={17} /><div><strong>Local-first by design</strong><span>Your material is stored in the local SQLite database and is never required for the app to work.</span></div></div></div>;
}

function StyleStep({ setup, update }) {
  return <div className="builder-content"><span className="section-number">03 / FORMAT</span><h2>Choose the pressure and pace.</h2><p>Build a realistic simulation or isolate one skill for deliberate practice.</p><div className="mode-grid">{MODES.map((mode) => { const Icon = mode.icon; return <button key={mode.name} className={setup.mode === mode.name ? "selected" : ""} onClick={() => update("mode", mode.name)}><Icon size={20} /><strong>{mode.name}</strong><span>{mode.description}</span>{setup.mode === mode.name && <Check size={15} />}</button>; })}</div><div className="field-row three"><label>Difficulty<select value={setup.difficulty} onChange={(event) => update("difficulty", event.target.value)}><option>Supportive</option><option>Adaptive</option><option>Challenging</option></select></label><label>Interviewer<select value={setup.interviewer_style} onChange={(event) => update("interviewer_style", event.target.value)}><option>Balanced</option><option>Friendly coach</option><option>Strict recruiter</option><option>Executive panel</option></select></label><label>Questions<select value={setup.total_questions} onChange={(event) => update("total_questions", Number(event.target.value))}><option value={3}>3 questions</option><option value={5}>5 questions</option><option value={6}>6 questions</option><option value={8}>8 questions</option></select></label></div></div>;
}

function SessionPreview({ setup, target }) {
  const meta = ROLE_META[setup.role_title]; const Icon = meta.icon;
  const analysis = target?.analysis;
  return <aside className="preview-card"><span className="preview-kicker">Session preview</span><div className={`preview-icon ${meta.tone}`}><Icon /></div><h3>{setup.role_title}</h3><p>{setup.company || "Open company practice"} · {setup.seniority}</p><div className="preview-list"><span><BrainCircuit />{setup.mode}</span><span><Gauge />{setup.difficulty} difficulty</span><span><MessageSquareText />{setup.total_questions} questions</span><span><Headphones />Voice and text enabled</span></div>{analysis ? <div className="match-card"><strong>{analysis.match_score}% match</strong><p>{analysis.positioning}</p></div> : <div className="preview-note"><WandSparkles size={17} /><p>Add a resume and job description to unlock opportunity-specific questions and gap analysis.</p></div>}</aside>;
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

  useEffect(() => () => { recognitionRef.current?.stop(); clearInterval(timerRef.current); }, []);
  const toggleVoice = () => {
    if (listening) { recognitionRef.current?.stop(); clearInterval(timerRef.current); setListening(false); return; }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { setError("Voice input requires Chrome or Edge. Typing remains available."); return; }
    const recognition = new Recognition(); let committed = answer;
    recognition.continuous = true; recognition.interimResults = true;
    recognition.onresult = (event) => { let interim = ""; for (let i = event.resultIndex; i < event.results.length; i += 1) { const text = event.results[i][0].transcript; if (event.results[i].isFinal) committed += `${committed ? " " : ""}${text}`; else interim += text; } setAnswer(`${committed}${interim ? ` ${interim}` : ""}`); };
    recognition.onend = () => { setListening(false); clearInterval(timerRef.current); };
    recognition.onerror = () => setError("The microphone stopped. Your transcript is still here.");
    recognition.start(); recognitionRef.current = recognition; setListening(true); setError("");
    timerRef.current = setInterval(() => setSeconds((value) => value + 1), 1000);
  };
  const submit = async () => {
    if (answer.trim().length < 30) { setError("Develop the answer a little further before requesting feedback."); return; }
    recognitionRef.current?.stop(); clearInterval(timerRef.current); setLoading(true); setError("");
    try {
      const data = await api(`/sessions/${session.session_id}/answers`, { method: "POST", body: JSON.stringify({ question: session.question, answer, question_number: number, duration_seconds: seconds }) });
      setFeedback(data.feedback); setDelivery(data.delivery);
      setSession((current) => ({ ...current, next_question: data.next_question, next_question_type: data.next_question_type, completed: data.completed }));
    } catch { setFeedback(SAMPLE_FEEDBACK); setDelivery({ word_count: answer.split(/\s+/).length, words_per_minute: 128, filler_count: 1, pace_label: "Measured", concision_score: 82 }); }
    finally { setLoading(false); }
  };
  const next = () => {
    const nextHistory = [...history, { question: session.question, answer, feedback, delivery }];
    setHistory(nextHistory);
    if (session.completed || nextHistory.length >= session.total_questions) { onFinish(); return; }
    setSession((current) => ({ ...current, question: current.next_question, question_type: current.next_question_type }));
    setAnswer(""); setFeedback(null); setDelivery(null); setSeconds(0); window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return <main className="studio-page"><div className="studio-progress"><span style={{ width: `${(number / session.total_questions) * 100}%` }} /></div><div className="studio-bar"><div><span className="live-dot" /> Live practice</div><strong>{setup.role_title}</strong><span>Question {number} of {session.total_questions}</span></div><div className="studio-layout"><section className="interviewer"><div className="interviewer-meta"><span className="interviewer-avatar">AI</span><div><strong>{setup.interviewer_style} interviewer</strong><small>{session.question_type} · {setup.difficulty}</small></div></div><div className="question-block"><span>Question {String(number).padStart(2, "0")}</span><h1>{session.question}</h1><button onClick={() => { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(session.question)); }}><Volume2 size={16} /> Listen to question</button></div><div className="studio-tip"><Lightbulb size={18} /><div><strong>Think before you fill the silence.</strong><p>A two-second pause sounds more confident than a rushed opening. Lead with your answer, then support it.</p></div></div></section><section className="response-workspace">{feedback ? <Feedback feedback={feedback} delivery={delivery} onNext={next} final={number >= session.total_questions} /> : <><div className="response-head"><div><span>Your response</span><small>{answer.trim() ? answer.trim().split(/\s+/).length : 0} words · {formatTime(seconds)}</small></div><button className={listening ? "recording" : ""} onClick={toggleVoice}>{listening ? <Square size={14} fill="currentColor" /> : <Mic size={16} />}{listening ? "Stop" : "Answer with voice"}</button></div><div className={`transcript ${listening ? "listening" : ""}`}>{listening && <div className="listening-strip"><span />Listening to your answer<div className="wave"><i /><i /><i /><i /><i /></div></div>}<textarea value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Take a breath, then begin. Your transcript will appear here…" /><div className="transcript-foot"><span><Activity size={14} /> Live delivery analysis</span>{answer && <button onClick={() => setAnswer("")}><X size={14} /> Clear</button>}</div></div>{error && <p className="form-error">{error}</p>}<div className="live-signals"><Signal label="Pace" value={listening ? "Listening…" : "Ready"} /><Signal label="Answer length" value={answer.split(/\s+/).filter(Boolean).length < 60 ? "Developing" : "Strong"} /><Signal label="Privacy" value="Local session" /></div><button className="primary submit-response" disabled={loading || !answer.trim()} onClick={submit}>{loading ? <><LoaderCircle className="spin" /> Analyzing five dimensions…</> : <>Analyze my answer <ArrowRight size={17} /></>}</button></>}</section></div></main>;
}

function Signal({ label, value }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function formatTime(seconds) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }

function Feedback({ feedback, delivery, onNext, final }) {
  const scores = Object.entries(feedback.scores || {});
  return <div className="feedback"><div className="feedback-hero"><div className="score-dial" style={{ "--score": feedback.overall_score }}><strong>{feedback.overall_score}</strong><span>overall</span></div><div><span className="eyebrow">Coaching analysis</span><h2>{feedback.overall_score >= 85 ? "A compelling, interview-ready answer." : feedback.overall_score >= 72 ? "Strong foundation. Sharpen the proof." : "Good raw material. Build the structure."}</h2><p>{feedback.summary}</p></div></div><div className="dimension-grid">{scores.map(([name, value]) => <div key={name}><span>{name}<strong>{value}</strong></span><i><b style={{ width: `${value}%` }} /></i></div>)}</div>{delivery && <div className="delivery-row"><Delivery icon={Gauge} label="Speaking pace" value={`${delivery.words_per_minute} wpm`} note={delivery.pace_label} /><Delivery icon={Pause} label="Filler words" value={delivery.filler_count} note={delivery.filler_count <= 2 ? "Controlled" : "Reduce"} /><Delivery icon={MessageSquareText} label="Answer length" value={delivery.word_count} note="words" /><Delivery icon={Zap} label="Concision" value={`${delivery.concision_score}%`} note="focus" /></div>}<div className="coaching-columns"><FeedbackList positive title="Signals that landed" items={feedback.strengths} /><FeedbackList title="Highest-value improvements" items={feedback.improvements} /></div><details className="stronger-answer"><summary><span><WandSparkles size={17} /> Coach’s stronger-answer blueprint</span><ChevronRight size={17} /></summary><p>{feedback.better_answer}</p></details><button className="primary submit-response" onClick={onNext}>{final ? "Open full performance report" : "Continue to next question"} <ArrowRight size={17} /></button></div>;
}
function Delivery({ icon, label, value, note }) { return <div>{createElement(icon, { size: 16 })}<span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function FeedbackList({ title, items, positive = false }) { return <div className={`feedback-list ${positive ? "positive" : ""}`}><h3>{positive ? <CircleCheck size={18} /> : <Target size={18} />}{title}</h3>{items.map((item) => <p key={item}><span>{positive ? "✓" : "→"}</span>{item}</p>)}</div>; }

function Report({ report, onNew }) {
  const { session, answers, averages } = report;
  const download = () => window.open(`/api/sessions/${session.id}/export`, "_blank");
  return <main className="page report-page"><section className="report-heading"><div><span className="eyebrow">Session complete · {session.role_title}</span><h1>Your performance,<br />made actionable.</h1><p>You completed {answers.length} questions. Here is the evidence, not just a score.</p></div><div className="report-actions"><button className="secondary" onClick={download}><Download size={16} /> Export report</button><button className="primary" onClick={onNew}><RotateCcw size={16} /> Practice again</button></div></section><section className="report-summary"><div className="report-score"><span>Overall performance</span><strong>{report.overall_score}</strong><small>/ 100</small><p>{report.overall_score >= 80 ? "Interview ready" : "Promising foundation"}</p></div><div className="radar-wrap"><Radar scores={averages} /></div><div className="report-insights"><div><span className="success"><TrendingUp /></span><p>Strongest competency<strong>{report.top_strength}</strong></p></div><div><span className="focus"><Target /></span><p>Priority improvement<strong>{report.focus_area}</strong></p></div><div><span><MessageSquareText /></span><p>Answers analyzed<strong>{answers.length} complete</strong></p></div></div></section><section className="report-grid"><div className="panel"><PanelHead kicker="Competencies" title="How your answers performed" />{Object.entries(averages).map(([name, value]) => <div className="report-bar" key={name}><span>{name}<strong>{value}</strong></span><i><b style={{ width: `${value}%` }} /></i></div>)}</div><div className="panel action-plan"><PanelHead kicker="Next seven days" title="Your practice plan" />{report.recommendations.map((item, index) => <div key={item}><span>0{index + 1}</span><p>{item}</p></div>)}</div></section><section className="answer-review"><PanelHead kicker="Answer evidence" title="Question-by-question review" action={`${answers.length} responses`} />{answers.map((item) => <details key={item.question_number}><summary><span><b>0{item.question_number}</b><div><small>{item.feedback.overall_score}/100</small><strong>{item.question}</strong></div></span><ChevronRight /></summary><div className="review-body"><div><h4>Your answer</h4><p>{item.answer}</p></div><div><h4>Coach’s read</h4><p>{item.feedback.summary}</p><ul>{item.feedback.improvements.map((point) => <li key={point}>{point}</li>)}</ul></div></div></details>)}</section></main>;
}

function Radar({ scores }) {
  const labels = ["clarity", "depth", "relevance", "structure", "delivery"];
  const angles = labels.map((_, index) => -Math.PI / 2 + (index * Math.PI * 2) / labels.length);
  const point = (value, angle) => `${50 + Math.cos(angle) * value * .4},${50 + Math.sin(angle) * value * .4}`;
  const polygon = labels.map((label, index) => point(scores[label] || 0, angles[index])).join(" ");
  return <svg className="radar" viewBox="0 0 100 100">{[20, 40, 60, 80, 100].map((level) => <polygon key={level} points={angles.map((angle) => point(level, angle)).join(" ")} />)}{angles.map((angle, index) => <line key={index} x1="50" y1="50" x2={50 + Math.cos(angle) * 40} y2={50 + Math.sin(angle) * 40} />)}<polygon className="radar-score" points={polygon} />{labels.map((label, index) => <text key={label} x={50 + Math.cos(angles[index]) * 48} y={50 + Math.sin(angles[index]) * 46}>{label.slice(0, 3).toUpperCase()}</text>)}</svg>;
}

function HistoryPage({ data, onOpen, onNew }) { return <main className="page history-page"><div className="page-title"><div><span className="eyebrow">Practice history</span><h1>Review your interview sessions.</h1><p>Revisit feedback, compare scores, and track the quality of your preparation over time.</p></div><button className="primary" onClick={onNew}><Plus size={16} /> New interview</button></div>{data.sessions?.length ? <SessionTable sessions={data.sessions} onOpen={onOpen} /> : <EmptySessions onNew={onNew} />}</main>; }
function SessionTable({ sessions, onOpen }) { return <div className="session-table"><div className="table-head"><span>Interview</span><span>Format</span><span>Progress</span><span>Score</span><span /></div>{sessions.map((session) => <button key={session.id} onClick={() => onOpen(session.id)}><span className="session-role"><i>{session.role_title.slice(0, 2).toUpperCase()}</i><div><strong>{session.role_title}</strong><small>{new Date(session.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</small></div></span><span>{session.mode}</span><span>{session.answer_count} / {session.total_questions} answers</span><span><b className={session.score >= 80 ? "high" : ""}>{session.score || "—"}</b></span><span><ChevronRight size={17} /></span></button>)}</div>; }
function EmptySessions({ onNew }) { return <div className="empty-state"><span><Mic /></span><h3>Your first interview starts here.</h3><p>Choose a role and create a meaningful performance baseline.</p><button className="primary" onClick={onNew}>Build an interview</button></div>; }

export default App;
