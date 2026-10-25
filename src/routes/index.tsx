import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createVault,
  deleteFile,
  downloadFile,
  listFiles,
  openVault,
  uploadFile,
  type VaultFileMeta,
} from "@/lib/vault.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lest File Transferer" },
      {
        name: "description",
        content:
          "Create a password-protected file database and open it from any device.",
      },
      { property: "og:title", content: "Lest File Transferer" },
      {
        property: "og:description",
        content: "Password-protected file vaults that work across devices.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Session = { vaultId: string; name: string; password: string };

const SESSION_KEY = "lest-file-transferer-session";

function loadSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    return parsed.vaultId && parsed.name && parsed.password ? parsed : null;
  } catch {
    return null;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type Screen = "home" | "create" | "open" | "vault";

function Index() {
  const [session, setSession] = useState<Session | null>(null);
  const [screen, setScreen] = useState<Screen>("home");

  // Resume an existing session on first paint (browser only).
  useEffect(() => {
    const saved = loadSession();
    if (saved) {
      setSession(saved);
      setScreen("vault");
    }
  }, []);

  const enterVault = useCallback((next: Session) => {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    setSession(next);
    setScreen("vault");
  }, []);

  const leaveVault = useCallback(() => {
    window.localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setScreen("home");
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-5">
        <Header />
        <main className="flex flex-1 flex-col justify-center py-12">
          {screen === "home" && (
            <HomeScreen
              onCreate={() => setScreen("create")}
              onOpen={() => setScreen("open")}
            />
          )}
          {screen === "create" && (
            <CreateScreen onBack={() => setScreen("home")} onCreated={enterVault} />
          )}
          {screen === "open" && (
            <OpenScreen onBack={() => setScreen("home")} onOpened={enterVault} />
          )}
          {screen === "vault" && session && (
            <VaultScreen session={session} onLeave={leaveVault} />
          )}
        </main>
        <Footer />
      </div>
    </div>
  );
}

function Header() {
  return (
    <header className="border-b border-border py-6">
      <h1 className="font-display text-2xl leading-none tracking-tight sm:text-3xl">
        LEST FILE TRANSFERER
      </h1>
      <p className="mt-3 text-xs text-muted-foreground tracking-mega uppercase">
        Password-protected file vaults, openable from any device
      </p>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border py-4 text-[10px] uppercase tracking-mega text-muted-foreground">
      Lest File Transferer — files up to 8 MB each
    </footer>
  );
}

function HomeScreen({
  onCreate,
  onOpen,
}: {
  onCreate: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="flex flex-col gap-6 sm:flex-row">
      <button
        type="button"
        onClick={onCreate}
        className="group flex flex-1 flex-col items-start gap-3 border border-border bg-card p-8 text-left transition-colors hover:border-foreground hover:bg-primary hover:text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
      >
        <span className="text-[10px] uppercase tracking-mega text-muted-foreground group-hover:text-primary-foreground/70">
          01
        </span>
        <span className="font-display text-xl leading-tight">CREATE A DATABASE</span>
        <span className="text-xs text-muted-foreground group-hover:text-primary-foreground/70">
          Name it, lock it with a password.
        </span>
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="group flex flex-1 flex-col items-start gap-3 border border-border bg-card p-8 text-left transition-colors hover:border-foreground hover:bg-primary hover:text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
      >
        <span className="text-[10px] uppercase tracking-mega text-muted-foreground group-hover:text-primary-foreground/70">
          02
        </span>
        <span className="font-display text-xl leading-tight">OPEN A DATABASE</span>
        <span className="text-xs text-muted-foreground group-hover:text-primary-foreground/70">
          Enter the name and password.
        </span>
      </button>
    </div>
  );
}

function VaultCredentialsForm({
  mode,
  submitLabel,
  onSubmit,
  onBack,
}: {
  mode: "create" | "open";
  submitLabel: string;
  onSubmit: (name: string, password: string) => Promise<void>;
  onBack: () => void;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(name, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-md">
      <div className="border border-border bg-card p-8">
        <div className="flex flex-col gap-6">
          <label className="flex flex-col gap-2">
            <span className="text-[10px] uppercase tracking-mega text-muted-foreground">
              Database name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              required
              autoComplete="off"
              spellCheck={false}
              placeholder={mode === "create" ? "my-vault" : "name-you-gave-it"}
              className="border-b border-input bg-transparent py-2 text-base outline-none placeholder:text-muted-foreground/50 focus:border-foreground"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-[10px] uppercase tracking-mega text-muted-foreground">
              Password
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === "create" ? "new-password" : "current-password"}
              placeholder="••••••••"
              className="border-b border-input bg-transparent py-2 text-base outline-none placeholder:text-muted-foreground/50 focus:border-foreground"
            />
          </label>
          {mode === "create" && (
            <p className="text-xs text-muted-foreground">
              Remember both. Anyone with the name and password can open this
              database from any device.
            </p>
          )}
          {error && (
            <p className="border border-border bg-secondary px-3 py-2 text-xs">
              {error}
            </p>
          )}
        </div>
      </div>
      <div className="mt-6 flex gap-3">
        <button
          type="submit"
          disabled={busy}
          className="border border-foreground bg-primary px-6 py-3 text-xs font-bold uppercase tracking-mega text-primary-foreground transition-opacity hover:opacity-80 disabled:opacity-40"
        >
          {busy ? "Working…" : submitLabel}
        </button>
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="border border-border px-6 py-3 text-xs uppercase tracking-mega text-muted-foreground transition-colors hover:border-foreground hover:text-foreground disabled:opacity-40"
        >
          Back
        </button>
      </div>
    </form>
  );
}

function CreateScreen({
  onBack,
  onCreated,
}: {
  onBack: () => void;
  onCreated: (session: Session) => void;
}) {
  return (
    <div>
      <StepTitle step="01" title="Create a database" />
      <VaultCredentialsForm
        mode="create"
        submitLabel="Create"
        onBack={onBack}
        onSubmit={async (name, password) => {
          const result = await createVault({ data: { name, password } });
          onCreated({ vaultId: result.vaultId, name: result.name, password });
        }}
      />
    </div>
  );
}

function OpenScreen({
  onBack,
  onOpened,
}: {
  onBack: () => void;
  onOpened: (session: Session) => void;
}) {
  return (
    <div>
      <StepTitle step="02" title="Open a database" />
      <VaultCredentialsForm
        mode="open"
        submitLabel="Open"
        onBack={onBack}
        onSubmit={async (name, password) => {
          const result = await openVault({ data: { name, password } });
          onOpened({ vaultId: result.vaultId, name: result.name, password });
        }}
      />
    </div>
  );
}

function StepTitle({ step, title }: { step: string; title: string }) {
  return (
    <div className="mb-8 flex items-baseline gap-4">
      <span className="text-[10px] uppercase tracking-mega text-muted-foreground">
        {step}
      </span>
      <h2 className="font-display text-xl uppercase">{title}</h2>
    </div>
  );
}

function VaultScreen({
  session,
  onLeave,
}: {
  session: Session;
  onLeave: () => void;
}) {
  const [files, setFiles] = useState<VaultFileMeta[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const auth = { vaultId: session.vaultId, name: session.name, password: session.password };

  const refresh = useCallback(async () => {
    try {
      const result = await listFiles({ data: auth });
      setFiles(result);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Could not open this database.",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.vaultId, session.name, session.password]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploadError(null);
    setUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        if (file.size > 5 * 1024 * 1024 * 1024) {
          throw new Error(`"${file.name}" is over 8 MB.`);
        }
        const base64 = await readAsBase64(file);
        await uploadFile({
          data: {
            vaultId: session.vaultId,
            name: session.name,
            password: session.password,
            filename: file.name,
            mimeType: file.type || "application/octet-stream",
            base64,
          },
        });
      }
      await refresh();
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Upload failed. Try again.",
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDownload(file: VaultFileMeta) {
    setDownloadingId(file.id);
    try {
      const result = await downloadFile({
        data: { ...auth, fileId: file.id },
      });
      const bytes = Uint8Array.from(atob(result.contentBase64), (c) =>
        c.charCodeAt(0),
      );
      const blob = new Blob([bytes], { type: result.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Download failed. Try again.",
      );
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleDelete(file: VaultFileMeta) {
    setDeletingId(file.id);
    try {
      await deleteFile({ data: { ...auth, fileId: file.id } });
      await refresh();
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Delete failed. Try again.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-baseline justify-between gap-4 border-b border-border pb-6">
        <div className="flex items-baseline gap-4">
          <span className="text-[10px] uppercase tracking-mega text-muted-foreground">
            DB
          </span>
          <h2 className="font-display text-xl uppercase">{session.name}</h2>
        </div>
        <button
          type="button"
          onClick={onLeave}
          className="border border-border px-4 py-2 text-[10px] uppercase tracking-mega text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
        >
          Leave
        </button>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={`cursor-pointer border border-dashed p-10 text-center transition-colors ${
          dragOver ? "border-foreground bg-secondary" : "border-border hover:border-foreground"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
        <p className="text-xs uppercase tracking-mega">
          {uploading ? "Transferring…" : "Drop files here or click to upload"}
        </p>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Up to 8 MB per file · stored under this database's password
        </p>
      </div>

      {(uploadError || loadError) && (
        <p className="mt-4 border border-border bg-secondary px-3 py-2 text-xs">
          {loadError ?? uploadError}
        </p>
      )}

      {files === null && !loadError && (
        <p className="mt-8 text-xs text-muted-foreground">Loading files…</p>
      )}

      {files !== null && (
        <div className="mt-8">
          {files.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              This database is empty. Upload the first file above.
            </p>
          ) : (
            <ul>
              {files.map((file) => (
                <li
                  key={file.id}
                  className="flex flex-wrap items-center gap-3 border-b border-border py-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{file.filename}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {formatBytes(file.sizeBytes)} · {formatDate(file.createdAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDownload(file)}
                    disabled={downloadingId === file.id || deletingId === file.id}
                    className="border border-foreground bg-primary px-4 py-2 text-[10px] uppercase tracking-mega text-primary-foreground transition-opacity hover:opacity-80 disabled:opacity-40"
                  >
                    {downloadingId === file.id ? "…" : "Download"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(file)}
                    disabled={downloadingId === file.id || deletingId === file.id}
                    className="border border-border px-4 py-2 text-[10px] uppercase tracking-mega text-muted-foreground transition-colors hover:border-foreground hover:text-foreground disabled:opacity-40"
                  >
                    {deletingId === file.id ? "…" : "Delete"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const commaIndex = dataUrl.indexOf(",");
      resolve(commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : "");
    };
    reader.readAsDataURL(file);
  });
}
