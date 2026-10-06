import type { PageOutcome } from '../../inject/pageScript';
import { IconTarget } from './icons';

/**
 * Buttons wired to the app's own simulation entry points.
 *
 * The app exposes them on `window.__KESC_DEV__` when vConsole is enabled
 * (`src/vconsole/devBridge.ts` in e_app_webview). Everything the vConsole Dip
 * Chip panel does by hand — read a card, break one, skip authentication, take
 * the photo — is one call behind that object, so the panel can offer it as a
 * button instead of a three-click walk through someone else's UI.
 */
export const BRIDGE = '__KESC_DEV__';

export interface AppAction {
  id: string;
  label: string;
  /** Property path under the bridge object. */
  fn: string;
  /** Whether the call takes the CIS id. */
  needsCis: boolean;
  hint: string;
  danger?: boolean;
}

export const APP_ACTIONS: AppAction[] = [
  {
    id: 'read',
    label: 'Simulate read card',
    fn: 'simulateReadCard',
    needsCis: true,
    hint: 'Generates the card payload for this customer and fills the form as a real read would',
  },
  {
    id: 'broken',
    label: 'Broken card',
    fn: 'brokenCard',
    needsCis: false,
    hint: 'Feeds in an unreadable card',
    danger: true,
  },
  {
    id: 'bypass',
    label: 'Bypass authen',
    fn: 'bypassAuthen',
    needsCis: true,
    hint: 'Skips authentication, leaving the form as it is',
  },
  {
    id: 'photo',
    label: 'Take photo',
    fn: 'takePhoto',
    needsCis: false,
    hint: 'Feeds in the stock photo the take-photo endpoint serves',
  },
];

interface Props {
  cisId: string;
  /** undefined while unknown, 0 when the page has no bridge, otherwise its version. */
  bridgeVersion?: number;
  running?: string;
  answer?: PageOutcome;
  disabled: boolean;
  onChangeCis: (cisId: string) => void;
  onRun: (action: AppAction) => void;
  onCheckBridge: () => void;
}

export default function AppActionsCard({
  cisId,
  bridgeVersion,
  running,
  answer,
  disabled,
  onChangeCis,
  onRun,
  onCheckBridge,
}: Props) {
  const missing = bridgeVersion === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="toolbar">
        <input
          className="field field-sm field-mono min-w-0 flex-1"
          placeholder="CIS ID"
          value={cisId}
          onChange={(event) => onChangeCis(event.target.value)}
          aria-label="CIS ID"
        />
        <button className="btn btn-sm btn-secondary" onClick={onCheckBridge} disabled={disabled}>
          <IconTarget />
          Check app
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {missing && (
          <p className="note text-warn">
            This page exposes no <code>{BRIDGE}</code>. The app installs it when vConsole is enabled —
            check that the build is one with <code>VCONSOLE: ENABLE</code>, and that the working frame
            above is the app's own frame rather than the simulator around it.
          </p>
        )}
        {bridgeVersion === undefined && (
          <p className="note">Press “Check app” to see whether this frame can be driven.</p>
        )}
        {bridgeVersion !== undefined && bridgeVersion > 0 && (
          <p className="note">Connected to the app (bridge v{bridgeVersion}).</p>
        )}

        <div className="mt-3 flex flex-col gap-2">
          {APP_ACTIONS.map((action) => (
            <div key={action.id} className="card p-2">
              <div className="flex items-center gap-2">
                <button
                  className={`btn btn-sm ${action.danger ? 'btn-danger' : 'btn-primary'}`}
                  disabled={disabled || running !== undefined || (action.needsCis && cisId.trim() === '')}
                  onClick={() => onRun(action)}
                >
                  {running === action.id ? 'Running…' : action.label}
                </button>
                {action.needsCis && cisId.trim() === '' && (
                  <span className="chip chip-pending">needs a CIS ID</span>
                )}
              </div>
              <p className="note pt-1">{action.hint}</p>
            </div>
          ))}
        </div>

        {answer && <Answer outcome={answer} />}
      </div>
    </div>
  );
}

/**
 * What the app said back.
 *
 * `simulateReadCard` returns the generator's warnings, and they matter: a card
 * that generated with warnings fills the form with fields the real customer
 * record could not supply.
 */
function Answer({ outcome }: { outcome: PageOutcome }) {
  if (outcome.kind === 'missing') {
    return <p className="note pt-3 text-warn">The app has no such entry point ({outcome.path}).</p>;
  }
  if (outcome.kind === 'error') return <p className="note pt-3 text-bad">{outcome.message}</p>;
  const empty = outcome.value.text === 'undefined' || outcome.value.text === '{}';
  return (
    <div className="pt-3">
      <p className="eyebrow pb-1">{empty ? 'done' : 'the app answered'}</p>
      {!empty && <pre className="code-block max-h-40 overflow-auto">{outcome.value.text}</pre>}
    </div>
  );
}
