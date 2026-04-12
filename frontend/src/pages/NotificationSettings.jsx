import { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { api } from '../services/api';
import Checkbox from '../components/ui/Checkbox';

function localToUTC(localHour, localMinute) {
  const now = new Date();
  const local = new Date(now.getFullYear(), now.getMonth(), now.getDate(), localHour, localMinute);
  return { send_hour: local.getUTCHours(), send_minute: local.getUTCMinutes() };
}

function utcToLocal(utcHour, utcMinute) {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), utcHour, utcMinute));
  return { hour: utc.getHours(), minute: utc.getMinutes() };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

export default function NotificationSettings() {
  const [settings, setSettings] = useState(null);
  const [dossiers, setDossiers] = useState([]);
  const [optedIn, setOptedIn] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [permissionState, setPermissionState] = useState('default');
  const [currentEndpoint, setCurrentEndpoint] = useState(null);
  const [subscribing, setSubscribing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [testingPush, setTestingPush] = useState(false);
  const [testResult, setTestResult] = useState(null); // null | 'success' | 'error'
  const [vapidInfo, setVapidInfo] = useState(null);
  const [localHour, setLocalHour] = useState(9);
  const [localMinute, setLocalMinute] = useState(0);

  // Load all data
  const loadData = useCallback(async () => {
    try {
      const [s, di, subs, dos, vi] = await Promise.all([
        api.getNotificationSettings(),
        api.getNotificationDossiers(),
        api.getPushSubscriptions(),
        api.getDossiers(),
        api.getVapidInfo(),
      ]);
      setSettings(s);
      setOptedIn(di);
      setSubscriptions(subs);
      setDossiers(dos);
      setVapidInfo(vi);
      const local = utcToLocal(s.send_hour, s.send_minute);
      setLocalHour(local.hour);
      setLocalMinute(local.minute);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    loadData();
    // Check current permission + subscription
    if ('Notification' in window) {
      setPermissionState(Notification.permission);
    }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          if (sub) setCurrentEndpoint(sub.endpoint);
        });
      });
    }
  }, [loadData]);

  async function handleToggleMaster(enabled) {
    try {
      const updated = await api.updateNotificationSettings({ enabled: enabled ? 1 : 0 });
      setSettings(updated);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleTimeChange(hour, minute) {
    setLocalHour(hour);
    setLocalMinute(minute);
    const utc = localToUTC(hour, minute);
    try {
      const updated = await api.updateNotificationSettings(utc);
      setSettings(updated);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRepeatToggle(enabled) {
    try {
      const updated = await api.updateNotificationSettings({ repeat_enabled: enabled ? 1 : 0 });
      setSettings(updated);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRepeatInterval(days) {
    const v = Number(days);
    if (!Number.isInteger(v) || v < 1 || v > 7) return;
    try {
      const updated = await api.updateNotificationSettings({ repeat_interval_days: v });
      setSettings(updated);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleEnableOnDevice() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const isStandalone = navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
      if (isIOS && !isStandalone) {
        setError('On iOS, push notifications are only available when the app is installed on your Home Screen. Tap the Share button in Safari and select "Add to Home Screen", then open the app from there.');
      } else {
        setError('Push notifications are not supported in this browser.');
      }
      return;
    }
    setSubscribing(true);
    setError('');
    try {
      const permission = await Notification.requestPermission();
      setPermissionState(permission);
      if (permission !== 'granted') return;

      const { publicKey } = await api.getVapidPublicKey();
      const reg = await navigator.serviceWorker.ready;
      // Unsubscribe any existing subscription first — if the server's VAPID keys
      // changed (e.g. DB wiped) the browser will reject a subscribe() with a key
      // mismatch error unless we clear the stale subscription first.
      const existing = await reg.pushManager.getSubscription();
      if (existing) await existing.unsubscribe();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const json = sub.toJSON();
      await api.subscribePush({ endpoint: json.endpoint, keys: json.keys });
      setCurrentEndpoint(json.endpoint);
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubscribing(false);
    }
  }

  async function handleRemoveSubscription(endpoint) {
    try {
      await api.unsubscribePush(endpoint);
      if (endpoint === currentEndpoint) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
        setCurrentEndpoint(null);
      }
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleTestPush() {
    setTestingPush(true);
    setTestResult(null);
    try {
      const data = await api.testPush();
      const anySuccess = data.results.some((r) => r.success);
      if (anySuccess) {
        setTestResult({ ok: true });
      } else {
        const first = data.results[0];
        const detail = first.statusCode ? `status ${first.statusCode}` : first.message || 'unknown error';
        setTestResult({ ok: false, detail });
      }
    } catch (err) {
      setTestResult({ ok: false, detail: err.message });
    } finally {
      setTestingPush(false);
      await loadData();
      setTimeout(() => setTestResult(null), 4000);
    }
  }

  async function handleDossierToggle(dossierId, checked) {
    const next = checked ? [...optedIn, dossierId] : optedIn.filter((id) => id !== dossierId);
    setSaving(true);
    try {
      const updated = await api.setNotificationDossiers(next);
      setOptedIn(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return <div style={{ padding: 'var(--space-6)', color: 'var(--text-muted)' }}>Loading…</div>;
  }

  const isCurrentDeviceSubscribed = !!currentEndpoint;
  const isRegisteredOnBackend = subscriptions.some((s) => s.endpoint === currentEndpoint);
  const notificationsBlocked = permissionState === 'denied';
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  const showIOSHint = isIOS && !isStandalone && !isCurrentDeviceSubscribed;

  return (
    <div className="page-fade-in" style={{ padding: 'var(--space-6)', maxWidth: 640 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 'var(--space-6)', color: 'var(--text-primary)' }}>
        Notification Settings
      </h1>

      {error && (
        <div style={{ background: 'var(--color-danger-light)', border: '1px solid var(--color-danger-border)', color: 'var(--color-danger-text)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-3)', marginBottom: 'var(--space-4)', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Master toggle */}
      <div className="card card--flat" style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Enable push notifications</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>
              Receive alerts for expenses, cycles, and snapshots
            </div>
          </div>
          <Checkbox
            checked={!!settings.enabled}
            onChange={(checked) => handleToggleMaster(checked)}
          />
        </div>
      </div>

      {/* Device registration */}
      <div className="card card--flat" style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-4)' }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 var(--space-3)' }}>This Device</h2>

        {showIOSHint && (
          <div style={{ color: 'var(--color-warning-text)', fontSize: 13, background: 'var(--color-warning-light)', border: '1px solid var(--color-warning-border)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
            On iOS, push notifications require the app to be installed on your Home Screen. Tap the Share button in Safari and select <strong>"Add to Home Screen"</strong>, then open the app from there.
          </div>
        )}

        {notificationsBlocked ? (
          <div style={{ color: 'var(--color-warning-text)', fontSize: 13, background: 'var(--color-warning-light)', border: '1px solid var(--color-warning-border)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-3)' }}>
            Notifications are blocked in your browser settings. To enable them, update your browser's notification permissions for this site.
          </div>
        ) : isCurrentDeviceSubscribed && isRegisteredOnBackend ? (
          <div style={{ color: 'var(--color-success-text)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <FontAwesomeIcon icon="circle-check" style={{ color: 'var(--color-success)', marginRight: '0.4rem' }} /> Notifications enabled on this device
          </div>
        ) : isCurrentDeviceSubscribed && !isRegisteredOnBackend ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div style={{ color: 'var(--color-warning-text)', fontSize: 13, background: 'var(--color-warning-light)', border: '1px solid var(--color-warning-border)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-3)' }}>
              This device is subscribed in the browser but not registered on the server. Click below to fix it.
            </div>
            <button
              className="btn btn-primary"
              onClick={handleEnableOnDevice}
              disabled={subscribing}
              style={{ fontSize: 13 }}
            >
              {subscribing ? 'Registering…' : 'Re-register this device'}
            </button>
          </div>
        ) : (
          <button
            className="btn btn-primary"
            onClick={handleEnableOnDevice}
            disabled={subscribing}
            style={{ fontSize: 13 }}
          >
            {subscribing ? 'Enabling…' : 'Enable notifications on this device'}
          </button>
        )}

        {subscriptions.length > 0 && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 'var(--space-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Registered devices
            </div>
            {subscriptions.map((sub) => (
              <div key={sub.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border-default)', fontSize: 13 }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {sub.endpoint === currentEndpoint ? 'This device' : 'Other device'}
                  <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                    · Registered {new Date(sub.created_at).toLocaleDateString()}
                  </span>
                </span>
                <button
                  className="btn btn-ghost"
                  onClick={() => handleRemoveSubscription(sub.endpoint)}
                  style={{ fontSize: 12, color: 'var(--color-danger)', padding: '2px 8px' }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {isCurrentDeviceSubscribed && (
          <div style={{ marginTop: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <button
              className="btn btn-ghost"
              onClick={handleTestPush}
              disabled={testingPush}
              style={{ fontSize: 13 }}
            >
              {testingPush ? 'Sending…' : 'Send test notification'}
            </button>
            {testResult?.ok === true && (
              <span style={{ fontSize: 12, color: 'var(--color-success-text)' }}>
                <FontAwesomeIcon icon="circle-check" style={{ marginRight: '0.3rem' }} />Notification sent — check your device
              </span>
            )}
            {testResult?.ok === false && (
              <span style={{ fontSize: 12, color: 'var(--color-danger-text)' }}>
                Failed: {testResult.detail}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Delivery time */}
      <div className="card card--flat" style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-4)' }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 var(--space-3)' }}>Delivery Time</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Send notifications at</span>
          <select
            value={localHour}
            onChange={(e) => handleTimeChange(Number(e.target.value), localMinute)}
            style={{ width: 70 }}
          >
            {Array.from({ length: 24 }, (_, i) => (
              <option key={i} value={i}>{pad2(i)}</option>
            ))}
          </select>
          <span style={{ fontSize: 13 }}>:</span>
          <select
            value={localMinute}
            onChange={(e) => handleTimeChange(localHour, Number(e.target.value))}
            style={{ width: 70 }}
          >
            {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
              <option key={m} value={m}>{pad2(m)}</option>
            ))}
          </select>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            (your local time — stored as UTC {pad2(settings.send_hour)}:{pad2(settings.send_minute)})
          </span>
        </div>
      </div>

      {/* Repetition */}
      <div className="card card--flat" style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: settings.repeat_enabled ? 'var(--space-3)' : 0 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Repeat notifications</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>
              Re-send while the condition still applies
            </div>
          </div>
          <Checkbox
            checked={!!settings.repeat_enabled}
            onChange={(checked) => handleRepeatToggle(checked)}
          />
        </div>
        {!!settings.repeat_enabled && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Repeat every</span>
            <input
              type="number" inputMode="numeric"
              min={1}
              max={7}
              value={settings.repeat_interval_days}
              onChange={(e) => handleRepeatInterval(e.target.value)}
              style={{ width: 60 }}
            />
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>day(s)</span>
          </div>
        )}
      </div>

      {/* Dossier opt-in */}
      <div className="card card--flat" style={{ padding: 'var(--space-4)' }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 var(--space-3)' }}>Dossiers</h2>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
          Send notifications for these dossiers
        </div>
        {dossiers.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No dossiers available.</div>
        ) : (
          dossiers.map((d) => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border-default)' }}>
              <Checkbox
                checked={optedIn.includes(d.id)}
                onChange={(checked) => handleDossierToggle(d.id, checked)}
              />
              <span style={{ fontSize: 13 }}>{d.name}</span>
            </div>
          ))
        )}
      </div>

      {/* VAPID debug info */}
      {vapidInfo && (
        <div className="card card--flat" style={{ marginTop: 'var(--space-4)', padding: 'var(--space-4)' }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 var(--space-3)', color: 'var(--text-muted)' }}>VAPID Config (debug)</h2>
          <table style={{ fontSize: 12, borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {[
                ['Source', vapidInfo.fromEnv ? 'Environment variables (set)' : 'Auto-generated (DB)'],
                ['Subject', vapidInfo.subject],
                ['Public key', vapidInfo.publicKey],
                ['Private key', vapidInfo.privateKey],
              ].map(([label, val]) => (
                <tr key={label}>
                  <td style={{ color: 'var(--text-muted)', paddingRight: 16, paddingBottom: 4, whiteSpace: 'nowrap' }}>{label}</td>
                  <td style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{val}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Helper: convert base64url VAPID public key to Uint8Array
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
