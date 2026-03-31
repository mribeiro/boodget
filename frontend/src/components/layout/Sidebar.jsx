import { useContext } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AuthContext } from '../../App';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUser, faChevronLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons';

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
              <linearGradient id="lg-sidebar" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#8b5cf6"/>
                <stop offset="100%" stopColor="#38bdf8"/>
              </linearGradient>
            </defs>
            <rect width="512" height="512" rx="120" fill="url(#lg-sidebar)"/>
            <path d="M136,400 L136,280 A120,120 0 0,1 376,280 L376,400 Q346,368 316,400 Q286,432 256,400 Q226,368 196,400 Q166,432 136,400 Z" fill="white"/>
            <circle cx="210" cy="250" r="26" fill="#1e1b4b"/>
            <circle cx="302" cy="250" r="26" fill="#1e1b4b"/>
            <circle cx="220" cy="240" r="9" fill="white"/>
            <circle cx="312" cy="240" r="9" fill="white"/>
            <path d="M220,295 Q256,318 292,295" fill="none" stroke="#1e1b4b" strokeWidth="8" strokeLinecap="round"/>
            <circle cx="256" cy="348" r="34" fill="#f59e0b"/>
            <circle cx="256" cy="348" r="25" fill="#fbbf24"/>
            <circle cx="256" cy="348" r="15" fill="#f59e0b"/>
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
      </nav>

      {/* Collapse toggle */}
      <button className="sidebar-collapse-btn" onClick={toggleCollapse} title={collapsed ? 'Expand' : 'Collapse'}>
        <FontAwesomeIcon icon={collapsed ? faChevronRight : faChevronLeft} />
      </button>
    </aside>
  );
}
