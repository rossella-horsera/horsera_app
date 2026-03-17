import { useNavigate, useLocation, Outlet } from 'react-router-dom';

const COLORS = {
  parchment: '#F5EFE6',
  cognac:    '#C17F4A',
  champagne: '#D4AF76',
  nk:        '#1C1C1E',
};

const TABS = [
  { label: 'Ride',        path: '/analysis',          icon: <svg width="11" height="11" viewBox="0 0 11 11"><polygon points="2,1 10,5.5 2,10" fill="currentColor"/></svg> },
  { label: 'Ride Report', path: '/analysis/report',   icon: <svg width="11" height="11" viewBox="0 0 11 11"><rect x="1" y="4" width="9" height="1.2" rx=".6" fill="currentColor"/><rect x="1" y="6.5" width="7" height="1.2" rx=".6" fill="currentColor"/><rect x="1" y="1.5" width="9" height="1.2" rx=".6" fill="currentColor"/></svg> },
  { label: 'Insights',    path: '/analysis/insights', icon: <svg width="11" height="11" viewBox="0 0 11 11"><polyline points="1,8 4,4.5 6.5,6 10,1.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg> },
];

export default function AnalysisShell() {
  const navigate  = useNavigate();
  const location  = useLocation();

  return (
    <div style={{ background: COLORS.parchment, minHeight: '100vh' }}>
      {/* ── Top tab bar ── */}
      <nav
        style={{
          position:     'sticky',
          top:          0,
          zIndex:       40,
          display:      'flex',
          background:   '#fff',
          borderBottom: '1px solid rgba(0,0,0,0.08)',
          height:       48,
        }}
      >
        {TABS.map((tab) => {
          const exact   = tab.path === '/analysis';
          const active  = exact
            ? location.pathname === '/analysis' || location.pathname === '/analysis/'
            : location.pathname.startsWith(tab.path);
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              style={{
                flex:            1,
                display:         'flex',
                alignItems:      'center',
                justifyContent:  'center',
                gap:             6,
                background:      'none',
                border:          'none',
                borderBottom:    active ? `2px solid ${COLORS.cognac}` : '2px solid transparent',
                color:           active ? COLORS.cognac : '#888',
                fontFamily:      "'Inter', -apple-system, sans-serif",
                fontSize:        11,
                fontWeight:      600,
                letterSpacing:   '0.9px',
                textTransform:   'uppercase',
                cursor:          'pointer',
                transition:      'all 0.18s',
                paddingBottom:   0,
              }}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* ── Screen content ── */}
      <Outlet />
    </div>
  );
}
