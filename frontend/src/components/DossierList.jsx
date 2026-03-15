import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileImport, faPlus, faXmark } from '@fortawesome/free-solid-svg-icons';
import { api } from '../services/api';

export default function DossierList() {
  const [dossiers, setDossiers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const importRef = useRef();

  useEffect(() => {
    const isExplicit = location.state?.explicit;
    if (isExplicit) {
      window.history.replaceState({}, document.title);
    }
    api
      .getDossiers()
      .then((data) => {
        if (data.length === 1 && !isExplicit) {
          navigate(`/dossiers/${data[0].id}`, { replace: true, state: { autoOpened: true } });
          return;
        }
        setDossiers(data);
      })
      .catch(() => setError('Failed to load dossiers'))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      const d = await api.createDossier({ name });
      setDossiers((prev) => [...prev, d]);
      setName('');
      setShowForm(false);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    setError('');
    setImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const d = await api.importDossier(data);
      setDossiers((prev) => [...prev, d]);
      navigate(`/dossiers/${d.id}`);
    } catch (err) {
      setError(err.message || 'Failed to import dossier');
    } finally {
      setImporting(false);
    }
  }

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportFile} />
      <div className="page-header">
        <h1>Dossiers</h1>
        <div className="page-header-actions">
          <button className="btn-secondary btn-sm" onClick={() => importRef.current.click()} disabled={importing}>
            <FontAwesomeIcon icon={faFileImport} style={{ marginRight: '0.4rem' }} />
            {importing ? 'Importing…' : 'Import'}
          </button>
          <button className="btn-primary btn-sm" onClick={() => setShowForm((v) => !v)}>
            {showForm ? (
              <><FontAwesomeIcon icon={faXmark} style={{ marginRight: '0.4rem' }} />Cancel</>
            ) : (
              <><FontAwesomeIcon icon={faPlus} style={{ marginRight: '0.4rem' }} />New dossier</>
            )}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="card card--flat" style={{ marginBottom: 'var(--space-5)', maxWidth: 480 }}>
          <form onSubmit={handleCreate} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
              <label htmlFor="dossier-name">Dossier name</label>
              <input
                id="dossier-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
            </div>
            <button type="submit" className="btn-primary">Create</button>
          </form>
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {dossiers.length === 0 ? (
        <div className="empty-state">
          <p>No dossiers yet.</p>
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            Create your first dossier
          </button>
        </div>
      ) : (
        <div className="card-grid">
          {dossiers.map((d) => (
            <div key={d.id} className="card card--clickable" onClick={() => navigate(`/dossiers/${d.id}`)}>
              <div className="card-title">{d.name}</div>
              <div className="card-meta">{d.is_creator ? 'Owner' : 'Shared with me'}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
