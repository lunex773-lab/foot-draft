import { useEffect, useRef, useState } from 'react';

/**
 * In-page confirm / prompt dialogs. The browser's own window.confirm and
 * window.prompt are blocked (they return false / null at once) in many phone
 * browsers inside apps and in home-screen apps, which made actions such as
 * GEMS distribution impossible there. Use these instead:
 *
 *   if (!(await confirmDialog('…'))) return;
 *   const reason = await promptDialog('…');   // null = cancelled
 */

interface Request {
  id: number;
  kind: 'confirm' | 'prompt';
  message: string;
  defaultValue: string;
  okLabel: string;
  danger: boolean;
  resolve: (v: boolean | string | null) => void;
}

let push: ((r: Request) => void) | null = null;
let seq = 0;

export function confirmDialog(message: string, opts: { okLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!push) return resolve(false);
    push({ id: ++seq, kind: 'confirm', message, defaultValue: '', okLabel: opts.okLabel ?? 'OK', danger: !!opts.danger, resolve: (v) => resolve(v === true) });
  });
}

export function promptDialog(message: string, defaultValue = '', opts: { okLabel?: string } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    if (!push) return resolve(null);
    push({ id: ++seq, kind: 'prompt', message, defaultValue, okLabel: opts.okLabel ?? 'OK', danger: false, resolve: (v) => resolve(typeof v === 'string' ? v : null) });
  });
}

/** mounted once at the root of the admin site */
export function DialogHost() {
  const [queue, setQueue] = useState<Request[]>([]);
  const [text, setText] = useState('');
  const okRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const current = queue[0] ?? null;

  useEffect(() => {
    push = (r) => setQueue((q) => [...q, r]);
    return () => {
      push = null;
    };
  }, []);

  useEffect(() => {
    if (!current) return;
    setText(current.defaultValue);
    // focus the field (prompt) or the OK button (confirm)
    setTimeout(() => (current.kind === 'prompt' ? inputRef.current?.focus() : okRef.current?.focus()), 0);
  }, [current]);

  if (!current) return null;
  const close = (v: boolean | string | null) => {
    current.resolve(v);
    setQueue((q) => q.slice(1));
  };
  return (
    <div className="dialog-bg" onClick={() => close(current.kind === 'prompt' ? null : false)}>
      <div
        className="dialog panel"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && close(current.kind === 'prompt' ? null : false)}
      >
        <div className="dialog-message">{current.message}</div>
        {current.kind === 'prompt' && <textarea ref={inputRef} rows={3} value={text} onChange={(e) => setText(e.target.value)} />}
        <div className="dialog-actions">
          <button className="btn" onClick={() => close(current.kind === 'prompt' ? null : false)}>
            キャンセル
          </button>
          <button ref={okRef} className={`btn ${current.danger ? 'danger' : 'primary'}`} onClick={() => close(current.kind === 'prompt' ? text : true)}>
            {current.okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
