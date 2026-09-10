import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { rules } from '../stories/fixtures';
import RuleList from './RuleList';

const meta = {
  title: 'Panel/RuleList',
  component: RuleList,
  args: { rules, onToggle: fn(), onDelete: fn(), onEdit: fn() },
} satisfies Meta<typeof RuleList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every badge at once: edits, delay, an error status, a scoped and inactive rule. */
export const Mixed: Story = {};
export const Empty: Story = { args: { rules: [] } };
export const SingleRule: Story = { args: { rules: rules.slice(0, 1) } };
