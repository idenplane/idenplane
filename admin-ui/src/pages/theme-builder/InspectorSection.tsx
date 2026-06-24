import { useState, type ReactNode } from 'react';

interface InspectorSectionProps {
    title: string;
    /** Optional short hint shown under the title when collapsed. */
    subtitle?: string;
    /** Whether the section starts expanded. */
    defaultOpen?: boolean;
    children: ReactNode;
}

/**
 * A single collapsible group inside the builder's right-hand Inspector.
 * Replaces the previous flat row of tabs with grouped, expandable sections.
 */
export default function InspectorSection({
    title,
    subtitle,
    defaultOpen = false,
    children,
}: InspectorSectionProps) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div className="border-b border-gray-200">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
                aria-expanded={open}
            >
                <span>
                    <span className="block text-sm font-semibold text-gray-900">{title}</span>
                    {subtitle && !open && (
                        <span className="block text-xs text-gray-400">{subtitle}</span>
                    )}
                </span>
                <svg
                    className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                >
                    <path
                        fillRule="evenodd"
                        d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                        clipRule="evenodd"
                    />
                </svg>
            </button>
            {open && <div className="px-1 pb-2">{children}</div>}
        </div>
    );
}
