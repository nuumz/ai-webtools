import type { StorybookConfig } from '@storybook/react-vite';

/**
 * The builder picks up the project's own `vite.config.ts`, so the React and
 * Tailwind plugins (and therefore the theme in `src/panel/index.css`) come for
 * free — stories render with exactly the pipeline the extension ships with.
 */
const config: StorybookConfig = {
  framework: { name: '@storybook/react-vite', options: {} },
  stories: ['../src/panel/**/*.stories.tsx'],
  addons: ['@storybook/addon-docs'],
  // No usage pings from CI.
  core: { disableTelemetry: true },
};

export default config;
