import Logo from "./Logo";

// Shared shell for every public auth page (login/register/forgot-password/
// accept-invite). Uses the same navy/blue enterprise tokens as the
// authenticated app (see .auth-* classes in globals.css) — width is
// per-page since Login is a single form and Register is a wide accordion.
export default function AuthCard({
  children,
  width = 420,
}: {
  children: React.ReactNode;
  width?: number;
}) {
  return (
    <div className="auth-card" style={{ maxWidth: width }}>
      <div className="auth-card-hdr">
        <Logo size={30} />
        <div className="auth-card-brand">
          Smart<span className="auth-card-brand-b">ERP</span>
        </div>
      </div>
      <div className="auth-card-body">{children}</div>
      <div className="auth-card-ftr">Secure &amp; Private</div>
    </div>
  );
}
