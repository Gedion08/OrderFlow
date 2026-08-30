import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import './styles.css';
import { Wizard } from './pages/Wizard';
import { Dashboard } from './pages/Dashboard';

function Layout() {
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
          borderBottom: '1px solid var(--border)',
          paddingBottom: 16,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 20 }}>
          <span style={{ color: 'var(--accent)' }}>⟶</span> OrderFlow
        </div>
        <nav style={{ display: 'flex', gap: 16 }}>
          <NavLink to="/">Launch</NavLink>
          <NavLink to="/dashboard">Dashboard</NavLink>
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<Wizard />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Layout />
    </BrowserRouter>
  </React.StrictMode>
);
