type StepStatus = "locked" | "active" | "complete";

interface Props {
  index: number;
  title: string;
  status: StepStatus;
  children: React.ReactNode;
}

function StatusIcon({ status, index }: { status: StepStatus; index: number }) {
  if (status === "complete") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-terracotta-500 text-[11px] font-medium text-white">
        ✓
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-terracotta-500 text-[11px] font-medium text-terracotta-600">
        {index}
      </span>
    );
  }
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-cream-200 text-[11px] font-medium text-terracotta-700 opacity-50">
      {index}
    </span>
  );
}

export default function AccordionStep({ index, title, status, children }: Props) {
  const expanded = status === "active";

  return (
    <div className="border-b border-cream-200 last:border-b-0">
      <div
        className={`flex items-center gap-3 py-3 ${
          status === "locked" ? "opacity-50" : ""
        }`}
      >
        <StatusIcon status={status} index={index} />
        <span
          className={`text-sm ${
            expanded ? "font-semibold text-navy-800" : "font-medium text-terracotta-700"
          }`}
        >
          {title}
        </span>
      </div>
      {expanded && <div className="pb-5 pl-9">{children}</div>}
    </div>
  );
}
