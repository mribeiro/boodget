import { useContext, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AuthContext } from '../../App';

export default function Sidebar({ mobileOpen, onClose }) {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();
  const location = useLocation();

  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem('ct-sidebar-collapsed') === 'true';
  });

  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('ct-sidebar-collapsed', String(next));
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
        <span className="sidebar-logo-text">Capital Tracker</span>
      </div>

      {/* Nav */}
      <nav className="sidebar-nav">
        <button
          className={`sidebar-nav-item${location.pathname === '/users' ? ' active' : ''}`}
          data-tooltip="Users"
          onClick={() => navToPath('/users')}
        >
          <span className="sidebar-nav-icon">👤</span>
          <span className="sidebar-nav-label">Users</span>
        </button>
      </nav>

      {/* Collapse toggle */}
      <button className="sidebar-collapse-btn" onClick={toggleCollapse} title={collapsed ? 'Expand' : 'Collapse'}>
        {collapsed ? '›' : '‹'}
      </button>
    </aside>
  );
}
