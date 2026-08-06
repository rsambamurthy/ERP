import Logo from "./Logo";

export default function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-md overflow-hidden rounded-2xl border border-cream-200 bg-white shadow-sm">
      <div className="flex flex-col items-center gap-2 bg-gradient-to-b from-cream-100 to-cream-50 px-8 py-10">
        <Logo size={64} />
        <div className="mt-2 text-2xl font-bold">
          <span className="text-navy-800">Smart</span>
          <span className="text-terracotta-500">ERP</span>
        </div>
        <p className="text-xs text-gray-500">MSME accounting, inventory &amp; production.</p>
      </div>
      <div className="p-8">{children}</div>
    </div>
  );
}
