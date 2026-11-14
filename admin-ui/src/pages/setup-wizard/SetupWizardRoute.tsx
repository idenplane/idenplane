/**
 * SetupWizardRoute — the `/console/setup` page.
 *
 * Mounted inside ProtectedRoute, so the admin signs in first. It asks the
 * server whether setup is still open (the wizard API is super-admin only and
 * refuses writes once setup is completed or skipped), and only then shows the
 * wizard. A finished setup shows a short notice with a link to the console
 * instead of the form.
 */

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { isAxiosError } from 'axios';
import type { ReactNode } from 'react';
import { getWizardStatus } from '../../api/wizard';
import { WizardProvider } from '../../context/WizardContext';
import PageFallback from '../../components/PageFallback';
import SetupWizardPage from './SetupWizardPage';

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-sunken px-4">
      <div className="mx-auto w-full max-w-lg rounded-lg bg-surface p-8 text-center shadow-lg">
        <h1 className="text-2xl font-bold text-fg">{title}</h1>
        <div className="mt-2 text-sm text-subtle">{children}</div>
        <Link
          to="/console"
          className="mt-6 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Go to the admin console
        </Link>
      </div>
    </div>
  );
}

export default function SetupWizardRoute() {
  const { data, error, isPending } = useQuery({
    queryKey: ['setup-wizard', 'status'],
    queryFn: getWizardStatus,
  });

  if (isPending) return <PageFallback />;

  if (error) {
    const forbidden = isAxiosError(error) && error.response?.status === 403;
    return (
      <Notice title={forbidden ? 'Super-admin required' : 'Setup wizard unavailable'}>
        {forbidden
          ? 'Only a super-admin can run the setup wizard. Sign in with a super-admin account or the admin API key.'
          : 'The setup wizard status could not be loaded. Try again later.'}
      </Notice>
    );
  }

  if (data.wizardCompleted || data.wizardSkipped) {
    return (
      <Notice title="Setup is already complete">
        {data.wizardCompleted
          ? 'The setup wizard has been completed and cannot be run again.'
          : 'The setup wizard was skipped and cannot be run again.'}{' '}
        Manage realms, users and clients from the admin console.
      </Notice>
    );
  }

  return (
    <WizardProvider initialState={{ currentStep: Math.min(data.currentStep, data.totalSteps - 1) }}>
      <SetupWizardPage />
    </WizardProvider>
  );
}
