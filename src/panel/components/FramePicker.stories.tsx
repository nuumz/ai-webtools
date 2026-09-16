import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { frames } from '../stories/fixtures';
import FramePicker from './FramePicker';

const meta = {
  title: 'Panel/FramePicker',
  component: FramePicker,
  args: {
    frames,
    workingFrameId: 12,
    onSelect: fn(),
    onRefresh: fn(),
    onPick: fn(),
  },
} satisfies Meta<typeof FramePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A simulator in the tab, the app in a child frame, and an ad frame beside it. */
export const AppInAnIframe: Story = {};

/** Before a frame is chosen: every frame answers, which is what fills the wrong one. */
export const NothingChosen: Story = { args: { workingFrameId: undefined } };

/** The top frame is a legitimate choice — plenty of apps are not framed at all. */
export const TopFrameChosen: Story = { args: { workingFrameId: 0 } };

/** Nothing to choose between, so the card stays out of the way entirely. */
export const SingleFrame: Story = { args: { frames: frames.slice(0, 1) } };

export const Disabled: Story = { args: { busy: true } };
