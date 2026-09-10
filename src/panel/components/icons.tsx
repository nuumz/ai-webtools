/**
 * The panel's whole icon set — hand-drawn on a 16px grid, stroked with
 * currentColor so one glyph works on every surface and in both schemes.
 * Small enough to inline; no icon package, no emoji standing in for icons.
 */
import type { ReactNode } from 'react';

interface IconProps {
  className?: string;
}

function Svg({ children, className }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {children}
    </svg>
  );
}

export function IconRecord({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden className={className}>
      <circle cx="8" cy="8" r="4.5" fill="currentColor" />
    </svg>
  );
}

export function IconStop({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden className={className}>
      <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  );
}

export function IconSearch({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25 13.5 13.5" />
    </Svg>
  );
}

export function IconClear({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.6 8.2a1 1 0 0 0 1 .8h4.8a1 1 0 0 0 1-.8l.6-8.2" />
    </Svg>
  );
}

export function IconSettings({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="8" cy="8" r="2.25" />
      <path d="M8 1.75v1.6M8 12.65v1.6M2.58 4.88l1.39.8M12.03 10.32l1.39.8M2.58 11.12l1.39-.8M12.03 5.68l1.39-.8" />
    </Svg>
  );
}

export function IconChevron({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M5.5 3.5 10 8l-4.5 4.5" />
    </Svg>
  );
}

export function IconClose({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Svg>
  );
}

export function IconPlus({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8 3.25v9.5M3.25 8h9.5" />
    </Svg>
  );
}

export function IconChecklist({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M2.5 4.75 4 6.25l2.5-2.5M2.5 11.25 4 12.75l2.5-2.5M8.75 5h4.75M8.75 11.5h4.75" />
    </Svg>
  );
}

export function IconTarget({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="8" cy="8" r="5.25" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2" />
    </Svg>
  );
}

export function IconWand({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 13 10.5 5.5M11.75 2.25l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6.6-1.4Z" />
    </Svg>
  );
}
