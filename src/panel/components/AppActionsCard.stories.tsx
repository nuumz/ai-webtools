import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import AppActionsCard from './AppActionsCard';

const meta = {
  title: 'Panel/AppActionsCard',
  component: AppActionsCard,
  args: {
    cisId: '23487',
    bridgeVersion: 1,
    disabled: false,
    onChangeCis: fn(),
    onRun: fn(),
    onCheckBridge: fn(),
  },
} satisfies Meta<typeof AppActionsCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The app is reachable and a customer is chosen: every button is live. */
export const Connected: Story = {};

/** Before anything has been checked — the panel does not claim either way. */
export const NotCheckedYet: Story = { args: { bridgeVersion: undefined } };

/**
 * The frame answered but carries no bridge: a production build, or the chosen
 * frame is the simulator shell rather than the app. Saying which two things to
 * check is the difference between a dead end and a fix.
 */
export const NoBridgeInThisFrame: Story = { args: { bridgeVersion: 0 } };

/** No customer yet: the two actions that need one say so rather than failing later. */
export const WithoutCisId: Story = { args: { cisId: '' } };

/** Mid-call, so a second press cannot stack two card reads. */
export const Running: Story = { args: { running: 'read' } };

/** The generator filled fields the customer record could not supply — worth reading. */
export const AnsweredWithWarnings: Story = {
  args: {
    answer: {
      kind: 'value',
      value: {
        type: 'object',
        text: '{\n  "warnings": [\n    "issueDate missing, defaulted",\n    "middleNameEn absent"\n  ]\n}',
      },
    },
  },
};

/** The call reached the app and the app threw — its own error, shown as it came. */
export const AppThrew: Story = {
  args: { answer: { kind: 'error', message: 'Error: Request failed (404)' } },
};

/** An entry point the installed build does not have — an older app than the panel. */
export const EntryPointMissing: Story = {
  args: { answer: { kind: 'missing', path: '__KESC_DEV__.takePhoto' } },
};
