import type { Preview } from '@storybook/react-vite';
import { installChromeMock } from '../src/panel/stories/chromeMock';
import '../src/panel/index.css';

// The panel reads chrome the moment SidePanel mounts, so the stand-in has to be
// in place before any story renders — not from a decorator.
installChromeMock();

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    // index.css paints the panel on <body> and follows the OS scheme, so
    // Storybook's own background layer would sit on top of it. Flip the OS (or
    // DevTools' "Emulate prefers-color-scheme") to review the other one.
    backgrounds: { disable: true },
    viewport: {
      options: {
        // The panel root is `h-screen`, so the viewport is what gives it a
        // side-panel shape — a fixed-height wrapper would not contain it.
        sidePanel: { name: 'Side panel', styles: { width: '400px', height: '820px' } },
        sidePanelWide: { name: 'Side panel (wide)', styles: { width: '520px', height: '820px' } },
      },
    },
    controls: { expanded: true },
  },
  initialGlobals: { viewport: { value: 'sidePanel' } },
  decorators: [
    // The panel's cards are full-height flex columns, so the frame has to be one
    // too — a padded block wrapper would collapse every toolbar and scroll area.
    (Story) => (
      <div className="flex h-screen flex-col bg-canvas font-sans text-[12px] text-ink">
        <Story />
      </div>
    ),
  ],
};

export default preview;
