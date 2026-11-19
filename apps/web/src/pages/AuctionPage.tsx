import { BID_REFUSAL_TEXT, MAX_CARD_LEVEL, RARITY_INFO, formatAuctionDuration, gemsForShortfall, type AuctionLotView, type BidRefusal, type Player } from '@fd/shared';
import { PlayerCard } from '@fd/ui';
import { useMemo, useState } from 'react';
import { useCatalog } from '../lib/catalog';
import { useAuction, type AuctionNotice } from '../lib/useAuction';
import { useNow } from '../lib/useNow';
import { useWallet } from '../lib/wallet';
import { sound } from '../sound/player';

/**
 * PLAYER AUCTION (decisions 97-106): one market for everyone, up to 8 cards at
 * a time, public ascending bids. Won cards go to the collection (+1 when owned).
 */
const fmt = (n: number) => n.toLocaleString('ja-JP');
/** the end in Japan time, e.g. 11/19 14:30 */
const endTime = (ms: number) => new Date(ms).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function errorText(code: string, message: string): string {
  if (code in BID_REFUSAL_TEXT) return BID_REFUSAL_TEXT[code as BidRefusal];
  if (code === 'RATE_LIMITED') return '入札が多すぎます。少し待ってからもう一度お試しください';
  if (code === 'INSUFFICIENT_FUNDS') return 'GEMS が足りません';
  return message || 'エラーが発生しました';
}

export default function AuctionPage() {
  const a = useAuction();
  const catalog = useCatalog();
  const { refresh: refreshWallet } = useWallet();
  const [open, setOpen] = useState<string | null>(null);
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [showRules, setShowRules] = useState(false);
  useNow(250);

  const selected = a.lots.find((l) => l.id === open) ?? null;
  const leading = a.lots.filter((l) => l.leaderIsYou);

  if (a.error && !a.state) return <div className="error">{a.error}</div>;
  if (!a.state || !catalog || !a.wallet) return <div className="muted">読み込み中…</div>;

  const rules = a.state.rules;
  return (
    <div className="auction">
      <div className="auction-head panel">
        <div className="auction-title">
          <h2>オークション</h2>
          <span className={`chip ${a.market?.open ? 'on' : ''}`}>{a.market?.open ? '開催中' : '停止中'}</span>
          {a.conn !== 'open' && <span className="chip warn">{a.conn === 'reconnecting' ? '再接続中…' : '接続中…'}</span>}
        </div>
        <div className="auction-funds">
          <div>
            <span className="tiny muted">使える資金</span>
            <b data-testid="auction-available">{fmt(a.wallet.available)}</b>
          </div>
          <div>
            <span className="tiny muted">入札中（仮押さえ）</span>
            <span>{fmt(a.wallet.held)}</span>
          </div>
          <button className="btn small" onClick={() => setExchangeOpen(true)}>
            GEMS から交換
          </button>
        </div>
        <div className="tiny muted">
          オークション専用のコインです。最初に {fmt(rules.initialFunds)} 。足りない時は GEMS から交換できます（1 GEMS = {rules.coinsPerGem} コイン）。
          <button className="link-btn" onClick={() => setShowRules((v) => !v)}>
            {showRules ? 'ルールを閉じる' : 'ルール'}
          </button>
        </div>
        {showRules && (
          <ul className="auction-rules small">
            <li>みんなで同じ選手を競り合います。終了時に最高額の人だけが支払い、選手を獲得します。</li>
            <li>入札するとその額は仮押さえされ、ほかの人に上回られるとすぐ戻ります。</li>
            <li>
              次の入札は今の最高額の {rules.minRaisePercent}% か {fmt(rules.minRaiseAmount)} の大きい方以上。最初の入札は開始価格（COMMON {fmt(rules.startPrice.common)}・RARE {fmt(rules.startPrice.rare)}・EPIC{' '}
              {fmt(rules.startPrice.epic)}・LEGENDARY {fmt(rules.startPrice.legendary)}・ICON {fmt(rules.startPrice.icon)}）以上。
            </li>
            <li>
              1人の出品は {formatAuctionDuration(rules.bidSeconds * 1000)}。終了前 {rules.extendWindowSeconds} 秒以内に入札があると {rules.extendSeconds} 秒延長。
            </li>
            <li>持っている選手を落札すると +1 強化（+5 の選手には入札できません）。入札の取り消しはできません。</li>
          </ul>
        )}
      </div>

      <Notices notices={a.notices} catalog={catalog} onDismiss={a.dismiss} />

      {a.lots.length === 0 ? (
        <div className="panel muted small">{a.market?.open ? '次の出品を準備しています…' : '現在オークションは停止中です。'}</div>
      ) : (
        <div className="auction-grid">
          {a.lots.map((l) => {
            const p = catalog.get(l.playerId);
            return p ? <LotCard key={l.id} lot={l} player={p} owned={a.state!.owned[l.playerId]} serverNow={a.serverNow} onOpen={() => setOpen(l.id)} /> : null;
          })}
        </div>
      )}

      {leading.length > 0 && (
        <div className="panel">
          <h3>最高額で入札中</h3>
          <div className="auction-list">
            {leading.map((l) => (
              <div key={l.id} className="auction-row">
                <span>{catalog.get(l.playerId)?.name ?? l.playerId}</span>
                <b>{fmt(l.currentPrice ?? 0)}</b>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <h3>落札した選手</h3>
        {a.state.wins.length === 0 && <div className="small muted">まだありません。</div>}
        <div className="auction-list">
          {a.state.wins.map((w) => (
            <div key={w.lotId} className="auction-row">
              <span>
                <span className={`rar-dot rar-${w.rarity}`} /> {catalog.get(w.playerId)?.name ?? w.playerId}
                <span className="tiny muted">　#{w.no}</span>
              </span>
              <span className="small">
                {fmt(w.price)}
                <span className="chip tiny">{w.outcome === 'new' ? 'NEW' : w.outcome === 'enhanced' ? `+${w.levelAfter}` : `交換pt +${w.points}`}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {selected && catalog.get(selected.playerId) && (
        <BidSheet
          lot={selected}
          player={catalog.get(selected.playerId)!}
          owned={a.state.owned[selected.playerId]}
          available={a.wallet.available}
          gemsTotal={a.state.gems.total}
          coinsPerGem={rules.coinsPerGem}
          serverNow={a.serverNow}
          onClose={() => setOpen(null)}
          onBid={async (amount, gems) => {
            if (gems > 0) {
              await a.exchange(gems);
              await refreshWallet().catch(() => undefined);
            }
            await a.bid(selected.id, amount);
          }}
        />
      )}
      {exchangeOpen && (
        <ExchangeSheet
          gemsTotal={a.state.gems.total}
          coinsPerGem={rules.coinsPerGem}
          onClose={() => setExchangeOpen(false)}
          onExchange={async (gems) => {
            await a.exchange(gems);
            await refreshWallet().catch(() => undefined);
          }}
        />
      )}
    </div>
  );
}

function LotCard({ lot, player, owned, serverNow, onOpen }: { lot: AuctionLotView; player: Player; owned: number | undefined; serverNow: () => number; onOpen: () => void }) {
  const total = Math.max(1, lot.endsAt - lot.listedAt);
  const left = Math.max(0, lot.endsAt - serverNow());
  const secs = Math.ceil(left / 1000);
  const maxed = owned !== undefined && owned >= MAX_CARD_LEVEL;
  return (
    <button className={`lot rar-${lot.rarity} ${lot.leaderIsYou ? 'mine' : ''} ${secs <= 60 ? 'ending' : ''}`} onClick={onOpen} aria-label={`${player.name} の入札`}>
      <PlayerCard player={player} width="100%" loading="eager" />
      <div className="lot-bar" aria-hidden="true">
        <span style={{ width: `${(left / total) * 100}%` }} />
      </div>
      <div className="lot-info">
        <div className="lot-price">
          <span className="tiny muted">{lot.currentPrice === null ? '開始' : '現在'}</span>
          <b>{fmt(lot.currentPrice ?? lot.minNextBid)}</b>
          <span className={`lot-time ${secs <= 60 ? 'low' : ''}`}>{formatAuctionDuration(left)}</span>
        </div>
        <div className="lot-leader tiny">{lot.leaderIsYou ? 'あなたが最高額' : lot.leaderName ? `${lot.leaderName}（${lot.bidCount}件）` : '入札なし'}</div>
        {owned !== undefined && <div className="lot-owned tiny">{maxed ? '+5 のため入札不可' : `所持 +${owned} → 落札で +${owned + 1}`}</div>}
      </div>
    </button>
  );
}

function BidSheet(props: {
  lot: AuctionLotView;
  player: Player;
  owned: number | undefined;
  available: number;
  gemsTotal: number;
  coinsPerGem: number;
  serverNow: () => number;
  onClose: () => void;
  onBid: (amount: number, gems: number) => Promise<void>;
}) {
  const { lot, player, owned, available, gemsTotal, coinsPerGem, serverNow, onClose, onBid } = props;
  const min = lot.minNextBid;
  const [amount, setAmount] = useState(min);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmGems, setConfirmGems] = useState<number | null>(null);
  const value = Math.max(amount, 0);
  const tooLow = value < min;
  const maxed = owned !== undefined && owned >= MAX_CARD_LEVEL;
  const left = Math.max(0, Math.ceil((lot.endsAt - serverNow()) / 1000));
  const gemsNeeded = gemsForShortfall(value, available, coinsPerGem);
  // the minimum moves up when someone else bids: follow it
  const steps = useMemo(() => {
    const up = (x: number) => Math.ceil(x / 100) * 100;
    return [...new Set([min, up(min * 1.05), up(min * 1.1), up(min * 1.2)])].filter((x) => x >= min).sort((x, y) => x - y);
  }, [min]);

  const submit = async (gems: number) => {
    setBusy(true);
    setMsg(null);
    try {
      await onBid(value, gems);
      sound.play('pick');
      setMsg({ ok: true, text: `${fmt(value)} で入札しました` });
      setConfirmGems(null);
    } catch (e) {
      const err = e as { code?: string; message: string };
      sound.play('error');
      setMsg({ ok: false, text: errorText(err.code ?? '', err.message) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-bg center" onClick={onClose}>
      <div className="modal panel bid-sheet" role="dialog" aria-modal="true" aria-label="入札" onClick={(e) => e.stopPropagation()}>
        <div className="bid-top">
          <PlayerCard player={player} width={130} />
          <div className="bid-facts">
            <div className="tiny muted">#{lot.no}・{RARITY_INFO[lot.rarity].label}</div>
            <b>{player.name}</b>
            <div className="small">
              {player.positions.join(' / ')}・OVR {player.ovr}
            </div>
            <div className="small">
              {lot.currentPrice === null ? '開始価格' : '現在の最高額'} <b>{fmt(lot.currentPrice ?? min)}</b>
            </div>
            <div className="small">{lot.leaderIsYou ? 'あなたが最高額です' : lot.leaderName ? `最高額：${lot.leaderName}` : 'まだ入札はありません'}</div>
            <div className={`small ${left <= 60 ? 'warn-text' : ''}`}>
              残り {formatAuctionDuration(lot.endsAt - serverNow())}（{endTime(lot.endsAt)} 終了）
            </div>
            {owned !== undefined && <div className="small">{maxed ? '+5 まで強化済み：入札できません' : `所持 +${owned} → 落札で +${owned + 1}`}</div>}
          </div>
        </div>
        {!lot.leaderIsYou && !maxed && left > 0 && (
          <>
            <label className="field">
              入札額（最低 {fmt(min)}）
              <input type="number" inputMode="numeric" min={min} step={100} value={amount} onChange={(e) => setAmount(Math.floor(Number(e.target.value) || 0))} aria-label="入札額" />
            </label>
            <div className="row bid-steps">
              {steps.map((s, i) => (
                <button key={i} type="button" className={`btn small ${value === s ? 'on' : ''}`} onClick={() => setAmount(s)}>
                  {fmt(s)}
                </button>
              ))}
            </div>
            <div className="tiny muted">
              使える資金 {fmt(available)}
              {gemsNeeded > 0 && `　足りない分は GEMS ${fmt(gemsNeeded)} で交換できます（所持 ${fmt(gemsTotal)}）`}
            </div>
          </>
        )}
        {msg && <div className={msg.ok ? 'small good-text' : 'error'}>{msg.text}</div>}
        {confirmGems !== null && (
          <div className="bid-confirm">
            <p className="small">
              足りない分のために GEMS {fmt(confirmGems)}（無償 → 有償の順）を {fmt(confirmGems * coinsPerGem)} コインに交換して入札します。GEMS には戻せません。
            </p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => setConfirmGems(null)} disabled={busy}>
                やめる
              </button>
              <button className="btn primary" data-sfx="none" onClick={() => submit(confirmGems)} disabled={busy}>
                交換して入札
              </button>
            </div>
          </div>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose}>
            閉じる
          </button>
          {!lot.leaderIsYou && !maxed && left > 0 && confirmGems === null && (
            <button
              className="btn primary"
              disabled={busy || tooLow || (gemsNeeded > 0 && gemsNeeded > gemsTotal)}
              data-sfx={gemsNeeded > 0 ? undefined : 'none'}
              onClick={() => (gemsNeeded > 0 ? setConfirmGems(gemsNeeded) : submit(0))}
            >
              {gemsNeeded > 0 ? (gemsNeeded > gemsTotal ? '資金が足りません' : 'GEMS を交換して入札') : `${fmt(value)} で入札`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ExchangeSheet({ gemsTotal, coinsPerGem, onClose, onExchange }: { gemsTotal: number; coinsPerGem: number; onClose: () => void; onExchange: (gems: number) => Promise<void> }) {
  const [gems, setGems] = useState(Math.min(100, gemsTotal));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const valid = Number.isInteger(gems) && gems >= 1 && gems <= gemsTotal;
  return (
    <div className="modal-bg center" onClick={onClose}>
      <div className="modal panel" style={{ maxWidth: 420 }} role="dialog" aria-modal="true" aria-label="GEMS から交換" onClick={(e) => e.stopPropagation()}>
        <h3>GEMS をオークション資金に交換</h3>
        <p className="small">
          1 GEMS = {coinsPerGem} コイン。無償 GEMS から先に使い、足りない分は有償 GEMS（配布 → 購入）を使います。交換したコインは GEMS には戻せません。
        </p>
        <label className="field">
          交換する GEMS（所持 {fmt(gemsTotal)}）
          <input type="number" inputMode="numeric" min={1} max={gemsTotal} value={gems} onChange={(e) => setGems(Math.floor(Number(e.target.value) || 0))} aria-label="交換する GEMS" />
        </label>
        <div className="small">→ {fmt(valid ? gems * coinsPerGem : 0)} コイン</div>
        {msg && <div className={msg.ok ? 'small good-text' : 'error'}>{msg.text}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose}>
            閉じる
          </button>
          <button
            className="btn primary"
            disabled={busy || !valid}
            onClick={async () => {
              setBusy(true);
              setMsg(null);
              try {
                await onExchange(gems);
                sound.play('coin');
                setMsg({ ok: true, text: `${fmt(gems * coinsPerGem)} コインに交換しました` });
              } catch (e) {
                const err = e as { code?: string; message: string };
                sound.play('error');
                setMsg({ ok: false, text: errorText(err.code ?? '', err.message) });
              } finally {
                setBusy(false);
              }
            }}
          >
            交換する
          </button>
        </div>
      </div>
    </div>
  );
}

function Notices({ notices, catalog, onDismiss }: { notices: AuctionNotice[]; catalog: Map<string, Player>; onDismiss: (at: number) => void }) {
  if (notices.length === 0) return null;
  return (
    <div className="auction-notices" aria-live="polite">
      {notices.map((n) => {
        const name = catalog.get(n.playerId)?.name ?? n.playerId;
        return (
          <button key={n.at} className={`auction-notice ${n.kind}`} onClick={() => onDismiss(n.at)}>
            {n.kind === 'outbid' && (
              <>
                上回られました：{name}（{fmt(n.price)}）
              </>
            )}
            {n.kind === 'won' && (
              <>
                落札しました！ {name}（{fmt(n.price)}）{n.levelAfter === 0 ? ' NEW' : n.levelAfter !== null ? ` +${n.levelAfter}` : ` 交換pt +${n.points}`}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
