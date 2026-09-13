import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { setLocalDemoToken } from "../lib/api";

export function LocalDemoLogin({
  onConnect,
}: {
  onConnect: (index: number) => void;
}) {
  const [actors, setActors] = useState<
    { index: number; label: string; email: string }[]
  >([]);
  const [index, setIndex] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/__buildz_demo/actors", { signal: controller.signal })
      .then((response) => response.json())
      .then((value) => {
        if (Array.isArray(value)) setActors(value);
        else setError("Local sample accounts could not load.");
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Local sample accounts could not load.");
      });
    return () => controller.abort();
  }, []);
  async function connect() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/__buildz_demo/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIndex: Number(index) }),
      });
      const result = await response.json();
      if (!response.ok || !result.access_token)
        throw new Error(result.error || "Local demo sign-in failed.");
      setLocalDemoToken(result.access_token);
      onConnect(Number(index));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Local demo sign-in failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="local-demo-login">
      <div className="divider-label">
        <span>CONNECTED LOCAL DEMO</span>
      </div>
      <label htmlFor="demo-identity">Fictional account</label>
      <select
        id="demo-identity"
        value={index}
        onChange={(event) => setIndex(event.target.value)}
        disabled={busy || !actors.length}
      >
        {actors.map((actor) => (
          <option key={actor.index} value={actor.index}>
            {actor.label}
          </option>
        ))}
      </select>
      <button
        className="button primary full"
        onClick={connect}
        disabled={busy || !actors.length}
      >
        {busy ? "Connecting…" : "Connect to local demo"}
        <ArrowRight size={17} />
      </button>
      <p className="preview-explainer">
        Real local API and database. Fictional accounts only.
        <br />
        Changes persist in the local demo database.
      </p>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
