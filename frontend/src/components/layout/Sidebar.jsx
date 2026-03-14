import { useContext, useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AuthContext, AppContext } from '../../App';

const TABS = ['capital', 'expenses', 'workbench', 'goals', 'settings'];

const NAV_DOSSIER = [
  { key: 'capital',   icon: '€',  label: 'Capital' },
  { key: 'expenses',  icon: '📅', label: 'Monthly Expenses' },
  { key: 'workbench', icon: '⚙', label: 'Workbench' },
  { key: 'goals',     icon: '◎', label: 'Goals' },
];

const NAV_GENERAL = [
  { key: 'users',    icon: '👤', label: 'Users',    path: '/users' },
];

function getDossierIdFromPath(pathname) {
  const m = pathname.match(/^\/dossiers\/(\d+)/);
  return m ? m[1] : null;
}

function getActiveTabFromState(locationState, pathname) {
  if (locationState?.tab) return locationState.tab;
  if (pathname.includes('/cycles/')) return 'expenses';
  if (pathname.includes('/months/')) return 'capital';
  return null;
}

export default function Sidebar({ mobileOpen, onClose }) {
  const { user } = useContext(AuthContext);
  const { currentDossier } = useContext(AppContext);
  const navigate = useNavigate();
  const location = useLocation();

  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem('ct-sidebar-collapsed') === 'true';
  });

  const dossierId = getDossierIdFromPath(location.pathname);
  const activeTab = getActiveTabFromState(location.state, location.pathname) || 'capital';
  const isOnDossier = !!dossierId;

  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('ct-sidebar-collapsed', String(next));
  }

  function navToTab(tab) {
    if (dossierId) {
      navigate(`/dossiers/${dossierId}`, { state: { tab } });
    }
    if (mobileOpen) onClose();
  }

  function navToPath(path) {
    navigate(path);
    if (mobileOpen) onClose();
  }

  function navToDossiers() {
    navigate('/', { state: { explicit: true } });
    if (mobileOpen) onClose();
  }

  const sidebarClass = [
    'sidebar',
    collapsed ? 'collapsed' : '',
    mobileOpen ? 'mobile-open' : '',
  ].filter(Boolean).join(' ');

  return (
    <aside className={sidebarClass}>
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon" onClick={navToDossiers} style={{ cursor: 'pointer' }}>
          C
        </div>
        <span className="sidebar-logo-text">Capital Tracker</span>
      </div>

      {/* Dossier selector */}
      {isOnDossier && (
        <div className="sidebar-dossier">
          <div className="sidebar-dossier-label">Dossier</div>
          <button className="sidebar-dossier-btn" onClick={navToDossiers} title="Back to dossiers">
            <span>📁</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {currentDossier?.name || '—'}
            </span>
          </button>
        </div>
      )}

      {/* Nav */}
      <nav className="sidebar-nav">
        {/* Dossier-specific nav items */}
        {isOnDossier && NAV_DOSSIER.map(item => {
          const isActive = activeTab === item.key;
          return (
            <button
              key={item.key}
              className={`sidebar-nav-item${isActive ? ' active' : ''}`}
              data-tooltip={item.label}
              onClick={() => navToTab(item.key)}
            >
              <span className="sidebar-nav-icon">{item.icon}</span>
              <span className="sidebar-nav-label">{item.label}</span>
            </button>
          );
        })}

        <hr />

        {/* Settings (dossier) */}
        {isOnDossier && (
          <button
            className={`sidebar-nav-item${activeTab === 'settings' ? ' active' : ''}`}
            data-tooltip="Settings"
            onClick={() => navToTab('settings')}
          >
            <span className="sidebar-nav-icon">⚙</span>
            <span className="sidebar-nav-label">Settings</span>
          </button>
        )}

        {/* General nav */}
        {NAV_GENERAL.map(item => {
          const isActive = location.pathname === item.path;
          return (
            <button
              key={item.key}
              className={`sidebar-nav-item${isActive ? ' active' : ''}`}
              data-tooltip={item.label}
              onClick={() => navToPath(item.path)}
            >
              <span className="sidebar-nav-icon">{item.icon}</span>
              <span className="sidebar-nav-label">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <button className="sidebar-collapse-btn" onClick={toggleCollapse} title={collapsed ? 'Expand' : 'Collapse'}>
        {collapsed ? '›' : '‹'}
      </button>
    </aside>
  );
}
