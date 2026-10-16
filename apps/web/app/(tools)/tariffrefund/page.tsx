import type { Metadata } from "next";
import { TariffLanding } from "@/components/tariff-landing";

export const metadata: Metadata = {
  title: "Tariff Refund Tool",
  description:
    "Ten questions that show which IEEPA tariff refund path fits your imports, the deadline that applies, and what to send your customs broker.",
};

export default async function TariffRefundPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return <TariffLanding errorField={error} />;
}
