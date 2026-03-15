import { useState } from 'react';
import Sidebar from './Sidebar';
import Navbar from './Navbar';

export default function AppShell({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('ct-sidebar-collapsed') === 'true'
  );

  function handleCollapseChange(next) {
    setCollapsed(next);
    localStorage.setItem('ct-sidebar-collapsed', String(next));
  }

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <Sidebar
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        collapsed={collapsed}
        onCollapseChange={handleCollapseChange}
      />

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
    </div>
  );
}
