import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import type { ActionScript } from '../../shared/actions';
import ControlCard from './ControlCard';

const script: ActionScript = {
  id: 'act-1',
  name: 'Dip chip → bypass',
  steps: [
    {
      id: 'step-1',
      label: 'Simulate read card',
      kind: 'click',
      selectors: [{ strategy: 'testid', value: 'simulate-read-card' }],
    },
    {
      id: 'step-2',
      label: 'Wait for the result panel',
      kind: 'waitFor',
      selectors: [{ strategy: 'label', value: 'Simulated ID card read' }],
      timeoutMs: 5000,
    },
    { id: 'step-3', label: 'Bypass authen', kind: 'click', selectors: [{ strategy: 'id', value: 'bypass' }] },
  ],
};

const meta = {
  title: 'Panel/ControlCard',
  component: ControlCard,
  args: {
    scripts: [script],
    activeId: script.id,
    outcomes: {},
    running: false,
    disabled: false,
    onSelect: fn(),
    onCreate: fn(),
    onChange: fn(),
    onDelete: fn(),
    onPickStep: fn(),
    onRun: fn(),
    onCall: fn(),
    onEval: fn(),
    onReplay: fn(),
  },
} satisfies Meta<typeof ControlCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A script pointed at the helper panel's own buttons, before it has been run. */
export const Ready: Story = {};

/** Nothing recorded yet — the state a user lands in the first time. */
export const NoScripts: Story = { args: { scripts: [], activeId: undefined } };

/**
 * A run that stopped halfway: the click landed, then the screen the next step
 * waits for never arrived. Each step carries its own verdict, because "the
 * script failed" does not say which button is wrong.
 */
export const StoppedMidway: Story = {
  args: {
    outcomes: {
      'step-1': { id: 'step-1', ok: true },
      'step-2': { id: 'step-2', ok: false, why: 'timeout' },
    },
  },
};

/** A selector that matches nothing — the step is simply pointed at the wrong element. */
export const StepNotFound: Story = {
  args: { outcomes: { 'step-1': { id: 'step-1', ok: false, why: 'missing' } } },
};

/** A call that answered: the value is shown as JSON with its `typeof` above it. */
export const CallAnswered: Story = {
  args: {
    called: { kind: 'value', value: { type: 'object', text: '{\n  "cisId": "3445617",\n  "state": "READY"\n}' } },
  },
};

/**
 * The page's own CSP refuses evaluated code. Hard to reach by hand — most pages
 * allow it — and the message has to name the call path as the way out.
 */
export const EvaluateBlockedByCsp: Story = {
  args: {
    called: {
      kind: 'error',
      message:
        "EvalError: call to Function() blocked by CSP — this page's CSP blocks evaluated code. Use a call path instead.",
    },
  },
};

/** A replay that came back, with the page's own cookies and wrappers applied. */
export const RequestSent: Story = {
  args: {
    replayed: {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: [['content-type', 'application/json']],
      body: '{"raw":"8f2c…"}',
      ms: 182,
      truncated: false,
    },
  },
};

/** The fetch never reached a server: no status to show, only the browser's reason. */
export const RequestFailed: Story = {
  args: {
    replayed: {
      ok: false,
      status: 0,
      statusText: '',
      headers: [],
      body: '',
      ms: 31,
      truncated: false,
      error: 'TypeError: Failed to fetch',
    },
  },
};

/** Mid-run: every button that would start a second run is out. */
export const Running: Story = { args: { running: true } };
