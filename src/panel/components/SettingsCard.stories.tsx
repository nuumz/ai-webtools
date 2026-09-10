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

/**
 * Raised for an app with large payloads: under the default limit those
 * responses come back truncated, and a truncated body cannot be stubbed.
 */
export const LargeBodyLimit: Story = {
  args: { settings: { ...settings, captureBodyLimit: 16 * 1024 * 1024 }, usageBytes: 148_000_000 },
};

export const Busy: Story = { args: { busy: 'Importing…' } };
