import {
  type CalcResult,
  type Range,
  type Scenario,
  computeLandedCost,
  tariffRules,
} from "@jw/content";
import { getDb } from "@jw/db";
import type { Metadata } from "next";
import Link from "next/link";
import { HandRaise } from "@/components/hand-raise";
import { SignupForm } from "@/components/signup-form";
import { type HtsLookup, lookupHts } from "@/lib/hts";
import { formatDate, isVerified, publicSources, publicTexts } from "@/lib/tariff-view";

export const metadata: Metadata = {
  title: "Landed-cost calculator",
  description:
    "The duty stack on your imports today and on January 1, 2027: base duty, Section 301 forced-labor tariff, Section 232, and per-entry fees.",
};

type Query = {
  category?: string;
  hts?: string;
  country?: string;
  usmca?: string;
  value?: string;
  shipments?: string;
  fee?: string;
  signup?: string;
  raised?: string;
};

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 ? 2 : 0 });
const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, "")}%`;
const range = (r: Range, f: (n: number) => string) =>
  r.low === r.high ? f(r.low) : `${f(r.low)} to ${f(r.high)}`;
const num = (v: string | undefined) => {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

function ScenarioTable({ today, future }: { today: Scenario; future: Scenario }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[0.95rem]">
        <thead>
          <tr className="border-b border-rule text-left">
            <th className="py-2 pr-4 font-semibold">Layer</th>
            <th className="py-2 pr-4 font-semibold whitespace-nowrap">{today.label}</th>
            <th className="py-2 font-semibold whitespace-nowrap">{future.label}</th>
          </tr>
        </thead>
        <tbody>
          {today.layers.map((layer, i) => {
            const next = future.layers[i]!;
            return (
              <tr key={layer.id} className="border-b border-rule align-top">
                <td className="py-2 pr-4">
                  {layer.label}
                  <div className="text-[0.85rem] text-muted">{layer.reason}</div>
                  {next.reason !== layer.reason ? (
                    <div className="text-[0.85rem] text-muted">From {future.label}: {next.reason}</div>
                  ) : null}
                </td>
                <td className="py-2 pr-4 whitespace-nowrap tabular-nums">
                  {layer.rate ? range(layer.rate, pct) : "Not included"}
                </td>
                <td className="py-2 whitespace-nowrap tabular-nums">
                  {next.rate ? range(next.rate, pct) : "Not included"}
                </td>
              </tr>
            );
          })}
          <tr className="border-b border-rule font-semibold">
            <td className="py-2 pr-4">Total rate{today.includesBaseRate ? "" : " (without base duty)"}</td>
            <td className="py-2 pr-4 whitespace-nowrap tabular-nums">{range(today.totalRate, pct)}</td>
            <td className="py-2 whitespace-nowrap tabular-nums">{range(future.totalRate, pct)}</td>
          </tr>
          <tr className="border-b border-rule">
            <td className="py-2 pr-4">Duty per shipment</td>
            <td className="py-2 pr-4 whitespace-nowrap tabular-nums">{range(today.dutyPerShipment, money)}</td>
            <td className="py-2 whitespace-nowrap tabular-nums">{range(future.dutyPerShipment, money)}</td>
          </tr>
          <tr className="border-b border-rule">
            <td className="py-2 pr-4">Duty per month</td>
            <td className="py-2 pr-4 whitespace-nowrap tabular-nums">{range(today.dutyPerMonth, money)}</td>
            <td className="py-2 whitespace-nowrap tabular-nums">{range(future.dutyPerMonth, money)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function BaseRateNote({ lookup }: { lookup: HtsLookup | null }) {
  if (!lookup) return null;
  if (lookup.status === "invalid") return <p className="notice">Enter an HTS code with 8 or 10 digits, or leave it blank.</p>;
  if (lookup.status === "unavailable")
    return <p className="notice">The USITC tariff schedule did not answer, so the base duty is left out. Try again later.</p>;
  if (lookup.status === "not-found")
    return (
      <p className="notice">
        No general rate was found for that code in the <a href={lookup.sourceUrl}>USITC schedule</a>, so the base duty is left out.
      </p>
    );
  return (
    <p className="text-[0.95rem]">
      Base duty for {lookup.rate.htsNumber}
      {lookup.rate.description ? ` (${lookup.rate.description})` : ""}: <strong>{lookup.rate.generalRateText}</strong>
      {lookup.rate.adValoremPct === null ? ", which is not a simple percent, so it is left out of the totals" : ""}.
      From the <a href={lookup.sourceUrl}>USITC Harmonized Tariff Schedule</a>, checked{" "}
      {lookup.fetchedAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.
    </p>
  );
}

function Fees({ result, shipments }: { result: CalcResult; shipments: number }) {
  const c = tariffRules.calculator;
  const mpfConfirmed = isVerified(tariffRules, c.mpfMinimum.facts);
  const broker = result.fees.brokerFeePerEntry;
  const perShipment = (mpfConfirmed ? result.fees.mpfMinimumPerEntry : 0) + (broker ?? 0);
  return (
    <section>
      <h2>Entry fees</h2>
      {publicTexts(c.deMinimis.note, tariffRules).map((t) => (
        <p key={t}>{t}</p>
      ))}
      <ul>
        {mpfConfirmed ? (
          <li>Merchandise processing fee: at least {money(result.fees.mpfMinimumPerEntry)} per entry.</li>
        ) : (
          <li>Merchandise processing fee: the amount is not confirmed here. Ask your broker.</li>
        )}
        <li>
          Your broker&apos;s fee:{" "}
          {broker !== null ? `${money(broker)} per entry` : "enter it above to include it"}
          {isVerified(tariffRules, c.brokerFee.facts)
            ? ` (typical: ${money(c.brokerFee.low)} to ${money(c.brokerFee.high)})`
            : ""}
          .
        </li>
      </ul>
      {perShipment > 0 ? (
        <p>
          Known entry fees: {money(perShipment)} per shipment, {money(perShipment * shipments)} per month.
        </p>
      ) : null}
    </section>
  );
}

export default async function CalculatorPage({ searchParams }: { searchParams: Promise<Query> }) {
  const q = await searchParams;
  const c = tariffRules.calculator;
  const category = c.categories.find((x) => x.id === q.category);
  const country = c.countries.find((x) => x.id === q.country);
  const value = num(q.value);
  const shipments = num(q.shipments);
  const fee = q.fee ? num(q.fee) : null;
  const ready = Boolean(category && country && value !== null && shipments !== null);

  const lookup = ready && q.hts?.trim() ? await lookupHts(getDb(), q.hts) : null;
  const baseRatePct = lookup?.status === "ok" ? lookup.rate.adValoremPct : null;
  const result = ready
    ? computeLandedCost(
        {
          categoryId: category!.id,
          countryId: country!.id,
          usmcaQualified: q.usmca === "yes",
          declaredValue: value!,
          shipmentsPerMonth: shipments!,
          baseRatePct,
          brokerFeePerEntry: fee,
        },
        tariffRules,
      )
    : null;

  const notes = result
    ? [
        ...publicTexts(category!.notes, tariffRules),
        ...publicTexts(country!.notes, tariffRules),
        ...publicTexts(c.s301.note, tariffRules),
      ]
    : [];
  const sources = result
    ? publicSources(
        [
          ...result.today.layers.flatMap((l) => l.facts),
          ...result.future.layers.flatMap((l) => l.facts),
          ...result.fees.facts,
          ...c.s301.facts,
        ],
        tariffRules,
      )
    : [];

  return (
    <div className="prose-plain">
      <h1 className="mb-3 text-[2rem] leading-tight font-semibold">Landed-cost calculator</h1>
      <p className="text-[1.1rem] text-muted">
        The duty stack on a product today and on {c.futureLabel}, plus the per-entry fees now that
        de minimis is suspended.
      </p>

      <form method="get" className="mt-6 grid max-w-md gap-3">
        <label className="grid gap-1">
          <span className="text-[0.95rem] font-semibold">What are you importing?</span>
          <select className="field" name="category" defaultValue={q.category ?? ""} required>
            <option value="" disabled>
              Choose one
            </option>
            {c.categories.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[0.95rem] font-semibold">
            HTS code <span className="font-normal text-muted">(optional, for the base duty)</span>
          </span>
          <input className="field" name="hts" defaultValue={q.hts ?? ""} inputMode="numeric" placeholder="9403.40.90" />
        </label>
        <label className="grid gap-1">
          <span className="text-[0.95rem] font-semibold">Country of origin</span>
          <select className="field" name="country" defaultValue={q.country ?? ""} required>
            <option value="" disabled>
              Choose one
            </option>
            {c.countries.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-start gap-2.5">
          <input className="mt-1.5 size-4 shrink-0" type="checkbox" name="usmca" value="yes" defaultChecked={q.usmca === "yes"} />
          <span>The goods qualify under USMCA (Canada or Mexico only)</span>
        </label>
        <label className="grid gap-1">
          <span className="text-[0.95rem] font-semibold">Declared value per shipment ($)</span>
          <input className="field" name="value" defaultValue={q.value ?? ""} inputMode="decimal" required />
        </label>
        <label className="grid gap-1">
          <span className="text-[0.95rem] font-semibold">Shipments per month</span>
          <input className="field" name="shipments" defaultValue={q.shipments ?? ""} inputMode="numeric" required />
        </label>
        <label className="grid gap-1">
          <span className="text-[0.95rem] font-semibold">
            Your broker&apos;s fee per entry ($) <span className="font-normal text-muted">(optional)</span>
          </span>
          <input className="field" name="fee" defaultValue={q.fee ?? ""} inputMode="decimal" />
        </label>
        <div>
          <button type="submit" className="btn">
            Calculate
          </button>
        </div>
      </form>

      {result ? (
        <section className="mt-10">
          <h2>Duty on {category!.label.toLowerCase()} from {country!.label}</h2>
          <BaseRateNote lookup={lookup} />
          <ScenarioTable today={result.today} future={result.future} />
          {notes.length > 0 ? (
            <ul className="mt-4">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
          <Fees result={result} shipments={shipments!} />
          <h2>Sources</h2>
          <ul>
            {sources.map((s) => (
              <li key={s.id}>
                {s.text}{" "}
                {s.sources.map((url, i) => (
                  <span key={url}>
                    <a href={url} rel="noopener noreferrer" target="_blank">
                      Source{s.sources.length > 1 ? ` ${i + 1}` : ""}
                    </a>{" "}
                  </span>
                ))}
                <span className="text-muted">(as of {formatDate(s.asOf)})</span>
              </li>
            ))}
          </ul>
          <p className="text-[0.9rem] text-muted">
            Rates as of {formatDate(tariffRules.asOf)}. An estimate, not a customs ruling. Your
            broker can confirm the classification and every rate.
          </p>
        </section>
      ) : null}

      <section>
        <h2>Get rate changes by email</h2>
        <p>One email when a rate or deadline in this tool changes. Nothing else.</p>
        <SignupForm tool="tariff" returnTo="/tariffrefund/calculator" status={q.signup} buttonLabel="Email me changes" />
      </section>

      <p className="mt-8">
        <Link href="/tariffrefund">Find your IEEPA refund path</Link>
      </p>

      <HandRaise
        tool="tariff"
        prompt="Recalculating landed cost every time a rate moves is manual work. Want it built into your quoting or ERP system?"
        returnTo="/tariffrefund/calculator"
        raised={q.raised === "1"}
      />
    </div>
  );
}
