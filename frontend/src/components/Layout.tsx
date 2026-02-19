import { Outlet, Link } from 'react-router-dom';

export default function Layout() {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <header
        style={{
          backgroundColor: '#1a237e',
          color: '#fff',
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Link to="/" style={{ color: '#fff', textDecoration: 'none' }}>
          <h1 style={{ margin: 0, fontSize: '1.4rem' }}>Keiba EV App</h1>
        </Link>
        <nav style={{ display: 'flex', gap: '20px' }}>
          <Link to="/" style={{ color: '#cfd8dc', textDecoration: 'none' }}>
            出走予定
          </Link>
          <Link to="/results" style={{ color: '#cfd8dc', textDecoration: 'none' }}>
            実績比較
          </Link>
        </nav>
      </header>
      <main style={{ maxWidth: '960px', margin: '0 auto', padding: '24px' }}>
        <Outlet />
      </main>
    </div>
  );
}
