import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { bodies, exchanges, pendingExchange } from '../stories/fixtures';
import ExchangeDetail from './ExchangeDetail';

// Stable across renders: the component asks for bodies from an effect keyed on
// this identity, so a fresh function per render would loop.
const onLoadBody = fn();

const meta = {
  title: 'Panel/ExchangeDetail',
  component: ExchangeDetail,
  args: { exchange: exchanges[1], bodies: bodies.items, onLoadBody, onCreateRule: fn() },
  decorators: [
    (Story) => (
      <div className="panel-card overflow-hidden">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ExchangeDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Json: Story = {};

/** Before the body comes back from the worker. */
export const Loading: Story = { args: { bodies: undefined } };

/** The worker dropped the body when the tab navigated away. */
export const BodyGone: Story = { args: { bodies: bodies.missing } };

/** Secrets are masked in the page and bodies are capped at 64 KB. */
export const TruncatedAndRedacted: Story = {
  args: { exchange: exchanges[4], bodies: bodies.truncated },
};

/** A request with a query string offers to pin the full URL in the generated rule. */
export const WithQueryString: Story = {
  args: { exchange: exchanges[2], bodies: bodies.items },
};

/** Still waiting on the backend — no body to show yet. */
export const Pending: Story = {
  args: { exchange: pendingExchange(2600), bodies: bodies.missing },
};

/**
 * A body that is not JSON cannot be stubbed, and a truncated one is broken
 * JSON — both disable the button and say why rather than handing the app `{}`.
 */
export const NotJson: Story = {
  args: { exchange: exchanges[5], bodies: bodies.html },
};

export const FailedRequest: Story = {
  args: { exchange: exchanges[3], bodies: bodies.checkout },
};
