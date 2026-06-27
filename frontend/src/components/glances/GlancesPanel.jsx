import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import CapitalGlance from './CapitalGlance';
import CycleGlance from './CycleGlance';
import NextExpenseGlance from './NextExpenseGlance';
import GoalsGlance from './GoalsGlance';

function cycleYearMonth(today, cycleStartDay) {
  const d = today.getDate();
  if (d >= cycleStartDay) {
    return { year: today.getFullYear(), month: today.getMonth() + 1 };
  }
  const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return { year: prev.getFullYear(), month: prev.getMonth() + 1 };
}

export default function GlancesPanel({ dossierId, months, onNavigate }) {
  const [settings, setSettings] = useState(null);
  const [cyclesList, setCyclesList] = useState([]);
  const [currentCycleDetail, setCurrentCycleDetail] = useState(null);
  const [goals, setGoals] = useState([]);
  const [efStatus, setEfStatus] = useState(null);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('glances-collapsed') === 'true'; } catch { return false; }
  });
  const today = new Date();
  const navigate = useNavigate();

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem('glances-collapsed', String(next)); } catch {}
      return next;
    });
  }

  useEffect(() => {
    Promise.all([
      api.getDossierSettings(dossierId),
      api.getCycles(dossierId),
      api.getGoals(dossierId),
      api.getEmergencyFundStatus(dossierId),
    ]).then(([s, c, g, ef]) => {
      setSettings(s);
      setCyclesList(c);
      setGoals(g);
      setEfStatus(ef);

      const cur = cycleYearMonth(today, s.cycle_start_day ?? 25);
      const curCycle = c.find((cy) => cy.year === cur.year && cy.month === cur.month);
      if (curCycle) {
        api.getCycle(dossierId, curCycle.id).then(setCurrentCycleDetail).catch(() => {});
      }
    }).catch(() => {});
  }, [dossierId]);

  if (!settings) return null;

  return (
    <div className="glances-panel">
      <button className="glances-label glances-label--toggle" onClick={toggleCollapsed}>
        Glances
        <FontAwesomeIcon
          icon={faChevronDown}
          className={`glances-chevron${collapsed ? ' glances-chevron--collapsed' : ''}`}
        />
      </button>
      <div className={`glances-grid-wrapper${collapsed ? ' glances-grid-wrapper--collapsed' : ''}`}>
      <div className="glances-grid">
        <CapitalGlance
          months={months}
          settings={settings}
          today={today}
          onClick={() => onNavigate('capital')}
        />
        <CycleGlance
          dossierId={dossierId}
          cyclesList={cyclesList}
          currentCycleDetail={currentCycleDetail}
          settings={settings}
          today={today}
          onClick={() => onNavigate('expenses')}
        />
        <NextExpenseGlance
          currentCycleDetail={currentCycleDetail}
          settings={settings}
          today={today}
          onClick={currentCycleDetail
            ? () => navigate(`/dossiers/${dossierId}/cycles/${currentCycleDetail.id}`)
            : () => onNavigate('expenses')}
          onMarkPaid={async (next) => {
            if (next.type === 'annual') {
              await api.updateAnnualPayment(dossierId, next.item.id, { paid: true });
            } else {
              await api.updateCycleItem(dossierId, currentCycleDetail.id, next.item.id, { paid: true });
            }
            const updated = await api.getCycle(dossierId, currentCycleDetail.id);
            setCurrentCycleDetail(updated);
          }}
        />
        <GoalsGlance
          goals={goals}
          onClick={() => onNavigate('goals')}
          efStatus={efStatus}
          onEfClick={() => onNavigate('emergency-fund')}
        />
      </div>
      </div>
    </div>
  );
}
