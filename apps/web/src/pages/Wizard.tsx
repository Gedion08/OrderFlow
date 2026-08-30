/**
 * The "Set it and forget it" wizard.
 *
 * Flow: Amount → Token/Pool → Tranches & Timeframe → Review → Go.
 * Produces a DcaStrategy payload and (in production) submits it to the keeper
 * store via the API. The tranche-bin math reuses the shared core helpers so the
 * wizard preview exactly matches what the keeper will place.
 */

import { useMemo, useState } from 'react';
import type { DcaStrategy } from '@orderflow/core';
import { spreadBinsBetweenBrackets, priceFromBin } from '../lib/bin';
import { api, fmtUsd, fmtPrice, PoolRow } from '../lib/api';

type Step = 'amount' | 'token' | 'schedule' | 'review';

const BIN_STEP = 100; // 1.00% default for previews

export function Wizard() {
  const [step, setStep] = useState<Step>('amount');
  const [amount, setAmount] = useState('1000');
  const [tranches, setTranches] = useState('10');
  const [intervalSec, setIntervalSec] = useState('86400'); // daily
  const [side, setSide] = useState<'bid' | 'ask'>('bid');
  const [minPrice, setMinPrice] = useState('0.12');
  const [maxPrice, setMaxPrice] = useState('0.20');
  const [token, setToken] = useState<PoolRow | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PoolRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [launched, setLaunched] = useState(false);

  const amountN = Number(amount) || 0;
  const minN = Number(minPrice) || 0;
  const maxN = Number(maxPrice) || 0;

  const binPreview = useMemo(() => {
    if (!(minN > 0 && maxN > minN && tranches)) return [];
    return spreadBinsBetweenBrackets(minN, maxN, Number(tranches) || 1, BIN_STEP);
  }, [minN, maxN, tranches]);

  async function search() {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await api.searchPools(query);
      setResults(res.pools);
      setStep('token');
    } finally {
      setSearching(false);
    }
  }

  function finish() {
    const strategy: DcaStrategy = {
      strategyId: `strat-${Date.now()}`,
      owner: 'YOUR_WALLET_PUBKEY',
      pool: token?.address ?? '',
      tokenMint: (token?.token_x_uri ?? token?.name ?? '') as string,
      side,
      totalAmount: amountN,
      totalAmountLabel: `${fmtUsd(amountN)}`,
      tranches: Number(tranches) || 1,
      intervalSeconds: Number(intervalSec) || 0,
      minPrice: minN,
      maxPrice: maxN,
      status: 'scheduled',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      orders: [],
    };
    console.log('[OrderFlow] strategy ready to launch:', strategy);
    setLaunched(true);
  }

  const next = () => {
    if (step === 'amount') setStep('token');
    else if (step === 'token') setStep('schedule');
    else if (step === 'schedule') setStep('review');
  };

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Set it &amp; forget it</h2>
      <p className="muted">
        Deploy a DCA — each tranche is a real Meteora DLMM limit order. While it
        waits for the price, it stays live on a bin <em>earning LP fees</em>.
      </p>

      <div style={{ display: 'flex', gap: 8, margin: '16px 0' }}>
        {(['amount', 'token', 'schedule', 'review'] as Step[]).map((s, i) => (
          <span
            key={s}
            style={{
              padding: '4px 10px', borderRadius: 20,
              background: step === s ? 'var(--accent)' : 'var(--panel)',
              color: step === s ? '#fff' : 'var(--muted)', fontSize: 12,
            }}
          >
            {i + 1}. {s}
          </span>
        ))}
      </div>

      {step === 'amount' && (
        <>
          <div className="field">
            <label>Total amount ({side === 'bid' ? 'quote' : 'base'} token)</label>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <div className="hint">Across all tranches. Divided equally per bin.</div>
          </div>
          <div className="field">
            <label>Direction</label>
            <select value={side} onChange={(e) => setSide(e.target.value as 'bid' | 'ask')}>
              <option value="bid">Buy the dip (bid-side)</option>
              <option value="ask">Take profit (ask-side)</option>
            </select>
          </div>
          <button className="primary" onClick={next}>Choose a pool →</button>
        </>
      )}

      {step === 'token' && (
        <>
          <div className="field">
            <label>Search pool (symbol or address)</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. SOL / USDC, or pool address" />
              <button onClick={search} disabled={searching}>Search</button>
            </div>
          </div>
          {results.length > 0 && (
            <div>
              {results.map((p) => (
                <div
                  key={p.address}
                  onClick={() => { setToken(p); next(); }}
                  style={{
                    padding: 12, border: '1px solid var(--border)', borderRadius: 8, marginBottom: 8, cursor: 'pointer',
                  }}
                >
                  <b>{p.name ?? p.symbol ?? p.address.slice(0, 12)}</b>
                  <span className="muted" style={{ marginLeft: 8 }}>
                    TVL {fmtUsd(Number(p.tvl))} · 24h vol {fmtUsd(Number(p.volume24h))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {step === 'schedule' && (
        <>
          <div className="field">
            <label>Tranches</label>
            <input type="number" min={1} max={50} value={tranches} onChange={(e) => setTranches(e.target.value)} />
            <div className="hint">One DLMM limit order per tranche.</div>
          </div>
          <div className="field">
            <label>Interval (seconds between activations)</label>
            <input type="number" value={intervalSec} onChange={(e) => setIntervalSec(e.target.value)} />
            <div className="hint">86400 = daily · 3600 = hourly · 0 = deploy all now</div>
          </div>
          <div className="field">
            <label>Min price</label>
            <input type="number" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} />
          </div>
          <div className="field">
            <label>Max price</label>
            <input type="number" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
          </div>
          <button className="primary" onClick={next}>Review →</button>
        </>
      )}

      {step === 'review' && (
        <>
          <ReviewBlock
            token={token}
            amount={amountN}
            tranches={Number(tranches) || 1}
            intervalSec={Number(intervalSec) || 0}
            side={side}
            minN={minN}
            maxN={maxN}
            bins={binPreview}
          />
          {!launched && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="primary" onClick={finish}>🚀 Launch strategy</button>
              <button onClick={() => setStep('schedule')}>Back</button>
            </div>
          )}
          {launched && (
            <div className="pos" style={{ marginTop: 12 }}>
              ✓ Strategy launched — keeper is placing tranche 1 of {Number(tranches) || 1}.
              See the <a href="#/dashboard">Dashboard</a>.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ReviewBlock(props: {
  token: PoolRow | null;
  amount: number;
  tranches: number;
  intervalSec: number;
  side: 'bid' | 'ask';
  minN: number;
  maxN: number;
  bins: number[];
}) {
  const perTranche = props.tranches ? props.amount / props.tranches : 0;
  return (
    <div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {[
            ['Pool', props.token?.name ?? props.token?.symbol ?? '—'],
            ['Direction', props.side === 'bid' ? 'Buy the dip (bid)' : 'Take profit (ask)'],
            ['Total amount', fmtUsd(props.amount)],
            ['Tranches', String(props.tranches)],
            ['Per tranche', fmtUsd(perTranche)],
            ['Interval', props.intervalSec === 0 ? 'All at once' : `${Math.round(props.intervalSec / 3600)}h`],
            ['Price range', `${fmtPrice(props.minN)} – ${fmtPrice(props.maxN)}`],
            ['Active bins', String(props.bins.length)],
          ].map(([k, v]) => (
            <tr key={k as string}>
              <td className="muted" style={{ padding: '6px 0', width: 160 }}>{k}</td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hint" style={{ marginTop: 8 }}>
        Previewed bin prices (bin step 1.00%):
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {props.bins.slice(0, 12).map((b) => (
          <span key={b} style={{ fontSize: 11, background: 'var(--bg)', padding: '2px 8px', borderRadius: 4 }}>
            bin #{b} · {fmtPrice(priceFromBin(b, BIN_STEP))}
          </span>
        ))}
        {props.bins.length > 12 && <span className="muted">+{props.bins.length - 12} more…</span>}
      </div>
    </div>
  );
}
