import { useContext, useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AuthContext, AppContext } from '../../App';
import { api } from '../../services/api';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faUser,
  faBell,
  faChevronLeft,
  faChevronRight,
  faChevronDown,
  faCheck,
  faPlus,
  faVault,
  faCalendarDays,
  faCalendar,
  faTableCells,
  faBullseye,
  faHandHoldingDollar,
  faRotate,
  faShieldHeart,
  faWandMagicSparkles,
  faGear,
} from '@fortawesome/free-solid-svg-icons';

const NAV_ITEMS = [
  { key: 'capital',         icon: faVault,             label: 'Capital' },
  { key: 'expenses',        icon: faCalendarDays,      label: 'Monthly Expenses' },
  { key: 'annual-expenses', icon: faCalendar,          label: 'Annual Expenses' },
  { key: 'workbench',       icon: faTableCells,        label: 'Workbench' },
  { key: 'goals',           icon: faBullseye,          label: 'Goals' },
  { key: 'loans',           icon: faHandHoldingDollar, label: 'Loans' },
  { key: 'subscriptions',   icon: faRotate,            label: 'Subscriptions' },
  { key: 'emergency-fund',  icon: faShieldHeart,       label: 'Emergency Fund' },
  { key: 'ai-advisor',      icon: faWandMagicSparkles, label: 'AI Advisor' },
  { key: 'settings',        icon: faGear,              label: 'Settings' },
];

function isInDossierPath(pathname) {
  return /^\/dossiers\/[^/]+/.test(pathname);
}

// Swipe-to-close starts on the open drawer itself, not the screen edge, so
// it never competes with the browser's native edge-swipe-back gesture.
const SWIPE_CLOSE_THRESHOLD_PX = 60;
const MAX_VERTICAL_DRIFT_PX = 50;

export default function Sidebar({ mobileOpen, onClose, collapsed, onCollapseChange }) {
  const { user } = useContext(AuthContext);
  const { currentDossier, activeTab, setActiveTab } = useContext(AppContext);
  const navigate = useNavigate();
  const location = useLocation();

  const [dossiers, setDossiers] = useState([]);
  const [dossierMenuOpen, setDossierMenuOpen] = useState(false);
  const dossierMenuRef = useRef(null);
  const swipeCloseRef = useRef(null);

  const inDossier = isInDossierPath(location.pathname) && !!currentDossier;
  const aiEnabled = currentDossier ? currentDossier.ai_enabled !== 0 : true;

  useEffect(() => {
    if (!dossierMenuOpen) return;
    api.getDossiers().then(setDossiers).catch(() => {});
  }, [dossierMenuOpen]);

  useEffect(() => {
    function handleClick(e) {
      if (dossierMenuRef.current && !dossierMenuRef.current.contains(e.target)) {
        setDossierMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function toggleCollapse() {
    onCollapseChange(!collapsed);
  }

  function navToPath(path) {
    navigate(path);
    if (mobileOpen) onClose();
  }

  function handleTabClick(key) {
    setActiveTab(key);
    const targetPath = `/dossiers/${currentDossier.id}`;
    if (location.pathname !== targetPath) {
      navigate(targetPath, { state: { tab: key } });
    }
    if (mobileOpen) onClose();
  }

  function selectDossier(d) {
    setDossierMenuOpen(false);
    if (d.id !== currentDossier.id) {
      navigate(`/dossiers/${d.id}`, { state: { tab: activeTab } });
    }
    if (mobileOpen) onClose();
  }

  function handleNewDossier() {
    setDossierMenuOpen(false);
    navigate('/', { state: { openCreate: true } });
    if (mobileOpen) onClose();
  }

  function handleSwipeCloseStart(e) {
    if (!mobileOpen) return;
    const touch = e.touches[0];
    swipeCloseRef.current = { startX: touch.clientX, startY: touch.clientY };
  }

  function handleSwipeCloseMove(e) {
    if (!swipeCloseRef.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - swipeCloseRef.current.startX;
    const dy = touch.clientY - swipeCloseRef.current.startY;
    if (Math.abs(dy) > MAX_VERTICAL_DRIFT_PX) {
      swipeCloseRef.current = null;
      return;
    }
    if (dx < -SWIPE_CLOSE_THRESHOLD_PX) {
      onClose();
      swipeCloseRef.current = null;
    }
  }

  function handleSwipeCloseEnd() {
    swipeCloseRef.current = null;
  }

  const sidebarClass = [
    'sidebar',
    collapsed ? 'collapsed' : '',
    mobileOpen ? 'mobile-open' : '',
  ].filter(Boolean).join(' ');

  return (
    <aside
      className={sidebarClass}
      onTouchStart={handleSwipeCloseStart}
      onTouchMove={handleSwipeCloseMove}
      onTouchEnd={handleSwipeCloseEnd}
    >
      {/* Logo */}
      <div className="sidebar-logo">
        <img
          className="sidebar-logo-img"
          src="/icon.svg"
          alt="boodget"
          onClick={() => navToPath('/')}
          style={{ cursor: 'pointer' }}
        />
        <span className="sidebar-logo-text">boodget</span>
      </div>

      {/* Dossier switcher */}
      {inDossier && (
        <div className="sidebar-dossier">
          <div className="sidebar-dossier-label">Dossier</div>
          <div className="sidebar-dossier-wrap" ref={dossierMenuRef}>
            <button
              className="sidebar-dossier-btn"
              onClick={() => setDossierMenuOpen((o) => !o)}
            >
              <span className="sidebar-dossier-btn-name">{currentDossier.name}</span>
              <FontAwesomeIcon icon={faChevronDown} className="sidebar-dossier-chevron" />
            </button>

            {dossierMenuOpen && (
              <div className="sidebar-dossier-menu">
                {dossiers.map((d) => (
                  <button
                    key={d.id}
                    className={`sidebar-dossier-option${d.id === currentDossier.id ? ' active' : ''}`}
                    onClick={() => selectDossier(d)}
                  >
                    {d.name}
                    {d.id === currentDossier.id && <FontAwesomeIcon icon={faCheck} className="sidebar-dossier-check" />}
                  </button>
                ))}
                <hr className="sidebar-dossier-divider" />
                <button
                  className="sidebar-dossier-option sidebar-dossier-create"
                  onClick={handleNewDossier}
                >
                  <FontAwesomeIcon icon={faPlus} /> New dossier
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Dossier-scoped nav tabs (scrollable, fills remaining space) */}
      <nav className="sidebar-nav">
        {inDossier && NAV_ITEMS
          .filter((item) => item.key !== 'ai-advisor' || aiEnabled)
          .map(({ key, icon, label }) => (
            <button
              key={key}
              className={`sidebar-nav-item${activeTab === key ? ' active' : ''}`}
              data-tooltip={label}
              onClick={() => handleTabClick(key)}
            >
              <span className="sidebar-nav-icon"><FontAwesomeIcon icon={icon} /></span>
              <span className="sidebar-nav-label">{label}</span>
            </button>
          ))}
      </nav>

      {/* Bottom-pinned items */}
      <div className="sidebar-nav-bottom">
        <button
          className={`sidebar-nav-item${location.pathname === '/notifications' ? ' active' : ''}`}
          data-tooltip="Notifications"
          onClick={() => navToPath('/notifications')}
        >
          <span className="sidebar-nav-icon"><FontAwesomeIcon icon={faBell} /></span>
          <span className="sidebar-nav-label">Notifications</span>
        </button>
        <button
          className={`sidebar-nav-item${location.pathname === '/users' ? ' active' : ''}`}
          data-tooltip="Users"
          onClick={() => navToPath('/users')}
        >
          <span className="sidebar-nav-icon"><FontAwesomeIcon icon={faUser} /></span>
          <span className="sidebar-nav-label">Users</span>
        </button>
      </div>

      {/* Collapse toggle */}
      <button className="sidebar-collapse-btn" onClick={toggleCollapse} title={collapsed ? 'Expand' : 'Collapse'}>
        <FontAwesomeIcon icon={collapsed ? faChevronRight : faChevronLeft} />
      </button>
    </aside>
  );
}
