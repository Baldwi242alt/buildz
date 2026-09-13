import { useEffect, useRef, useState, type FormEvent } from "react";
import { Download, Upload } from "lucide-react";
import {
  api,
  unwrap,
  errorMessage,
  ServiceError,
  type Schemas,
} from "../lib/api";
import { Modal } from "../components/ui";

export function FileUpload({
  projectId,
  onClose,
  onUploaded,
}: {
  projectId: string;
  onClose: () => void;
  onUploaded: (file: Schemas["ProjectFile"]) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const [waitUntil, setWaitUntil] = useState(0);
  const key = useRef(crypto.randomUUID());
  const sending = useRef(false);
  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file || sending.current) return;
    if (Date.now() < waitUntil) {
      setError(
        "The service is rate-limited. Wait before retrying this upload.",
      );
      return;
    }
    setError("");
    if (
      !["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(
        file.type,
      ) ||
      file.size > 2 * 1024 * 1024 ||
      !file.size
    ) {
      setError(
        "Choose a non-empty PNG, JPEG, WebP, or PDF file no larger than 2 MiB.",
      );
      return;
    }
    sending.current = true;
    setBusy(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () =>
          reject(
            new ServiceError(
              "This file couldn’t be read. Select it again.",
              "FILE_READ_ERROR",
            ),
          );
        reader.readAsDataURL(file);
      });
      const saved = await unwrap(
        api!.POST("/v1/projects/{id}/files", {
          params: {
            path: { id: projectId },
            header: { "Idempotency-Key": key.current },
          },
          body: {
            name: file.name,
            mimeType: file.type as Schemas["UploadFile"]["mimeType"],
            contentBase64: base64,
          },
        }),
      );
      onUploaded(saved);
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
      if (
        !(failure instanceof ServiceError) ||
        failure.code === "INVALID_RESPONSE"
      )
        setLocked(true);
      if (failure instanceof ServiceError && failure.retryAfter)
        setWaitUntil(Date.now() + failure.retryAfter * 1000);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Upload private project evidence"
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="modal-intro">
        PNG, JPEG, WebP, or PDF · up to 2 MiB each. Accessible only to
        authorized project members and reviewers. Uploading does not submit a
        progress update; attach the saved file when you share an update.
      </p>
      <form className="workflow-form" onSubmit={upload}>
        <label>
          Choose evidence file
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            required
            disabled={busy || locked}
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
        </label>
        {file && (
          <p className="workflow-caption">
            {file.name} · {(file.size / 1024).toFixed(0)} KiB
          </p>
        )}
        <p className="workflow-caption">
          The server validates file type, signature, and size. This is not a
          malware-scan guarantee. Do not upload secrets or personal information
          without permission.
        </p>
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
          <button className="button primary" disabled={!file || busy}>
            <Upload size={17} />
            {busy
              ? "Uploading…"
              : locked
                ? "Retry same upload"
                : "Upload evidence"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function FileDownload({
  fileId,
  label,
}: {
  fileId: string;
  label: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [name, setName] = useState(label);
  const [waitUntil, setWaitUntil] = useState(0);
  const alive = useRef(true);
  const urlRef = useRef("");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);
  useEffect(() => {
    if (!waitUntil) return;
    const timer = setTimeout(
      () => setWaitUntil(0),
      Math.max(0, waitUntil - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [waitUntil]);
  async function prepare() {
    if (busy || Date.now() < waitUntil) return;
    setBusy(true);
    setError("");
    try {
      const file = await unwrap(
        api!.GET("/v1/files/{id}/content", {
          params: { path: { id: fileId } },
        }),
      );
      const bytes = Uint8Array.from(atob(file.contentBase64), (char) =>
        char.charCodeAt(0),
      );
      if (!alive.current) return;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(
        new Blob([bytes], { type: file.mimeType }),
      );
      setUrl(urlRef.current);
      setName(file.name);
    } catch (failure) {
      if (alive.current) {
        setError(errorMessage(failure));
        if (failure instanceof ServiceError && failure.retryAfter)
          setWaitUntil(Date.now() + failure.retryAfter * 1000);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <span className="file-download">
      {url ? (
        <a className="workflow-inline-link" href={url} download={name}>
          <Download size={14} />
          {label} · Download ready
        </a>
      ) : (
        <button
          className="text-button"
          disabled={busy || Date.now() < waitUntil}
          onClick={() => void prepare()}
        >
          <Download size={14} />
          {busy ? "Preparing download…" : label}
        </button>
      )}
      {error && (
        <span className="error-message" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
