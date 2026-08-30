/**
 * Live orderbook-style dashboard.
 *
 * Renders the book view from the read layer (/api/book/:address) as an
 * orderbook: bids below the active bin on the left, asks above on the right.
 * OrderFlow-owned bins are highlighted with their waiting amount + fees.
 */

import { useEffect, useState } from 'react';
import { api, BookView, fmtPrice, fmtUsd } from '../lib/api';

const DEFAULT_POOL = localStorage.getItem('orderflow.pool') ?? '';
const BIN_STEP = 100;

export function Dashboard() {
  const [pool, setPool] = useState(DEFAULT_POOL);
  const [book, setBook] = useState<BookView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    if (!pool.trim()) return;
    let live = true;
    api
      .book(pool.trim())
      .then((b) => { if (live) { setBook(b); setErr(null); localStorage.setItem('orderflow.pool', pool.trim()); } })
      .catch((e) => { if (live) setErr((e as Error).message); });
    return () => { live = false; };
  }, [pool, refresh]);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => setRefresh((r) => r + 1), 5000);
    return () => clearInterval(t);
  }, [auto]);

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <label>Pool address</label>
            <input
              value={pool}
              onChange={(e) => setPool(e.target.value)}
              placeholder="DLMM LbPair address"
            />
          </div>
          <button onClick={() => setRefresh((r) => r + 1)} style={{ marginTop: 18 }}>Refresh</button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 18 }}>
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} style={{ width: 'auto' }} />
            auto (5s)
          </label>
        </div>
        {err && <div className="neg" style={{ marginTop: 8 }}>⚠ {err}. Try a valid pool or start the API + keeper.</div>}
      </div>

      {book && (
        <>
          <PoolHeader book={book} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <SidePanel title="Bids (below active)" rows={book.bids} book={book} side="bid" />
            <SidePanel title="Asks (above active)" rows={book.asks} book={book} side="ask" />
          </div>
        </>
      )}
    </div>
  );
}

function PoolHeader({ book }: { book: BookView }) {
  const spread = book.asks[0] && book.bids[0] ? book.asks[0].price - book.bids[0].price : 0;
  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div>
          <b style={{ fontSize: 18 }}>{book.poolTokenSymbol} / {book.poolQuoteSymbol}</b>
          <div className="muted" style={{ fontSize: 12 }}>{book.pool}</div>
        </div>
        <Metric k="Active price" v={fmtPrice(book.activeBinPrice)} />
        <Metric k="Active bin" v={`#${book.activeBinId}`} />
        <Metric k="Best spread" v={fmtPrice(spread)} />
        <Metric k="Bin step" v={`${(book.binStep * 0.01).toFixed(2)}%`} />
      </div>
    </div>
  );
}

function Metric({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 11 }}>{k}</div>
      <div style={{ fontWeight: 600 }}>{v}</div>
    </div>
  );
}

function SidePanel({ title, rows, side }: { title: string; rows: BookView['bids' | 'asks']; book: BookView; side: 'bid' | 'ask' }) {
  const ours = rows.filter((r) => r.ours);
  const totalOurs = ours.reduce((a, r) => a + r.ourAmount, 0);
  const totalFees = ours.reduce((a, r) => a + r.ourFees, 0);
  const maxReserve = Math.max(1, ...rows.map((r) => r.baseReserve));
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
        <b>{title}</b>
        <span className="muted" style={{ fontSize: 12 }}>
          ours: {fmtUsd(totalOurs)} · fees {fmtUsd(totalFees)} ({ours.length} bins)
          {side === 'bid' ? <span className="pos"> ⬇</span> : <span className="neg"> ⬆</span>}
        </span>
      </div>
      <div style={{ maxHeight: 460, overflowY: 'auto' }}>
        {rows.length === 0 && <div className="muted" style={{ padding: 14 }}>No bins returned — the live pool may be empty or the API needs bin data.</div>}
        {rows.map((r) => (
          <div
            key={r.binId}
            style={{
              position: 'relative', display: 'flex', alignItems: 'center', gap: 8,
              padding: '4px 14px', fontSize: 13, borderBottom: '1px solid rgba(35,42,56,0.4)',
            }}
          >
            <div
              style={{
                position: 'absolute', inset: 0,
                width: `${Math.min(100, (r.baseReserve / maxReserve) * 100)}%`,
                background: side === 'bid' ? 'rgba(38,166,154,0.12)' : 'rgba(239,83,80,0.12)',
              }}
            />
            <span style={{ width: 90, position: 'relative', color: r.active ? 'var(--amber)' : undefined, fontWeight: r.active ? 700 : 500 }}>
              {fmtPrice(r.price)}
            </span>
            <span className="muted" style={{ width: 60, position: 'relative' }}>#{r.binId}</span>
            <span className="muted" style={{ flex: 1, position: 'relative' }}>{r.baseReserve.toFixed(2)}</span>
            {r.ours && (
              <span style={{ position: 'relative', color: 'var(--accent)', fontWeight: 600 }}>
                ● {fmtUsd(r.ourAmount)} / fees {r.ourFees.toFixed(4)}
              </span>
            )}
            {r.active && <span style={{ position: 'relative' }} className="amber">ACTIVE</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
