export type ThemeType = 'login' | 'account' | 'email';

export interface ThemeColors {
  primaryColor: string;
  backgroundColor: string;
  cardColor: string;
  textColor: string;
  labelColor: string;
  inputBorderColor: string;
  inputBgColor: string;
  mutedColor: string;
}

export interface ThemeTypeConfig {
  css: string[];
}

export interface ThemeDefinition {
  name: string;
  displayName: string;
  description: string;
  parent: string | null;
  colors: ThemeColors;
  types: Partial<Record<ThemeType, ThemeTypeConfig>>;
}

export interface ThemeInfo {
  name: string;
  displayName: string;
  description: string;
  colors: ThemeColors;
  /** Template warnings found when the theme was loaded (never errors). */
  warnings: string[];
}

export interface ResolvedTheme {
  primaryColor: string;
  primaryHoverColor: string;
  backgroundColor: string;
  cardColor: string;
  textColor: string;
  labelColor: string;
  inputBorderColor: string;
  inputBgColor: string;
  mutedColor: string;
  logoUrl: string;
  faviconUrl: string;
  appTitle: string;
  customCss: string;
  themeCssFiles: string[];
}
