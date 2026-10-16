import { tariffRules } from "@jw/content";
import Link from "next/link";
import { TariffForm } from "@/components/tariff-form";
import { formatDate } from "@/lib/tariff-view";

export function TariffLanding({
  partner,
  errorField,
}: {
  partner?: { slug: string; name: string; logoUrl: string | null } | null;
  errorField?: string;
}) {
  return (
    <div>
      {partner ? (
        <p className="notice flex items-center gap-3">
          {/* Partner logos are small external images Joe sets in admin, so a plain img is enough. */}
          {partner.logoUrl ? <img src={partner.logoUrl} alt="" className="h-8 w-auto" /> : null}
          <span>Shared with you by {partner.name}.</span>
        </p>
      ) : null}
      <h1 className="mb-3 text-[2rem] leading-tight font-semibold">Tariff Refund Tool</h1>
      <p className="text-[1.1rem] text-muted">
        The Supreme Court struck down the IEEPA tariffs. Answer ten questions to see which refund
        path fits your imports, the deadline that applies, and a summary you can send your customs
        broker. No entry files to upload.
      </p>
      <p className="text-[0.95rem] text-muted">
        Rules as of {formatDate(tariffRules.asOf)}. General information, not legal or customs
        advice. Also see the{" "}
        <Link href="/tariffrefund/calculator">landed-cost calculator</Link> for what imports cost
        today and on {tariffRules.calculator.futureLabel}.
      </p>
      {errorField ? (
        <p className="notice">One answer was missing or not valid. It is marked below.</p>
      ) : null}
      <TariffForm rules={tariffRules} partner={partner?.slug} errorField={errorField} />
    </div>
  );
}
