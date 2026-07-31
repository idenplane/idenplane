import type { StepType } from '../../api/authFlows';

// ─── Step type metadata ──────────────────────────────────────

export interface StepMeta {
  label: string;
  icon: string;
  color: string;
}

export const STEP_TYPE_META: Record<StepType, StepMeta> = {
  password: {
    label: 'Password',
    icon: '🔑',
    color: 'bg-info-soft border-info-soft',
  },
  totp: {
    label: 'TOTP',
    icon: '📱',
    color: 'bg-purple-50 border-purple-200',
  },
  webauthn: {
    label: 'WebAuthn',
    icon: '🔐',
    color: 'bg-accent-soft border-accent-soft',
  },
  social: {
    label: 'Social Login',
    icon: '🌐',
    color: 'bg-success-soft border-success-soft',
  },
  ldap: {
    label: 'LDAP',
    icon: '🗂️',
    color: 'bg-warning-soft border-warning-soft',
  },
  email_otp: {
    label: 'Email OTP',
    icon: '📧',
    color: 'bg-warning-soft border-warning-soft',
  },
  consent: {
    label: 'Consent',
    icon: '✅',
    color: 'bg-teal-50 border-teal-200',
  },
};
