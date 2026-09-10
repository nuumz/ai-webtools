import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import TabBar, { type TabId } from './TabBar';

const TABS: { id: TabId; label: string; count?: number }[] = [
  { id: 'network', label: 'Network', count: 7 },
  { id: 'mocks', label: 'Mocks', count: 4 },
  { id: 'fill', label: 'Fill', count: 3 },
];

const meta = {
  title: 'Panel/TabBar',
  component: TabBar,
  args: { tabs: TABS, active: 'network', onSelect: fn() },
} satisfies Meta<typeof TabBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Network: Story = {};
export const Mocks: Story = { args: { active: 'mocks' } };
export const Fill: Story = { args: { active: 'fill' } };
/** Counts are optional; a fresh install has nothing to count yet. */
export const NoCounts: Story = {
  args: { tabs: TABS.map(({ id, label }) => ({ id, label })) },
};
