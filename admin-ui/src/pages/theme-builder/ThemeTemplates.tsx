import { useState } from 'react';
import type {
  ThemeStyles,
  ThemeComponent,
  ThemeAssets,
  ThemeSettings,
} from '../../types/theme';

// ─── Template Data ──────────────────────────────────────────────────────────

interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  category: 'corporate' | 'modern' | 'minimal' | 'custom';
  previewGradient: string;
  accentColor: string;
  styles: ThemeStyles;
  components: ThemeComponent[];
  assets: Partial<ThemeAssets>;
  settings: Partial<ThemeSettings>;
}

// Corporate template - Professional, trustworthy
const corporateTemplate: TemplateDefinition = {
  id: 'corporate',
  name: 'Corporate',
  description: 'Professional and trustworthy design with blue tones',
  category: 'corporate',
  previewGradient: 'from-blue-600 to-blue-800',
  accentColor: '#1e40af',
  styles: {
    colors: {
      primaryColor: '#1e40af',
      primaryHoverColor: '#1e3a8a',
      primaryActiveColor: '#1e3a8a',
      secondaryColor: '#475569',
      backgroundColor: '#f1f5f9',
      cardColor: '#ffffff',
      surfaceColor: '#e2e8f0',
      textColor: '#1e293b',
      textSecondaryColor: '#64748b',
      borderColor: '#cbd5e1',
      errorColor: '#b91c1c',
      warningColor: '#d97706',
      successColor: '#15803d',
      infoColor: '#0369a1',
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
      borderColor: '#cbd5e1',
      borderWidthFocus: '2px',
      borderColorFocus: '#1e40af',
      borderWidthError: '2px',
      borderColorError: '#b91c1c',
    },
    shadows: {
      shadowSm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
      shadow: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
      shadowMd: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
      shadowLg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
      shadowXl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
      shadowFocus: '0 0 0 3px rgba(30, 64, 175, 0.2)',
      shadowCard: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
    },
    customCss: '',
  },
  components: [
    { id: 'header-1', type: 'header', label: 'Header', order: 0, visible: true, props: { title: 'Sign In' } },
    { id: 'logo-1', type: 'logo', label: 'Logo', order: 1, visible: true, props: { size: 'medium', alignment: 'center' } },
    { id: 'form-1', type: 'form', label: 'Login Form', order: 2, visible: true, props: { showUsername: true, showEmail: false } },
    { id: 'remember-me-1', type: 'rememberMe', label: 'Remember Me', order: 3, visible: true, props: {} },
    { id: 'forgot-password-1', type: 'forgotPassword', label: 'Forgot Password Link', order: 4, visible: true, props: {} },
    { id: 'registration-1', type: 'registrationLink', label: 'Registration Link', order: 5, visible: true, props: {} },
    { id: 'footer-1', type: 'footer', label: 'Footer', order: 6, visible: true, props: {} },
  ],
  assets: {},
  settings: {
    appTitle: 'Sign In',
    appDescription: 'Access your corporate account',
    showRememberMe: true,
    showForgotPassword: true,
    showRegistrationLink: true,
    showSocialProviders: false,
  },
};

// Modern template - Sleek, vibrant, contemporary
const modernTemplate: TemplateDefinition = {
  id: 'modern',
  name: 'Modern',
  description: 'Sleek design with vibrant gradients and rounded elements',
  category: 'modern',
  previewGradient: 'from-violet-600 to-purple-600',
  accentColor: '#7c3aed',
  styles: {
    colors: {
      primaryColor: '#7c3aed',
      primaryHoverColor: '#6d28d9',
      primaryActiveColor: '#5b21b6',
      secondaryColor: '#ec4899',
      backgroundColor: '#faf5ff',
      cardColor: '#ffffff',
      surfaceColor: '#f3e8ff',
      textColor: '#1f2937',
      textSecondaryColor: '#6b7280',
      borderColor: '#e5e7eb',
      errorColor: '#dc2626',
      warningColor: '#f59e0b',
      successColor: '#10b981',
      infoColor: '#3b82f6',
    },
    typography: {
      fontFamily: 'Poppins, system-ui, -apple-system, sans-serif',
      fontFamilyFallback: 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
      fontSizeBase: '16px',
      fontSizeSmall: '14px',
      fontSizeLarge: '20px',
      fontWeightNormal: 400,
      fontWeightMedium: 500,
      fontWeightBold: 600,
      lineHeight: '1.6',
      letterSpacing: '0',
    },
    spacing: {
      spacingUnit: '4px',
      spacingXs: '4px',
      spacingSm: '8px',
      spacingMd: '20px',
      spacingLg: '32px',
      spacingXl: '40px',
      spacing2xl: '56px',
      spacing3xl: '72px',
      borderRadius: '12px',
      borderRadiusSm: '8px',
      borderRadiusLg: '16px',
      borderRadiusFull: '9999px',
    },
    borders: {
      borderWidth: '1px',
      borderStyle: 'solid',
      borderColor: '#e5e7eb',
      borderWidthFocus: '2px',
      borderColorFocus: '#7c3aed',
      borderWidthError: '2px',
      borderColorError: '#dc2626',
    },
    shadows: {
      shadowSm: '0 2px 4px 0 rgb(124 58 237 / 0.05)',
      shadow: '0 4px 6px -1px rgb(124 58 237 / 0.1), 0 2px 4px -2px rgb(124 58 237 / 0.1)',
      shadowMd: '0 10px 15px -3px rgb(124 58 237 / 0.1), 0 4px 6px -4px rgb(124 58 237 / 0.1)',
      shadowLg: '0 20px 25px -5px rgb(124 58 237 / 0.1), 0 10px 10px -5px rgb(124 58 237 / 0.1)',
      shadowXl: '0 25px 50px -12px rgb(124 58 237 / 0.25)',
      shadowFocus: '0 0 0 4px rgba(124, 58, 237, 0.2)',
      shadowCard: '0 10px 25px -5px rgb(124 58 237 / 0.1), 0 8px 10px -6px rgb(124 58 237 / 0.1)',
    },
    customCss: '',
  },
  components: [
    { id: 'logo-1', type: 'logo', label: 'Logo', order: 0, visible: true, props: { size: 'large', alignment: 'center' } },
    { id: 'spacer-1', type: 'spacer', label: 'Spacer', order: 1, visible: true, props: { height: 24 } },
    { id: 'heading-1', type: 'heading', label: 'Heading', order: 2, visible: true, props: { content: 'Welcome Back', level: 1, alignment: 'center' } },
    { id: 'form-1', type: 'form', label: 'Login Form', order: 3, visible: true, props: { showUsername: true, showEmail: false } },
    { id: 'remember-me-1', type: 'rememberMe', label: 'Remember Me', order: 4, visible: true, props: {} },
    { id: 'forgot-password-1', type: 'forgotPassword', label: 'Forgot Password Link', order: 5, visible: true, props: {} },
    { id: 'social-1', type: 'socialButton', label: 'Social Login', order: 6, visible: true, props: { layout: 'vertical' } },
    { id: 'registration-1', type: 'registrationLink', label: 'Registration Link', order: 7, visible: true, props: {} },
  ],
  assets: {},
  settings: {
    appTitle: 'Welcome Back',
    appDescription: 'Sign in to continue',
    showRememberMe: true,
    showForgotPassword: true,
    showRegistrationLink: true,
    showSocialProviders: true,
  },
};

// Minimal template - Clean, simple, focused
const minimalTemplate: TemplateDefinition = {
  id: 'minimal',
  name: 'Minimal',
  description: 'Clean and simple with focus on essential elements',
  category: 'minimal',
  previewGradient: 'from-gray-700 to-gray-900',
  accentColor: '#111827',
  styles: {
    colors: {
      primaryColor: '#111827',
      primaryHoverColor: '#000000',
      primaryActiveColor: '#000000',
      secondaryColor: '#6b7280',
      backgroundColor: '#ffffff',
      cardColor: '#ffffff',
      surfaceColor: '#f9fafb',
      textColor: '#111827',
      textSecondaryColor: '#6b7280',
      borderColor: '#e5e7eb',
      errorColor: '#dc2626',
      warningColor: '#f59e0b',
      successColor: '#16a34a',
      infoColor: '#0284c7',
    },
    typography: {
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
      fontFamilyFallback: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
      fontSizeBase: '15px',
      fontSizeSmall: '13px',
      fontSizeLarge: '17px',
      fontWeightNormal: 400,
      fontWeightMedium: 500,
      fontWeightBold: 600,
      lineHeight: '1.4',
      letterSpacing: '-0.01em',
    },
    spacing: {
      spacingUnit: '4px',
      spacingXs: '4px',
      spacingSm: '8px',
      spacingMd: '12px',
      spacingLg: '16px',
      spacingXl: '24px',
      spacing2xl: '32px',
      spacing3xl: '48px',
      borderRadius: '4px',
      borderRadiusSm: '2px',
      borderRadiusLg: '6px',
      borderRadiusFull: '4px',
    },
    borders: {
      borderWidth: '1px',
      borderStyle: 'solid',
      borderColor: '#e5e7eb',
      borderWidthFocus: '1px',
      borderColorFocus: '#111827',
      borderWidthError: '1px',
      borderColorError: '#dc2626',
    },
    shadows: {
      shadowSm: '0 1px 1px 0 rgb(0 0 0 / 0.05)',
      shadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
      shadowMd: '0 4px 6px -1px rgb(0 0 0 / 0.07)',
      shadowLg: '0 10px 15px -3px rgb(0 0 0 / 0.08)',
      shadowXl: '0 20px 25px -5px rgb(0 0 0 / 0.1)',
      shadowFocus: '0 0 0 2px rgb(17 24 39 / 0.1)',
      shadowCard: '0 1px 3px 0 rgb(0 0 0 / 0.1)',
    },
    customCss: '',
  },
  components: [
    { id: 'logo-1', type: 'logo', label: 'Logo', order: 0, visible: true, props: { size: 'small', alignment: 'left' } },
    { id: 'heading-1', type: 'heading', label: 'Heading', order: 1, visible: true, props: { content: 'Sign in', level: 2, alignment: 'left' } },
    { id: 'form-1', type: 'form', label: 'Login Form', order: 2, visible: true, props: { showUsername: true, showEmail: false } },
    { id: 'remember-me-1', type: 'rememberMe', label: 'Remember Me', order: 3, visible: true, props: {} },
    { id: 'forgot-password-1', type: 'forgotPassword', label: 'Forgot Password Link', order: 4, visible: true, props: { alignment: 'right' } },
    { id: 'registration-1', type: 'registrationLink', label: 'Registration Link', order: 5, visible: true, props: { text: 'Create account', alignment: 'center' } },
  ],
  assets: {},
  settings: {
    appTitle: 'Sign in',
    appDescription: '',
    showRememberMe: true,
    showForgotPassword: true,
    showRegistrationLink: true,
    showSocialProviders: false,
  },
};

// All available templates
const TEMPLATES: TemplateDefinition[] = [corporateTemplate, modernTemplate, minimalTemplate];

// ─── Props ──────────────────────────────────────────────────────────────────

interface ThemeTemplatesProps {
  onApplyTemplate: (template: {
    styles: ThemeStyles;
    components: ThemeComponent[];
    assets: Partial<ThemeAssets>;
    settings: Partial<ThemeSettings>;
  }) => void;
  currentTemplateId?: string | null;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ThemeTemplates({
  onApplyTemplate,
  currentTemplateId,
}: ThemeTemplatesProps) {
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'corporate' | 'modern' | 'minimal'>('all');
  const [applyingTemplateId, setApplyingTemplateId] = useState<string | null>(null);

  const filteredTemplates = selectedCategory === 'all'
    ? TEMPLATES
    : TEMPLATES.filter(t => t.category === selectedCategory);

  const handleApplyTemplate = (template: TemplateDefinition) => {
    setApplyingTemplateId(template.id);

    // Apply the template with a slight delay for visual feedback
    setTimeout(() => {
      onApplyTemplate({
        styles: template.styles,
        components: template.components,
        assets: template.assets,
        settings: template.settings,
      });
      setApplyingTemplateId(null);
    }, 300);
  };

  const categories = [
    { key: 'all' as const, label: 'All' },
    { key: 'corporate' as const, label: 'Corporate' },
    { key: 'modern' as const, label: 'Modern' },
    { key: 'minimal' as const, label: 'Minimal' },
  ];

  return (
    <div className="flex h-full flex-col bg-surface" data-testid="theme-templates">
      {/* Header */}
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-base font-semibold text-fg">Theme Templates</h2>
        <p className="mt-1 text-sm text-subtle">
          Choose a pre-built template to start with
        </p>
      </div>

      {/* Category filters */}
      <div className="flex gap-1 border-b border-line px-4 py-2">
        {categories.map((cat) => (
          <button
            key={cat.key}
            onClick={() => setSelectedCategory(cat.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              selectedCategory === cat.key
                ? 'bg-accent-soft text-accent'
                : 'text-muted hover:bg-hover'
            }`}
            data-testid={`template-category-${cat.key}`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Template gallery */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid gap-4">
          {filteredTemplates.map((template) => (
            <button
              key={template.id}
              onClick={() => handleApplyTemplate(template)}
              disabled={applyingTemplateId !== null}
              className={`group relative overflow-hidden rounded-xl border-2 bg-surface p-0 text-left transition-all hover:border-accent-soft hover:shadow-md ${
                currentTemplateId === template.id
                  ? 'border-accent ring-2 ring-indigo-200'
                  : 'border-line'
              } ${
                applyingTemplateId === template.id ? 'opacity-70' : ''
              }`}
              data-testid={`template-card-${template.id}`}
            >
              {/* Preview area */}
              <div className={`h-32 bg-gradient-to-br ${template.previewGradient} flex items-center justify-center`}>
                <div className="flex flex-col items-center gap-2">
                  {/* Mini preview of form elements */}
                  <div className="h-6 w-24 rounded bg-surface/20" />
                  <div className="h-8 w-32 rounded bg-surface/20" />
                  <div className="h-8 w-24 rounded bg-surface" />
                </div>
              </div>

              {/* Template info */}
              <div className="p-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-fg">{template.name}</h3>
                  <span
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-white"
                    style={{ backgroundColor: template.accentColor }}
                  >
                    {template.category}
                  </span>
                </div>
                <p className="mt-1 text-sm text-subtle">{template.description}</p>

                {/* Color preview dots */}
                <div className="mt-3 flex items-center gap-1">
                  <div
                    className="h-4 w-4 rounded-full border border-white shadow-sm"
                    style={{ backgroundColor: template.styles.colors.primaryColor }}
                  />
                  <div
                    className="h-4 w-4 rounded-full border border-white shadow-sm"
                    style={{ backgroundColor: template.styles.colors.backgroundColor }}
                  />
                  <div
                    className="h-4 w-4 rounded-full border border-white shadow-sm"
                    style={{ backgroundColor: template.styles.colors.cardColor }}
                  />
                  <div
                    className="h-4 w-4 rounded-full border border-white shadow-sm"
                    style={{ backgroundColor: template.styles.colors.textColor }}
                  />
                  <span className="ml-1 text-xs text-subtle">
                    {template.components.length} components
                  </span>
                </div>
              </div>

              {/* Apply indicator */}
              {applyingTemplateId === template.id && (
                <div className="absolute inset-0 flex items-center justify-center bg-surface/80">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent-soft border-t-indigo-600" />
                </div>
              )}

              {/* Hover overlay */}
              <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/5">
                <span className="rounded-lg bg-surface px-4 py-2 text-sm font-medium text-fg shadow-lg opacity-0 transition-opacity group-hover:opacity-100">
                  Apply Template
                </span>
              </div>

              {/* Current indicator */}
              {currentTemplateId === template.id && (
                <div className="absolute right-2 top-2 rounded-full bg-accent p-1">
                  <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Empty state for filtered category */}
        {filteredTemplates.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <svg
              className="h-12 w-12 text-gray-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
              />
            </svg>
            <p className="mt-2 text-sm text-subtle">No templates in this category</p>
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="border-t border-line px-4 py-3">
        <p className="text-xs text-subtle">
          Tip: You can customize the template after applying it using the Style Editor and Canvas
        </p>
      </div>
    </div>
  );
}

// Export template definitions for external use
export type { TemplateDefinition };