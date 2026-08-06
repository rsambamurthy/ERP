export default function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
      {children}
    </div>
  );
}
