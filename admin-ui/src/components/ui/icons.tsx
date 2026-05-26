/* eslint-disable react-refresh/only-export-components --
   Icon registry module: exports a namespace object of stateless SVG components,
   not Fast-Refresh-able page components. */
import type { SVGProps } from 'react';

/**
 * Idenplane icon set — ported from `new Design/Idenplane/src/icons.jsx`.
 *
 * Each icon is a 24×24 stroked SVG. Size defaults to 18px but is overridable
 * either with the `size` prop or, preferably, Tailwind sizing utilities
 * (`className="h-4 w-4"`) which win over the width/height attributes.
 * Icons are `aria-hidden` so they never pollute the accessible name of a
 * button or link that wraps them.
 */
export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'stroke'> {
  size?: number;
  strokeWidth?: number;
}

function makeIcon(paths: string | string[]) {
  const d = Array.isArray(paths) ? paths : [paths];
  function Icon({ size = 18, strokeWidth = 1.75, className, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={className}
        {...rest}
      >
        {d.map((p, i) => (
          <path key={i} d={p} />
        ))}
      </svg>
    );
  }
  return Icon;
}

export interface IpMarkProps extends SVGProps<SVGSVGElement> {
  size?: number;
  fg?: string;
  accent?: string;
}

/** The bracket logo mark: `[ ]` with an emerald slot. */
function IpMark({ size = 24, fg = 'currentColor', accent = '#10b981', className, ...rest }: IpMarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" aria-hidden="true" className={className} {...rest}>
      <rect width="96" height="96" rx="14" fill={fg} />
      <path d="M24 28h12v4H28v32h8v4H24V28zM60 28h12v40H60v-4h8V32h-8v-4z" fill="#fff" />
      <rect x="44" y="44" width="8" height="8" fill={accent} />
    </svg>
  );
}

export const Icons = {
  // Navigation
  Dashboard: makeIcon(['M3 13v6a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2Z', 'M13 5v6a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2Z', 'M13 19v-2a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2Z', 'M3 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z']),
  Realms: makeIcon(['M2 22h20', 'M3 22V8l9-6 9 6v14', 'M9 22V12h6v10', 'M9 6h.01', 'M15 6h.01', 'M9 10h.01', 'M15 10h.01']),
  Users: makeIcon(['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75']),
  Clients: makeIcon(['M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z', 'M3.27 6.96 12 12.01l8.73-5.05', 'M12 22.08V12']),
  Roles: makeIcon(['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10', 'm9 12 2 2 4-4']),
  Groups: makeIcon(['M7 21a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4', 'M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M21 11h-3a2 2 0 0 0-2 2', 'M3 11h3a2 2 0 0 1 2 2', 'M19 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4', 'M5 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4']),
  Sessions: makeIcon('M22 12h-4l-3 9L9 3l-3 9H2'),
  Events: makeIcon(['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M16 13H8', 'M16 17H8', 'M10 9H8']),
  Idp: makeIcon(['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', 'M3.6 9h16.8', 'M3.6 15h16.8', 'M11.5 3a17 17 0 0 0 0 18', 'M12.5 3a17 17 0 0 1 0 18']),
  Keys: makeIcon(['M21 2 19 4M15 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0z', 'm11 11 8-8M14 7l3 3M5 13l-4 4 3 3 4-4M9 17l3 3']),
  Settings: makeIcon(['M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z']),
  Build: makeIcon(['M12 20h9', 'M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z']),

  // Actions
  Plus: makeIcon(['M12 5v14', 'M5 12h14']),
  Search: makeIcon(['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'm21 21-4.35-4.35']),
  ChevronD: makeIcon('m6 9 6 6 6-6'),
  ChevronR: makeIcon('m9 18 6-6-6-6'),
  ChevronL: makeIcon('m15 18-6-6 6-6'),
  ChevronU: makeIcon('m18 15-6-6-6 6'),
  ArrowR: makeIcon(['M5 12h14', 'm12 5 7 7-7 7']),
  ArrowUR: makeIcon(['M7 17 17 7', 'M7 7h10v10']),
  Menu: makeIcon(['M4 6h16', 'M4 12h16', 'M4 18h16']),
  Logout: makeIcon(['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9']),
  Eye: makeIcon(['M2 12s4-8 10-8 10 8 10 8-4 8-10 8-10-8-10-8z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z']),
  EyeOff: makeIcon(['M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94', 'M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19', 'M14.12 14.12a3 3 0 1 1-4.24-4.24', 'M1 1l22 22']),
  Filter: makeIcon('M22 3H2l8 9.46V19l4 2v-8.54z'),
  More: makeIcon(['M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z', 'M19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z', 'M5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z']),
  Trash: makeIcon(['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M10 11v6', 'M14 11v6']),
  Copy: makeIcon(['M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2z', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1']),
  Download: makeIcon(['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3']),
  Refresh: makeIcon(['M3 12a9 9 0 0 1 15-6.7L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-15 6.7L3 16', 'M3 21v-5h5']),
  External: makeIcon(['M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6', 'M15 3h6v6', 'M10 14 21 3']),
  Pin: makeIcon(['M12 17v5', 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z']),

  // Status
  Check: makeIcon('m5 12 5 5L20 7'),
  CheckCircle: makeIcon(['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'm22 4-10 10.01-3-3']),
  X: makeIcon(['M18 6 6 18', 'm6 6 12 12']),
  XCircle: makeIcon(['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M15 9 9 15', 'M9 9l6 6']),
  Info: makeIcon(['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 16v-4', 'M12 8h.01']),
  Alert: makeIcon(['M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z', 'M12 9v4', 'M12 17h.01']),
  Shield: makeIcon('M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'),
  ShieldCheck: makeIcon(['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', 'm9 12 2 2 4-4']),
  Bell: makeIcon(['M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9', 'M13.73 21a2 2 0 0 1-3.46 0']),
  Help: makeIcon(['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 'M12 17h.01']),

  // Data
  Activity: makeIcon('M22 12h-4l-3 9L9 3l-3 9H2'),
  Trend: makeIcon(['M22 7 13.5 15.5 8.5 10.5 2 17', 'M16 7h6v6']),
  TrendDown: makeIcon(['M22 17 13.5 8.5 8.5 13.5 2 7', 'M16 17h6v-6']),
  Globe: makeIcon(['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', 'M3.6 9h16.8', 'M3.6 15h16.8', 'M11.5 3a17 17 0 0 0 0 18', 'M12.5 3a17 17 0 0 1 0 18']),
  Lock: makeIcon(['M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z', 'M7 11V7a5 5 0 0 1 10 0v4']),
  Unlock: makeIcon(['M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z', 'M7 11V7a5 5 0 0 1 9.9-1']),
  Sun: makeIcon(['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', 'M12 1v2', 'M12 21v2', 'M4.22 4.22l1.42 1.42', 'M18.36 18.36l1.42 1.42', 'M1 12h2', 'M21 12h2', 'M4.22 19.78l1.42-1.42', 'M18.36 5.64l1.42-1.42']),
  Moon: makeIcon('M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'),
  Terminal: makeIcon(['m4 17 6-6-6-6', 'M12 19h8']),
  Clock: makeIcon(['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2']),
  Server: makeIcon(['M2 5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5z', 'M2 16a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3z', 'M6 6h.01', 'M6 17h.01']),
  Database: makeIcon(['M12 8c4.97 0 9-1.79 9-4s-4.03-4-9-4-9 1.79-9 4 4.03 4 9 4z', 'M3 5v6c0 2.21 4.03 4 9 4s9-1.79 9-4V5', 'M3 12v7c0 2.21 4.03 4 9 4s9-1.79 9-4v-7']),
  Mail: makeIcon(['M22 6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6z', 'm22 6-10 7L2 6']),
  User: makeIcon(['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z']),
  Code: makeIcon(['m16 18 6-6-6-6', 'm8 6-6 6 6 6']),
  Zap: makeIcon('M13 2L3 14h9l-1 8 10-12h-9l1-8z'),
  Star: makeIcon('M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'),
  Fingerprint: makeIcon(['M6.6 17a18 18 0 0 0 .8-4.8', 'M12 7a4 4 0 0 1 4 4v1.5', 'M3 9a9 9 0 0 1 17.4-3.3', 'M3.6 13.5a8.4 8.4 0 0 1 .4-2.5', 'M21 13.5a18 18 0 0 1-3 8.5', 'M14 13a8 8 0 0 1-1 7', 'M10 21a14 14 0 0 0 1-7', 'M12 11v1']),

  // Brand
  IpMark,
};

export type IconComponent = (props: IconProps) => React.JSX.Element;
