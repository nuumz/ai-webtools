import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { payloads, rules } from '../stories/fixtures';
import RuleForm, { type RuleDraft } from './RuleForm';

const meta = {
  title: 'Panel/RuleForm',
  component: RuleForm,
  args: { onSubmit: fn() },
} satisfies Meta<typeof RuleForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** What you get on a fresh install: a mutate-response rule waiting for a pattern. */
export const Blank: Story = {};

export const EditingStub: Story = { args: { editing: rules[1], onCancel: fn() } };

/**
 * Editing a rule that carries edits and a fault re-opens the advanced section
 * on its own, so those fields cannot be cleared by accident.
 */
export const EditingWithEditsAndFault: Story = {
  args: { editing: rules[0], onCancel: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Timing, failures and field edits/)).toBeInTheDocument();
  },
};

/** What "Stub this response" in the network log hands the form. */
export const PrefilledFromExchange: Story = {
  args: {
    initialDraft: {
      type: 'STUB',
      method: 'GET',
      urlPattern: '/api/items',
      status: 200,
      payload: payloads.items,
    } satisfies RuleDraft,
  },
};

export const AdvancedExpanded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText(/Timing, failures and field edits/));
  },
};

/** Bad JSON is reported instead of being saved. */
export const InvalidPayload: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const payload = canvasElement.querySelector('textarea');
    if (payload) {
      await userEvent.clear(payload);
      await userEvent.type(payload, '{{ not json');
    }
    await userEvent.click(canvas.getByRole('button', { name: /save rule/i }));
  },
};
