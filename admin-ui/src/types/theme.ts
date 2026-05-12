/**
 * Theme Builder Type Definitions
 *
 * TypeScript types for the visual theme builder feature, including:
 * - Theme configuration and versioning
 * - Draggable component definitions
 * - CSS variable/style customization
 * - Asset management for logos and images
 */

// ─── Theme Core Types ─────────────────────────────────────────────────────

export type ThemeType = 'login' | 'account' | 'email' | 'full';
export type ThemeStatus = 'draft' | 'published' | 'archived';

export interface Theme {
  id: string;
  realmId: string;
  name: string;
  description: string | null;
  themeType: ThemeType;
  isBuiltIn: boolean;
  isActive: boolean;
  styles: ThemeStyles;
  components: ThemeComponent[];
  assets: ThemeAssets;
  settings: ThemeSettings;
  version: number;
  status: ThemeStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface ThemeVersion {
  id: string;
  themeId: string;
  version: number;
  changes: string | null;
  checksum: string | null;
  styles: ThemeStyles;
  components: ThemeComponent[];
  assets: ThemeAssets;
  settings: ThemeSettings;
  createdAt: string;
  createdBy: string | null;
}

// ─── Theme Styles ─────────────────────────────────────────────────────────

export interface ThemeStyles {
  colors: ThemeColors;
  typography: ThemeTypography;
  spacing: ThemeSpacing;
  borders: ThemeBorders;
  shadows: ThemeShadows;
  customCss?: string;
}

export interface ThemeColors {
  primaryColor: string;
  primaryHoverColor: string;
  primaryActiveColor: string;
  secondaryColor: string;
  backgroundColor: string;
  cardColor: string;
  surfaceColor: string;
  textColor: string;
  textSecondaryColor: string;
  borderColor: string;
  errorColor: string;
  warningColor: string;
  successColor: string;
  infoColor: string;
}

export interface ThemeTypography {
  fontFamily: string;
  fontFamilyFallback: string;
  fontSizeBase: string;
  fontSizeSmall: string;
  fontSizeLarge: string;
  fontWeightNormal: number;
  fontWeightMedium: number;
  fontWeightBold: number;
  lineHeight: string;
  letterSpacing: string;
}

export interface ThemeSpacing {
  spacingUnit: string;
  spacingXs: string;
  spacingSm: string;
  spacingMd: string;
  spacingLg: string;
  spacingXl: string;
  spacing2xl: string;
  spacing3xl: string;
  borderRadius: string;
  borderRadiusSm: string;
  borderRadiusLg: string;
  borderRadiusFull: string;
}

export interface ThemeBorders {
  borderWidth: string;
  borderStyle: string;
  borderColor: string;
  borderWidthFocus: string;
  borderColorFocus: string;
  borderWidthError: string;
  borderColorError: string;
}

export interface ThemeShadows {
  shadowSm: string;
  shadow: string;
  shadowMd: string;
  shadowLg: string;
  shadowXl: string;
  shadowFocus: string;
  shadowCard: string;
}

// ─── Theme Components ─────────────────────────────────────────────────────

export type ComponentType =
  | 'header'
  | 'logo'
  | 'footer'
  | 'form'
  | 'input'
  | 'passwordInput'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'button'
  | 'link'
  | 'alert'
  | 'card'
  | 'divider'
  | 'spacer'
  | 'text'
  | 'heading'
  | 'image'
  | 'socialButton'
  | 'rememberMe'
  | 'forgotPassword'
  | 'registrationLink';

export interface ThemeComponent {
  id: string;
  type: ComponentType;
  label: string;
  order: number;
  visible: boolean;
  props: Record<string, unknown>;
  styles?: Record<string, string>;
}

export interface ThemeComponentStyle {
  id: string;
  componentId: string;
  property: string;
  value: string;
  modifiedAt: string;
}

// ─── Theme Component Props ─────────────────────────────────────────────────

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type InputType = 'text' | 'email' | 'tel' | 'url' | 'number';
export type AlertType = 'error' | 'warning' | 'success' | 'info';
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type TextAlignment = 'left' | 'center' | 'right';
export type LogoSize = 'small' | 'medium' | 'large' | 'custom';
export type LogoAlignment = 'left' | 'center' | 'right';

export interface ButtonProps {
  label: string;
  variant: ButtonVariant;
  fullWidth: boolean;
  disabled: boolean;
  type?: 'button' | 'submit' | 'reset';
  iconLeft?: string;
  iconRight?: string;
}

export interface InputProps {
  label: string;
  placeholder: string;
  required: boolean;
  autocomplete?: string;
  type: InputType;
  name?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

export interface PasswordInputProps {
  label: string;
  placeholder: string;
  required: boolean;
  showForgotPassword: boolean;
  showVisibilityToggle: boolean;
  minLength?: number;
  maxLength?: number;
}

export interface HeaderProps {
  title: string;
  subtitle?: string;
  showLogo: boolean;
}

export interface LogoProps {
  url?: string;
  alt: string;
  size: LogoSize;
  customWidth?: number;
  alignment: LogoAlignment;
}

export interface FooterProps {
  showPrivacyPolicy: boolean;
  showTermsOfService: boolean;
  customText?: string;
}

export interface AlertProps {
  type: AlertType;
  message: string;
  dismissible: boolean;
  icon?: string;
}

export interface FormProps {
  showUsername: boolean;
  showEmail: boolean;
  showFirstName: boolean;
  showLastName: boolean;
  showPassword: boolean;
}

export interface SelectProps {
  label: string;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  required: boolean;
  multiSelect: boolean;
}

export interface CheckboxProps {
  label: string;
  checked: boolean;
  required: boolean;
  name?: string;
}

export interface RadioProps {
  label: string;
  options: Array<{ value: string; label: string }>;
  name: string;
  required: boolean;
}

export interface LinkProps {
  text: string;
  href: string;
  newTab: boolean;
  alignment: TextAlignment;
}

export interface CardProps {
  padding: 'none' | 'small' | 'medium' | 'large';
  shadow: 'none' | 'sm' | 'md' | 'lg';
  bordered: boolean;
}

export interface SpacerProps {
  height: number;
}

export interface TextProps {
  content: string;
  alignment: TextAlignment;
}

export interface HeadingProps {
  content: string;
  level: HeadingLevel;
  alignment: TextAlignment;
}

export interface ImageProps {
  url: string;
  alt: string;
  width?: number;
  height?: number;
  objectFit?: 'cover' | 'contain' | 'fill';
}

export interface SocialButtonProps {
  providers: Array<{ id: string; name: string; icon?: string }>;
  layout: 'vertical' | 'horizontal';
}

export interface RememberMeProps {
  alignment: TextAlignment;
}

export interface ForgotPasswordProps {
  alignment: TextAlignment;
}

export interface RegistrationLinkProps {
  text: string;
  alignment: TextAlignment;
}

export interface DividerProps {
  label?: string;
  margin: 'none' | 'small' | 'medium' | 'large';
}

// ─── Component Props Union ────────────────────────────────────────────────

export type ComponentProps =
  | ButtonProps
  | InputProps
  | PasswordInputProps
  | HeaderProps
  | LogoProps
  | FooterProps
  | AlertProps
  | FormProps
  | SelectProps
  | CheckboxProps
  | RadioProps
  | LinkProps
  | CardProps
  | SpacerProps
  | TextProps
  | HeadingProps
  | ImageProps
  | SocialButtonProps
  | RememberMeProps
  | ForgotPasswordProps
  | RegistrationLinkProps
  | DividerProps;

// ─── Component Style Presets ───────────────────────────────────────────────

export interface ComponentStylePreset {
  id: string;
  name: string;
  type: ComponentType;
  styles: Record<string, string>;
}

// ─── Component Definition with Props ──────────────────────────────────────

export interface ComponentDefinition {
  type: ComponentType;
  label: string;
  icon: string;
  description: string;
  defaultProps: Partial<ComponentProps>;
  allowedProps: string[];
  styles?: ComponentStyleDefinition[];
}

export interface ComponentStyleDefinition {
  property: string;
  label: string;
  type: 'color' | 'text' | 'select' | 'number' | 'boolean';
  defaultValue?: string | number | boolean;
  options?: Array<{ value: string; label: string }>;
  unit?: string;
  min?: number;
  max?: number;
}

// ─── Theme Assets ──────────────────────────────────────────────────────────

export interface ThemeAssets {
  logoUrl: string | null;
  logoAlt: string | null;
  faviconUrl: string | null;
  backgroundImageUrl: string | null;
  backgroundImageOpacity: number;
  socialLogoUrls: Record<string, string>;
}

export interface UploadedAsset {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
}

// ─── Theme Settings ───────────────────────────────────────────────────────

export interface ThemeSettings {
  appTitle: string;
  appDescription: string;
  showRememberMe: boolean;
  showForgotPassword: boolean;
  showRegistrationLink: boolean;
  showSocialProviders: boolean;
  defaultCountryCode: string;
  privacyPolicyUrl: string | null;
  termsOfServiceUrl: string | null;
  customFooterText: string | null;
  recaptchaEnabled: boolean;
  recaptchaSiteKey: string | null;
}

// ─── Theme Templates ──────────────────────────────────────────────────────

export interface ThemeTemplate {
  id: string;
  name: string;
  description: string;
  previewImage: string;
  themeType: ThemeType;
  styles: ThemeStyles;
  components: ThemeComponent[];
  assets: Partial<ThemeAssets>;
  settings: Partial<ThemeSettings>;
}

// ─── Default Values ────────────────────────────────────────────────────────

export const DEFAULT_THEME_STYLES: ThemeStyles = {
  colors: {
    primaryColor: '#2563eb',
    primaryHoverColor: '#1d4ed8',
    primaryActiveColor: '#1e40af',
    secondaryColor: '#64748b',
    backgroundColor: '#f8fafc',
    cardColor: '#ffffff',
    surfaceColor: '#f1f5f9',
    textColor: '#1e293b',
    textSecondaryColor: '#64748b',
    borderColor: '#e2e8f0',
    errorColor: '#dc2626',
    warningColor: '#f59e0b',
    successColor: '#16a34a',
    infoColor: '#0ea5e9',
  },
  typography: {
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    fontFamilyFallback: 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
    fontSizeBase: '16px',
    fontSizeSmall: '14px',
    fontSizeLarge: '18px',
    fontWeightNormal: 400,
    fontWeightMedium: 500,
    fontWeightBold: 700,
    lineHeight: '1.5',
    letterSpacing: '0',
  },
  spacing: {
    spacingUnit: '4px',
    spacingXs: '4px',
    spacingSm: '8px',
    spacingMd: '16px',
    spacingLg: '24px',
    spacingXl: '32px',
    spacing2xl: '48px',
    spacing3xl: '64px',
    borderRadius: '6px',
    borderRadiusSm: '4px',
    borderRadiusLg: '8px',
    borderRadiusFull: '9999px',
  },
  borders: {
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderWidthFocus: '2px',
    borderColorFocus: '#2563eb',
    borderWidthError: '2px',
    borderColorError: '#dc2626',
  },
  shadows: {
    shadowSm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    shadow: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
    shadowMd: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
    shadowLg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    shadowXl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
    shadowFocus: '0 0 0 3px rgba(37, 99, 235, 0.2)',
    shadowCard: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  },
  customCss: '',
};

export const DEFAULT_THEME_COMPONENTS: ThemeComponent[] = [
  {
    id: 'header-1',
    type: 'header',
    label: 'Header',
    order: 0,
    visible: true,
    props: {},
  },
  {
    id: 'logo-1',
    type: 'logo',
    label: 'Logo',
    order: 1,
    visible: true,
    props: { size: 'medium', alignment: 'center' },
  },
  {
    id: 'form-1',
    type: 'form',
    label: 'Login Form',
    order: 2,
    visible: true,
    props: { showUsername: true, showEmail: false },
  },
  {
    id: 'remember-me-1',
    type: 'rememberMe',
    label: 'Remember Me',
    order: 3,
    visible: true,
    props: {},
  },
  {
    id: 'forgot-password-1',
    type: 'forgotPassword',
    label: 'Forgot Password Link',
    order: 4,
    visible: true,
    props: {},
  },
  {
    id: 'registration-1',
    type: 'registrationLink',
    label: 'Registration Link',
    order: 5,
    visible: true,
    props: {},
  },
  {
    id: 'social-1',
    type: 'socialButton',
    label: 'Social Login',
    order: 6,
    visible: true,
    props: { providers: [] },
  },
  {
    id: 'footer-1',
    type: 'footer',
    label: 'Footer',
    order: 7,
    visible: true,
    props: {},
  },
];

export const DEFAULT_THEME_ASSETS: ThemeAssets = {
  logoUrl: null,
  logoAlt: null,
  faviconUrl: null,
  backgroundImageUrl: null,
  backgroundImageOpacity: 1,
  socialLogoUrls: {},
};

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  appTitle: 'AuthMe',
  appDescription: 'Sign in to your account',
  showRememberMe: true,
  showForgotPassword: true,
  showRegistrationLink: true,
  showSocialProviders: true,
  defaultCountryCode: 'US',
  privacyPolicyUrl: null,
  termsOfServiceUrl: null,
  customFooterText: null,
  recaptchaEnabled: false,
  recaptchaSiteKey: null,
};

// ─── Component Definitions ─────────────────────────────────────────────────

export const COMPONENT_DEFINITIONS: ComponentDefinition[] = [
  {
    type: 'header',
    label: 'Header',
    icon: 'layout-header',
    description: 'Page header with title',
    defaultProps: { title: '' },
    allowedProps: ['title', 'subtitle'],
    styles: [
      { property: 'backgroundColor', label: 'Background', type: 'color' },
      { property: 'padding', label: 'Padding', type: 'text', unit: 'px' },
    ],
  },
  {
    type: 'logo',
    label: 'Logo',
    icon: 'image',
    description: 'Brand logo image',
    defaultProps: { size: 'medium', alignment: 'center', alt: 'Logo' },
    allowedProps: ['size', 'alignment', 'alt', 'url'],
    styles: [
      { property: 'maxWidth', label: 'Max Width', type: 'number', unit: 'px', min: 50, max: 300 },
      { property: 'padding', label: 'Padding', type: 'text', unit: 'px' },
    ],
  },
  {
    type: 'form',
    label: 'Form',
    icon: 'form-input',
    description: 'Login/registration form',
    defaultProps: { showUsername: true, showEmail: false, showFirstName: false, showLastName: false },
    allowedProps: ['showUsername', 'showEmail', 'showFirstName', 'showLastName'],
    styles: [
      { property: 'gap', label: 'Field Gap', type: 'number', unit: 'px', min: 8, max: 32 },
    ],
  },
  {
    type: 'input',
    label: 'Text Input',
    icon: 'text-input',
    description: 'Single text input field',
    defaultProps: { label: 'Username', placeholder: '', required: true },
    allowedProps: ['label', 'placeholder', 'required', 'autocomplete'],
    styles: [
      { property: 'marginBottom', label: 'Margin Bottom', type: 'number', unit: 'px', min: 0, max: 24 },
    ],
  },
  {
    type: 'passwordInput',
    label: 'Password Input',
    icon: 'password',
    description: 'Password field with visibility toggle',
    defaultProps: { label: 'Password', placeholder: '', required: true, showForgotPassword: true },
    allowedProps: ['label', 'placeholder', 'required', 'showForgotPassword'],
    styles: [],
  },
  {
    type: 'button',
    label: 'Button',
    icon: 'button',
    description: 'Primary action button',
    defaultProps: { label: 'Sign In', variant: 'primary', fullWidth: true },
    allowedProps: ['label', 'variant', 'fullWidth', 'disabled'],
    styles: [
      { property: 'backgroundColor', label: 'Background', type: 'color' },
      { property: 'height', label: 'Height', type: 'number', unit: 'px', min: 32, max: 64 },
      { property: 'borderRadius', label: 'Border Radius', type: 'text', unit: 'px' },
    ],
  },
  {
    type: 'alert',
    label: 'Alert',
    icon: 'alert',
    description: 'Error, warning, or info message',
    defaultProps: { type: 'error', message: '', dismissible: false },
    allowedProps: ['type', 'message', 'dismissible'],
    styles: [
      { property: 'backgroundColor', label: 'Background', type: 'color' },
      { property: 'borderColor', label: 'Border', type: 'color' },
    ],
  },
  {
    type: 'link',
    label: 'Link',
    icon: 'link',
    description: 'Clickable text link',
    defaultProps: { text: '', href: '', alignment: 'center' },
    allowedProps: ['text', 'href', 'alignment', 'newTab'],
    styles: [
      { property: 'color', label: 'Color', type: 'color' },
      { property: 'fontSize', label: 'Font Size', type: 'text' },
    ],
  },
  {
    type: 'card',
    label: 'Card',
    icon: 'card',
    description: 'Container card with shadow',
    defaultProps: { padding: 'medium' },
    allowedProps: ['padding', 'shadow', 'bordered'],
    styles: [
      { property: 'backgroundColor', label: 'Background', type: 'color' },
      { property: 'borderRadius', label: 'Border Radius', type: 'text', unit: 'px' },
      { property: 'padding', label: 'Padding', type: 'number', unit: 'px', min: 0, max: 48 },
    ],
  },
  {
    type: 'spacer',
    label: 'Spacer',
    icon: 'space',
    description: 'Vertical spacing',
    defaultProps: { height: 16 },
    allowedProps: ['height'],
    styles: [],
  },
  {
    type: 'text',
    label: 'Text',
    icon: 'text',
    description: 'Plain text content',
    defaultProps: { content: '', alignment: 'center' },
    allowedProps: ['content', 'alignment'],
    styles: [
      { property: 'color', label: 'Color', type: 'color' },
      { property: 'fontSize', label: 'Font Size', type: 'text' },
    ],
  },
  {
    type: 'heading',
    label: 'Heading',
    icon: 'heading',
    description: 'Page or section heading',
    defaultProps: { content: 'Welcome Back', level: 2, alignment: 'center' },
    allowedProps: ['content', 'level', 'alignment'],
    styles: [
      { property: 'color', label: 'Color', type: 'color' },
      { property: 'fontSize', label: 'Font Size', type: 'text' },
    ],
  },
  {
    type: 'socialButton',
    label: 'Social Login',
    icon: 'social',
    description: 'Social provider login buttons',
    defaultProps: { providers: [], layout: 'vertical' },
    allowedProps: ['providers', 'layout'],
    styles: [
      { property: 'gap', label: 'Button Gap', type: 'number', unit: 'px', min: 4, max: 24 },
    ],
  },
  {
    type: 'divider',
    label: 'Divider',
    icon: 'minus',
    description: 'Horizontal separator line',
    defaultProps: { label: 'or', margin: 'medium' },
    allowedProps: ['label', 'margin'],
    styles: [
      { property: 'borderColor', label: 'Color', type: 'color' },
      { property: 'borderWidth', label: 'Width', type: 'number', unit: 'px', min: 1, max: 4 },
    ],
  },
  {
    type: 'rememberMe',
    label: 'Remember Me',
    icon: 'checkbox',
    description: 'Remember me checkbox',
    defaultProps: {},
    allowedProps: [],
    styles: [],
  },
  {
    type: 'forgotPassword',
    label: 'Forgot Password',
    icon: 'link',
    description: 'Forgot password link',
    defaultProps: { alignment: 'right' },
    allowedProps: ['alignment'],
    styles: [
      { property: 'color', label: 'Color', type: 'color' },
    ],
  },
  {
    type: 'registrationLink',
    label: 'Register',
    icon: 'user-plus',
    description: 'New user registration link',
    defaultProps: { text: "Don't have an account? Sign up", alignment: 'center' },
    allowedProps: ['text', 'alignment'],
    styles: [
      { property: 'color', label: 'Color', type: 'color' },
    ],
  },
];