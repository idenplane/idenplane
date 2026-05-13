import { Injectable, Logger } from '@nestjs/common';

/**
 * Renders theme preview HTML from theme data.
 * This is used by the Theme Builder's live preview feature to provide
 * server-side rendering of theme previews.
 */
@Injectable()
export class ThemePreviewService {
  private readonly logger = new Logger(ThemePreviewService.name);

  /**
   * Renders a theme preview as an HTML string.
   * This generates a self-contained HTML document with all CSS inline,
   * suitable for embedding in an iframe or returning as a blob.
   */
  renderPreview(params: {
    styles: Record<string, unknown>;
    components?: unknown[];
    assets?: Record<string, unknown>;
    settings?: Record<string, string>;
  }): string {
    const { styles, components = [], assets = {}, settings = {} } = params;

    // Extract theme values with fallbacks
    const colors = (styles['colors'] as Record<string, string>) || {};
    const typography = (styles['typography'] as Record<string, unknown>) || {};
    const spacing = (styles['spacing'] as Record<string, string>) || {};
    const borders = (styles['borders'] as Record<string, string>) || {};
    const shadows = (styles['shadows'] as Record<string, string>) || {};
    const customCss = (styles['customCss'] as string) || '';

    // Build CSS variables
    const cssVars = this.buildCssVars({
      colors,
      typography,
      spacing,
      borders,
      shadows,
    });

    // Build base styles
    const baseStyles = this.buildBaseStyles();

    // Generate components HTML
    const componentsHtml = this.renderComponents(
      components as Array<{
        type: string;
        visible?: boolean;
        order: number;
        props?: Record<string, unknown>;
      }>,
      assets as Record<string, string>,
      settings,
    );

    // Wrap in full HTML document
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${settings['appTitle'] || 'AuthMe'} - Theme Preview</title>
  <style>
    ${cssVars}
    ${baseStyles}
    ${customCss}
  </style>
</head>
<body>
  <div class="login-container">
    <div class="login-card">
      ${componentsHtml}
    </div>
  </div>
</body>
</html>`;
  }

  private buildCssVars(params: {
    colors: Record<string, string>;
    typography: Record<string, string>;
    spacing: Record<string, string>;
    borders: Record<string, string>;
    shadows: Record<string, string>;
  }): string {
    const { colors, typography, spacing, borders, shadows } = params;

    return `
:root {
  --primary-color: ${colors['primaryColor'] || '#2563eb'};
  --primary-hover-color: ${colors['primaryHoverColor'] || '#1d4ed8'};
  --primary-active-color: ${colors['primaryActiveColor'] || '#1e40af'};
  --secondary-color: ${colors['secondaryColor'] || '#64748b'};
  --background-color: ${colors['backgroundColor'] || '#f0f2f5'};
  --card-color: ${colors['cardColor'] || '#ffffff'};
  --surface-color: ${colors['surfaceColor'] || '#f8fafc'};
  --text-color: ${colors['textColor'] || '#1a1a2e'};
  --text-secondary-color: ${colors['textSecondaryColor'] || '#6b7280'};
  --border-color: ${colors['borderColor'] || '#e2e8f0'};
  --error-color: ${colors['errorColor'] || '#ef4444'};
  --warning-color: ${colors['warningColor'] || '#f59e0b'};
  --success-color: ${colors['successColor'] || '#22c55e'};
  --info-color: ${colors['infoColor'] || '#3b82f6'};
  --font-family: ${typography['fontFamily'] || 'Inter, system-ui, sans-serif'};
  --font-family-fallback: ${typography['fontFamilyFallback'] || 'system-ui, sans-serif'};
  --font-size-base: ${typography['fontSizeBase'] || '14px'};
  --font-size-small: ${typography['fontSizeSmall'] || '12px'};
  --font-size-large: ${typography['fontSizeLarge'] || '18px'};
  --font-weight-normal: ${typography['fontWeightNormal'] || '400'};
  --font-weight-medium: ${typography['fontWeightMedium'] || '500'};
  --font-weight-bold: ${typography['fontWeightBold'] || '600'};
  --line-height: ${typography['lineHeight'] || '1.5'};
  --letter-spacing: ${typography['letterSpacing'] || '0'};
  --spacing-unit: ${spacing['spacingUnit'] || '4px'};
  --spacing-xs: ${spacing['spacingXs'] || '4px'};
  --spacing-sm: ${spacing['spacingSm'] || '8px'};
  --spacing-md: ${spacing['spacingMd'] || '16px'};
  --spacing-lg: ${spacing['spacingLg'] || '24px'};
  --spacing-xl: ${spacing['spacingXl'] || '32px'};
  --spacing-2xl: ${spacing['spacing2xl'] || '48px'};
  --spacing-3xl: ${spacing['spacing3xl'] || '64px'};
  --border-radius: ${spacing['borderRadius'] || '6px'};
  --border-radius-sm: ${spacing['borderRadiusSm'] || '4px'};
  --border-radius-lg: ${spacing['borderRadiusLg'] || '12px'};
  --border-radius-full: ${spacing['borderRadiusFull'] || '9999px'};
  --border-width: ${borders['borderWidth'] || '1px'};
  --border-color: ${borders['borderColor'] || '#e2e8f0'};
  --border-width-focus: ${borders['borderWidthFocus'] || '2px'};
  --border-color-focus: ${borders['borderColorFocus'] || '#2563eb'};
  --border-width-error: ${borders['borderWidthError'] || '1px'};
  --border-color-error: ${borders['borderColorError'] || '#ef4444'};
  --shadow-sm: ${shadows['shadowSm'] || '0 1px 2px rgba(0, 0, 0, 0.05)'};
  --shadow: ${shadows['shadow'] || '0 1px 3px rgba(0, 0, 0, 0.1)'};
  --shadow-md: ${shadows['shadowMd'] || '0 4px 6px rgba(0, 0, 0, 0.1)'};
  --shadow-lg: ${shadows['shadowLg'] || '0 10px 15px rgba(0, 0, 0, 0.1)'};
  --shadow-xl: ${shadows['shadowXl'] || '0 20px 25px rgba(0, 0, 0, 0.1)'};
  --shadow-focus: ${shadows['shadowFocus'] || '0 0 0 3px rgba(37, 99, 235, 0.2)'};
  --shadow-card: ${shadows['shadowCard'] || '0 4px 6px rgba(0, 0, 0, 0.07), 0 2px 4px rgba(0, 0, 0, 0.05)'};
}
`;
  }

  private buildBaseStyles(): string {
    return `
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
  text-align: center;
}
.login-logo img {
  max-width: 120px;
  max-height: 60px;
  object-fit: contain;
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
  text-align: center;
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
  display: block;
}
.alert-error {
  background-color: color-mix(in srgb, var(--error-color) 10%, transparent);
  border: 1px solid var(--error-color);
  color: var(--error-color);
}
.alert-warning {
  background-color: color-mix(in srgb, var(--warning-color) 10%, transparent);
  border: 1px solid var(--warning-color);
  color: var(--warning-color);
}
.alert-success {
  background-color: color-mix(in srgb, var(--success-color) 10%, transparent);
  border: 1px solid var(--success-color);
  color: var(--success-color);
}
.alert-info {
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
.social-icon {
  width: 18px;
  height: 18px;
}
`;
  }

  private renderComponents(
    components: Array<{
      type: string;
      visible?: boolean;
      order: number;
      props?: Record<string, unknown>;
    }>,
    assets: Record<string, string>,
    settings: Record<string, unknown>,
  ): string {
    const sortedComponents = [...components].sort((a, b) => a.order - b.order);
    let html = '';

    for (const component of sortedComponents) {
      if (component.visible === false) continue;

      switch (component.type) {
        case 'logo':
          html += this.renderLogo(component.props, assets);
          break;
        case 'header':
          html += this.renderHeader(component.props, settings);
          break;
        case 'form':
          html += this.renderForm(component.props);
          break;
        case 'rememberMe':
          if (settings['showRememberMe']) {
            html += this.renderRememberMe();
          }
          break;
        case 'button':
          html += this.renderButton(component.props);
          break;
        case 'forgotPassword':
          if (settings['showForgotPassword']) {
            html += this.renderForgotPassword();
          }
          break;
        case 'socialButton':
          if (settings['showSocialProviders']) {
            html += this.renderSocialButtons(settings);
          }
          break;
        case 'registrationLink':
          if (settings['showRegistrationLink']) {
            html += this.renderRegistrationLink();
          }
          break;
        case 'footer':
          html += this.renderFooter(component.props);
          break;
        case 'spacer':
          html += this.renderSpacer(component.props);
          break;
        case 'alert':
          html += this.renderAlert(component.props);
          break;
        case 'text':
          html += this.renderText(component.props);
          break;
        case 'heading':
          html += this.renderHeading(component.props);
          break;
        case 'divider':
          html += this.renderDivider(component.props);
          break;
      }
    }

    return html;
  }

  private renderLogo(
    props: Record<string, unknown> | undefined,
    assets: Record<string, string>,
  ): string {
    const logoUrl = assets['logoUrl'];
    const logoAlt = assets['logoAlt'] || 'Logo';

    return `
  <div class="login-logo">
    ${
      logoUrl
        ? `<img src="${this.escapeHtml(logoUrl)}" alt="${this.escapeHtml(logoAlt)}" />`
        : `<div class="login-logo-placeholder">${this.escapeHtml(logoAlt)}</div>`
    }
  </div>`;
  }

  private renderHeader(
    props: Record<string, unknown> | undefined,
    settings: Record<string, unknown>,
  ): string {
    const title =
      (props?.['title'] as string) ||
      (settings['appTitle'] as string) ||
      'Welcome Back';
    const subtitle =
      (props?.['subtitle'] as string) ||
      (settings['appDescription'] as string) ||
      'Sign in to your account';

    return `
  <div class="login-header">
    <h1 class="login-title">${this.escapeHtml(title)}</h1>
    <p class="login-subtitle">${this.escapeHtml(subtitle)}</p>
  </div>`;
  }

  private renderForm(props: Record<string, unknown> | undefined): string {
    const formProps = props || {};
    const showUsername = formProps['showUsername'] !== false;
    const showEmail = formProps['showEmail'] === true;
    const showPassword = formProps['showPassword'] !== false;

    let html = '<form class="login-form" onsubmit="return false;">';
    html += '<div class="alert alert-error">Error: Invalid credentials</div>';

    if (showUsername || !showEmail) {
      html += `
  <div class="form-group">
    <label class="form-label" for="username">Username</label>
    <input class="form-input" type="text" id="username" name="username" placeholder="Enter your username" autocomplete="username" />
  </div>`;
    }

    if (showEmail) {
      html += `
  <div class="form-group">
    <label class="form-label" for="email">Email</label>
    <input class="form-input" type="email" id="email" name="email" placeholder="Enter your email" autocomplete="email" />
  </div>`;
    }

    if (showPassword) {
      html += `
  <div class="form-group">
    <label class="form-label" for="password">Password</label>
    <input class="form-input" type="password" id="password" name="password" placeholder="Enter your password" autocomplete="current-password" />
  </div>`;
    }

    html += '</form>';
    return html;
  }

  private renderRememberMe(): string {
    return `
  <div class="form-row">
    <label class="checkbox-label">
      <input type="checkbox" name="rememberMe" />
      Remember me
    </label>
  </div>`;
  }

  private renderButton(props: Record<string, unknown> | undefined): string {
    const label = (props?.['label'] as string) || 'Sign In';
    return `
  <div class="form-group">
    <button class="btn-primary" type="submit">${this.escapeHtml(label)}</button>
  </div>`;
  }

  private renderForgotPassword(): string {
    return `
  <div class="form-row">
    <a href="#" class="link">Forgot your password?</a>
  </div>`;
  }

  private renderSocialButtons(settings: Record<string, unknown>): string {
    // Get social providers from settings
    const providers = (settings['socialProviders'] as Array<{
      name: string;
      icon?: string;
    }>) || [{ name: 'Google' }, { name: 'GitHub' }];

    const buttonsHtml = providers
      .slice(0, 3)
      .map((provider) => {
        const icon = provider.icon || this.getSocialIcon(provider.name);
        return `
      <button class="btn-social" type="button">
        ${icon}
        <span>Continue with ${provider.name}</span>
      </button>`;
      })
      .join('');

    return `
  <div class="divider">or</div>
  <div class="social-buttons">${buttonsHtml}
  </div>`;
  }

  private getSocialIcon(providerName: string): string {
    // Simple SVG icons for common providers
    const icons: Record<string, string> = {
      Google: `<svg class="social-icon" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`,
      GitHub: `<svg class="social-icon" viewBox="0 0 24 24" fill="#333"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>`,
      Microsoft: `<svg class="social-icon" viewBox="0 0 24 24"><path fill="#F25022" d="M0 0h11.5v11.5H0z"/><path fill="#00A4EF" d="M12.5 0H24v11.5H12.5z"/><path fill="#7FBA00" d="M0 12.5h11.5V24H0z"/><path fill="#FFB900" d="M12.5 12.5H24V24H12.5z"/></svg>`,
    };

    return (
      icons[providerName] ||
      `<svg class="social-icon" viewBox="0 0 24 24"><circle fill="#666" cx="12" cy="12" r="10"/></svg>`
    );
  }

  private renderRegistrationLink(): string {
    return `
  <div class="login-footer">
    Don't have an account? <a href="#">Sign up</a>
  </div>`;
  }

  private renderFooter(props: Record<string, unknown> | undefined): string {
    const showPrivacy = props?.['showPrivacyPolicy'];
    const showTerms = props?.['showTermsOfService'];
    const customText = props?.['customText'] as string;

    return `
  <div class="login-footer">
    ${showPrivacy ? '<a href="#">Privacy Policy</a> · ' : ''}
    ${showTerms ? '<a href="#">Terms of Service</a>' : ''}
    ${customText ? `<p style="margin-top: 8px;">${this.escapeHtml(customText)}</p>` : ''}
  </div>`;
  }

  private renderSpacer(props: Record<string, unknown> | undefined): string {
    const height = (props?.['height'] as number) || 16;
    return `<div style="height: ${height}px;"></div>`;
  }

  private renderAlert(props: Record<string, unknown> | undefined): string {
    const type = (props?.['type'] as string) || 'info';
    const message = props?.['message'] as string;

    if (!message) return '';

    const validTypes = ['error', 'warning', 'success', 'info'];
    const alertType = validTypes.includes(type) ? type : 'info';

    return `<div class="alert alert-${alertType}">${this.escapeHtml(message)}</div>`;
  }

  private renderText(props: Record<string, unknown> | undefined): string {
    const content = (props?.['content'] as string) || '';
    const alignment = (props?.['alignment'] as string) || 'center';

    return `<p style="text-align: ${alignment};">${this.escapeHtml(content)}</p>`;
  }

  private renderHeading(props: Record<string, unknown> | undefined): string {
    const content = (props?.['content'] as string) || '';
    const level = Math.min(Math.max((props?.['level'] as number) || 2, 1), 6);
    const alignment = (props?.['alignment'] as string) || 'center';

    return `<h${level} style="text-align: ${alignment}; margin-bottom: var(--spacing-md);">${this.escapeHtml(content)}</h${level}>`;
  }

  private renderDivider(props: Record<string, unknown> | undefined): string {
    const label = (props?.['label'] as string) || '';
    return `<div class="divider">${this.escapeHtml(label)}</div>`;
  }

  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }
}
