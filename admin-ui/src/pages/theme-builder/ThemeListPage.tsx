import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    archiveTheme,
    createTheme,
    deleteTheme,
    duplicateTheme,
    getThemes,
    publishTheme,
    setActiveTheme,
} from '../../api/themes';
import type { Theme } from '../../types/theme';
import { getErrorMessage } from '../../utils/getErrorMessage';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StatusBadge({ theme }: { theme: Theme }) {
    if (theme.published) {
        return (
            <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700">
                Published
            </span>
        );
    }
    return (
        <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600">
            Draft
        </span>
    );
}

function TypeBadge({ type }: { type: string }) {
    const colours: Record<string, string> = {
        login: 'bg-blue-100 text-blue-700',
        account: 'bg-purple-100 text-purple-700',
        email: 'bg-amber-100 text-amber-700',
        full: 'bg-indigo-100 text-indigo-700',
    };
    return (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${colours[type] ?? 'bg-gray-100 text-gray-600'}`}>
            {type}
        </span>
    );
}

// ─── Confirmation dialog (inline) ─────────────────────────────────────────────

function ConfirmDialog({
    message,
    onConfirm,
    onCancel,
}: {
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="w-80 rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
                <p className="text-sm text-gray-700">{message}</p>
                <div className="mt-4 flex justify-end gap-2">
                    <button
                        onClick={onCancel}
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
                    >
                        Confirm
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ThemeListPage() {
    const { name } = useParams<{ name: string }>();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const [deleteTarget, setDeleteTarget] = useState<Theme | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [actionSuccess, setActionSuccess] = useState<string | null>(null);
    const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

    const { data: themes, isLoading, error } = useQuery({
        queryKey: ['themes', name],
        queryFn: () => getThemes(name!),
        enabled: !!name,
    });

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['themes', name] });

    const flash = (msg: string, isError = false) => {
        if (isError) {
            setActionError(msg);
            setTimeout(() => setActionError(null), 4000);
        } else {
            setActionSuccess(msg);
            setTimeout(() => setActionSuccess(null), 3000);
        }
    };

    // ── Mutations ──────────────────────────────────────────────────────────────

    const deleteMutation = useMutation({
        mutationFn: (id: string) => deleteTheme(name!, id),
        onSuccess: () => { invalidate(); flash('Theme deleted.'); setDeleteTarget(null); },
        onError: (e) => { flash(getErrorMessage(e, 'Failed to delete theme.'), true); setDeleteTarget(null); },
    });

    const publishMutation = useMutation({
        mutationFn: (id: string) => publishTheme(name!, id),
        onSuccess: () => { invalidate(); flash('Theme published.'); },
        onError: (e) => flash(getErrorMessage(e, 'Failed to publish theme.'), true),
    });

    const activateMutation = useMutation({
        mutationFn: (id: string) => setActiveTheme(name!, id),
        onSuccess: () => { invalidate(); flash('Theme activated — it is now the active theme for this realm.'); },
        onError: (e) => flash(getErrorMessage(e, 'Failed to activate theme.'), true),
    });

    const archiveMutation = useMutation({
        mutationFn: (id: string) => archiveTheme(name!, id),
        onSuccess: () => { invalidate(); flash('Theme archived.'); },
        onError: (e) => flash(getErrorMessage(e, 'Failed to archive theme.'), true),
    });

    async function handleDuplicate(theme: Theme) {
        const newName = `${theme.name}-copy-${Date.now().toString(36)}`;
        setDuplicatingId(theme.id);
        try {
            await duplicateTheme(name!, theme.id, newName);
            await invalidate();
            flash(`Duplicated as "${newName}".`);
        } catch (e) {
            flash(getErrorMessage(e, 'Failed to duplicate theme.'), true);
        } finally {
            setDuplicatingId(null);
        }
    }

    async function handleNew() {
        try {
            const created = await createTheme(name!, {
                name: `theme-${Date.now().toString(36)}`,
                themeType: 'login',
            });
            await invalidate();
            navigate(`/console/realms/${name}/themes/${created.id}/edit`);
        } catch (e) {
            flash(getErrorMessage(e, 'Failed to create theme.'), true);
        }
    }

    // ── Render ─────────────────────────────────────────────────────────────────

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="text-gray-500">Loading themes…</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
                {getErrorMessage(error, 'Failed to load themes.')}
            </div>
        );
    }

    return (
        <div>
            {deleteTarget && (
                <ConfirmDialog
                    message={`Delete theme "${deleteTarget.name}"? This cannot be undone.`}
                    onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
                    onCancel={() => setDeleteTarget(null)}
                />
            )}

            {/* Page header */}
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Themes</h1>
                    <p className="mt-1 text-sm text-gray-500">
                        Manage login and branding themes for <span className="font-medium">{name}</span>
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => navigate(`/console/realms/${name}/themes/builder`)}
                        className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                        Open Builder
                    </button>
                    <button
                        onClick={handleNew}
                        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                    >
                        + New Theme
                    </button>
                </div>
            </div>

            {/* Feedback messages */}
            {actionSuccess && (
                <div className="mb-4 rounded-md bg-green-50 px-4 py-3 text-sm text-green-700">
                    {actionSuccess}
                </div>
            )}
            {actionError && (
                <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
                    {actionError}
                </div>
            )}

            {/* Table */}
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                <table className="min-w-full divide-y divide-gray-200" aria-label="Themes">
                    <thead className="bg-gray-50">
                        <tr>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Name</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Type</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Status</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Version</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Updated</th>
                            <th scope="col" className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {themes && themes.length > 0 ? (
                            themes.map((theme) => {
                                const busy =
                                    publishMutation.isPending ||
                                    activateMutation.isPending ||
                                    archiveMutation.isPending ||
                                    duplicatingId === theme.id ||
                                    deleteMutation.isPending;

                                return (
                                    <tr key={theme.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4">
                                            <div className="text-sm font-medium text-gray-900">{theme.displayName || theme.name}</div>
                                            {theme.displayName && (
                                                <div className="text-xs text-gray-400">{theme.name}</div>
                                            )}
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4">
                                            <TypeBadge type={theme.themeType} />
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4">
                                            <StatusBadge theme={theme} />
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                                            v{theme.version}
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                                            {new Date(theme.updatedAt).toLocaleDateString()}
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                {/* Edit */}
                                                <button
                                                    onClick={() => navigate(`/console/realms/${name}/themes/${theme.id}/edit`)}
                                                    className="rounded px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
                                                >
                                                    Edit
                                                </button>

                                                {/* Publish (only drafts) */}
                                                {!theme.published && (
                                                    <button
                                                        onClick={() => publishMutation.mutate(theme.id)}
                                                        disabled={busy}
                                                        className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-40"
                                                    >
                                                        Publish
                                                    </button>
                                                )}

                                                {/* Activate (only published) */}
                                                {theme.published && (
                                                    <button
                                                        onClick={() => activateMutation.mutate(theme.id)}
                                                        disabled={busy}
                                                        className="rounded px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                                                    >
                                                        Activate
                                                    </button>
                                                )}

                                                {/* Archive (only published) */}
                                                {theme.published && (
                                                    <button
                                                        onClick={() => archiveMutation.mutate(theme.id)}
                                                        disabled={busy}
                                                        className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-40"
                                                    >
                                                        Archive
                                                    </button>
                                                )}

                                                {/* Duplicate */}
                                                <button
                                                    onClick={() => handleDuplicate(theme)}
                                                    disabled={busy}
                                                    className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-40"
                                                >
                                                    {duplicatingId === theme.id ? '…' : 'Duplicate'}
                                                </button>

                                                {/* Delete */}
                                                <button
                                                    onClick={() => setDeleteTarget(theme)}
                                                    disabled={busy}
                                                    className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })
                        ) : (
                            <tr>
                                <td colSpan={6} className="px-6 py-12 text-center text-sm text-gray-500">
                                    No themes yet.{' '}
                                    <button
                                        onClick={handleNew}
                                        className="font-medium text-indigo-600 hover:underline"
                                    >
                                        Create your first theme
                                    </button>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
