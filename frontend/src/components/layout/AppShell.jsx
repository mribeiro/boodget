import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faChartLine,
  faCalendarDays,
  faScaleBalanced,
  faBullseye,
  faGear,
} from '@fortawesome/free-solid-svg-icons';
import Sidebar from './Sidebar';
import Navbar from './Navbar';

const BOTTOM_NAV_TABS = [
  { key: 'capital',   icon: faChartLine,       label: 'Capital' },
  { key: 'expenses',  icon: faCalendarDays,    label: 'Expenses' },
  { key: 'workbench', icon: faScaleBalanced,   label: 'Workbench' },
  { key: 'goals',     icon: faBullseye,        label: 'Goals' },
  { key: 'settings',  icon: faGear,            label: 'Settings' },
];

function getDossierIdFromPath(pathname) {
  const m = pathname.match(/^\/dossiers\/(\d+)/);
  return m ? m[1] : null;
}

function getActiveTabFromState(locationState, pathname) {
  if (locationState?.tab) return locationState.tab;
  if (pathname.includes('/cycles/')) return 'expenses';
  if (pathname.includes('/months/')) return 'capital';
  return 'capital';
}

export default function AppShell({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const dossierId = getDossierIdFromPath(location.pathname);
  const activeTab = getActiveTabFromState(location.state, location.pathname);

  // Read collapsed state from localStorage (mirrored from Sidebar)
  const collapsed = localStorage.getItem('ct-sidebar-collapsed') === 'true';

  function navToTab(tab) {
    if (dossierId) {
      navigate(`/dossiers/${dossierId}`, { state: { tab } });
    }
    setMobileOpen(false);
  }

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="mobile-drawer-overlay open"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Main column */}
      <div className={`app-shell-main${collapsed ? ' sidebar-collapsed' : ''}`}>
        <Navbar onHamburger={() => setMobileOpen((o) => !o)} />

        <main className="page-body">
          {children}
        </main>
      </div>

      {/* Mobile bottom nav (only on dossier routes) */}
      {dossierId && (
        <nav className="bottom-nav">
          {BOTTOM_NAV_TABS.map(item => (
            <button
              key={item.key}
              className={`bottom-nav-item${activeTab === item.key ? ' active' : ''}`}
              onClick={() => navToTab(item.key)}
            >
              <FontAwesomeIcon icon={item.icon} className="bottom-nav-item-icon" />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
