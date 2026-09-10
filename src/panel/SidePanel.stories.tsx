import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, waitFor, within } from 'storybook/test';
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

/** Recorded stories on top, hand-written rules below — rules always win. */
export const MocksTab: Story = { play: openTab('Mocks') };

/** Form profiles with their resolved values, ready for Alt+Shift+F. */
export const FillTab: Story = { play: openTab('Fill') };

/** Backup, cross-device sync and storage housekeeping. */
export const SettingsTab: Story = { play: openTab('Settings') };

/** A wider window, for checking how the two-line log rows reflow. */
export const WideViewport: Story = {
  globals: { viewport: { value: 'sidePanelWide' } },
  play: openTab('Network'),
};
