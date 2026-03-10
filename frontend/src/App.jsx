import { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { api } from './services/api';
import SetupWizard from './components/SetupWizard';
import LoginPage from './components/LoginPage';
import DossierList from './components/DossierList';
import DossierView from './components/DossierView';
import MonthEditor from './components/MonthEditor';
import CycleEditor from './components/expenses/CycleEditor';
import UserManager from './components/UserManager';
import PasswordChange from './components/PasswordChange';

export const AuthContext = createContext(null);

export default function App() {
  const [authState, setAuthState] = useState({ loading: true, needsSetup: false, user: null });

  useEffect(() => {
    async function init() {
      try {
        const setup = await api.getSetupStatus();
        if (setup.needsSetup) {
          setAuthState({ loading: false, needsSetup: true, user: null });
          return;
        }
        const user = await api.me().catch(() => null);
        setAuthState({ loading: false, needsSetup: false, user });
      } catch {
        setAuthState({ loading: false, needsSetup: false, user: null });
      }
    }
    init();
  }, []);

  if (authState.loading) return <div className="loading">Loading...</div>;

  return (
    <AuthContext.Provider value={{ ...authState, setAuthState }}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthContext.Provider>
  );
}

function AppRoutes() {
  const { needsSetup, user, setAuthState } = useContext(AuthContext);

  if (needsSetup) {
    return (
      <Routes>
        <Route
          path="*"
          element={
            <SetupWizard
              onComplete={(u) => setAuthState({ loading: false, needsSetup: false, user: u })}
            />
          }
        />
      </Routes>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route
          path="/login"
          element={<LoginPage onLogin={(u) => setAuthState((s) => ({ ...s, user: u }))} />}
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <div className="app">
      <Navbar />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<DossierList />} />
          <Route path="/dossiers/:id" element={<DossierView />} />
          <Route path="/dossiers/:id/months/:monthId" element={<MonthEditor />} />
          <Route path="/dossiers/:id/cycles/:cycleId" element={<CycleEditor />} />
          <Route path="/users" element={<UserManager />} />
          <Route path="/change-password" element={<PasswordChange />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function Navbar() {
  const { user, setAuthState } = useContext(AuthContext);
  const navigate = useNavigate();

  async function handleLogout() {
    await api.logout().catch(() => {});
    setAuthState((s) => ({ ...s, user: null }));
  }

  return (
    <nav className="navbar">
      <span className="nav-brand" onClick={() => navigate('/', { state: { explicit: true } })}>
        Capital Tracker
      </span>
      <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontFamily: 'monospace', opacity: 0.6 }}>
        {import.meta.env.VITE_GIT_COMMIT || 'unknown'}
      </span>
      <div className="nav-links">
        <button className="nav-link" onClick={() => navigate('/', { state: { explicit: true } })}>
          Dossiers
        </button>
        <button className="nav-link" onClick={() => navigate('/users')}>
          Users
        </button>
        {!user.is_oidc && (
          <button className="nav-link" onClick={() => navigate('/change-password')}>
            Password
          </button>
        )}
        <span className="nav-user">{user.username}</span>
        <button className="nav-link logout" onClick={handleLogout}>
          Logout
        </button>
      </div>
    </nav>
  );
}
