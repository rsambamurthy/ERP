const STEPS = ["Sign up", "Verify", "Domain(s)", "Details", "Workspace"];

export default function StepIndicator({ current }: { current: number }) {
  return (
    <ol className="mb-8 flex w-full max-w-md items-center justify-between text-xs text-gray-500">
      {STEPS.map((label, i) => {
        const idx = i + 1;
        const active = idx === current;
        const done = idx < current;
        return (
          <li key={label} className="flex flex-1 flex-col items-center gap-1">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-medium ${
                done
                  ? "bg-brand-600 text-white"
                  : active
                  ? "border-2 border-brand-600 text-brand-800"
                  : "border border-gray-300 text-gray-400"
              }`}
            >
              {idx}
            </span>
            <span className={active ? "font-medium text-gray-800" : ""}>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
