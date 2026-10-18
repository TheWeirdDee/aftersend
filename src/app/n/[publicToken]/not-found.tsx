import Link from "next/link";

export default function NoticeNotFound() {
  return (
    <main id="main" className="mx-auto grid min-h-dvh max-w-[680px] place-items-center px-4 text-center">
      <div>
        <p className="eyebrow">Not found</p>
        <h1 className="mt-3 text-[32px] font-semibold tracking-[-0.04em]">This notice link doesn&apos;t exist.</h1>
        <p className="mt-3 text-[16px] text-muted">Check the link you were sent. It may have been mistyped, or the notice was never published.</p>
        <Link href="/" className="btn-secondary mt-8">
          About AfterSend
        </Link>
      </div>
    </main>
  );
}
