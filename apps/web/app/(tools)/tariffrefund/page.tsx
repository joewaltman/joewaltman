import type { Metadata } from "next";
import { SignupForm } from "@/components/signup-form";

export const metadata: Metadata = {
  title: "Tariff Refund Tool",
  description:
    "Find out which IEEPA tariff refund path applies to your imports, the deadline, and what to send your customs broker.",
};

export default async function TariffRefundPage({
  searchParams,
}: {
  searchParams: Promise<{ signup?: string; partner?: string }>;
}) {
  const { signup, partner } = await searchParams;
  return (
    <div className="prose-plain">
      <h1 className="mb-3 text-[2rem] leading-tight font-semibold">Tariff Refund Tool</h1>
      <p className="text-[1.1rem] text-muted">
        Ten questions that tell a small importer which IEEPA tariff refund path applies, the
        deadline that applies, and what to send their customs broker.
      </p>
      <p>
        This tool is being built now. Leave your email and you will get one note when it is ready.
      </p>
      <SignupForm
        tool="tariff"
        returnTo="/tariffrefund"
        status={signup}
        partner={partner}
        buttonLabel="Tell me when it is ready"
      />
    </div>
  );
}
