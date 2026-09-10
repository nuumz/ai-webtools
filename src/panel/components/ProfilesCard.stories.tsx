import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { resolveProfile } from '../../shared/resolveProfile';
import { formCases, profiles, screenElsewhere, screenOnStep } from '../stories/fixtures';
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
    cases: formCases,
    screen: screenOnStep,
    preview: signup.values,
    errors: signup.errors,
    onSelect: fn(),
    onSelectCase: fn(),
    onCreateCase: fn(),
    onChangeCase: fn(),
    onDeleteCase: fn(),
    onCheckScreen: fn(),
    onChangeScreen: fn(),
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

export const Empty: Story = {
  args: { profiles: [], activeId: undefined, cases: [], preview: {}, errors: [] },
};

/**
 * A case selected: values are edited on the case, and a field that takes the
 * profile's own value is read-only with the chip naming where it comes from.
 */
export const CaseSelected: Story = {
  args: { activeCaseId: formCases[0].id },
};

/** A case is one row of data; a blank value in it is deliberate, not missing. */
export const CaseWithBlank: Story = {
  args: { activeCaseId: formCases[1].id },
};

/** The tab is on a different step, so the panel names the screen that is showing. */
export const AnotherScreenShowing: Story = {
  args: { screen: screenElsewhere },
};

/** No signature: the profile fills whatever page is open. */
export const AnyScreen: Story = {
  args: { activeId: profiles[1].id, screen: undefined, preview: {}, errors: [] },
};

/** A profile with no fields yet — right after "New profile". */
export const NewProfile: Story = {
  args: { activeId: profiles[2].id, cases: [], preview: {}, errors: [] },
};

/** Two formulas that reference each other are reported instead of looping. */
export const CircularReference: Story = {
  args: { activeId: profiles[1].id, cases: [], preview: broken.values, errors: broken.errors },
};
