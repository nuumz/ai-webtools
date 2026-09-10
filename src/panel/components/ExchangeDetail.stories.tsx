import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, userEvent, within } from 'storybook/test';
import { bodies, exchanges, formCases, profiles } from '../stories/fixtures';
import ExchangeDetail from './ExchangeDetail';

// Stable across renders: the component asks for bodies from an effect keyed on
// this identity, so a fresh function per render would loop.
const onLoadBody = fn();

const meta = {
  title: 'Panel/ExchangeDetail',
  component: ExchangeDetail,
  args: {
    exchange: exchanges[1],
    bodies: bodies.items,
    profiles,
    cases: formCases,
    onLoadBody,
    onCreateRule: fn(),
    onSaveCase: fn(),
    onClose: fn(),
  },
  decorators: [
    (Story) => (
      <div className="card overflow-hidden">
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

export const FailedRequest: Story = {
  args: { exchange: exchanges[3], bodies: bodies.checkout },
};

/** Opens a tab in the detail pane's segmented control. */
const openView = (label: string): NonNullable<Story['play']> =>
  async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('tab', { name: label }));
  };

/**
 * A response the profile can be built from. The count is the headline because
 * picking the wrong exchange is the mistake this screen exists to catch.
 */
export const SaveAsCase: Story = {
  args: { bodies: bodies.customer },
  play: openView('Case'),
};

/** One field of eight: the shape of a wrong pick, and the panel says so. */
export const SaveAsCaseWrongResponse: Story = {
  args: { bodies: bodies.thin },
  play: openView('Case'),
};

/**
 * Saving twice from the same exchange never overwrites the first case, so the
 * name field opens already carrying the suffix rather than proposing a
 * duplicate the picker could not tell apart.
 */
export const SaveAsCaseNameTaken: Story = {
  args: {
    bodies: bodies.customer,
    cases: [...formCases, { id: 'cs_dup', profileId: profiles[0].id, name: 'GET /api/items', values: {} }],
  },
  play: openView('Case'),
};

/** Nothing to lift out of a response that is not JSON. */
export const SaveAsCaseNotJson: Story = {
  args: { bodies: { found: true, response: { text: '<html>', bytes: 6, truncated: false, redacted: false } } },
  play: openView('Case'),
};

/** A case has to belong to a profile, and there is none yet. */
export const SaveAsCaseNoProfiles: Story = {
  args: { bodies: bodies.customer, profiles: [] },
  play: openView('Case'),
};
