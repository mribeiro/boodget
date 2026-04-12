import { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { api } from './services/api';
import { ThemeProvider } from './contexts/ThemeContext';
import AppShell from './components/layout/AppShell';
import SetupWizard from './components/SetupWizard';
import LoginPage from './components/LoginPage';
import DossierList from './components/DossierList';
import DossierView from './components/DossierView';
import MonthEditor from './components/MonthEditor';
import CycleEditor from './components/expenses/CycleEditor';
import UserManager from './components/UserManager';
import PasswordChange from './components/PasswordChange';
import GoalDetail from './components/goals/GoalDetail';
import NotificationSettings from './pages/NotificationSettings';

export const AuthContext = createContext(null);
export const AppContext = createContext({ currentDossier: null, setCurrentDossier: () => {} });

export default function App() {
  const [authState, setAuthState] = useState({ loading: true, needsSetup: false, user: null });
  const [serverError, setServerError] = useState(false);

  async function init() {
    setServerError(false);
    setAuthState({ loading: true, needsSetup: false, user: null });
    try {
      const setup = await api.getSetupStatus();
      if (setup.needsSetup) {
        setAuthState({ loading: false, needsSetup: true, user: null });
        return;
      }
      const user = await api.me().catch(() => null);
      setAuthState({ loading: false, needsSetup: false, user });
    } catch (err) {
      if (err instanceof TypeError) {
        setServerError(true);
        setAuthState({ loading: false, needsSetup: false, user: null });
      } else {
        setAuthState({ loading: false, needsSetup: false, user: null });
      }
    }
  }

  useEffect(() => {
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (authState.loading) return <div className="loading">Loading...</div>;

  if (serverError) {
    return (
      <ThemeProvider>
        <div className="server-error-screen">
          <div className="server-error-card">
            <div className="server-error-icon"><FontAwesomeIcon icon="triangle-exclamation" /></div>
            <h2 className="server-error-title">Server unavailable</h2>
            <p className="server-error-message">
              Could not connect to the server. Check your connection and try again.
            </p>
            <button className="server-error-retry" onClick={init}>
              Retry
            </button>
          </div>
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <AuthContext.Provider value={{ ...authState, setAuthState }}>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthContext.Provider>
    </ThemeProvider>
  );
}

function AppRoutes() {
  const { needsSetup, user, setAuthState } = useContext(AuthContext);
  const [currentDossier, setCurrentDossier] = useState(null);

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
    <AppContext.Provider value={{ currentDossier, setCurrentDossier }}>
      <AppShell>
        <Routes>
          <Route path="/" element={<DossierList />} />
          <Route path="/dossiers/:id" element={<DossierView />} />
          <Route path="/dossiers/:id/months/:monthId" element={<MonthEditor />} />
          <Route path="/dossiers/:id/cycles/:cycleId" element={<CycleEditor />} />
          <Route path="/dossiers/:id/goals/:goalId" element={<GoalDetail />} />
          <Route path="/users" element={<UserManager />} />
          <Route path="/change-password" element={<PasswordChange />} />
          <Route path="/notifications" element={<NotificationSettings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </AppContext.Provider>
  );
}
