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
    color: 'bg-blue-50 border-blue-200',
  },
  totp: {
    label: 'TOTP',
    icon: '📱',
    color: 'bg-purple-50 border-purple-200',
  },
  webauthn: {
    label: 'WebAuthn',
    icon: '🔐',
    color: 'bg-indigo-50 border-indigo-200',
  },
  social: {
    label: 'Social Login',
    icon: '🌐',
    color: 'bg-green-50 border-green-200',
  },
  ldap: {
    label: 'LDAP',
    icon: '🗂️',
    color: 'bg-yellow-50 border-yellow-200',
  },
  email_otp: {
    label: 'Email OTP',
    icon: '📧',
    color: 'bg-orange-50 border-orange-200',
  },
  consent: {
    label: 'Consent',
    icon: '✅',
    color: 'bg-teal-50 border-teal-200',
  },
};
