import { useCallback, useEffect, useState } from "react";
import type { FormEvent, JSX, ReactNode } from "react";
import { Lock } from "lucide-react";
import { m } from "motion/react";

import { api, INSTANCE_LOCKED_EVENT } from "../api";
import { useTranslation } from "../i18n";
import { OpenNowLogoMark } from "./OpenNowLogoMark";
import { MotionSpinner } from "./MotionSpinner";
import { dialogMotion } from "./MotionProvider";

interface InstanceStatus {
  private: boolean;
  unlocked: boolean;
}

type GateState = "checking" | "locked" | "unlocked" | "error";

export function InstanceGate({ children }: { children: ReactNode }): JSX.Element {
  const { t } = useTranslation();
  const [state, setState] = useState<GateState>("checking");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const status = await api<InstanceStatus>("/api/instance/status");
      setState(!status.private || status.unlocked ? "unlocked" : "locked");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void checkStatus();
    // The unlock can expire (or the password can change) while the app is open.
    const onLocked = () => setState("locked");
    window.addEventListener(INSTANCE_LOCKED_EVENT, onLocked);
    return () => window.removeEventListener(INSTANCE_LOCKED_EVENT, onLocked);
  }, [checkStatus]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api<InstanceStatus>("/api/instance/unlock", {
        method: "POST",
        body: JSON.stringify({ password, remember }),
      });
      setPassword("");
      setState("unlocked");
    } catch (unlockError) {
      setError(unlockError instanceof Error ? unlockError.message : t("instance.errors.generic"));
    } finally {
      setSubmitting(false);
    }
  };

  if (state === "unlocked") return <>{children}</>;

  return (
    <div className="login-screen">
      <div className="login-bg">
        <div className="login-bg-orb login-bg-orb--1" />
        <div className="login-bg-orb login-bg-orb--2" />
        <div className="login-bg-orb login-bg-orb--3" />
        <div className="login-bg-noise" />
      </div>

      <m.div className="login-content" {...dialogMotion}>
        <div className="login-brand">
          <div className="login-brand-mark">
            <OpenNowLogoMark className="opennow-logo-mark" />
          </div>
          <span className="login-brand-name">OpenNOW</span>
        </div>

        <div className="login-card">
          {state === "checking" ? (
            <div className="instance-gate-checking">
              <MotionSpinner className="login-motion-spinner" size={18} label={t("common.loading")} />
            </div>
          ) : state === "error" ? (
            <>
              <div className="login-card-header">
                <h1>{t("instance.unavailableTitle")}</h1>
                <p>{t("instance.unavailableDescription")}</p>
              </div>
              <div className="login-actions">
                <button className="login-button" type="button" onClick={() => { setState("checking"); void checkStatus(); }}>
                  <span>{t("instance.retry")}</span>
                </button>
              </div>
            </>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="login-card-header">
                <h1>{t("instance.title")}</h1>
                <p>{t("instance.description")}</p>
              </div>

              {error && (
                <div className="login-error" role="alert">
                  <span className="login-error-dot" />
                  {error}
                </div>
              )}

              <div className="login-field">
                <label className="login-label" htmlFor="instance-password">{t("instance.passwordLabel")}</label>
                <input
                  id="instance-password"
                  className="login-select instance-gate-input"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={submitting}
                />
              </div>

              <label className="instance-gate-remember">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                  disabled={submitting}
                />
                <span>{t("instance.remember")}</span>
              </label>

              <div className="login-actions">
                <button
                  className={`login-button ${submitting ? "loading" : ""}`}
                  type="submit"
                  disabled={submitting || !password}
                >
                  {submitting ? (
                    <MotionSpinner className="login-motion-spinner" size={16} label={t("common.loading")} />
                  ) : (
                    <Lock size={16} />
                  )}
                  <span>{t("instance.unlock")}</span>
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="login-footer">{t("app.tagline")}</p>
      </m.div>
    </div>
  );
}
