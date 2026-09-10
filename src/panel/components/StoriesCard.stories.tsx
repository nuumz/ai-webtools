import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, userEvent, within } from 'storybook/test';
import { stories } from '../stories/fixtures';
import StoriesCard from './StoriesCard';

const meta = {
  title: 'Panel/StoriesCard',
  component: StoriesCard,
  args: { stories, onUpdate: fn(), onDelete: fn() },
} satisfies Meta<typeof StoriesCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Library: Story = {};

export const Empty: Story = { args: { stories: [] } };

/** Only one story recorded and it is answering 501 for anything it does not cover. */
export const StrictOnly: Story = { args: { stories: [{ ...stories[1], isActive: true }] } };

/** The per-story settings (match mode, strict pattern, replay timing) live behind the row. */
export const Expanded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getAllByRole('button', { name: 'Show options' })[0]);
  },
};
