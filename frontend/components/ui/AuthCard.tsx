import Logo from "./Logo";

// Matches SmartAppt Gold's actual login card (src/pages/LoginPage.tsx):
// 360px wide, 20px radius, cream border, a tall logo header band, white
// body, and a "Powered by" cream footer strip.
export default function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="w-full overflow-hidden border border-cream-200"
      style={{ maxWidth: 360, borderRadius: 20, boxShadow: "0 8px 32px rgba(0,0,0,0.13)" }}
    >
      <div className="flex flex-col items-center justify-center gap-2 border-b border-cream-200 bg-gradient-to-b from-cream-100 to-cream-50 py-10">
        <Logo size={56} />
        <div className="mt-1 text-xl font-bold">
          <span className="text-navy-800">Smart</span>
          <span className="text-terracotta-500">ERP</span>
        </div>
      </div>
      <div className="bg-white px-6 py-5">{children}</div>
      <div className="border-t border-cream-200 bg-cream-100 py-2.5 text-center text-[10px] text-terracotta-700">
        Secure &amp; Private
      </div>
    </div>
  );
}
