import type { Preview } from '@storybook/react-vite';
import { installChromeMock } from '../src/panel/stories/chromeMock';
import '../src/panel/index.css';

// The panel reads chrome the moment SidePanel mounts, so the stand-in has to be
// in place before any story renders — not from a decorator.
installChromeMock();

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    // index.css already paints the dark workbench on <body>; Storybook's own
    // background layer would sit on top of it.
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
    (Story) => (
      <div className="min-h-screen bg-canvas p-3 font-sans text-[13px] text-ink">
        <Story />
      </div>
    ),
  ],
};

export default preview;
