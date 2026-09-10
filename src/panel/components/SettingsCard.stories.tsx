import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { settings, usageBytes } from '../stories/fixtures';
import SettingsCard from './SettingsCard';

const meta = {
  title: 'Panel/SettingsCard',
  component: SettingsCard,
  args: {
    settings,
    usageBytes,
    busy: null,
    onChange: fn(),
    onExport: fn(),
    onImport: fn(),
    onTrim: fn(),
    onCollectGarbage: fn(),
    onClose: fn(),
  },
} satisfies Meta<typeof SettingsCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Sync is off out of the box, and nothing has been stored yet. */
export const FreshInstall: Story = {
  args: { settings: { ...settings, syncEnabled: false }, usageBytes: 0 },
};

/** `chrome.storage.sync` caps items at 8 KB, so oversized records are reported, not silently dropped. */
export const SyncQuotaWarning: Story = {
  args: {
    settings: {
      ...settings,
      syncStatus: 'Synced 4 rules, 2 profiles — too large to sync: “Everything free and out of stock”',
    },
  },
};

export const Busy: Story = { args: { busy: 'Importing…' } };
