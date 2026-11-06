import { useEffect, useState } from "react";
import { api } from "./api";
import { useT } from "./i18n";

const supported = (): boolean => typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const keyBytes = (b64: string): Uint8Array<ArrayBuffer> => {
  const raw = atob(b64.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64.length / 4) * 4, "="));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
};

/** Phone notifications for approvals and questions, per device. Needs the panel on https (or installed on iPhone). */
export function PushPanel() {
  const { t } = useT();
  const [on, setOn] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supported()) return;
    void navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setOn(!!sub), () => {});
  }, []);

  if (!supported()) return <p className="muted">{t.pushUnsupported}</p>;

  const enable = async () => {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error(t.pushDenied);
    const reg = await navigator.serviceWorker.ready;
    const { key } = await api.get<{ key: string }>("/api/push/key");
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
    await api.post("/api/push/subscribe", sub.toJSON());
  };
  const disable = async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api.post("/api/push/unsubscribe", { endpoint: sub.endpoint });
      await sub.unsubscribe();
    }
  };
  const toggle = async () => {
    setBusy(true);
    setMsg("");
    try {
      if (on) await disable();
      else await enable();
      setOn(!on);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setMsg("");
    try {
      await api.post("/api/push/test");
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="card section">
      <h3>{t.pushTitle}</h3>
      <p className="muted">{t.pushHelp}</p>
      <div className="row">
        <button disabled={busy} onClick={toggle}>
          {on ? t.pushOff : t.pushOn}
        </button>
        {on && (
          <button className="ghost" onClick={test}>
            {t.pushTest}
          </button>
        )}
        {msg && <span className="err">{msg}</span>}
      </div>
    </div>
  );
}
