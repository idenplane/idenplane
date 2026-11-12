/** Shown while a page's code chunk loads. */
export default function PageFallback() {
  return (
    <div role="status" aria-live="polite" className="py-10 text-center text-sm text-subtle">
      Loading…
    </div>
  );
}
