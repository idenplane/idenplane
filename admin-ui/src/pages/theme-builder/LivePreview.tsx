import { useMemo, useRef, useEffect, useCallback } from 'react';
import type {
  ThemeStyles,
  ThemeComponent,
  ThemeAssets,
  ThemeSettings,
} from '../../types/theme';

interface LivePreviewProps {
  styles: ThemeStyles;
  components: ThemeComponent[];
  assets: ThemeAssets;
  settings: ThemeSettings;
  viewportSize?: 'desktop' | 'tablet' | 'mobile';
  onViewportChange?: (size: 'desktop' | 'tablet' | 'mobile') => void;
}

// Debounce helper for avoiding excessive re-renders
function useDebounce<T extends (...args: any[]) => void>(callback: T, delay: number): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);

  // Keep callback ref updated
  callbackRef.current = callback;

  return useCallback(
    ((...args: any[]) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        callbackRef.current(...args);
      }, delay);
    }) as T,
    [delay],
  );
}

interface ViewportDimensions {
  width: string;
  height: string;
}

const VIEWPORT_DIMENSIONS: Record<string, ViewportDimensions> = {
  desktop: { width: '100%', height: '100%' },
  tablet: { width: '768px', height: '100%' },
  mobile: { width: '375px', height: '100%' },
};

function generatePreviewHtml(
  styles: ThemeStyles,
  components: ThemeComponent[],
  assets: ThemeAssets,
  settings: ThemeSettings,
): string {
  const { colors, typography, spacing, borders, shadows } = styles;

  const cssVars = `
    :root {
      --primary-color: ${colors.primaryColor};
      --primary-hover-color: ${colors.primaryHoverColor};
      --primary-active-color: ${colors.primaryActiveColor};
      --secondary-color: ${colors.secondaryColor};
      --background-color: ${colors.backgroundColor};
      --card-color: ${colors.cardColor};
      --surface-color: ${colors.surfaceColor};
      --text-color: ${colors.textColor};
      --text-secondary-color: ${colors.textSecondaryColor};
      --border-color: ${colors.borderColor};
      --error-color: ${colors.errorColor};
      --warning-color: ${colors.warningColor};
      --success-color: ${colors.successColor};
      --info-color: ${colors.infoColor};
      --font-family: ${typography.fontFamily};
      --font-family-fallback: ${typography.fontFamilyFallback};
      --font-size-base: ${typography.fontSizeBase};
      --font-size-small: ${typography.fontSizeSmall};
      --font-size-large: ${typography.fontSizeLarge};
      --font-weight-normal: ${typography.fontWeightNormal};
      --font-weight-medium: ${typography.fontWeightMedium};
      --font-weight-bold: ${typography.fontWeightBold};
      --line-height: ${typography.lineHeight};
      --letter-spacing: ${typography.letterSpacing};
      --spacing-unit: ${spacing.spacingUnit};
      --spacing-xs: ${spacing.spacingXs};
      --spacing-sm: ${spacing.spacingSm};
      --spacing-md: ${spacing.spacingMd};
      --spacing-lg: ${spacing.spacingLg};
      --spacing-xl: ${spacing.spacingXl};
      --spacing-2xl: ${spacing.spacing2xl};
      --spacing-3xl: ${spacing.spacing3xl};
      --border-radius: ${spacing.borderRadius};
      --border-radius-sm: ${spacing.borderRadiusSm};
      --border-radius-lg: ${spacing.borderRadiusLg};
      --border-radius-full: ${spacing.borderRadiusFull};
      --border-width: ${borders.borderWidth};
      --border-color: ${borders.borderColor};
      --border-width-focus: ${borders.borderWidthFocus};
      --border-color-focus: ${borders.borderColorFocus};
      --border-width-error: ${borders.borderWidthError};
      --border-color-error: ${borders.borderColorError};
      --shadow-sm: ${shadows.shadowSm};
      --shadow: ${shadows.shadow};
      --shadow-md: ${shadows.shadowMd};
      --shadow-lg: ${shadows.shadowLg};
      --shadow-xl: ${shadows.shadowXl};
      --shadow-focus: ${shadows.shadowFocus};
      --shadow-card: ${shadows.shadowCard};
    }
  `;

  const baseStyles = `
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: var(--font-family), var(--font-family-fallback);
      font-size: var(--font-size-base);
      line-height: var(--line-height);
      letter-spacing: var(--letter-spacing);
      color: var(--text-color);
      background-color: var(--background-color);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-lg);
    }
    .login-container {
      width: 100%;
      max-width: 420px;
    }
    .login-card {
      background-color: var(--card-color);
      border-radius: var(--border-radius-lg);
      box-shadow: var(--shadow-card);
      padding: var(--spacing-2xl);
    }
    .login-header {
      text-align: center;
      margin-bottom: var(--spacing-xl);
    }
    .login-logo {
      margin-bottom: var(--spacing-lg);
    }
    .login-logo img {
      max-width: 120px;
      max-height: 60px;
    }
    .login-logo-placeholder {
      display: inline-block;
      width: 120px;
      height: 60px;
      background: var(--surface-color);
      border-radius: var(--border-radius);
      line-height: 60px;
      color: var(--text-secondary-color);
      font-size: var(--font-size-small);
    }
    .login-title {
      font-size: var(--font-size-large);
      font-weight: var(--font-weight-bold);
      color: var(--text-color);
      margin-bottom: var(--spacing-xs);
    }
    .login-subtitle {
      font-size: var(--font-size-small);
      color: var(--text-secondary-color);
    }
    .form-group {
      margin-bottom: var(--spacing-md);
    }
    .form-label {
      display: block;
      font-size: var(--font-size-small);
      font-weight: var(--font-weight-medium);
      color: var(--text-color);
      margin-bottom: var(--spacing-xs);
    }
    .form-input {
      width: 100%;
      padding: var(--spacing-sm) var(--spacing-md);
      font-size: var(--font-size-base);
      font-family: inherit;
      color: var(--text-color);
      background-color: var(--card-color);
      border: var(--border-width) solid var(--border-color);
      border-radius: var(--border-radius);
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .form-input:focus {
      outline: none;
      border-color: var(--border-color-focus);
      box-shadow: var(--shadow-focus);
    }
    .form-input::placeholder {
      color: var(--text-secondary-color);
    }
    .form-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--spacing-md);
    }
    .checkbox-label {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      font-size: var(--font-size-small);
      color: var(--text-color);
      cursor: pointer;
    }
    .checkbox-label input {
      width: 16px;
      height: 16px;
      accent-color: var(--primary-color);
    }
    .link {
      font-size: var(--font-size-small);
      color: var(--primary-color);
      text-decoration: none;
    }
    .link:hover {
      text-decoration: underline;
      color: var(--primary-hover-color);
    }
    .btn-primary {
      width: 100%;
      padding: var(--spacing-sm) var(--spacing-md);
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-medium);
      font-family: inherit;
      color: #ffffff;
      background-color: var(--primary-color);
      border: none;
      border-radius: var(--border-radius);
      cursor: pointer;
      transition: background-color 0.15s ease;
    }
    .btn-primary:hover {
      background-color: var(--primary-hover-color);
    }
    .btn-primary:active {
      background-color: var(--primary-active-color);
    }
    .btn-primary:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .login-footer {
      text-align: center;
      margin-top: var(--spacing-lg);
      font-size: var(--font-size-small);
      color: var(--text-secondary-color);
    }
    .login-footer a {
      color: var(--primary-color);
      text-decoration: none;
    }
    .login-footer a:hover {
      text-decoration: underline;
    }
    .divider {
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
      margin: var(--spacing-lg) 0;
      color: var(--text-secondary-color);
      font-size: var(--font-size-small);
    }
    .divider::before,
    .divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background-color: var(--border-color);
    }
    .alert {
      padding: var(--spacing-sm) var(--spacing-md);
      border-radius: var(--border-radius);
      font-size: var(--font-size-small);
      margin-bottom: var(--spacing-md);
      display: none;
    }
    .alert.alert-error {
      background-color: color-mix(in srgb, var(--error-color) 10%, transparent);
      border: 1px solid var(--error-color);
      color: var(--error-color);
    }
    .alert.alert-warning {
      background-color: color-mix(in srgb, var(--warning-color) 10%, transparent);
      border: 1px solid var(--warning-color);
      color: var(--warning-color);
    }
    .alert.alert-success {
      background-color: color-mix(in srgb, var(--success-color) 10%, transparent);
      border: 1px solid var(--success-color);
      color: var(--success-color);
    }
    .alert.alert-info {
      background-color: color-mix(in srgb, var(--info-color) 10%, transparent);
      border: 1px solid var(--info-color);
      color: var(--info-color);
    }
    .social-buttons {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-sm);
    }
    .btn-social {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-sm);
      width: 100%;
      padding: var(--spacing-sm) var(--spacing-md);
      font-size: var(--font-size-small);
      font-family: inherit;
      color: var(--text-color);
      background-color: var(--surface-color);
      border: var(--border-width) solid var(--border-color);
      border-radius: var(--border-radius);
      cursor: pointer;
      transition: background-color 0.15s ease, border-color 0.15s ease;
    }
    .btn-social:hover {
      background-color: var(--background-color);
      border-color: var(--primary-color);
    }
    ${styles.customCss || ''}
  `;

  const sortedComponents = [...components].sort((a, b) => a.order - b.order);

  let componentsHtml = '';

  for (const component of sortedComponents) {
    if (!component.visible) continue;

    switch (component.type) {
      case 'logo':
        componentsHtml += `
          <div class="login-logo">
            ${assets.logoUrl
              ? `<img src="${assets.logoUrl}" alt="${assets.logoAlt || 'Logo'}" />`
              : `<div class="login-logo-placeholder">${assets.logoAlt || 'Logo'}</div>`
            }
          </div>
        `;
        break;

      case 'header':
        componentsHtml += `
          <div class="login-header">
            <h1 class="login-title">${(component.props as { title?: string }).title || settings.appTitle || 'Welcome Back'}</h1>
            ${(component.props as { subtitle?: string }).subtitle
              ? `<p class="login-subtitle">${(component.props as { subtitle?: string }).subtitle}</p>`
              : `<p class="login-subtitle">${settings.appDescription || 'Sign in to your account'}</p>`
            }
          </div>
        `;
        break;

      case 'form':
        const formProps = component.props as {
          showUsername?: boolean;
          showEmail?: boolean;
          showFirstName?: boolean;
          showLastName?: boolean;
          showPassword?: boolean;
        };
        componentsHtml += `<form class="login-form" onsubmit="return false;">`;
        componentsHtml += `<div class="alert alert-error" style="display:block;">Error: Invalid credentials</div>`;

        if (formProps.showUsername || !formProps.showEmail) {
          componentsHtml += `
            <div class="form-group">
              <label class="form-label" for="username">Username</label>
              <input class="form-input" type="text" id="username" name="username" placeholder="Enter your username" autocomplete="username" />
            </div>
          `;
        }

        if (formProps.showEmail) {
          componentsHtml += `
            <div class="form-group">
              <label class="form-label" for="email">Email</label>
              <input class="form-input" type="email" id="email" name="email" placeholder="Enter your email" autocomplete="email" />
            </div>
          `;
        }

        if (formProps.showPassword !== false) {
          componentsHtml += `
            <div class="form-group">
              <label class="form-label" for="password">Password</label>
              <input class="form-input" type="password" id="password" name="password" placeholder="Enter your password" autocomplete="current-password" />
            </div>
          `;
        }

        componentsHtml += `</form>`;
        break;

      case 'rememberMe':
        if (settings.showRememberMe) {
          componentsHtml += `
            <div class="form-row">
              <label class="checkbox-label">
                <input type="checkbox" name="rememberMe" />
                Remember me
              </label>
            </div>
          `;
        }
        break;

      case 'button':
        const btnProps = component.props as { label?: string; variant?: string };
        componentsHtml += `
          <div class="form-group">
            <button class="btn-primary" type="submit">${btnProps.label || 'Sign In'}</button>
          </div>
        `;
        break;

      case 'forgotPassword':
        if (settings.showForgotPassword) {
          componentsHtml += `
            <div class="form-row">
              <a href="#" class="link">Forgot your password?</a>
            </div>
          `;
        }
        break;

      case 'socialButton':
        if (settings.showSocialProviders) {
          componentsHtml += `
            <div class="divider">or</div>
            <div class="social-buttons">
              <button class="btn-social">Continue with Google</button>
              <button class="btn-social">Continue with GitHub</button>
            </div>
          `;
        }
        break;

      case 'registrationLink':
        if (settings.showRegistrationLink) {
          componentsHtml += `
            <div class="login-footer">
              Don't have an account? <a href="#">Sign up</a>
            </div>
          `;
        }
        break;

      case 'footer':
        const footerProps = component.props as {
          showPrivacyPolicy?: boolean;
          showTermsOfService?: boolean;
          customText?: string;
        };
        componentsHtml += `
          <div class="login-footer">
            ${footerProps.showPrivacyPolicy ? `<a href="#">Privacy Policy</a> · ` : ''}
            ${footerProps.showTermsOfService ? `<a href="#">Terms of Service</a>` : ''}
            ${footerProps.customText ? `<p>${footerProps.customText}</p>` : ''}
          </div>
        `;
        break;

      case 'spacer':
        const spacerHeight = (component.props as { height?: number }).height || 16;
        componentsHtml += `<div style="height: ${spacerHeight}px;"></div>`;
        break;

      case 'alert':
        const alertProps = component.props as { type?: string; message?: string };
        if (alertProps.message) {
          componentsHtml += `
            <div class="alert alert-${alertProps.type || 'info'}">${alertProps.message}</div>
          `;
        }
        break;

      case 'text':
        const textProps = component.props as { content?: string; alignment?: string };
        componentsHtml += `
          <p style="text-align: ${textProps.alignment || 'center'};">${textProps.content || ''}</p>
        `;
        break;

      case 'heading':
        const headingProps = component.props as {
          content?: string;
          level?: number;
          alignment?: string;
        };
        const Tag = `h${headingProps.level || 2}` as string;
        componentsHtml += `
          <${Tag} style="text-align: ${headingProps.alignment || 'center'};">${headingProps.content || ''}</${Tag}>
        `;
        break;

      case 'divider':
        const dividerProps = component.props as { label?: string };
        componentsHtml += `
          <div class="divider">${dividerProps.label || ''}</div>
        `;
        break;

      default:
        break;
    }
  }

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${settings.appTitle || 'AuthMe'} - Login Preview</title>
      <style>
        ${cssVars}
        ${baseStyles}
      </style>
    </head>
    <body>
      <div class="login-container">
        <div class="login-card">
          ${componentsHtml}
        </div>
      </div>
    </body>
    </html>
  `;
}

export default function LivePreview({
  styles,
  components,
  assets,
  settings,
  viewportSize = 'desktop',
  onViewportChange,
}: LivePreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Generate preview HTML with memoization - updates within ~50ms for real-time feel
  const previewHtml = useMemo(() => {
    return generatePreviewHtml(styles, components, assets, settings);
  }, [styles, components, assets, settings]);

  // Debounced iframe update - prevents excessive DOM writes during rapid changes
  const debouncedWriteToIframe = useDebounce((html: string) => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(html);
        doc.close();
      }
    } catch {
      // Cross-origin restrictions may prevent writing to iframe - silent fail
    }
  }, 50);

  // Update iframe content when preview HTML changes (debounced to prevent excessive writes)
  useEffect(() => {
    debouncedWriteToIframe(previewHtml);
  }, [previewHtml, debouncedWriteToIframe]);

  const viewportDimensions = VIEWPORT_DIMENSIONS[viewportSize] || VIEWPORT_DIMENSIONS.desktop;

  return (
    <div className="flex h-full flex-col bg-gray-100">
      {/* Viewport controls */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2">
        <span className="text-sm font-medium text-gray-700">Preview</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onViewportChange?.('desktop')}
            className={`rounded p-1.5 transition-colors ${
              viewportSize === 'desktop'
                ? 'bg-indigo-100 text-indigo-600'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
            title="Desktop view"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
            </svg>
          </button>
          <button
            onClick={() => onViewportChange?.('tablet')}
            className={`rounded p-1.5 transition-colors ${
              viewportSize === 'tablet'
                ? 'bg-indigo-100 text-indigo-600'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
            title="Tablet view"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5h3m-6.75 2.25h10.5a2.25 2.25 0 002.25-2.25v-15a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 4.5v15a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </button>
          <button
            onClick={() => onViewportChange?.('mobile')}
            className={`rounded p-1.5 transition-colors ${
              viewportSize === 'mobile'
                ? 'bg-indigo-100 text-indigo-600'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
            title="Mobile view"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 0h3" />
            </svg>
          </button>
        </div>
      </div>

      {/* Preview area */}
      <div className="relative flex-1 overflow-auto p-4">
        <div className="mx-auto flex h-full items-start justify-center">
          <div
            className="overflow-auto rounded-lg border border-gray-300 bg-white shadow-lg transition-all duration-200"
            style={{
              width: viewportDimensions.width,
              maxWidth: '100%',
            }}
          >
            <iframe
              ref={iframeRef}
              title="Theme Preview"
              className="block min-h-[500px] w-full border-0"
              sandbox="allow-scripts"
              srcDoc={previewHtml}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
