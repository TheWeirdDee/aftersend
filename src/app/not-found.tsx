import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto grid min-h-dvh max-w-[680px] place-items-center px-4 text-center">
      <div>
        <p className="eyebrow">404</p>
        <h1 className="mt-3 text-[32px] font-semibold tracking-[-0.04em]">Page not found.</h1>
        <Link href="/" className="btn-secondary mt-8">
          Go home
        </Link>
      </div>
    </main>
  );
}
