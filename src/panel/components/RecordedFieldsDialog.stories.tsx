import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { recordedFields } from '../stories/fixtures';
import RecordedFieldsDialog from './RecordedFieldsDialog';

const meta = {
  title: 'Panel/RecordedFieldsDialog',
  component: RecordedFieldsDialog,
  args: { fields: recordedFields, includeSecrets: false, onToggleSecrets: fn(), onAdd: fn(), onCancel: fn() },
  // The dialog is `absolute inset-0`, so it needs a positioned box to fill.
  decorators: [
    (Story) => (
      <div className="relative h-[560px] overflow-hidden rounded-[var(--radius-lg)] border border-line bg-canvas">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RecordedFieldsDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** What "Record form" returns after filling a signup page by hand. */
export const Recorded: Story = {};

/** With secrets included, the card number comes along too. */
export const WithSecrets: Story = { args: { includeSecrets: true } };

export const NothingFound: Story = { args: { fields: [] } };
