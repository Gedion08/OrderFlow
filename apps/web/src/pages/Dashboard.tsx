import { useEffect, useState } from 'react';
import {
  RefreshCw,
  Activity,
  TrendingUp,
  TrendingDown,
  Layers,
  Zap,
  ArrowDown,
  ArrowUp,
  AlertCircle,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { api, BookView, fmtPrice, fmtUsd } from '../lib/api';

const DEFAULT_POOL = localStorage.getItem('orderflow.pool') ?? '';

export function Dashboard() {
  const [pool, setPool] = useState(DEFAULT_POOL);
  const [book, setBook] = useState<BookView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [auto, setAuto] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!pool.trim()) return;
    let live = true;
    setLoading(true);
    api
      .book(pool.trim())
      .then((b) => {
        if (live) {
          setBook(b);
          setErr(null);
          localStorage.setItem('orderflow.pool', pool.trim());
        }
      })
      .catch((e) => {
        if (live) setErr((e as Error).message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => { live = false; };
  }, [pool, refresh]);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => setRefresh((r) => r + 1), 5000);
    return () => clearInterval(t);
  }, [auto]);

  return (
    <div className="animate-in">
      {/* ── Pool Input Bar ── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Layers size={13} /> Pool address
            </label>
            <input
              value={pool}
              onChange={(e) => setPool(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setRefresh((r) => r + 1)}
              placeholder="Paste DLMM LbPair address"
            />
          </div>
          <button
            className="btn"
            onClick={() => setRefresh((r) => r + 1)}
            style={{ padding: '12px 16px' }}
          >
            <RefreshCw size={15} className={loading ? 'spin' : ''} style={loading ? { animation: 'spin 0.6s linear infinite' } : {}} />
            Refresh
          </button>
          <button
            className={auto ? 'btn-primary' : 'btn'}
            onClick={() => setAuto(!auto)}
            style={{ padding: '12px 16px' }}
          >
            {auto ? <Wifi size={15} /> : <WifiOff size={15} />}
            {auto ? 'Live' : 'Paused'}
          </button>
        </div>
        {err && (
          <div
            className="animate-in"
            style={{
              marginTop: 12,
              padding: '12px 16px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--red-dim)',
              border: '1px solid rgba(239, 68, 68, 0.15)',
              color: 'var(--red)',
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <AlertCircle size={15} />
            {err}. Try a valid pool or start the API + keeper.
          </div>
        )}
      </div>

      {/* ── Book Content ── */}
      {book && (
        <div className="animate-slide-up">
          <PoolHeader book={book} />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
              gap: 16,
              marginTop: 16,
            }}
          >
            <SidePanel title="Bids" subtitle="Below active" rows={book.bids} side="bid" icon={<ArrowDown size={15} />} />
            <SidePanel title="Asks" subtitle="Above active" rows={book.asks} side="ask" icon={<ArrowUp size={15} />} />
          </div>
        </div>
      )}

      {/* ── Empty State ── */}
      {!book && !err && !loading && (
        <div
          style={{
            textAlign: 'center',
            padding: '80px 24px',
            color: 'var(--text-muted)',
          }}
        >
          <Activity size={40} style={{ opacity: 0.3, marginBottom: 16 }} />
          <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 6, color: 'var(--text-secondary)' }}>
            No pool loaded
          </div>
          <div style={{ fontSize: 13 }}>
            Enter a Meteora DLMM pool address above to view the live orderbook.
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Pool Header Stats ── */

function PoolHeader({ book }: { book: BookView }) {
  const spread = book.asks[0] && book.bids[0] ? book.asks[0].price - book.bids[0].price : 0;
  return (
    <div
      className="card"
      style={{
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Gradient accent strip */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: 'var(--accent-gradient)',
        }}
      />

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 20,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <Zap size={18} style={{ color: 'var(--accent-light)' }} />
            <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em' }}>
              {book.poolTokenSymbol}
              <span style={{ color: 'var(--text-muted)', fontWeight: 400, margin: '0 6px' }}>/</span>
              {book.poolQuoteSymbol}
            </h3>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            {book.pool.slice(0, 8)}...{book.pool.slice(-6)}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <StatCard label="Active Price" value={fmtPrice(book.activeBinPrice)} icon={<Activity size={14} />} />
          <StatCard label="Active Bin" value={`#${book.activeBinId}`} icon={<Layers size={14} />} accent />
          <StatCard label="Spread" value={fmtPrice(spread)} icon={<TrendingUp size={14} />} />
          <StatCard label="Bin Step" value={`${(book.binStep * 0.01).toFixed(2)}%`} icon={<Zap size={14} />} />
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div style={{ minWidth: 100 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          fontSize: 11,
          fontWeight: 500,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 4,
        }}
      >
        {icon} {label}
      </div>
      <div
        style={{
          fontWeight: 700,
          fontSize: 16,
          color: accent ? 'var(--accent-light)' : 'var(--text)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
    </div>
  );
}

/* ── Orderbook Side Panel ── */

function SidePanel({
  title,
  subtitle,
  rows,
  side,
  icon,
}: {
  title: string;
  subtitle: string;
  rows: BookView['bids' | 'asks'];
  side: 'bid' | 'ask';
  icon: React.ReactNode;
}) {
  const ours = rows.filter((r) => r.ours);
  const totalOurs = ours.reduce((a, r) => a + r.ourAmount, 0);
  const totalFees = ours.reduce((a, r) => a + r.ourFees, 0);
  const maxReserve = Math.max(1, ...rows.map((r) => r.baseReserve));
  const sideColor = side === 'bid' ? 'var(--green)' : 'var(--red)';
  const sideDim = side === 'bid' ? 'var(--green-dim)' : 'var(--red-dim)';
  const sideGlow = side === 'bid' ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)';

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* Panel header */}
      <div
        style={{
          padding: '16px 18px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: sideColor }}>{icon}</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{subtitle}</div>
          </div>
        </div>
        {ours.length > 0 && (
          <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
            <span>
              <span style={{ color: 'var(--text-muted)' }}>ours: </span>
              <span style={{ fontWeight: 600, color: 'var(--accent-light)' }}>{fmtUsd(totalOurs)}</span>
            </span>
            <span>
              <span style={{ color: 'var(--text-muted)' }}>fees: </span>
              <span style={{ fontWeight: 600, color: sideColor }}>{fmtUsd(totalFees)}</span>
            </span>
            <span className="badge" style={{ background: sideDim, color: sideColor }}>
              {ours.length} bins
            </span>
          </div>
        )}
      </div>

      {/* Bin rows */}
      <div style={{ maxHeight: 500, overflowY: 'auto' }}>
        {rows.length === 0 && (
          <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            No bins returned — the pool may be empty or the API needs bin data.
          </div>
        )}
        {rows.map((r) => (
          <div
            key={r.binId}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '8px 18px',
              fontSize: 13,
              borderBottom: '1px solid rgba(255,255,255,0.02)',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {/* Depth bar */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 0,
                width: `${Math.min(100, (r.baseReserve / maxReserve) * 100)}%`,
                background: side === 'bid'
                  ? 'linear-gradient(90deg, rgba(34,197,94,0.06) 0%, rgba(34,197,94,0.02) 100%)'
                  : 'linear-gradient(90deg, rgba(239,68,68,0.06) 0%, rgba(239,68,68,0.02) 100%)',
                transition: 'width 0.3s ease',
              }}
            />

            {/* Active bin glow */}
            {r.active && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'var(--amber-dim)',
                  borderLeft: '3px solid var(--amber)',
                }}
              />
            )}

            {/* Our order indicator */}
            {r.ours && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderLeft: `3px solid var(--accent)`,
                  background: 'var(--accent-glow)',
                  opacity: 0.3,
                }}
              />
            )}

            {/* Content */}
            <span
              style={{
                width: 100,
                position: 'relative',
                fontWeight: r.active ? 700 : 500,
                color: r.active ? 'var(--amber)' : 'var(--text)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {fmtPrice(r.price)}
            </span>
            <span style={{ width: 65, position: 'relative', color: 'var(--text-muted)', fontSize: 12 }}>
              #{r.binId}
            </span>
            <span style={{ flex: 1, position: 'relative', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
              {r.baseReserve.toFixed(2)}
            </span>
            {r.ours && (
              <span
                style={{
                  position: 'relative',
                  color: 'var(--accent-light)',
                  fontWeight: 600,
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Zap size={12} />
                {fmtUsd(r.ourAmount)}
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                  / {r.ourFees.toFixed(4)} fees
                </span>
              </span>
            )}
            {r.active && (
              <span className="badge badge-amber" style={{ position: 'relative', fontSize: 10, padding: '2px 8px' }}>
                <Activity size={10} /> ACTIVE
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
