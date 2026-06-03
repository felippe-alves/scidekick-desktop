import { useEffect, useState } from "react";
import { CheckCircle2, FolderOpen, Loader2, RefreshCw, X, XCircle } from "lucide-react";
import { EFFORT_OPTIONS, MODEL_OPTIONS } from "../lib/agentOptions";
import type { AgentProbeResult, HarnessSettings } from "../types/agent";

interface SettingsDialogProps {
  open: boolean;
  settings: HarnessSettings;
  scidekickProbe: AgentProbeResult | null;
  onClose: () => void;
  onSave: (next: HarnessSettings) => Promise<void>;
  onPickBinary: () => Promise<string | null>;
  onProbeBinary: (command: string) => Promise<AgentProbeResult>;
}

const APPROVAL_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: "default", label: "Inherit from sk", hint: "Use sk's tools.approvalMode config." },
  { value: "always-ask", label: "Always ask", hint: "Prompt before every tool call." },
  { value: "write", label: "Auto-approve reads", hint: "Reads run silently; writes still prompt." },
  { value: "yolo", label: "YOLO", hint: "Auto-approve everything. Trust nothing else." },
];

export function SettingsDialog({
  open,
  settings,
  scidekickProbe,
  onClose,
  onSave,
  onPickBinary,
  onProbeBinary,
}: SettingsDialogProps) {
  // Local draft so Cancel discards changes; only Save persists.
  const [draft, setDraft] = useState<HarnessSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<AgentProbeResult | null>(scidekickProbe);
  const [error, setError] = useState<string | null>(null);

  // Re-seed draft whenever the dialog is reopened with fresh settings.
  useEffect(() => {
    if (open) {
      setDraft(settings);
      setProbe(scidekickProbe);
      setError(null);
    }
  }, [open, settings, scidekickProbe]);

  // Esc to close. Mounted only while the dialog is open so we don't
  // intercept Esc when the user is interacting with the rest of the app.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, saving, onClose]);

  if (!open) return null;

  const scidekickOverride = draft.agentCommands.scidekick ?? "";

  function setScidekickOverride(value: string) {
    setDraft((current) => ({
      ...current,
      agentCommands: {
        ...current.agentCommands,
        scidekick: value,
      },
    }));
  }

  function setComposerField<K extends keyof HarnessSettings["composer"]>(
    key: K,
    value: HarnessSettings["composer"][K],
  ) {
    setDraft((current) => ({
      ...current,
      composer: { ...current.composer, [key]: value },
    }));
  }

  async function handleBrowse() {
    try {
      const picked = await onPickBinary();
      if (picked) setScidekickOverride(picked);
    } catch (err) {
      console.error("[scidekick-desktop] pickAgentBinary failed:", err);
    }
  }

  async function handleProbe() {
    const command = scidekickOverride.trim() || "sk";
    setProbing(true);
    setError(null);
    try {
      const result = await onProbeBinary(command);
      setProbe(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setProbing(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      // Only close when clicking outside the card.
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <div className="modal-card settings-card" role="dialog" aria-labelledby="settings-title">
        <header className="modal-header">
          <h2 id="settings-title">Settings</h2>
          <button type="button" className="modal-close" onClick={onClose} disabled={saving} aria-label="Close settings">
            <X size={14} />
          </button>
        </header>

        <div className="modal-body">
          <section className="settings-section">
            <header>
              <h3>Scidekick binary</h3>
              <p>Path to the `sk` executable. Leave blank to use whatever `sk` resolves to on PATH.</p>
            </header>
            <div className="settings-binary-row">
              <input
                type="text"
                value={scidekickOverride}
                onChange={(event) => setScidekickOverride(event.target.value)}
                placeholder="/usr/local/bin/sk"
                spellCheck={false}
              />
              <button type="button" className="ghost-button" onClick={handleBrowse} disabled={saving}>
                <FolderOpen size={13} />
                Browse
              </button>
              <button type="button" className="ghost-button" onClick={handleProbe} disabled={probing || saving}>
                {probing ? <Loader2 className="spin" size={13} /> : <RefreshCw size={13} />}
                Detect
              </button>
            </div>
            <ProbeStatus probe={probe} probing={probing} />
          </section>

          <section className="settings-section">
            <header>
              <h3>Composer defaults</h3>
              <p>Applied to every new chat.</p>
            </header>
            <div className="settings-grid">
              <label>
                <span>Model</span>
                <select
                  value={draft.composer.selectedModel ?? "default"}
                  onChange={(event) => setComposerField("selectedModel", event.target.value)}
                >
                  {MODEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Reasoning effort</span>
                <select
                  value={draft.composer.thinkingEffort ?? "default"}
                  onChange={(event) => setComposerField("thinkingEffort", event.target.value)}
                >
                  {EFFORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settings-grid-full">
                <span>Approval mode</span>
                <select
                  value={draft.composer.approvalMode ?? "default"}
                  onChange={(event) => setComposerField("approvalMode", event.target.value)}
                >
                  {APPROVAL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <small className="settings-hint">
                  {APPROVAL_OPTIONS.find((opt) => opt.value === (draft.composer.approvalMode ?? "default"))?.hint}
                </small>
              </label>
            </div>
          </section>
        </div>

        {error ? <div className="modal-error">{error}</div> : null}

        <footer className="modal-footer">
          <button type="button" className="ghost-button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="spin" size={13} /> : null}
            {saving ? "Saving" : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function ProbeStatus({ probe, probing }: { probe: AgentProbeResult | null; probing: boolean }) {
  if (probing) {
    return (
      <p className="probe-status probing">
        <Loader2 className="spin" size={13} /> Detecting…
      </p>
    );
  }
  if (!probe) {
    return <p className="probe-status muted">Click Detect to verify the binary.</p>;
  }
  if (probe.available) {
    const version = probe.stdout.trim();
    return (
      <p className="probe-status ok">
        <CheckCircle2 size={13} />
        Found {probe.command}
        {version ? <span className="probe-version">· {version}</span> : null}
      </p>
    );
  }
  const reason = probe.stderr.trim() || probe.stdout.trim() || `exit ${probe.exitCode ?? "?"}`;
  return (
    <p className="probe-status error">
      <XCircle size={13} />
      Could not run {probe.command}
      <span className="probe-reason">· {reason}</span>
    </p>
  );
}
