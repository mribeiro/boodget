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
          C
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
