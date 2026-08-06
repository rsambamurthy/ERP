import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-3xl font-semibold text-gray-900">ERP</h1>
      <p className="max-w-md text-gray-600">
        MSME ERP for Trading and Manufacturing businesses. Create your
        workspace to get started.
      </p>
      <Link
        href="/register"
        className="rounded-lg bg-brand-600 px-6 py-3 font-medium text-white hover:bg-brand-800"
      >
        Create your workspace
      </Link>
    </main>
  );
}
