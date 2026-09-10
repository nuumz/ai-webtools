import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, waitFor, within } from 'storybook/test';
import { installChromeMock, type ChromeMockOptions } from './stories/chromeMock';
import SidePanel from './SidePanel';

/**
 * The whole panel, running against the fake `chrome` installed in
 * `.storybook/preview.tsx` — storage, the log port and the injected form agent
 * all answer, so these are the real screens rather than a mock-up of them.
 */
const meta = {
  title: 'Panel/SidePanel',
  component: SidePanel,
  parameters: { layout: 'fullscreen' },
  // The panel root is `h-screen`; the viewport gives it its side-panel shape.
  globals: { viewport: { value: 'sidePanel' } },
  decorators: [
    (Story) => (
      <div className="h-screen">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SidePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Re-installs the stand-in for one story, then puts the default back. */
const withChrome = (options: ChromeMockOptions) => () => {
  installChromeMock(options);
  return () => installChromeMock();
};

const openTab = (label: string): NonNullable<Story['play']> =>
  async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // TabBar renders a tablist, and the counts arrive from the fake port a tick
    // after mount, so match the label loosely and wait for it.
    const tab = () => canvas.getByRole('tab', { name: new RegExp(label) });
    await waitFor(tab);
    await userEvent.click(tab());
  };

/** Traffic from the active tab: what the extension saw, and what it served. */
export const NetworkTab: Story = { play: openTab('Network') };

/** Hand-written rules; the segmented switch flips to recorded stories. */
export const MocksTab: Story = { play: openTab('Mocks') };

/** Form profiles with their resolved values, ready for Alt+Shift+F. */
export const FillTab: Story = { play: openTab('Fill') };

/** Backup, cross-device sync and storage housekeeping — a sheet over the tabs. */
/** The Fill tab with a case chosen: values come from the case, selectors do not. */
export const FillTabWithCase: Story = {
  play: async (context) => {
    await openTab('Fill')(context);
    const canvas = within(context.canvasElement);
    await userEvent.selectOptions(canvas.getByLabelText('Active case'), 'cs_bulk');
  },
};

/** "Read the page" — the fields the agent found, before any are added. */
export const ReadThePage: Story = {
  play: async (context) => {
    await openTab('Fill')(context);
    const canvas = within(context.canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Read the page' }));
    await waitFor(() => canvas.getByRole('dialog', { name: 'Fields found on the page' }));
  },
};

export const SettingsTab: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Settings' }));
  },
};

/**
 * The tab the panel was opened for has gone away: the log stays readable, but
 * nothing can act on the page any more.
 */
export const PinnedTabClosed: Story = {
  beforeEach: withChrome({ tabClosed: true }),
  play: openTab('Network'),
};

/** Recording is per tab and starts off until you turn it on. */
export const NotRecording: Story = {
  beforeEach: withChrome({ recording: false, entries: [] }),
  play: openTab('Network'),
};

/**
 * Recording, but no content script runs in the tab — the case that reads as a
 * quiet app unless the panel says otherwise.
 */
export const PageNotConnected: Story = {
  beforeEach: withChrome({ pageConnected: false, entries: [] }),
  play: openTab('Network'),
};

/** A tab that went dark after recording: the rows stay, the warning is a banner. */
export const PageNotConnectedWithRows: Story = {
  beforeEach: withChrome({ pageConnected: false }),
  play: openTab('Network'),
};

/** A wider window: the log row keeps one line and the path column takes the slack. */
export const WideViewport: Story = {
  globals: { viewport: { value: 'sidePanelWide' } },
  play: openTab('Network'),
};
