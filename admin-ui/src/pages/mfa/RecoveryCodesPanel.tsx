import { useState } from 'react';
import { Alert, Button, Icons } from '../../components/ui';

/**
 * New recovery codes, shown once. The admin copies or downloads them and
 * says so; they are never shown again.
 */
export default function RecoveryCodesPanel({
  codes,
  onDone,
}: {
  codes: string[];
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const text = `Idenplane admin console recovery codes\nEach code works once.\n\n${codes.join('\n')}\n`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'idenplane-admin-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section
      aria-labelledby="recovery-codes-title"
      className="rounded-xl border border-warning/40 bg-warning-soft p-5"
    >
      <h2 id="recovery-codes-title" className="text-base font-semibold text-fg">
        Save your recovery codes
      </h2>
      <p className="mt-1 text-sm text-muted">
        If you lose your authenticator and passkeys, a recovery code signs you in instead. Each
        code works once. They are shown only now: store them somewhere safe, such as a password
        manager.
      </p>
      <ol
        className="mt-4 grid grid-cols-1 gap-2 font-mono text-[13px] text-fg sm:grid-cols-2"
        data-testid="recovery-codes"
      >
        {codes.map((code) => (
          <li key={code} className="rounded-md border border-line bg-surface px-3 py-1.5">
            {code}
          </li>
        ))}
      </ol>
      {copied && (
        <Alert variant="success" className="mt-3">
          Copied to the clipboard.
        </Alert>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" icon={Icons.Copy} onClick={() => void copy()}>
          Copy
        </Button>
        <Button size="sm" variant="secondary" icon={Icons.Download} onClick={download}>
          Download
        </Button>
        <Button size="sm" onClick={onDone}>
          I have saved them
        </Button>
      </div>
    </section>
  );
}
