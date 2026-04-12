import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleCheck } from '@fortawesome/free-solid-svg-icons';

export default function Toast({ message, visible }) {
  return (
    <div style={{
      position: 'fixed',
      bottom: 32,
      right: 24,
      background: 'var(--color-success)',
      color: '#fff',
      padding: '10px 20px',
      borderRadius: 'var(--radius)',
      fontWeight: 700,
      fontSize: 13,
      opacity: visible ? 1 : 0,
      transform: `translateY(${visible ? 0 : 12}px)`,
      transition: 'all 0.35s cubic-bezier(.22,1,.36,1)',
      pointerEvents: 'none',
      zIndex: 500,
      boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
    }}>
      <FontAwesomeIcon icon={faCircleCheck} style={{ fontSize: 14 }} />
      {message}
    </div>
  );
}
