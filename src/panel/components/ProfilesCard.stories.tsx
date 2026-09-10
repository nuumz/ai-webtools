import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { resolveProfile } from '../../shared/resolveProfile';
import { profiles } from '../stories/fixtures';
import ProfilesCard from './ProfilesCard';

// The preview column is whatever the real resolver produces, not hand-written
// strings — so a change to the expression engine shows up here.
const signup = resolveProfile(profiles[0], { counters: { user: 41 } });
const broken = resolveProfile(profiles[1]);

const meta = {
  title: 'Panel/ProfilesCard',
  component: ProfilesCard,
  args: {
    profiles,
    activeId: profiles[0].id,
    preview: signup.values,
    errors: signup.errors,
    onSelect: fn(),
    onChange: fn(),
    onCreate: fn(),
    onDuplicate: fn(),
    onDelete: fn(),
    onFill: fn(),
    onRecord: fn(),
    onPick: fn(),
  },
} satisfies Meta<typeof ProfilesCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Template, mirror and formula fields side by side, with their resolved values. */
export const Signup: Story = {};

export const Empty: Story = { args: { profiles: [], activeId: undefined, preview: {}, errors: [] } };

/** A profile with no fields yet — right after "New profile". */
export const NewProfile: Story = {
  args: { activeId: profiles[2].id, preview: {}, errors: [] },
};

/** Two formulas that reference each other are reported instead of looping. */
export const CircularReference: Story = {
  args: { activeId: profiles[1].id, preview: broken.values, errors: broken.errors },
};
