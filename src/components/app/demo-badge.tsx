/** Marks sample content so nobody mistakes a judge-facing demonstration for a real school notice. */
export function DemoBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`pill border-warn/50 bg-warn/10 text-warn ${className}`}
      title="Sample content for the AfterSend demonstration. Not a real announcement."
    >
      Demo data
    </span>
  );
}