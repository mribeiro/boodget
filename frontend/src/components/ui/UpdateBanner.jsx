import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRotateRight, faXmark } from '@fortawesome/free-solid-svg-icons';

export default function UpdateBanner() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updateSW, setUpdateSW] = useState(null);

  useEffect(() => {
    const update = registerSW({
      immediate: true,
      onNeedRefresh() {
        setNeedRefresh(true);
      },
      onRegisteredSW(_url, registration) {
        if (registration) {
          setInterval(() => registration.update(), 60 * 60 * 1000);
        }
      },
    });
    setUpdateSW(() => update);
  }, []);

  if (!needRefresh) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 24,
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'var(--bg-card)',
      border: '1px solid var(--border-default)',
      color: 'var(--text-primary)',
      padding: '10px 14px',
      borderRadius: 'var(--radius)',
      fontSize: 13,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      zIndex: 500,
      boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
    }}>
      <span>A new version is available.</span>
      <button
        className="btn-primary"
        style={{ fontSize: 12, padding: '0.35rem 0.65rem' }}
        onClick={() => updateSW?.(true)}
      >
        <FontAwesomeIcon icon={faRotateRight} style={{ marginRight: '0.35rem' }} />
        Refresh
      </button>
      <button
        onClick={() => setNeedRefresh(false)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}
        title="Dismiss"
      >
        <FontAwesomeIcon icon={faXmark} />
      </button>
    </div>
  );
}
