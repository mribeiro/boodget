import { useContext, useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AuthContext, AppContext } from '../../App';
import { useTheme } from '../../contexts/ThemeContext';
import { api } from '../../services/api';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faA, faMoon, faSun, faBars } from '@fortawesome/free-solid-svg-icons';

const THEME_ICONS = { system: faA, light: faSun, dark: faMoon };
const THEME_LABELS = { system: 'Following system', light: 'Light mode', dark: 'Dark mode' };
const THEME_ORDER = ['system', 'light', 'dark'];

function getInitials(username) {
  if (!username) return '?';
  return username.slice(0, 2).toUpperCase();
}

function getDossierIdFromPath(pathname) {
  const m = pathname.match(/^\/dossiers\/(\d+)/);
  return m ? m[1] : null;
}

export default function Navbar({ onHamburger }) {
  const { user, setAuthState } = useContext(AuthContext);
  const { currentDossier } = useContext(AppContext);
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const appEnv = window.__APP_ENV__;
  const navbarBg =
    appEnv === 'dev' ? 'var(--color-navbar-dev)' :
    appEnv === 'ephemeral' ? 'var(--color-navbar-ephemeral)' :
    undefined;

  const dossierId = getDossierIdFromPath(location.pathname);
  const sha = (import.meta.env.VITE_GIT_COMMIT || 'unknown').slice(0, 7);

  // Build breadcrumb
  let breadcrumb = null;
  if (dossierId && currentDossier) {
    breadcrumb = (
      <span className="navbar-breadcrumb">
        <strong>{currentDossier.name}</strong>
      </span>
    );
  }

  function cycleTheme() {
    const idx = THEME_ORDER.indexOf(theme);
    setTheme(THEME_ORDER[(idx + 1) % THEME_ORDER.length]);
  }

  async function handleLogout() {
    await api.logout().catch(() => {});
    setAuthState((s) => ({ ...s, user: null }));
    setDropdownOpen(false);
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <nav className="navbar" style={navbarBg ? { backgroundColor: navbarBg } : undefined}>
      <div className="navbar-left">
        <button className="navbar-hamburger" onClick={onHamburger} aria-label="Menu">
          <FontAwesomeIcon icon={faBars} />
        </button>
        {breadcrumb}
      </div>

      <div className="navbar-right">
        {/* Env badge */}
        {appEnv === 'dev' && (
          <span className="badge badge-success">dev</span>
        )}
        {appEnv === 'ephemeral' && (
          <span className="badge badge-warning">preview</span>
        )}

        {/* Git SHA */}
        <span className="navbar-sha">{sha}</span>

        {/* Theme toggle */}
        <button
          className="theme-toggle-btn"
          onClick={cycleTheme}
          title={THEME_LABELS[theme]}
        >
          <FontAwesomeIcon icon={THEME_ICONS[theme]} />
        </button>

        {/* User menu */}
        <div className="user-menu-wrapper" ref={dropdownRef}>
          <button
            className="user-avatar-btn"
            onClick={() => setDropdownOpen((o) => !o)}
            title={user?.username}
          >
            {getInitials(user?.username)}
          </button>

          {dropdownOpen && (
            <div className="user-dropdown">
              <div style={{ padding: '8px 16px 6px', fontSize: 12, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-default)', marginBottom: 2 }}>
                {user?.username}
              </div>
              {!user?.is_oidc && (
                <button
                  className="user-dropdown-item"
                  onClick={() => { navigate('/change-password'); setDropdownOpen(false); }}
                >
                  Change Password
                </button>
              )}
              <hr className="user-dropdown-divider" />
              <button className="user-dropdown-item danger" onClick={handleLogout}>
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
