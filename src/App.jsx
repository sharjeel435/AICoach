import { createElement, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  CircleCheck,
  Clock3,
  Code2,
  Lightbulb,
  LoaderCircle,
  Menu,
  MessageSquareText,
  Mic,
  MicOff,
  RotateCcw,
  Sparkles,
  Square,
  Target,
  TrendingUp,
  Volume2,
  X,
} from "lucide-react";

const ROLES = [
  {
    id: "product-manager",
    title: "Product Manager",
    company: "Tech & SaaS",
    icon: Target,
    color: "coral",
    description: "Strategy, discovery, prioritization, and cross-functional leadership.",
    questions: 6,
  },
  {
    id: "software-engineer",
    title: "Software Engineer",
    company: "Product Engineering",
    icon: Code2,
    color: "blue",
    description: "Technical decisions, collaboration, debugging, and system thinking.",
    questions: 6,
  },
  {
    id: "marketing-manager",
    title: "Marketing Manager",
    company: "Growth & Brand",
    icon: TrendingUp,
    color: "gold",
    description: "Campaign strategy, customer insight, measurement, and storytelling.",
    questions: 6,
  },
  {
    id: "ux-designer",
    title: "UX Designer",
    company: "Design & Research",
    icon: Sparkles,
    color: "purple",
    description: "Research, design rationale, stakeholder feedback, and user outcomes.",
    questions: 6,
  },
];

const SAMPLE_FEEDBACK = {
  overall_score: 82,
  summary:
    "You gave a clear, credible example and showed strong ownership. The answer would land even better with a sharper opening and one concrete business result.",
  scores: { clarity: 86, depth: 78, relevance: 84, structure: 80 },
  strengths: [
    "You made your personal contribution easy to identify.",
    "The trade-off between speed and confidence felt realistic.",
    "Your explanation stayed focused on the customer problem.",
  ],
  improvements: [
    "Lead with the outcome before walking through the process.",
    "Add a metric that shows the impact of your decision.",
    "Close by naming what you learned or would repeat.",
  ],
  better_answer:
    "I led a pricing-page redesign after research showed prospects were struggling to compare plans. I aligned sales, design, and engineering around one success metric: trial-to-paid conversion. We shipped a simplified comparison experience in three weeks, then tested it against the existing page. Conversion increased 14%, and support questions about plan differences fell 22%. The experience taught me to define the decision metric before debating solutions.",
};

function App() {
  const [view, setView] = useState("home");
  const [role, setRole] = useState(null);
  const [session, setSession] = useState(null);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [history, setHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState("");
  const recognitionRef = useRef(null);

  const questionNumber = history.length + 1;
  const progress = session
    ? Math.min((questionNumber / session.total_questions) * 100, 100)
    : 0;

  useEffect(() => {
    return () => recognitionRef.current?.stop();
  }, []);

  const api = async (path, options = {}) => {
    const response = await fetch(`/api${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (!response.ok) throw new Error("The coach could not respond. Please try again.");
    return response.json();
  };

  const startInterview = async (selectedRole) => {
    setRole(selectedRole);
    setIsLoading(true);
    setError("");
    try {
      const data = await api("/sessions", {
        method: "POST",
        body: JSON.stringify({
          role_id: selectedRole.id,
          role_title: selectedRole.title,
          total_questions: selectedRole.questions,
        }),
      });
      setSession(data);
    } catch {
      setSession({
        session_id: crypto.randomUUID(),
        question:
          "Tell me about a time you had to make an important decision with incomplete information. What did you do, and what happened?",
        question_type: "Behavioral",
        total_questions: selectedRole.questions,
        demo_mode: true,
      });
    } finally {
      setView("interview");
      setIsLoading(false);
    }
  };

  const submitAnswer = async () => {
    if (answer.trim().length < 30) {
      setError("Give yourself a little more room. Aim for at least 2–3 sentences.");
      return;
    }
    setError("");
    setIsLoading(true);
    try {
      const data = await api(`/sessions/${session.session_id}/answers`, {
        method: "POST",
        body: JSON.stringify({
          question: session.question,
          answer,
          question_number: questionNumber,
          role_title: role.title,
        }),
      });
      setFeedback(data.feedback);
      setSession((current) => ({ ...current, next_question: data.next_question }));
    } catch {
      setFeedback(SAMPLE_FEEDBACK);
      setSession((current) => ({
        ...current,
        next_question:
          "Describe a project that did not go as planned. How did you respond, and what did you change afterward?",
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const nextQuestion = () => {
    const completed = {
      question: session.question,
      answer,
      feedback,
      score: feedback.overall_score,
    };
    const nextHistory = [...history, completed];
    setHistory(nextHistory);
    setFeedback(null);
    setAnswer("");
    setError("");

    if (nextHistory.length >= session.total_questions) {
      setView("results");
      return;
    }

    setSession((current) => ({
      ...current,
      question:
        current.next_question ||
        "What is a piece of difficult feedback you received, and how did you act on it?",
      question_type: nextHistory.length % 2 === 0 ? "Behavioral" : "Role specific",
    }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Voice input is not supported in this browser. Chrome works best.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    let committed = answer;

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) committed += `${committed ? " " : ""}${transcript}`;
        else interim += transcript;
      }
      setAnswer(`${committed}${interim ? ` ${interim}` : ""}`);
    };
    recognition.onerror = () => {
      setIsListening(false);
      setError("I lost the microphone. You can continue by typing.");
    };
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
    setError("");
  };

  const reset = () => {
    recognitionRef.current?.stop();
    setView("home");
    setRole(null);
    setSession(null);
    setAnswer("");
    setFeedback(null);
    setHistory([]);
    setError("");
  };

  return (
    <div className="app">
      <Header onLogoClick={reset} />
      {view === "home" && (
        <Home roles={ROLES} onStart={startInterview} isLoading={isLoading} />
      )}
      {view === "interview" && session && (
        <Interview
          role={role}
          session={session}
          questionNumber={questionNumber}
          progress={progress}
          answer={answer}
          setAnswer={setAnswer}
          feedback={feedback}
          onSubmit={submitAnswer}
          onNext={nextQuestion}
          onBack={reset}
          isLoading={isLoading}
          isListening={isListening}
          toggleListening={toggleListening}
          error={error}
        />
      )}
      {view === "results" && (
        <Results role={role} history={history} onRestart={reset} />
      )}
    </div>
  );
}

function Header({ onLogoClick }) {
  return (
    <header className="site-header">
      <button className="brand" onClick={onLogoClick} aria-label="Bravely home">
        <span className="brand-mark"><Sparkles size={18} /></span>
        <span>bravely</span>
      </button>
      <nav>
        <a href="#how-it-works">How it works</a>
        <a href="#roles">Practice roles</a>
        <button className="nav-button" onClick={onLogoClick}>Start practicing</button>
      </nav>
      <button className="menu-button" aria-label="Open menu"><Menu /></button>
    </header>
  );
}

function Home({ roles, onStart, isLoading }) {
  const [selected, setSelected] = useState(roles[0]);

  return (
    <main>
      <section className="hero">
        <div className="eyebrow"><span /> Your private interview room</div>
        <h1>Practice out loud.<br /><em>Show up ready.</em></h1>
        <p className="hero-copy">
          Real interview questions, thoughtful AI coaching, and a space to
          find the words before they really count.
        </p>
        <div className="hero-actions">
          <a className="primary-button" href="#roles">
            Choose your role <ArrowRight size={18} />
          </a>
          <a className="text-link" href="#how-it-works">See how it works <span>↓</span></a>
        </div>
        <div className="proof-row">
          <div className="avatar-stack">
            <span>MK</span><span>AJ</span><span>SL</span>
          </div>
          <div><strong>4,200+ practice sessions</strong><small>Built for the moment before the moment.</small></div>
        </div>
        <div className="hero-note note-one">“Be specific. What changed because of you?”</div>
        <div className="hero-note note-two"><Mic size={17} /> Voice practice on</div>
      </section>

      <section className="roles-section" id="roles">
        <div className="section-heading">
          <div>
            <span className="section-kicker">Pick your practice room</span>
            <h2>What are you preparing for?</h2>
          </div>
          <p>Each session adapts its questions and feedback to the role you choose.</p>
        </div>
        <div className="role-grid">
          {roles.map((item) => {
            const Icon = item.icon;
            const active = selected.id === item.id;
            return (
              <button
                key={item.id}
                className={`role-card ${active ? "selected" : ""}`}
                onClick={() => setSelected(item)}
              >
                <span className={`role-icon ${item.color}`}><Icon size={22} /></span>
                <span className="role-check">{active && <Check size={15} />}</span>
                <span className="role-company">{item.company}</span>
                <strong>{item.title}</strong>
                <p>{item.description}</p>
                <span className="role-meta"><MessageSquareText size={14} /> {item.questions} tailored questions</span>
              </button>
            );
          })}
        </div>
        <button
          className="start-session"
          onClick={() => onStart(selected)}
          disabled={isLoading}
        >
          {isLoading ? <LoaderCircle className="spin" size={19} /> : <Mic size={19} />}
          Start {selected.title} practice
          <ArrowRight size={19} />
        </button>
        <p className="privacy-note">No sign-up needed. Your practice stays private.</p>
      </section>

      <section className="how-section" id="how-it-works">
        <div className="section-heading">
          <div>
            <span className="section-kicker">A better way to rehearse</span>
            <h2>Practice that actually changes your answer.</h2>
          </div>
        </div>
        <div className="steps-grid">
          <article><span>01</span><Mic /><h3>Answer naturally</h3><p>Speak or type. Take the space you need to think through a real example.</p></article>
          <article><span>02</span><Sparkles /><h3>Get useful feedback</h3><p>See what was clear, what was missing, and where your story can work harder.</p></article>
          <article><span>03</span><TrendingUp /><h3>Watch yourself improve</h3><p>Move through a focused session and leave with stronger stories ready to use.</p></article>
        </div>
      </section>
    </main>
  );
}

function Interview({
  role,
  session,
  questionNumber,
  progress,
  answer,
  setAnswer,
  feedback,
  onSubmit,
  onNext,
  onBack,
  isLoading,
  isListening,
  toggleListening,
  error,
}) {
  const words = answer.trim() ? answer.trim().split(/\s+/).length : 0;

  return (
    <main className="interview-page">
      <div className="interview-topbar">
        <button className="back-button" onClick={onBack}><ArrowLeft size={17} /> Leave session</button>
        <div className="role-pill"><BriefcaseBusiness size={15} /> {role.title}</div>
        <div className="question-count">{questionNumber} of {session.total_questions}</div>
      </div>
      <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>

      <div className="interview-layout">
        <section className="question-panel">
          <div className="question-label">
            <span>{session.question_type}</span>
            <span><Clock3 size={14} /> Take 2–3 minutes</span>
          </div>
          <h1>{session.question}</h1>
          <button
            className="listen-button"
            onClick={() => {
              window.speechSynthesis.cancel();
              window.speechSynthesis.speak(new SpeechSynthesisUtterance(session.question));
            }}
          >
            <Volume2 size={17} /> Hear question
          </button>
          <div className="coach-tip">
            <Lightbulb size={19} />
            <div><strong>Coach’s nudge</strong><p>Try the STAR structure: set the scene, explain your task, focus on your actions, and finish with the result.</p></div>
          </div>
        </section>

        <section className="answer-panel">
          {!feedback ? (
            <>
              <div className="answer-heading">
                <div><span>Your answer</span><small>{words} words</small></div>
                <button
                  className={`mic-button ${isListening ? "recording" : ""}`}
                  onClick={toggleListening}
                >
                  {isListening ? <Square size={15} fill="currentColor" /> : <Mic size={17} />}
                  {isListening ? "Stop recording" : "Answer with voice"}
                </button>
              </div>
              <div className={`answer-box ${isListening ? "is-listening" : ""}`}>
                {isListening && (
                  <div className="recording-state">
                    <span className="record-dot" />
                    Listening
                    <div className="wave"><i /><i /><i /><i /><i /></div>
                  </div>
                )}
                <textarea
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  placeholder="Start speaking, or type your answer here…"
                  disabled={isLoading}
                />
                <div className="answer-footer">
                  <span>Your answer is only used to create this feedback.</span>
                  {answer && <button onClick={() => setAnswer("")}><X size={15} /> Clear</button>}
                </div>
              </div>
              {error && <p className="error-message">{error}</p>}
              <button
                className="submit-answer"
                onClick={onSubmit}
                disabled={isLoading || !answer.trim()}
              >
                {isLoading ? <><LoaderCircle className="spin" size={18} /> Reviewing your answer…</> : <>Get my feedback <ArrowRight size={18} /></>}
              </button>
            </>
          ) : (
            <Feedback feedback={feedback} onNext={onNext} questionNumber={questionNumber} total={session.total_questions} />
          )}
        </section>
      </div>
    </main>
  );
}

function Feedback({ feedback, onNext, questionNumber, total }) {
  const scoreItems = [
    ["Clarity", feedback.scores.clarity],
    ["Depth", feedback.scores.depth],
    ["Relevance", feedback.scores.relevance],
    ["Structure", feedback.scores.structure],
  ];

  return (
    <div className="feedback-wrap">
      <div className="feedback-header">
        <div className="score-ring" style={{ "--score": feedback.overall_score }}>
          <strong>{feedback.overall_score}</strong><span>/100</span>
        </div>
        <div><span className="feedback-kicker">Your coaching notes</span><h2>A strong answer with room to sharpen.</h2></div>
      </div>
      <p className="feedback-summary">{feedback.summary}</p>
      <div className="score-grid">
        {scoreItems.map(([label, value]) => (
          <div key={label}><span>{label}<strong>{value}</strong></span><i><b style={{ width: `${value}%` }} /></i></div>
        ))}
      </div>
      <FeedbackList title="What worked" icon={CircleCheck} items={feedback.strengths} positive />
      <FeedbackList title="Make it stronger" icon={Target} items={feedback.improvements} />
      <details className="example-answer">
        <summary><span><Sparkles size={17} /> See a stronger version</span><ChevronDown size={18} /></summary>
        <p>{feedback.better_answer}</p>
      </details>
      <button className="submit-answer" onClick={onNext}>
        {questionNumber >= total ? "See session report" : "Next question"} <ArrowRight size={18} />
      </button>
    </div>
  );
}

function FeedbackList({ title, icon, items, positive = false }) {
  return (
    <div className={`feedback-list ${positive ? "positive" : ""}`}>
      <h3>{createElement(icon, { size: 18 })} {title}</h3>
      {items.map((item) => <p key={item}><span>{positive ? "✓" : "→"}</span>{item}</p>)}
    </div>
  );
}

function Results({ role, history, onRestart }) {
  const average = useMemo(
    () => Math.round(history.reduce((sum, item) => sum + item.score, 0) / history.length),
    [history],
  );

  return (
    <main className="results-page">
      <div className="results-hero">
        <span className="complete-icon"><Check size={30} /></span>
        <span className="section-kicker">Session complete</span>
        <h1>You’re more ready than when you started.</h1>
        <p>You worked through {history.length} {role.title} questions and built a clearer picture of your strongest stories.</p>
      </div>
      <section className="results-card">
        <div className="results-score">
          <span>Session score</span><strong>{average}</strong><small>Strong foundation</small>
        </div>
        <div className="results-stat"><span>Strongest area</span><strong>Clarity</strong><p>Your examples were easy to follow.</p></div>
        <div className="results-stat"><span>Focus next</span><strong>Measurable impact</strong><p>Bring more outcomes into your closing.</p></div>
      </section>
      <section className="answer-review">
        <div className="section-heading"><div><span className="section-kicker">Your answers</span><h2>Review the session</h2></div></div>
        {history.map((item, index) => (
          <details key={item.question} open={index === 0}>
            <summary><span><b>0{index + 1}</b>{item.question}</span><strong>{item.score}</strong></summary>
            <p>{item.feedback.summary}</p>
          </details>
        ))}
      </section>
      <button className="start-session" onClick={onRestart}><RotateCcw size={18} /> Practice another role</button>
    </main>
  );
}

export default App;
