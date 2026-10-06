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

/**
 * A simulator in the tab, the app in a child frame, and an ad frame beside it.
 * The choice is already made, so the card is one line and the fields below get
 * the room — click the header to open the list again.
 */
export const AppInAnIframe: Story = {};

/**
 * Before a frame is chosen: every frame answers, which is what fills the wrong
 * one. That is the open decision, so this is the state the card opens itself in.
 */
export const NothingChosen: Story = { args: { workingFrameId: undefined } };

/** The top frame is a legitimate choice — plenty of apps are not framed at all. */
export const TopFrameChosen: Story = { args: { workingFrameId: 0 } };

/** Nothing to choose between, so the card stays out of the way entirely. */
export const SingleFrame: Story = { args: { frames: frames.slice(0, 1) } };

/**
 * The frame that was chosen is not in the list any more — an SPA swapped its
 * iframe, or Chrome parked the page. Every fill fails in this state, so the
 * folded card says so instead of naming a frame that answers nothing.
 */
export const ChosenFrameGone: Story = { args: { workingFrameId: 920 } };

export const Disabled: Story = { args: { busy: true } };
