import { useContext } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AuthContext } from '../../App';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUser, faBell, faChevronLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons';

export default function Sidebar({ mobileOpen, onClose, collapsed, onCollapseChange }) {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();
  const location = useLocation();

  function toggleCollapse() {
    onCollapseChange(!collapsed);
  }

  function navToPath(path) {
    navigate(path);
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
        <div className="sidebar-logo-icon" onClick={() => navToPath('/')} style={{ cursor: 'pointer' }}>
          <svg width="28" height="28" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="lg-sidebar-bg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#7FD7DD"/>
                <stop offset="100%" stopColor="#1F7A8C"/>
              </linearGradient>
              <linearGradient id="lg-sidebar-body" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FFFFFF"/>
                <stop offset="100%" stopColor="#EAF6F8"/>
              </linearGradient>
              <radialGradient id="lg-sidebar-coin" cx="35%" cy="30%" r="80%">
                <stop offset="0%" stopColor="#FFE9A8"/>
                <stop offset="55%" stopColor="#F4BE3E"/>
                <stop offset="100%" stopColor="#D98E04"/>
              </radialGradient>
            </defs>
            <rect x="0" y="0" width="512" height="512" rx="120" ry="120" fill="url(#lg-sidebar-bg)"/>
            <g transform="translate(110.5,96) scale(1.4545)">
              <path d="M16,102 A84,84 0 0 1 184,102 L184,178 Q176,206 160,178 Q152,206 136,178 Q128,206 112,178 Q104,206 88,178 Q80,206 64,178 Q56,206 40,178 Q32,206 16,178 Z" fill="url(#lg-sidebar-body)" stroke="#123A46" strokeWidth="4.5" strokeLinejoin="round"/>
              <path d="M52,100 Q60,88 68,100" fill="none" stroke="#123A46" strokeWidth="5" strokeLinecap="round"/>
              <path d="M112,100 Q120,88 128,100" fill="none" stroke="#123A46" strokeWidth="5" strokeLinecap="round"/>
              <path d="M78,116 Q90,126 102,116" fill="none" stroke="#123A46" strokeWidth="4.5" strokeLinecap="round"/>
              <circle cx="128" cy="164" r="25" fill="url(#lg-sidebar-coin)" stroke="#123A46" strokeWidth="4"/>
              <circle cx="128" cy="164" r="17" fill="none" stroke="#D98E04" strokeWidth="2.5" opacity="0.6"/>
            </g>
          </svg>
        </div>
        <span className="sidebar-logo-text">boodget</span>
      </div>

      {/* Nav */}
      <nav className="sidebar-nav">
        <button
          className={`sidebar-nav-item${location.pathname === '/users' ? ' active' : ''}`}
          data-tooltip="Users"
          onClick={() => navToPath('/users')}
        >
          <span className="sidebar-nav-icon"><FontAwesomeIcon icon={faUser} /></span>
          <span className="sidebar-nav-label">Users</span>
        </button>
        <button
          className={`sidebar-nav-item${location.pathname === '/notifications' ? ' active' : ''}`}
          data-tooltip="Notifications"
          onClick={() => navToPath('/notifications')}
        >
          <span className="sidebar-nav-icon"><FontAwesomeIcon icon={faBell} /></span>
          <span className="sidebar-nav-label">Notifications</span>
        </button>
      </nav>

      {/* Collapse toggle */}
      <button className="sidebar-collapse-btn" onClick={toggleCollapse} title={collapsed ? 'Expand' : 'Collapse'}>
        <FontAwesomeIcon icon={collapsed ? faChevronRight : faChevronLeft} />
      </button>
    </aside>
  );
}
