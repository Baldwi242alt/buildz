import { useRef, useState, type FormEvent } from "react";
import { auth } from "../lib/auth";
import { Modal } from "./ui";
import { emailRequestError, useEmailCooldown } from "../lib/authEmailFeedback";

export function Signup({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const sending = useRef(false);
  const wait = useEmailCooldown();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!auth || sending.current || wait > 0) return;
    setError("");
    if (!name.trim()) {
      setError("Enter your display name.");
      return;
    }
    if (password !== confirmation) {
      setError("The passwords don’t match. Check both entries and try again.");
      return;
    }
    if (password.length < 12) {
      setError("Use at least 12 characters for your password.");
      return;
    }
    sending.current = true;
    setBusy(true);
    try {
      const result = await auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: location.origin,
          data: { display_name: name.trim() },
        },
      });
      if (result.error) setError(emailRequestError(result.error));
      else {
        setPassword("");
        setConfirmation("");
        setSent(true);
      }
    } catch {
      setError(
        "We couldn’t confirm the signup response. Check your email before retrying; your entries are kept here.",
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Create your BuildZ account"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {sent ? (
        <>
          <p className="notice" role="status">
            Check your inbox. If this address is eligible for signup, follow the
            confirmation email and return to BuildZ to sign in.
          </p>
          <p className="modal-intro">
            Already have an account? Sign in or use password recovery. Creating
            an account does not verify school membership or grant project
            permissions.
          </p>
          <div className="modal-actions">
            <button className="button primary" onClick={onClose}>
              Back to sign in
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="modal-intro">
            Start with your name and email. After confirming your email, request
            school verification in your workspace. An email address alone never
            grants student or staff permissions.
          </p>
          <form className="auth-form" onSubmit={submit}>
            <label htmlFor="signup-name">Display name</label>
            <input
              id="signup-name"
              autoComplete="nickname"
              required
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
            />
            <label htmlFor="signup-email">Email address</label>
            <input
              id="signup-email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
            />
            <label htmlFor="signup-password">Create password</label>
            <input
              id="signup-password"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              aria-describedby="signup-password-hint"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
            />
            <p id="signup-password-hint" className="field-hint">
              Use at least 12 characters. Password managers and paste are
              supported.
            </p>
            <label htmlFor="signup-confirm">Confirm password</label>
            <input
              id="signup-confirm"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              disabled={busy}
            />
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={show}
                onChange={(event) => setShow(event.target.checked)}
                disabled={busy}
              />
              <span>Show passwords</span>
            </label>
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={onClose}
              >
                Cancel
              </button>
              <button className="button primary" disabled={busy || wait > 0}>
                {busy
                  ? "Creating account…"
                  : wait
                    ? `Try again in ${wait}s`
                    : "Create account"}
              </button>
            </div>
          </form>
        </>
      )}
    </Modal>
  );
}
