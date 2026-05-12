import { useParams, Link } from 'react-router-dom';
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
    LOW: { bg: 'bg-green-100', text: 'text-green-700' },
    MEDIUM: { bg: 'bg-yellow-100', text: 'text-yellow-700' },
    HIGH: { bg: 'bg-orange-100', text: 'text-orange-700' },
    CRITICAL: { bg: 'bg-red-100', text: 'text-red-700' },
  };
  const c = config[level] ?? { bg: 'bg-gray-100', text: 'text-gray-700' };
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
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
        Terminate Session
      </span>
    );
  }
  if (profile.stepUpRequired) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
        Step-up Required
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
      Normal
    </span>
  );
}

// ─── Score Display ────────────────────────────────────────────────────────────

function ScoreDisplay({ label, value, maxValue = 100 }: { label: string; value: number; maxValue?: number }) {
  const percentage = (value / maxValue) * 100;
  const colorClass =
    percentage >= 70 ? 'text-red-600' : percentage >= 40 ? 'text-yellow-600' : 'text-green-600';

  return (
    <div className="text-center">
      <div className={`text-3xl font-bold ${colorClass}`}>{value.toFixed(0)}</div>
      <div className="mt-1 text-xs text-gray-500">{label}</div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full ${percentage >= 70 ? 'bg-red-500' : percentage >= 40 ? 'bg-yellow-500' : 'bg-green-500'}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

// ─── Device Posture Card ──────────────────────────────────────────────────────

function DevicePostureCard({ posture }: { posture: DevicePostureRecord }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-900">Device Posture</h4>
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
          posture.complianceStatus === 'COMPLIANT' ? 'bg-green-100 text-green-700' :
          posture.complianceStatus === 'NON_COMPLIANT' ? 'bg-red-100 text-red-700' :
          'bg-gray-100 text-gray-700'
        }`}>
          {posture.complianceStatus}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <span className="text-gray-500">OS:</span>{' '}
          <span className="font-medium text-gray-900">{posture.osType} {posture.osVersion}</span>
        </div>
        <div>
          <span className="text-gray-500">Device Type:</span>{' '}
          <span className="font-medium text-gray-900">{posture.deviceType}</span>
        </div>
        <div>
          <span className="text-gray-500">Disk Encryption:</span>{' '}
          <span className={posture.diskEncryption ? 'text-green-600' : 'text-red-600'}>
            {posture.diskEncryption ? 'Yes' : 'No'}
          </span>
        </div>
        <div>
          <span className="text-gray-500">Screen Lock:</span>{' '}
          <span className={posture.screenLockEnabled ? 'text-green-600' : 'text-red-600'}>
            {posture.screenLockEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <div>
          <span className="text-gray-500">Managed:</span>{' '}
          <span className={posture.managedDevice ? 'text-green-600' : 'text-gray-600'}>
            {posture.managedDevice ? 'Yes' : 'No'}
          </span>
        </div>
        <div>
          <span className="text-gray-500">Jailbreak:</span>{' '}
          <span className={posture.jailbreakDetected ? 'text-red-600' : 'text-green-600'}>
            {posture.jailbreakDetected ? 'Detected' : 'Not Detected'}
          </span>
        </div>
        <div>
          <span className="text-gray-500">Firewall:</span>{' '}
          <span className={posture.firewallEnabled ? 'text-green-600' : 'text-gray-600'}>
            {posture.firewallEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <div>
          <span className="text-gray-500">Antivirus:</span>{' '}
          <span className={posture.antivirusActive ? 'text-green-600' : 'text-gray-600'}>
            {posture.antivirusActive ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      <div className="mt-3 border-t border-gray-100 pt-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500">Compliance Score</span>
          <span className={`font-semibold ${posture.complianceScore >= 80 ? 'text-green-600' : posture.complianceScore >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
            {posture.complianceScore}%
          </span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className={`h-full rounded-full ${posture.complianceScore >= 80 ? 'bg-green-500' : posture.complianceScore >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
            style={{ width: `${posture.complianceScore}%` }}
          />
        </div>
      </div>

      <p className="mt-2 text-xs text-gray-400">Last reported: {formatDate(posture.reportedAt)}</p>
    </div>
  );
}

// ─── Network Context Card ──────────────────────────────────────────────────────

function NetworkContextCard({ network }: { network: NetworkContextRecord }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-900">Network Context</h4>
        <div className="flex gap-1">
          {network.isVpn && (
            <span className="inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
              VPN
            </span>
          )}
          {network.isTor && (
            <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
              Tor
            </span>
          )}
          {network.isProxy && (
            <span className="inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
              Proxy
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="col-span-2">
          <span className="text-gray-500">IP Address:</span>{' '}
          <span className="font-medium text-gray-900">{network.ipAddress}</span>
          <span className="ml-2 text-gray-400">(IPv{network.ipVersion})</span>
        </div>
        {network.geoVelocityAnomaly && (
          <div className="col-span-2 rounded-md bg-yellow-50 px-2 py-1 text-yellow-700">
            Geo-velocity anomaly detected
          </div>
        )}
        {network.country && (
          <div>
            <span className="text-gray-500">Country:</span>{' '}
            <span className="font-medium text-gray-900">{network.country}</span>
          </div>
        )}
        {network.region && (
          <div>
            <span className="text-gray-500">Region:</span>{' '}
            <span className="font-medium text-gray-900">{network.region}</span>
          </div>
        )}
        {network.city && (
          <div>
            <span className="text-gray-500">City:</span>{' '}
            <span className="font-medium text-gray-900">{network.city}</span>
          </div>
        )}
        {network.isp && (
          <div className="col-span-2">
            <span className="text-gray-500">ISP:</span>{' '}
            <span className="font-medium text-gray-900">{network.isp}</span>
          </div>
        )}
        {network.networkType && (
          <div>
            <span className="text-gray-500">Network Type:</span>{' '}
            <span className="font-medium text-gray-900">{network.networkType}</span>
          </div>
        )}
        {network.ispRiskLevel && (
          <div>
            <span className="text-gray-500">ISP Risk:</span>{' '}
            <span className={`font-medium ${network.ispRiskLevel === 'HIGH' ? 'text-red-600' : network.ispRiskLevel === 'MEDIUM' ? 'text-yellow-600' : 'text-gray-900'}`}>
              {network.ispRiskLevel}
            </span>
          </div>
        )}
      </div>

      <p className="mt-2 text-xs text-gray-400">Captured: {formatDate(network.capturedAt)}</p>
    </div>
  );
}

// ─── Signal Type Badge ────────────────────────────────────────────────────────

function SignalTypeBadge({ type }: { type: string }) {
  const config: Record<string, { bg: string; text: string }> = {
    device_posture: { bg: 'bg-blue-100', text: 'text-blue-700' },
    network_context: { bg: 'bg-purple-100', text: 'text-purple-700' },
    behavioral_biometrics: { bg: 'bg-green-100', text: 'text-green-700' },
    impossible_travel: { bg: 'bg-red-100', text: 'text-red-700' },
    baseline_monitor: { bg: 'bg-gray-100', text: 'text-gray-700' },
  };
  const c = config[type] ?? { bg: 'bg-gray-100', text: 'text-gray-700' };
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
    NO_ACTION: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'No Action' },
    NOTIFY: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Notify' },
    STEP_UP_REQUIRED: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Step-up' },
    TERMINATE_SESSION: { bg: 'bg-red-100', text: 'text-red-700', label: 'Terminate' },
  };
  const c = config[action] ?? { bg: 'bg-gray-100', text: 'text-gray-600', label: action };
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
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
        No recent risk events for this session.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              Time
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              Signal
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              Risk Change
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              Action
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {events.slice(0, 10).map((event) => (
            <tr key={event.id} className="hover:bg-gray-50">
              <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                {formatDate(event.evaluatedAt)}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <SignalTypeBadge type={event.signalType} />
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <span className="text-gray-500">{event.riskScoreBefore.toFixed(0)}</span>
                <span className="mx-1 text-gray-400">→</span>
                <span className={event.riskScoreAfter > event.riskScoreBefore ? 'font-medium text-red-600' : 'font-medium text-green-600'}>
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
        <div className="text-gray-500">Loading session risk details...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
        Failed to load session risk details: {getErrorMessage(error, 'Unknown error')}
      </div>
    );
  }

  if (!sessionData) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
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
              to={`/console/realms/${realmName}/continuous-verification/dashboard`}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              ← Back to Dashboard
            </Link>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">Session Risk Details</h1>
          <p className="mt-1 text-sm text-gray-500">
            Session <span className="font-mono text-gray-700">{sessionId?.slice(0, 8)}...</span> for realm{' '}
            <span className="font-medium">{realmName}</span>
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowReevaluateConfirm(true)}
            disabled={reevaluateMutation.isPending}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {reevaluateMutation.isPending ? 'Re-evaluating...' : 'Re-evaluate Risk'}
          </button>
        </div>
      </div>

      {/* Error state from mutation */}
      {reevaluateMutation.isError && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          Re-evaluation failed: {getErrorMessage(reevaluateMutation.error, 'Unknown error')}
        </div>
      )}

      {/* Session Profile Overview */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Risk Profile</h2>
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
            <div className="mt-1 text-xs text-gray-500">Current Level</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 border-t border-gray-100 pt-4 text-sm sm:grid-cols-4">
          <div>
            <span className="text-gray-500">User ID:</span>{' '}
            <Link
              to={`/console/realms/${realmName}/users/${profile.userId}`}
              className="font-medium text-indigo-600 hover:text-indigo-900"
            >
              {profile.userId}
            </Link>
          </div>
          <div>
            <span className="text-gray-500">Session ID:</span>{' '}
            <span className="font-mono text-gray-700">{profile.sessionId.slice(0, 16)}...</span>
          </div>
          <div>
            <span className="text-gray-500">Last Evaluated:</span>{' '}
            <span className="text-gray-700">{formatDate(profile.lastEvaluatedAt)}</span>
          </div>
          <div>
            <span className="text-gray-500">Updated:</span>{' '}
            <span className="text-gray-700">{formatDate(profile.updatedAt)}</span>
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
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Signal Details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-md border border-gray-100 p-4">
            <h3 className="mb-2 text-sm font-medium text-gray-700">Device Posture</h3>
            <pre className="overflow-auto text-xs text-gray-600">
              {JSON.stringify(profile.devicePosture, null, 2)}
            </pre>
          </div>
          <div className="rounded-md border border-gray-100 p-4">
            <h3 className="mb-2 text-sm font-medium text-gray-700">Network Context</h3>
            <pre className="overflow-auto text-xs text-gray-600">
              {JSON.stringify(profile.networkContext, null, 2)}
            </pre>
          </div>
          <div className="rounded-md border border-gray-100 p-4">
            <h3 className="mb-2 text-sm font-medium text-gray-700">Behavioral Biometrics</h3>
            <pre className="overflow-auto text-xs text-gray-600">
              {JSON.stringify(profile.behavioralBiometrics, null, 2)}
            </pre>
          </div>
          <div className="rounded-md border border-gray-100 p-4">
            <h3 className="mb-2 text-sm font-medium text-gray-700">Impossible Travel</h3>
            <pre className="overflow-auto text-xs text-gray-600">
              {JSON.stringify(profile.impossibleTravel, null, 2)}
            </pre>
          </div>
        </div>
      </div>

      {/* Recent Risk Events */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Recent Risk Events</h2>
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