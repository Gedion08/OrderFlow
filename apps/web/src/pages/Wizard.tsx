import { useMemo, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import {
  ArrowRight,
  ArrowLeftRight,
  Search,
  Layers,
  BarChart3,
  Check,
  Rocket,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Clock,
  Hash,
  ChevronRight,
  CircleDot,
  Wallet,
} from 'lucide-react';
import { spreadBinsBetweenBrackets, priceFromBin } from '../lib/bin';
import { api, fmtUsd, fmtPrice, PoolRow } from '../lib/api';

type Step = 'amount' | 'token' | 'schedule' | 'review';

const BIN_STEP = 100;

const STEPS: { key: Step; label: string }[] = [
  { key: 'amount', label: 'Amount' },
  { key: 'token', label: 'Pool' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'review', label: 'Review' },
];

export function Wizard() {
  const { publicKey, connected } = useWallet();
  const [step, setStep] = useState<Step>('amount');
  const [amount, setAmount] = useState('1000');
  const [tranches, setTranches] = useState('10');
  const [intervalSec, setIntervalSec] = useState('86400');
  const [side, setSide] = useState<'bid' | 'ask'>('bid');
  const [minPrice, setMinPrice] = useState('0.12');
  const [maxPrice, setMaxPrice] = useState('0.20');
  const [token, setToken] = useState<PoolRow | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PoolRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [launched, setLaunched] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchErr, setLaunchErr] = useState<string | null>(null);

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

  async function finish() {
    if (!connected || !publicKey) return;
    setLaunching(true);
    setLaunchErr(null);
    try {
      await api.createStrategy({
        owner: publicKey.toBase58(),
        pool: token?.address ?? '',
        tokenMint: (token?.token_x_uri ?? token?.name ?? '') as string,
        side,
        totalAmount: amountN,
        totalAmountLabel: `${fmtUsd(amountN)}`,
        tranches: Number(tranches) || 1,
        intervalSeconds: Number(intervalSec) || 0,
        minPrice: minN,
        maxPrice: maxN,
      });
      console.log('[OrderFlow] strategy submitted to keeper for execution');
      setLaunched(true);
    } catch (e) {
      setLaunchErr((e as Error).message);
    } finally {
      setLaunching(false);
    }
  }

  const next = () => {
    if (step === 'amount') setStep('token');
    else if (step === 'token') setStep('schedule');
    else if (step === 'schedule') setStep('review');
  };

  const stepIdx = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="animate-in" style={{ maxWidth: 720, margin: '0 auto' }}>
      {/* ── Step Progress ── */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 32, gap: 0 }}>
        {STEPS.map((s, i) => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  fontWeight: 600,
                  transition: 'all 0.3s ease',
                  background: i < stepIdx
                    ? 'var(--accent)'
                    : i === stepIdx
                      ? 'var(--accent-gradient)'
                      : 'var(--surface-alt)',
                  color: i <= stepIdx ? '#fff' : 'var(--text-muted)',
                  border: i > stepIdx ? '1px solid var(--border)' : 'none',
                  boxShadow: i === stepIdx ? 'var(--shadow-glow)' : 'none',
                }}
              >
                {i < stepIdx ? <Check size={14} /> : i + 1}
              </div>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: i <= stepIdx ? 'var(--text)' : 'var(--text-muted)',
                }}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{ flex: 1, height: 1, background: 'var(--border)', margin: '0 16px' }} />
            )}
          </div>
        ))}
      </div>

      {/* ── Step Content ── */}
      <div className="card animate-in" key={step}>
        <h2 style={{ marginTop: 0, marginBottom: 6, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
          {step === 'amount' && 'Set your investment'}
          {step === 'token' && 'Choose a pool'}
          {step === 'schedule' && 'Configure tranches'}
          {step === 'review' && 'Review & launch'}
        </h2>
        <p className="muted" style={{ marginTop: 0, marginBottom: 28, fontSize: 14, lineHeight: 1.6 }}>
          {step === 'amount' &&
            'Each tranche becomes a live Meteora DLMM limit order — earning LP fees while it waits for your price.'}
          {step === 'token' && 'Search for a trading pair on Meteora DLMM to deploy your strategy against.'}
          {step === 'schedule' &&
            'Split your order across multiple bins for better average entry. Each bin is an independent on-chain limit order.'}
          {step === 'review' && 'Double-check everything before launching your strategy on-chain.'}
        </p>

        {/* ── Amount Step ── */}
        {step === 'amount' && (
          <div className="animate-in stagger">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <DollarSign size={14} />
                Total amount ({side === 'bid' ? 'quote' : 'base'} token)
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="1000"
                style={{ fontSize: 18, fontWeight: 600, padding: '14px 16px' }}
              />
              <div className="hint">Across all tranches. Divided equally per bin.</div>
            </div>

            <div style={{ marginTop: 20 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <ArrowLeftRight size={14} />
                Direction
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <SideButton
                  active={side === 'bid'}
                  onClick={() => setSide('bid')}
                  icon={<TrendingDown size={16} />}
                  label="Buy the dip"
                  sub="bid-side"
                  color="var(--green)"
                  bgActive="var(--green-dim)"
                />
                <SideButton
                  active={side === 'ask'}
                  onClick={() => setSide('ask')}
                  icon={<TrendingUp size={16} />}
                  label="Take profit"
                  sub="ask-side"
                  color="var(--red)"
                  bgActive="var(--red-dim)"
                />
              </div>
            </div>

            <div style={{ marginTop: 28 }}>
              <button className="btn-primary btn-lg" onClick={next} style={{ width: '100%' }}>
                Choose a pool <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ── Token Step ── */}
        {step === 'token' && (
          <div className="animate-in stagger">
            <div className="field">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Search size={14} />
                Search pool
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && search()}
                  placeholder="e.g. SOL / USDC, or paste a pool address"
                  style={{ flex: 1 }}
                />
                <button className="btn" onClick={search} disabled={searching} style={{ minWidth: 100 }}>
                  {searching ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 14, height: 14, border: '2px solid var(--text-muted)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.6s linear infinite', display: 'inline-block' }} />
                      Searching
                    </span>
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Search size={14} /> Search
                    </span>
                  )}
                </button>
              </div>
            </div>

            {results.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} className="stagger">
                {results.map((p) => (
                  <PoolCard
                    key={p.address}
                    pool={p}
                    onClick={() => {
                      setToken(p);
                      next();
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Schedule Step ── */}
        {step === 'schedule' && (
          <div className="animate-in stagger">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Layers size={14} />
                  Tranches
                </label>
                <input type="number" min={1} max={50} value={tranches} onChange={(e) => setTranches(e.target.value)} />
                <div className="hint">One DLMM limit order per tranche.</div>
              </div>
              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Clock size={14} />
                  Interval (seconds)
                </label>
                <input type="number" value={intervalSec} onChange={(e) => setIntervalSec(e.target.value)} />
                <div className="hint">86400 = daily · 3600 = hourly · 0 = all now</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <BarChart3 size={14} />
                  Min price
                </label>
                <input type="number" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} placeholder="0.12" />
              </div>
              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <BarChart3 size={14} />
                  Max price
                </label>
                <input type="number" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="0.20" />
              </div>
            </div>

            <div style={{ marginTop: 4 }}>
              <button className="btn-primary btn-lg" onClick={next} style={{ width: '100%' }}>
                Review strategy <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ── Review Step ── */}
        {step === 'review' && (
          <div className="animate-in">
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 24 }}>
                {!connected ? (
                  <div
                    style={{
                      padding: 20,
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--surface-alt)',
                      border: '1px solid var(--border)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 14,
                      textAlign: 'center',
                    }}
                  >
                    <Wallet size={28} style={{ color: 'var(--accent-light)' }} />
                    <div>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>Connect your wallet</div>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                        You need to connect a Solana wallet before launching a strategy.
                      </div>
                    </div>
                    <WalletMultiButton />
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button className="btn-primary btn-lg" onClick={finish} disabled={launching} style={{ flex: 1 }}>
                        <Rocket size={16} /> {launching ? 'Launching…' : 'Launch strategy'}
                      </button>
                      <button className="btn btn-lg" onClick={() => setStep('schedule')} disabled={launching}>
                        <ArrowLeftRight size={16} style={{ transform: 'rotate(180deg)' }} /> Back
                      </button>
                    </div>
                    {launchErr && (
                      <div style={{ fontSize: 13, color: 'var(--red)' }}>{launchErr}</div>
                    )}
                  </div>
                )}
              </div>
            )}
            {launched && (
              <div
                className="animate-in"
                style={{
                  marginTop: 20,
                  padding: 20,
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--green-dim)',
                  border: '1px solid rgba(34, 197, 94, 0.2)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                }}
              >
                <CircleDot size={20} style={{ color: 'var(--green)', marginTop: 2, flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--green)', marginBottom: 4 }}>
                    Strategy launched
                  </div>
                  <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                    Keeper is placing tranche 1 of {Number(tranches) || 1}.{' '}
                    <a href="/dashboard">View Dashboard →</a>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function SideButton({
  active,
  onClick,
  icon,
  label,
  sub,
  color,
  bgActive,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  sub: string;
  color: string;
  bgActive: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '16px',
        borderRadius: 'var(--radius-md)',
        border: `1.5px solid ${active ? color : 'var(--border)'}`,
        background: active ? bgActive : 'var(--bg-raised)',
        color: active ? color : 'var(--text-secondary)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 6,
        transition: 'all 0.2s ease',
        flex: 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}>
        {icon} {label}
      </div>
      <span style={{ fontSize: 12, opacity: 0.7 }}>{sub}</span>
    </button>
  );
}

function PoolCard({ pool, onClick }: { pool: PoolRow; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 18px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border)',
        background: 'var(--bg-raised)',
        textAlign: 'left',
        width: '100%',
        transition: 'all 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--accent)';
        e.currentTarget.style.background = 'var(--surface-alt)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.background = 'var(--bg-raised)';
      }}
    >
      <div>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>
          {pool.name ?? pool.symbol ?? pool.address.slice(0, 12)}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {pool.address.slice(0, 6)}...{pool.address.slice(-4)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>TVL</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{fmtUsd(Number(pool.tvl))}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>24h Vol</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{fmtUsd(Number(pool.volume24h))}</div>
        </div>
        <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} />
      </div>
    </button>
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
  const rows: { icon: React.ReactNode; label: string; value: string; color?: string }[] = [
    { icon: <Layers size={15} />, label: 'Pool', value: props.token?.name ?? props.token?.symbol ?? '—' },
    {
      icon: props.side === 'bid' ? <TrendingDown size={15} /> : <TrendingUp size={15} />,
      label: 'Direction',
      value: props.side === 'bid' ? 'Buy the dip (bid)' : 'Take profit (ask)',
      color: props.side === 'bid' ? 'var(--green)' : 'var(--red)',
    },
    { icon: <DollarSign size={15} />, label: 'Total amount', value: fmtUsd(props.amount) },
    { icon: <Hash size={15} />, label: 'Tranches', value: `${props.tranches} (${fmtUsd(perTranche)} each)` },
    {
      icon: <Clock size={15} />,
      label: 'Interval',
      value: props.intervalSec === 0 ? 'All at once' : `${Math.round(props.intervalSec / 3600)}h`,
    },
    { icon: <BarChart3 size={15} />, label: 'Price range', value: `${fmtPrice(props.minN)} — ${fmtPrice(props.maxN)}` },
    { icon: <CircleDot size={15} />, label: 'Active bins', value: String(props.bins.length) },
  ];

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }} className="stagger">
        {rows.map((r) => (
          <div
            key={r.label}
            className="animate-in"
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '12px 14px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-raised)',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', width: 150, fontSize: 13 }}>
              {r.icon} {r.label}
            </span>
            <span style={{ fontWeight: 600, fontSize: 14, color: r.color ?? 'var(--text)' }}>{r.value}</span>
          </div>
        ))}
      </div>

      {props.bins.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
            Bin preview (step 1.00%):
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {props.bins.slice(0, 12).map((b) => (
              <span
                key={b}
                style={{
                  fontSize: 12,
                  fontFamily: 'var(--font)',
                  background: 'var(--surface-alt)',
                  border: '1px solid var(--border)',
                  padding: '4px 10px',
                  borderRadius: 20,
                  color: 'var(--text-secondary)',
                }}
              >
                #{b} · {fmtPrice(priceFromBin(b, BIN_STEP))}
              </span>
            ))}
            {props.bins.length > 12 && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
                +{props.bins.length - 12} more
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
