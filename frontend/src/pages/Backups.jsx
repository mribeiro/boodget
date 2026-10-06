import { useState, useEffect, useContext } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDatabase, faSpinner } from '@fortawesome/free-solid-svg-icons';
import { api } from '../services/api';
import { AuthContext } from '../App';
import Toast from '../components/ui/Toast';
import useToast from '../components/ui/useToast';
import { describeSchedule, formatBytes, backupHealth } from '../utils/backups';

function fmtDate(iso) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const HEALTH = {
  failed: { className: 'alert alert-error', text: (d) => `The last backup failed (${fmtDate(d.last_run.at)}): ${d.last_run.error}` },
  stale: { className: 'alert alert-warning', text: (d) => `No backup since ${fmtDate(d.backups[0].created_at)} — a scheduled run seems to have been missed.` },
  none: { className: 'alert alert-warning', text: () => 'No backups yet. Run one now to check everything works.' },
};

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--space-3)', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border-default)', fontSize: 13, flexWrap: 'wrap' }}>
      <div style={{ width: 110, flexShrink: 0, color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{children}</div>
    </div>
  );
}

export default function Backups() {
  const { user } = useContext(AuthContext);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const { toast, showToast } = useToast();

  function load() {
    return api.getBackups().then(setData).catch((err) => setError(err.message));
  }

  useEffect(() => {
    if (user.is_admin) load();
  }, []);

  async function handleBackupNow() {
    setRunning(true);
    setError('');
    try {
      await api.createBackup();
      showToast('Backup created');
    } catch (err) {
      setError(err.message);
    } finally {
      await load();
      setRunning(false);
    }
  }

  if (!user.is_admin) {
    return (
      <div className="page-fade-in">
        <div className="page-header"><h1>Backups</h1></div>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Only administrators can manage backups.</p>
      </div>
    );
  }
  if (!data && !error) return <div className="loading">Loading...</div>;

  const health = data ? backupHealth(data) : null;
  const banner = HEALTH[health];

  return (
    <div className="page-fade-in" style={{ maxWidth: 720 }}>
      <div className="page-header">
        <h1>Backups</h1>
        <div className="page-header-actions">
          <button className="btn-primary btn-sm" onClick={handleBackupNow} disabled={running || !data}>
            <FontAwesomeIcon icon={running ? faSpinner : faDatabase} spin={running} style={{ marginRight: '0.4rem' }} />
            {running ? 'Backing up…' : 'Back up now'}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {data && banner && <div className={banner.className}>{banner.text(data)}</div>}

      {data && (
        <>
          <div className="card card--flat" style={{ marginBottom: 'var(--space-5)', padding: 'var(--space-4)' }}>
            <p className="text-sm" style={{ color: 'var(--text-muted)', marginTop: 0, marginBottom: 'var(--space-3)' }}>
              A full copy of the database — every user, dossier and setting. Copy this folder somewhere
              else (a NAS, cloud storage) to be safe from a disk failure.
            </p>
            <Row label="Schedule">
              {data.enabled
                ? <>{describeSchedule(data.schedule)} <span style={{ color: 'var(--text-muted)' }}>(server time)</span></>
                : <span className="badge badge-neutral">Disabled</span>}
            </Row>
            <Row label="Retention">Keeps the {data.keep} most recent</Row>
            <Row label="Folder"><code style={{ fontSize: 12 }}>{data.dir}</code></Row>
            <Row label="Last run">
              {data.last_run ? (
                <>
                  <span className={`badge ${data.last_run.ok ? 'badge-success' : 'badge-danger'}`} style={{ marginRight: 8 }}>
                    {data.last_run.ok ? 'OK' : 'Failed'}
                  </span>
                  {fmtDate(data.last_run.at)}
                  <span style={{ color: 'var(--text-muted)' }}>
                    {' · '}{data.last_run.trigger === 'manual' ? `manual${data.last_run.by ? ` by ${data.last_run.by}` : ''}` : 'scheduled'}
                  </span>
                </>
              ) : <span style={{ color: 'var(--text-muted)' }}>Never</span>}
            </Row>
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Backup</th>
                  <th style={{ textAlign: 'right' }}>Size</th>
                </tr>
              </thead>
              <tbody>
                {data.backups.length === 0 && (
                  <tr><td colSpan={2} style={{ color: 'var(--text-muted)', textAlign: 'center' }}>No backups yet</td></tr>
                )}
                {data.backups.map((b) => (
                  <tr key={b.name}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{fmtDate(b.created_at)}</div>
                      <div className="text-sm" style={{ color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{b.name}</div>
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{formatBytes(b.size)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-sm" style={{ color: 'var(--text-muted)', marginTop: 'var(--space-4)' }}>
            Backups can't be downloaded here: each one is the whole database, including other
            users' dossiers and stored API keys. Copy them from the backup folder on the server
            (e.g. with Kopia). To restore: stop the app, replace the database file with a backup
            (renamed to the database's file name), then start it again.
          </p>
        </>
      )}
      <Toast {...toast} />
    </div>
  );
}
