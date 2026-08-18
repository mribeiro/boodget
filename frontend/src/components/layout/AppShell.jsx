import { useState, useRef, useContext } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar, { isInDossierPath } from './Sidebar';
import Navbar from './Navbar';
import AiChatWidget from '../ai-advisor/AiChatWidget';
import { AppContext } from '../../App';

// Edge-swipe-to-open only fires in standalone (installed PWA) mode, where
// there's no browser chrome claiming the screen edge for swipe-back
// navigation. In an ordinary mobile browser tab it would fight that native
// gesture, so there we rely on the hamburger button instead.
const EDGE_ZONE_PX = 24;
const SWIPE_OPEN_THRESHOLD_PX = 60;
const MAX_VERTICAL_DRIFT_PX = 50;

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export default function AppShell({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('ct-sidebar-collapsed') === 'true'
  );
  const [chatOpen, setChatOpen] = useState(false);
  const [chatPinned, setChatPinned] = useState(
    () => localStorage.getItem('ct-chat-pinned') === 'true'
  );
  const swipeRef = useRef(null);

  const { currentDossier } = useContext(AppContext);
  const location = useLocation();
  // Same gate the sidebar uses for its own dossier-scoped nav — the chat widget is equally
  // dossier-scoped (ai_enabled, dossier context, etc. are all per-dossier), and hidden entirely
  // when the feature is off so there's no AI reference anywhere in the dossier UI.
  const chatAvailable = isInDossierPath(location.pathname) && !!currentDossier && currentDossier.ai_enabled !== 0;
  const chatPanelDocked = chatAvailable && chatOpen && chatPinned;

  function handleCollapseChange(next) {
    setCollapsed(next);
    localStorage.setItem('ct-sidebar-collapsed', String(next));
  }

  function handleChatPinnedChange(next) {
    setChatPinned(next);
    localStorage.setItem('ct-chat-pinned', String(next));
  }

  function handleTouchStart(e) {
    if (mobileOpen || !isStandalone() || window.matchMedia('(min-width: 768px)').matches) return;
    const touch = e.touches[0];
    if (touch.clientX > EDGE_ZONE_PX) return;
    swipeRef.current = { startX: touch.clientX, startY: touch.clientY };
  }

  function handleTouchMove(e) {
    if (!swipeRef.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - swipeRef.current.startX;
    const dy = touch.clientY - swipeRef.current.startY;
    if (Math.abs(dy) > MAX_VERTICAL_DRIFT_PX) {
      swipeRef.current = null;
      return;
    }
    if (dx > SWIPE_OPEN_THRESHOLD_PX) {
      setMobileOpen(true);
      swipeRef.current = null;
    }
  }

  function handleTouchEnd() {
    swipeRef.current = null;
  }

  return (
    <div
      className="app-shell"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
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
      <div className={`app-shell-main${collapsed ? ' sidebar-collapsed' : ''}${chatPanelDocked ? ' chat-pinned' : ''}`}>
        <Navbar onHamburger={() => setMobileOpen((o) => !o)} />

        <main className="page-body">
          {children}
        </main>
      </div>

      {chatAvailable && (
        <AiChatWidget
          dossier={currentDossier}
          open={chatOpen}
          onOpenChange={setChatOpen}
          pinned={chatPinned}
          onPinnedChange={handleChatPinnedChange}
        />
      )}
    </div>
  );
}
