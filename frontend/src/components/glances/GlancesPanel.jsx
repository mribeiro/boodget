import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import CapitalGlance from './CapitalGlance';
import CycleGlance from './CycleGlance';
import NextExpenseGlance from './NextExpenseGlance';
import GoalsGlance from './GoalsGlance';
import EmergencyFundGlance from './EmergencyFundGlance';

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
  const today = new Date();
  const navigate = useNavigate();

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

  const showEF = efStatus?.status === 'underfunded';

  return (
    <div className="glances-panel">
      <div className="glances-label">Glances</div>
      <div className={`glances-grid${showEF ? ' glances-grid--5' : ''}`}>
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
        />
        <EmergencyFundGlance
          efStatus={efStatus}
          onClick={() => onNavigate('emergency-fund')}
        />
      </div>
    </div>
  );
}
