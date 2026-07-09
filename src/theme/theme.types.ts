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
  /** Optional heading text from the theme builder's first visible heading component. */
  customHeading: string;
  /** Optional subtitle shown under the heading on the login page. */
  loginSubtitle: string;
  /** Optional footer text shown at the bottom of the login card. */
  loginFooterText: string;
  /** When truthy, hides the corresponding optional login block. */
  hideRememberMe: string;
  hideForgotPassword: string;
  hideSocial: string;
  hideRegistration: string;
  themeCssFiles: string[];
}
