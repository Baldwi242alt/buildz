import { useState, type FormEvent } from "react";
import { auth } from "../lib/auth";
import { Brand, Modal } from "./ui";
import { emailRequestError, useEmailCooldown } from "../lib/authEmailFeedback";

export function RecoveryRequest({
  initialEmail,
  onClose,
}: {
  initialEmail: string;
  onClose: () => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const wait = useEmailCooldown();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!auth || busy || wait > 0) return;
    setBusy(true);
    setError("");
    try {
      const result = await auth.resetPasswordForEmail(email.trim(), {
        redirectTo: location.origin,
      });
      if (result.error) setError(emailRequestError(result.error));
      else setSent(true);
    } catch {
      setError(
        "We couldn’t reach account recovery. Your email is kept here; check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Reset your password" onClose={onClose}>
      <p className="modal-intro">
        Enter your account email. If it is eligible, you’ll receive a link to
        choose a new password.
      </p>
      {sent ? (
        <>
          <p role="status" className="notice">
            Check your inbox for the next step. The link will bring you back to
            BuildZ.
          </p>
          <div className="modal-actions">
            <button className="button primary" onClick={onClose}>
              Back to sign in
            </button>
          </div>
        </>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="recovery-email">Email address</label>
          <input
            id="recovery-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
          />
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button
              className="button secondary"
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button className="button primary" disabled={busy || wait > 0}>
              {busy
                ? "Requesting link…"
                : wait
                  ? `Try again in ${wait}s`
                  : "Request reset link"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function PasswordReset({
  onComplete,
  onSignOut,
}: {
  onComplete: () => void;
  onSignOut: () => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!auth || busy) return;
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await auth.updateUser({ password });
      if (result.error) setError(result.error.message);
      else {
        setPassword("");
        setConfirm("");
        onComplete();
      }
    } catch {
      setError(
        "We couldn’t confirm the password change. Try again, or return to sign in to check your account.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="connection-screen">
      <Brand />
      <h1>Choose a new password.</h1>
      <form className="auth-form recovery-form" onSubmit={submit}>
        <label htmlFor="new-password">New password</label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <small>
          Use at least 8 characters. Your school may require a stronger
          password.
        </small>
        <label htmlFor="confirm-password">Confirm new password</label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? "Saving password…" : "Save new password"}
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={busy}
          onClick={onSignOut}
        >
          Return to sign in
        </button>
      </form>
    </main>
  );
}
