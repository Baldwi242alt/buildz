import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowRight,
  ArrowUpRight,
  Compass,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  Sparkles,
} from "lucide-react";
import { auth } from "./lib/auth";
import { config } from "./lib/config";
import { Brand } from "./components/ui";
import { LiveWorkspace } from "./LiveWorkspace";
import type { PreviewWorkspace as PreviewComponent } from "./preview/PreviewWorkspace";
import { LocalDemoLogin } from "./components/LocalDemoLogin";
import { setLocalDemoToken } from "./lib/api";
import { RecoveryRequest, PasswordReset } from "./components/AccountRecovery";
import { Signup } from "./components/Signup";
const PublicExperience = lazy(() =>
  import("./workflows/Discovery").then((module) => ({
    default: module.PublicExperience,
  })),
);
const publicRoute = () =>
  location.hash.slice(1) ||
  (location.pathname.startsWith("/showcase/") ? location.pathname : "");

export function App() {
  const [Preview, setPreview] = useState<typeof PreviewComponent | null>(null);
  const [demoIndex, setDemoIndex] = useState<number | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!!auth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [requestRecovery, setRequestRecovery] = useState(false);
  const [signup, setSignup] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [route, setRoute] = useState(publicRoute);
  const intendedRoute = useRef("");
  useEffect(() => {
    const update = () => setRoute(publicRoute());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    if (!auth) return;
    const { data } = auth.onAuthStateChange((_event, next) => {
      if (next) {
        setPreview(null);
        setRequestRecovery(false);
        setSignup(false);
        if (intendedRoute.current) {
          location.hash = intendedRoute.current;
          intendedRoute.current = "";
        }
      }
      if (_event === "PASSWORD_RECOVERY") setRecovering(true);
      if (_event === "SIGNED_OUT") setRecovering(false);
      setSession(next);
      setLoading(false);
      setPassword("");
    });
    return () => data.subscription.unsubscribe();
  }, []);
  async function enterPreview() {
    if (!import.meta.env.DEV || session) return;
    setBusy(true);
    setError("");
    try {
      const module = await import("./preview/PreviewWorkspace");
      setPreview(() => module.PreviewWorkspace);
    } catch {
      setError(
        "The sample workspace could not load. Refresh this page and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (!auth || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await auth.signInWithPassword({ email, password });
      if (result.error) setError(result.error.message);
    } catch {
      setError(
        "We couldn’t reach sign-in. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    if (demoIndex !== null) {
      setLocalDemoToken(null);
      setDemoIndex(null);
      setPassword("");
      setEmail("");
      location.hash = "";
      return;
    }
    if (!auth) return;
    setBusy(true);
    setError("");
    try {
      const result = await auth.signOut();
      if (result.error) setError("Sign-out failed. Please try again.");
      else {
        setSession(null);
        setPassword("");
        setEmail("");
        location.hash = "";
      }
    } catch {
      setError("Sign-out failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  if (
    !session &&
    demoIndex === null &&
    (route === "/discover" || route.startsWith("/showcase/"))
  )
    return (
      <Suspense
        fallback={
          <main className="connection-screen">
            <Brand />
            <p role="status">Loading public projects…</p>
          </main>
        }
      >
        <PublicExperience
          projectId={route.split("/")[2]}
          onSignIn={() => {
            intendedRoute.current = route;
            history.replaceState(null, "", "/#/signin");
            setRoute("/signin");
          }}
        />
      </Suspense>
    );
  if (Preview && !session)
    return (
      <Preview
        onExit={() => {
          setPreview(null);
          location.hash = "";
        }}
      />
    );
  if (session && recovering)
    return (
      <PasswordReset
        onComplete={() => setRecovering(false)}
        onSignOut={signOut}
      />
    );
  if (session)
    return (
      <>
        <LiveWorkspace
          key={session.user.id}
          onSignOut={signOut}
          signingOut={busy}
        />
        {error && (
          <div className="toast" role="alert">
            {error}
          </div>
        )}
      </>
    );
  if (demoIndex !== null && config.localDemo)
    return (
      <>
        <div className="connected-demo-banner">
          CONNECTED LOCAL DEMO · Fictional identities. Changes persist locally.
        </div>
        <LiveWorkspace
          key={`demo-${demoIndex}`}
          onSignOut={signOut}
          signingOut={busy}
        />
      </>
    );
  return (
    <div className="auth-page">
      <section className="auth-story">
        <Brand />
        <div className="auth-story-content">
          <span className="eyebrow light">
            <span className="tiny-spark">✳</span> YOUR IDEAS BELONG HERE
          </span>
          <h1>
            Small sparks.
            <br />
            Shared purpose.
            <br />
            <span>Real possibilities.</span>
          </h1>
          <p>
            A space to bring your ideas to life, find your people, and build
            something that matters.
          </p>
          <div className="story-blocks" aria-hidden="true">
            <div className="story-block block-one">
              <Compass size={48} strokeWidth={1.3} />
              <span>Explore.</span>
            </div>
            <div className="story-block block-two">
              <Layers3 size={48} strokeWidth={1.3} />
              <span>Make.</span>
            </div>
            <div className="story-block block-three">
              <Sparkles size={44} strokeWidth={1.3} />
              <span>Build together.</span>
              <ArrowUpRight size={26} />
            </div>
          </div>
        </div>
        <footer>
          Built for the things you haven’t built yet.
          <span>BuildZ / CAMPUS TO COMMUNITY</span>
        </footer>
      </section>
      <main className="auth-panel">
        <div className="auth-topline">
          A little idea can go a long way.
          <Sparkles size={17} />
        </div>
        <div className="auth-form-container">
          <span className="eyebrow">LET’S GET STARTED</span>
          <h2>{session ? "You’re signed in." : "Welcome to BuildZ."}</h2>
          <p className="auth-subtitle">
            {session
              ? "Your account is ready. Your workspace is next."
              : "Your next chapter starts with an idea."}
          </p>
          {loading ? (
            <div role="status" className="notice">
              <LoaderCircle className="spin" size={20} />
              Checking your session…
            </div>
          ) : (
            <>
              {auth && (
                <form className="auth-form" onSubmit={signIn}>
                  <label htmlFor="email">Email address</label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@school.edu"
                    disabled={!auth || busy}
                  />
                  <label htmlFor="password">Password</label>
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    disabled={!auth || busy}
                  />
                  <div className="password-tools">
                    <label>
                      <input
                        type="checkbox"
                        checked={showPassword}
                        onChange={(event) =>
                          setShowPassword(event.target.checked)
                        }
                        disabled={!auth}
                      />
                      Show password
                    </label>
                    <button
                      type="button"
                      className="text-button"
                      disabled={!auth || busy}
                      onClick={() => setRequestRecovery(true)}
                    >
                      Forgot password?
                    </button>
                  </div>
                  <button
                    className="button primary full"
                    disabled={!auth || busy}
                  >
                    {busy ? "Please wait…" : "Sign in"}
                    <ArrowRight size={18} />
                  </button>
                </form>
              )}
              {auth && (
                <button
                  className="button secondary full signup-entry"
                  disabled={busy}
                  onClick={() => setSignup(true)}
                >
                  Create an account
                </button>
              )}
              {config.localDemo && (
                <LocalDemoLogin
                  onConnect={(index) => {
                    setDemoIndex(index);
                    if (intendedRoute.current) {
                      location.hash = intendedRoute.current;
                      intendedRoute.current = "";
                    }
                  }}
                />
              )}
              {!auth && (
                <div className="connection-hint" role="note">
                  <LockKeyhole size={16} aria-hidden="true" />
                  <p>
                    <strong>School sign-in is not configured.</strong>
                    <br />
                    {config.localDemo
                      ? "Choose a fictional account above and connect to use the working project forms. No email or password is needed for this local demo."
                      : "A workspace administrator must connect hosted authentication before you can sign in."}
                  </p>
                </div>
              )}
              {config.previewAvailable && (
                <>
                  <div className="divider-label">
                    <span>TAKE A LOOK AROUND</span>
                  </div>
                  <button
                    className="button preview-button full"
                    onClick={enterPreview}
                    disabled={busy}
                  >
                    Explore sample workspace
                    <ArrowUpRight size={18} />
                  </button>
                  <p className="preview-explainer">
                    Development preview with fictional people and projects.
                    <br />
                    No account needed. No school data is changed.
                  </p>
                </>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
        </div>
        <footer className="auth-footer">
          <LockKeyhole size={14} />
          Your project. Your people. Your space.
        </footer>
      </main>
      {requestRecovery && (
        <RecoveryRequest
          initialEmail={email}
          onClose={() => setRequestRecovery(false)}
        />
      )}
      {signup && auth && <Signup onClose={() => setSignup(false)} />}
    </div>
  );
}
