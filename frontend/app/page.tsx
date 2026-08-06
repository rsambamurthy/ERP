import Link from "next/link";
import Logo from "@/components/ui/Logo";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <Logo size={64} />
      <h1 className="text-3xl font-bold">
        <span className="text-navy-800">Smart</span>
        <span className="text-terracotta-500">ERP</span>
      </h1>
      <p className="max-w-md text-gray-600">
        MSME accounting, inventory &amp; production for Trading and
        Manufacturing businesses. Create your workspace to get started.
      </p>
      <div className="flex gap-3">
        <Link
          href="/register"
          className="rounded-xl bg-terracotta-500 px-6 py-3 text-sm font-semibold text-white hover:bg-terracotta-600"
        >
          Create your workspace
        </Link>
        <Link
          href="/login"
          className="rounded-xl border border-cream-300 bg-white px-6 py-3 text-sm font-semibold text-navy-800 hover:bg-cream-50"
        >
          Log in
        </Link>
      </div>
    </main>
  );
}
