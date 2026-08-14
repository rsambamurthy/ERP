import { CheckIcon, ChevronIcon } from "../steps/stepIcons";

type StepStatus = "locked" | "active" | "complete";

interface Props {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  status: StepStatus;
  children: React.ReactNode;
}

export default function AccordionStep({ icon, title, subtitle, status, children }: Props) {
  const expanded = status === "active";

  return (
    <div className={`acc-step ${status}`}>
      <div className="acc-step-hdr">
        <span className="acc-step-icon">{status === "complete" ? <CheckIcon /> : icon}</span>
        <div className="acc-step-text">
          <div className="acc-step-title">{title}</div>
          <div className="acc-step-sub">{subtitle}</div>
        </div>
        {expanded && <ChevronIcon className="acc-step-chev open" />}
      </div>
      {expanded && <div className="acc-step-body">{children}</div>}
    </div>
  );
}
