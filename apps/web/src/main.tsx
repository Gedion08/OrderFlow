import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { Zap, BarChart3, Menu, X } from 'lucide-react';
import './styles.css';
import { Wizard } from './pages/Wizard';
import { Dashboard } from './pages/Dashboard';

function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* ── Top Navigation ── */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          background: 'rgba(10, 13, 19, 0.8)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: '0 auto',
            padding: '0 24px',
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {/* Logo */}
          <NavLink to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'var(--accent-gradient)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: 'var(--shadow-glow)',
              }}
            >
              <Zap size={18} color="#fff" fill="#fff" />
            </div>
            <span style={{ fontWeight: 700, fontSize: 18, color: 'var(--text)', letterSpacing: '-0.02em' }}>
              OrderFlow
            </span>
          </NavLink>

          {/* Desktop Nav */}
          <nav style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <DesktopNavLink to="/" label="Launch" active={location.pathname === '/'} />
            <DesktopNavLink to="/dashboard" label="Dashboard" active={location.pathname === '/dashboard'} />
          </nav>

          {/* Mobile Toggle */}
          <button
            className="btn"
            onClick={() => setMobileOpen(!mobileOpen)}
            style={{ display: 'none', padding: 8 }}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {/* Mobile Nav */}
        {mobileOpen && (
          <div
            style={{
              padding: '8px 24px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <MobileNavLink to="/" label="Launch" onClick={() => setMobileOpen(false)} />
            <MobileNavLink to="/dashboard" label="Dashboard" onClick={() => setMobileOpen(false)} />
          </div>
        )}
      </header>

      {/* ── Main Content ── */}
      <main style={{ flex: 1, maxWidth: 1200, margin: '0 auto', padding: '32px 24px', width: '100%' }}>
        <Routes>
          <Route path="/" element={<Wizard />} />
          <Route path="/dashboard" element={<Dashboard />} />
        </Routes>
      </main>

      {/* ── Footer ── */}
      <footer
        style={{
          borderTop: '1px solid var(--border)',
          padding: '20px 24px',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: 13,
        }}
      >
        OrderFlow — DCA & Limit Orders on{' '}
        <a href="https://www.meteora.ag" target="_blank" rel="noopener noreferrer">
          Meteora DLMM
        </a>
      </footer>
    </div>
  );
}

function DesktopNavLink({ to, label, active }: { to: string; label: string; active: boolean }) {
  return (
    <NavLink
      to={to}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 16px',
        borderRadius: 'var(--radius-sm)',
        fontSize: 14,
        fontWeight: 500,
        color: active ? 'var(--text)' : 'var(--text-secondary)',
        background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
        textDecoration: 'none',
        transition: 'all 0.2s ease',
      }}
    >
      {label}
    </NavLink>
  );
}

function MobileNavLink({ to, label, onClick }: { to: string; label: string; onClick: () => void }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      style={{
        display: 'block',
        padding: '12px 14px',
        borderRadius: 'var(--radius-sm)',
        fontSize: 15,
        fontWeight: 500,
        color: 'var(--text)',
        textDecoration: 'none',
        transition: 'background 0.2s ease',
      }}
    >
      {label}
    </NavLink>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Layout />
    </BrowserRouter>
  </React.StrictMode>
);
