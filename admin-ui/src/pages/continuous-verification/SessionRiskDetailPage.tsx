import { useParams, Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getSessionRisk,
  getDevicePosture,
  getNetworkContext,
  type SessionProfileDetail,
  type DevicePostureRecord,
  type NetworkContextRecord,
  type ContinuousRiskEvent,
} from '../../api/continuousVerification';
import { getErrorMessage } from '../../utils/getErrorMessage';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useState } from 'react';

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatDate(date: string) {
  return new Date(date).toLocaleString();
}

// ─── Risk Level Badge ─────────────────────────────────────────────────────────

function RiskLevelBadge({ level }: { level: string }) {
  const config: Record<string, { bg: string; text: string }> = {
    LOW: { bg: 'bg-success-soft', text: 'text-success-fg' },
    MEDIUM: { bg: 'bg-warning-soft', text: 'text-warning-fg' },
    HIGH: { bg: 'bg-warning-soft', text: 'text-warning-fg' },
    CRITICAL: { bg: 'bg-danger-soft', text: 'text-danger-fg' },
  };
  const c = config[level] ?? { bg: 'bg-sunken', text: 'text-muted' };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${c.bg} ${c.text}`}>
      {level}
    </span>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ profile }: { profile: SessionProfileDetail['profile'] }) {
  if (profile.terminateSession) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger-fg">
        Terminate Session
      </span>
    );
  }
  if (profile.stepUpRequired) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning-fg">
        Step-up Required
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success-fg">
      Normal
    </span>
  );
}

// ─── Score Display ────────────────────────────────────────────────────────────

function ScoreDisplay({ label, value, maxValue = 100 }: { label: string; value: number; maxValue?: number }) {
  const percentage = (value / maxValue) * 100;
  const colorClass =
    percentage >= 70 ? 'text-danger' : percentage >= 40 ? 'text-warning' : 'text-success';

  return (
    <div className="text-center">
      <div className={`text-3xl font-bold ${colorClass}`}>{value.toFixed(0)}</div>
      <div className="mt-1 text-xs text-subtle">{label}</div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-sunken">
        <div
          className={`h-full rounded-full ${percentage >= 70 ? 'bg-danger' : percentage >= 40 ? 'bg-warning' : 'bg-success'}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

// ─── Device Posture Card ──────────────────────────────────────────────────────

function DevicePostureCard({ posture }: { posture: DevicePostureRecord }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-fg">Device Posture</h4>
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
          posture.complianceStatus === 'COMPLIANT' ? 'bg-success-soft text-success-fg' :
          posture.complianceStatus === 'NON_COMPLIANT' ? 'bg-danger-soft text-danger-fg' :
          'bg-sunken text-muted'
        }`}>
          {posture.complianceStatus}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <span className="text-subtle">OS:</span>{' '}
          <span className="font-medium text-fg">{posture.osType} {posture.osVersion}</span>
        </div>
        <div>
          <span className="text-subtle">Device Type:</span>{' '}
          <span className="font-medium text-fg">{posture.deviceType}</span>
        </div>
        <div>
          <span className="text-subtle">Disk Encryption:</span>{' '}
          <span className={posture.diskEncryption ? 'text-success' : 'text-danger'}>
            {posture.diskEncryption ? 'Yes' : 'No'}
          </span>
        </div>
        <div>
          <span className="text-subtle">Screen Lock:</span>{' '}
          <span className={posture.screenLockEnabled ? 'text-success' : 'text-danger'}>
            {posture.screenLockEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <div>
          <span className="text-subtle">Managed:</span>{' '}
          <span className={posture.managedDevice ? 'text-success' : 'text-muted'}>
            {posture.managedDevice ? 'Yes' : 'No'}
          </span>
        </div>
        <div>
          <span className="text-subtle">Jailbreak:</span>{' '}
          <span className={posture.jailbreakDetected ? 'text-danger' : 'text-success'}>
            {posture.jailbreakDetected ? 'Detected' : 'Not Detected'}
          </span>
        </div>
        <div>
          <span className="text-subtle">Firewall:</span>{' '}
          <span className={posture.firewallEnabled ? 'text-success' : 'text-muted'}>
            {posture.firewallEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <div>
          <span className="text-subtle">Antivirus:</span>{' '}
          <span className={posture.antivirusActive ? 'text-success' : 'text-muted'}>
            {posture.antivirusActive ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      <div className="mt-3 border-t border-line pt-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-subtle">Compliance Score</span>
          <span className={`font-semibold ${posture.complianceScore >= 80 ? 'text-success' : posture.complianceScore >= 50 ? 'text-warning' : 'text-danger'}`}>
            {posture.complianceScore}%
          </span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-sunken">
          <div
            className={`h-full rounded-full ${posture.complianceScore >= 80 ? 'bg-success' : posture.complianceScore >= 50 ? 'bg-warning' : 'bg-danger'}`}
            style={{ width: `${posture.complianceScore}%` }}
          />
        </div>
      </div>

      <p className="mt-2 text-xs text-subtle">Last reported: {formatDate(posture.reportedAt)}</p>
    </div>
  );
}

// ─── Network Context Card ──────────────────────────────────────────────────────

function NetworkContextCard({ network }: { network: NetworkContextRecord }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-fg">Network Context</h4>
        <div className="flex gap-1">
          {network.isVpn && (
            <span className="inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
              VPN
            </span>
          )}
          {network.isTor && (
            <span className="inline-flex rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger-fg">
              Tor
            </span>
          )}
          {network.isProxy && (
            <span className="inline-flex rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning-fg">
              Proxy
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="col-span-2">
          <span className="text-subtle">IP Address:</span>{' '}
          <span className="font-medium text-fg">{network.ipAddress}</span>
          <span className="ml-2 text-subtle">(IPv{network.ipVersion})</span>
        </div>
        {network.geoVelocityAnomaly && (
          <div className="col-span-2 rounded-md bg-warning-soft px-2 py-1 text-warning-fg">
            Geo-velocity anomaly detected
          </div>
        )}
        {network.country && (
          <div>
            <span className="text-subtle">Country:</span>{' '}
            <span className="font-medium text-fg">{network.country}</span>
          </div>
        )}
        {network.region && (
          <div>
            <span className="text-subtle">Region:</span>{' '}
            <span className="font-medium text-fg">{network.region}</span>
          </div>
        )}
        {network.city && (
          <div>
            <span className="text-subtle">City:</span>{' '}
            <span className="font-medium text-fg">{network.city}</span>
          </div>
        )}
        {network.isp && (
          <div className="col-span-2">
            <span className="text-subtle">ISP:</span>{' '}
            <span className="font-medium text-fg">{network.isp}</span>
          </div>
        )}
        {network.networkType && (
          <div>
            <span className="text-subtle">Network Type:</span>{' '}
            <span className="font-medium text-fg">{network.networkType}</span>
          </div>
        )}
        {network.ispRiskLevel && (
          <div>
            <span className="text-subtle">ISP Risk:</span>{' '}
            <span className={`font-medium ${network.ispRiskLevel === 'HIGH' ? 'text-danger' : network.ispRiskLevel === 'MEDIUM' ? 'text-warning' : 'text-fg'}`}>
              {network.ispRiskLevel}
            </span>
          </div>
        )}
      </div>

      <p className="mt-2 text-xs text-subtle">Captured: {formatDate(network.capturedAt)}</p>
    </div>
  );
}

// ─── Signal Type Badge ────────────────────────────────────────────────────────

function SignalTypeBadge({ type }: { type: string }) {
  const config: Record<string, { bg: string; text: string }> = {
    device_posture: { bg: 'bg-info-soft', text: 'text-info-fg' },
    network_context: { bg: 'bg-purple-100', text: 'text-purple-700' },
    behavioral_biometrics: { bg: 'bg-success-soft', text: 'text-success-fg' },
    impossible_travel: { bg: 'bg-danger-soft', text: 'text-danger-fg' },
    baseline_monitor: { bg: 'bg-sunken', text: 'text-muted' },
  };
  const c = config[type] ?? { bg: 'bg-sunken', text: 'text-muted' };
  const label = type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${c.bg} ${c.text}`}>
      {label}
    </span>
  );
}

// ─── Action Badge ─────────────────────────────────────────────────────────────

function ActionBadge({ action }: { action: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    NO_ACTION: { bg: 'bg-sunken', text: 'text-muted', label: 'No Action' },
    NOTIFY: { bg: 'bg-info-soft', text: 'text-info-fg', label: 'Notify' },
    STEP_UP_REQUIRED: { bg: 'bg-warning-soft', text: 'text-warning-fg', label: 'Step-up' },
    TERMINATE_SESSION: { bg: 'bg-danger-soft', text: 'text-danger-fg', label: 'Terminate' },
  };
  const c = config[action] ?? { bg: 'bg-sunken', text: 'text-muted', label: action };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

// ─── Recent Events Table ──────────────────────────────────────────────────────

function RecentEventsTable({ events }: { events: ContinuousRiskEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-surface p-6 text-center text-sm text-subtle">
        No recent risk events for this session.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
      <table className="min-w-full divide-y divide-line text-sm">
        <thead className="bg-sunken">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
              Time
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
              Signal
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
              Risk Change
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
              Action
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {events.slice(0, 10).map((event) => (
            <tr key={event.id} className="hover:bg-hover">
              <td className="whitespace-nowrap px-4 py-3 text-xs text-subtle">
                {formatDate(event.evaluatedAt)}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <SignalTypeBadge type={event.signalType} />
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <span className="text-subtle">{event.riskScoreBefore.toFixed(0)}</span>
                <span className="mx-1 text-subtle">→</span>
                <span className={event.riskScoreAfter > event.riskScoreBefore ? 'font-medium text-danger' : 'font-medium text-success'}>
                  {event.riskScoreAfter.toFixed(0)}
                </span>
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <ActionBadge action={event.action} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SessionRiskDetailPage() {
  const { name: realmName, sessionId } = useParams<{ name: string; sessionId: string }>();
  const queryClient = useQueryClient();
  const [showReevaluateConfirm, setShowReevaluateConfirm] = useState(false);

  const { data: sessionData, isLoading, error } = useQuery<SessionProfileDetail>({
    queryKey: ['sessionRisk', realmName, sessionId],
    queryFn: () => getSessionRisk(realmName!, sessionId!),
    enabled: !!realmName && !!sessionId,
    refetchInterval: 30_000,
  });

  const { data: devicePosture } = useQuery<DevicePostureRecord[]>({
    queryKey: ['devicePosture', realmName, sessionId],
    queryFn: () => getDevicePosture(realmName!, sessionId!),
    enabled: !!realmName && !!sessionId,
  });

  const { data: networkContext } = useQuery<NetworkContextRecord[]>({
    queryKey: ['networkContext', realmName, sessionId],
    queryFn: () => getNetworkContext(realmName!, sessionId!),
    enabled: !!realmName && !!sessionId,
  });

  const reevaluateMutation = useMutation({
    mutationFn: async () => {
      const { triggerSessionRiskReevaluation } = await import('../../api/continuousVerification');
      return triggerSessionRiskReevaluation(realmName!, sessionId!);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessionRisk', realmName, sessionId] });
      setShowReevaluateConfirm(false);
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-subtle">Loading session risk details...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">
        Failed to load session risk details: {getErrorMessage(error, 'Unknown error')}
      </div>
    );
  }

  if (!sessionData) {
    return (
      <div className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">
        Session not found.
      </div>
    );
  }

  const { profile, recentEvents } = sessionData;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Link
              to={`/console/realms/${realmName}/risk-dashboard`}
              className="text-sm text-subtle hover:text-fg"
            >
              ← Back to Dashboard
            </Link>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-fg">Session Risk Details</h1>
          <p className="mt-1 text-sm text-subtle">
            Session <span className="font-mono text-muted">{sessionId?.slice(0, 8)}...</span> for realm{' '}
            <span className="font-medium">{realmName}</span>
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowReevaluateConfirm(true)}
            disabled={reevaluateMutation.isPending}
            className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-muted hover:bg-hover disabled:opacity-50"
          >
            {reevaluateMutation.isPending ? 'Re-evaluating...' : 'Re-evaluate Risk'}
          </button>
        </div>
      </div>

      {/* Error state from mutation */}
      {reevaluateMutation.isError && (
        <div className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">
          Re-evaluation failed: {getErrorMessage(reevaluateMutation.error, 'Unknown error')}
        </div>
      )}

      {/* Session Profile Overview */}
      <div className="rounded-lg border border-line bg-surface p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-fg">Risk Profile</h2>
          <StatusBadge profile={profile} />
        </div>

        <div className="mb-6 grid grid-cols-2 gap-8 sm:grid-cols-4">
          <ScoreDisplay label="Risk Score" value={profile.riskScore} />
          <ScoreDisplay label="Trust Score" value={profile.trustScore} />
          <ScoreDisplay label="Risk Level" value={
            profile.riskLevel === 'CRITICAL' ? 100 :
            profile.riskLevel === 'HIGH' ? 75 :
            profile.riskLevel === 'MEDIUM' ? 50 : 25
          } />
          <div className="text-center">
            <RiskLevelBadge level={profile.riskLevel} />
            <div className="mt-1 text-xs text-subtle">Current Level</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 border-t border-line pt-4 text-sm sm:grid-cols-4">
          <div>
            <span className="text-subtle">User ID:</span>{' '}
            <Link
              to={`/console/realms/${realmName}/users/${profile.userId}`}
              className="font-medium text-accent hover:text-accent"
            >
              {profile.userId}
            </Link>
          </div>
          <div>
            <span className="text-subtle">Session ID:</span>{' '}
            <span className="font-mono text-muted">{profile.sessionId.slice(0, 16)}...</span>
          </div>
          <div>
            <span className="text-subtle">Last Evaluated:</span>{' '}
            <span className="text-muted">{formatDate(profile.lastEvaluatedAt)}</span>
          </div>
          <div>
            <span className="text-subtle">Updated:</span>{' '}
            <span className="text-muted">{formatDate(profile.updatedAt)}</span>
          </div>
        </div>
      </div>

      {/* Context Cards */}
      <div className="grid gap-4 lg:grid-cols-2">
        {devicePosture && devicePosture.length > 0 && (
          <DevicePostureCard posture={devicePosture[devicePosture.length - 1]} />
        )}
        {networkContext && networkContext.length > 0 && (
          <NetworkContextCard network={networkContext[networkContext.length - 1]} />
        )}
      </div>

      {/* Signal Details */}
      <div className="rounded-lg border border-line bg-surface p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-fg">Signal Details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-md border border-line p-4">
            <h3 className="mb-2 text-sm font-medium text-muted">Device Posture</h3>
            <pre className="overflow-auto text-xs text-muted">
              {JSON.stringify(profile.devicePosture, null, 2)}
            </pre>
          </div>
          <div className="rounded-md border border-line p-4">
            <h3 className="mb-2 text-sm font-medium text-muted">Network Context</h3>
            <pre className="overflow-auto text-xs text-muted">
              {JSON.stringify(profile.networkContext, null, 2)}
            </pre>
          </div>
          <div className="rounded-md border border-line p-4">
            <h3 className="mb-2 text-sm font-medium text-muted">Behavioral Biometrics</h3>
            <pre className="overflow-auto text-xs text-muted">
              {JSON.stringify(profile.behavioralBiometrics, null, 2)}
            </pre>
          </div>
          <div className="rounded-md border border-line p-4">
            <h3 className="mb-2 text-sm font-medium text-muted">Impossible Travel</h3>
            <pre className="overflow-auto text-xs text-muted">
              {JSON.stringify(profile.impossibleTravel, null, 2)}
            </pre>
          </div>
        </div>
      </div>

      {/* Recent Risk Events */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-fg">Recent Risk Events</h2>
        <RecentEventsTable events={recentEvents} />
      </div>

      <ConfirmDialog
        isOpen={showReevaluateConfirm}
        title="Re-evaluate Session Risk"
        message="Are you sure you want to trigger a re-evaluation of this session's risk profile? This will reassess all risk signals immediately."
        onConfirm={() => reevaluateMutation.mutate()}
        onCancel={() => setShowReevaluateConfirm(false)}
      />
    </div>
  );
}