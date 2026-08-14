"use client";

import { useState } from "react";
import Input from "../ui/Input";
import Button from "../ui/Button";
import type {
  DomainCode,
  DomainDetailsMap,
  ManufacturingDetails,
  TradingDetails,
} from "@/lib/types";

interface Props {
  domains: DomainCode[];
  loading: boolean;
  error: string | null;
  onSubmit: (details: DomainDetailsMap) => void;
}

const emptyTrading: TradingDetails = {
  gstin: "",
  businessType: "RETAILER",
  primaryCategories: "",
};

const emptyManufacturing: ManufacturingDetails = {
  gstin: "",
  industryType: "",
  hasBom: true,
};

export default function DomainDetailsStep({ domains, loading, error, onSubmit }: Props) {
  const [trading, setTrading] = useState<TradingDetails>(emptyTrading);
  const [manufacturing, setManufacturing] = useState<ManufacturingDetails>(
    emptyManufacturing
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const details: DomainDetailsMap = {};
    if (domains.includes("TRADING")) details.TRADING = trading;
    if (domains.includes("MANUFACTURING")) details.MANUFACTURING = manufacturing;
    onSubmit(details);
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
      {domains.includes("TRADING") && (
        <fieldset className="auth-fieldset flex flex-col gap-3">
          <legend className="auth-legend">Trading</legend>
          <Input
            label="GSTIN"
            required
            maxLength={15}
            value={trading.gstin}
            onChange={(e) => setTrading((t) => ({ ...t, gstin: e.target.value }))}
          />
          <div className="auth-fg">
            <label className="auth-fl">Business type</label>
            <select
              className="auth-fc"
              value={trading.businessType}
              onChange={(e) =>
                setTrading((t) => ({
                  ...t,
                  businessType: e.target.value as TradingDetails["businessType"],
                }))
              }
            >
              <option value="RETAILER">Retailer</option>
              <option value="WHOLESALER">Wholesaler</option>
              <option value="DISTRIBUTOR">Distributor</option>
            </select>
          </div>
          <Input
            label="Primary categories (optional)"
            value={trading.primaryCategories}
            onChange={(e) =>
              setTrading((t) => ({ ...t, primaryCategories: e.target.value }))
            }
          />
        </fieldset>
      )}

      {domains.includes("MANUFACTURING") && (
        <fieldset className="auth-fieldset flex flex-col gap-3">
          <legend className="auth-legend">Manufacturing</legend>
          <Input
            label="GSTIN"
            required
            maxLength={15}
            value={manufacturing.gstin}
            onChange={(e) =>
              setManufacturing((m) => ({ ...m, gstin: e.target.value }))
            }
          />
          <Input
            label="Industry type"
            required
            value={manufacturing.industryType}
            onChange={(e) =>
              setManufacturing((m) => ({ ...m, industryType: e.target.value }))
            }
          />
          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-muted)" }}>
            <input
              type="checkbox"
              checked={manufacturing.hasBom}
              onChange={(e) =>
                setManufacturing((m) => ({ ...m, hasBom: e.target.checked }))
              }
            />
            Production uses BOM / WIP tracking
          </label>
        </fieldset>
      )}

      {error && <p className="auth-err">{error}</p>}
      <Button type="submit" loading={loading}>
        Create workspace
      </Button>
    </form>
  );
}
