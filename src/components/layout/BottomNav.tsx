import { useLocation, useNavigate } from 'react-router-dom';

const navItems = [
  {
    path: '/',
    label: 'Rides',
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        {/* Play/video icon — represents video analysis */}
        <rect
          x="3" y="4" width="18" height="16" rx="3"
          stroke={active ? '#8C5A3C' : '#C4B8AC'}
          strokeWidth="1.7"
          fill={active ? 'rgba(140,90,60,0.08)' : 'none'}
        />
        <path
          d="M10 8.5V15.5L16 12L10 8.5Z"
          fill={active ? '#8C5A3C' : '#C4B8AC'}
        />
      </svg>
    ),
  },
  {
    path: '/insights',
    label: 'Insights',
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path
          d="M4 18L8 12L12 15L16 8L20 11"
          stroke={active ? '#8C5A3C' : '#C4B8AC'}
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {active && (
          <path d="M4 18L8 12L12 15L16 8L20 11V18H4Z" fill="#8C5A3C" opacity="0.08" />
        )}
      </svg>
    ),
  },
  {
    path: '/journey',
    label: 'Journey',
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        {/* Path/road icon — represents the journey concept */}
        <path
          d="M12 3C12 3 5 10 5 15C5 18.87 8.13 22 12 22C15.87 22 19 18.87 19 15C19 10 12 3 12 3Z"
          stroke={active ? '#8C5A3C' : '#C4B8AC'}
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={active ? 'rgba(140,90,60,0.08)' : 'none'}
        />
        {/* Winding path inside */}
        <path
          d="M9.5 14C10.5 13 13.5 13 14.5 14"
          stroke={active ? '#8C5A3C' : '#C4B8AC'}
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <path
          d="M10 17C11 16 13 16 14 17"
          stroke={active ? '#8C5A3C' : '#C4B8AC'}
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <circle cx="12" cy="10.5" r="1.2" fill={active ? '#8C5A3C' : '#C4B8AC'} />
      </svg>
    ),
  },
  {
    path: '/analysis',
    label: 'Analysis',
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <polygon
          points="5,19 5,9 9,9 9,19"
          stroke={active ? '#8C5A3C' : '#C4B8AC'}
          strokeWidth="1.7"
          fill={active ? 'rgba(140,90,60,0.08)' : 'none'}
        />
        <polygon
          points="10,19 10,5 14,5 14,19"
          stroke={active ? '#8C5A3C' : '#C4B8AC'}
          strokeWidth="1.7"
          fill={active ? 'rgba(140,90,60,0.08)' : 'none'}
        />
        <polygon
          points="15,19 15,12 19,12 19,19"
          stroke={active ? '#8C5A3C' : '#C4B8AC'}
          strokeWidth="1.7"
          fill={active ? 'rgba(140,90,60,0.08)' : 'none'}
        />
      </svg>
    ),
  },
];

export default function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: '430px',
        height: '82px',
        background: 'rgba(250,247,243,0.95)',
        backdropFilter: 'blur(16px)',
        borderTop: '1px solid #EDE7DF',
        display: 'flex',
        alignItems: 'flex-start',
        paddingTop: '10px',
        zIndex: 50,
      }}
    >
      {navItems.map((item) => {
        // Rides tab is active for both / and /rides
        const active = item.path === '/'
          ? location.pathname === '/' || location.pathname === '/rides' || location.pathname.startsWith('/rides/')
          : item.path === '/analysis'
          ? location.pathname.startsWith('/analysis')
          : location.pathname === item.path;
        return (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '0',
            }}
          >
            <div style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {item.icon(active)}
            </div>
            <span
              style={{
                fontSize: '10px',
                fontWeight: active ? 600 : 500,
                color: active ? '#8C5A3C' : '#C4B8AC',
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
