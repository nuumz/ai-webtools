import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, userEvent, within } from 'storybook/test';
import { exchanges, makeLog, pendingExchange, stories } from '../stories/fixtures';
import NetworkLogCard from './NetworkLogCard';

const meta = {
  title: 'Panel/NetworkLogCard',
  component: NetworkLogCard,
  args: {
    log: makeLog(),
    capturing: true,
    stories,
    onToggleCapture: fn(),
    onCreateRule: fn(),
    onSaveToStory: fn(() => Promise.resolve()),
  },
} satisfies Meta<typeof NetworkLogCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A mutated response, a delayed stub, a failed POST and a 304, all in one list. */
export const Recording: Story = {};

/** Rows only arrive while recording, so this is what you see first. */
export const Idle: Story = { args: { capturing: false, log: makeLog({ entries: [] }) } };

export const NothingYet: Story = { args: { log: makeLog({ entries: [] }) } };

/** The ring buffer evicts the oldest entries once a tab gets chatty. */
export const WithDroppedEntries: Story = { args: { log: makeLog({ dropped: 128 }) } };

export const Disconnected: Story = {
  args: { capturing: false, log: makeLog({ connected: false, entries: [], tabUrl: undefined }) },
};

/** Expanding a row shows the bodies and the one-click rule buttons. */
export const RowExpanded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('/api/items'));
  },
};

/** In select mode, rows a mock already served cannot be ticked — they would record the mock. */
export const SelectMode: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Select' }));
    const boxes = canvasElement.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    for (const box of boxes) if (!box.disabled) await userEvent.click(box);
  },
};

/**
 * A request still in flight: the status reads “…”, the duration bar pulses and
 * grows against the clock, and the row cannot be picked for a story yet.
 */
export const InFlight: Story = {
  args: { log: makeLog({ entries: [pendingExchange(), ...exchanges] }) },
};

/** A story-heavy setup: everything already replayed, nothing new to record. */
export const AllServedByMocks: Story = {
  args: { log: makeLog({ entries: exchanges.filter((entry) => entry.servedBy !== 'network') }) },
};
