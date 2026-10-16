import Image from "next/image";
import headshot from "@/public/headshot3.png";

const roles: Array<{ years: string; title: string; co: string; extra?: string }> = [
  { years: "2018–2022", title: "Group Product Manager", co: "Coinbase" },
  { years: "2014–2017", title: "Co-Founder", co: "VetPronto", extra: " (mobile veterinary care)" },
  { years: "2009–2012", title: "Co-Founder", co: "RestEngine", extra: " (acquired by Twitter)" },
  { years: "2006–2008", title: "Business Development Manager", co: "Boost Mobile" },
  { years: "2003–2006", title: "Associate", co: "Sports Alliance" },
  { years: "2000–2001", title: "Senior Technical Consultant", co: "Akamai" },
  { years: "1999–2000", title: "Co-Founder, VP of Technology", co: "Todosport Network" },
  { years: "1996–1999", title: "Network Engineer", co: "Qualcomm" },
];

export default function Home() {
  return (
    <main>
      <h1>Joe Waltman</h1>
      <p className="lede">I build automation that removes manual work from operations.</p>

      <figure>
        <Image src={headshot} alt="Joe Waltman" width={320} height={320} priority />
      </figure>

      <section>
        <h2>What I do</h2>
        <p>
          I build software that removes repetitive manual work from operations. The intake,
          quoting, booking, and follow-through that pile up when work arrives from outside a
          business through channels the business does not control.
        </p>
        <p>
          I spent the past year deep in AI development, building things and working out where it
          is genuinely useful and where it is noise. Most of what gets marketed as AI for
          operations solves a problem that was never expensive. The work actually worth
          automating tends to be unglamorous: the same document produced fifty different ways for
          fifty different customers, the follow-up that never happens, the number nobody can see
          across the whole business.
        </p>
        <p>
          My focus is manufacturers, logistics operators, and construction firms. Smaller
          companies whose work arrives from larger, more automated counterparties on terms the
          smaller party does not set.
        </p>
      </section>

      <section>
        <h2>Background</h2>
        <ul className="roles">
          {roles.map((r) => (
            <li key={r.years}>
              <span className="years">{r.years}</span>
              <span className="role">
                <span className="title">{r.title}</span>, <span className="co">{r.co}</span>
                {r.extra}
              </span>
            </li>
          ))}
        </ul>

        <ul className="edu">
          <li>
            <strong>INSEAD</strong>, MBA
          </li>
          <li>
            <strong>University of Southern California</strong>, MS Computer Science
          </li>
          <li>
            <strong>UC Berkeley</strong>, BA International Relations, minor in Computer Science
          </li>
        </ul>
      </section>

      <section>
        <h2>What I{"’"}m working on now</h2>
        <p className="date">September 2026</p>
        <p>
          The same pattern keeps showing up in different industries. Work arrives from outside a
          business through a portal, an inbox, or a phone call, and someone inside re-types it
          into whatever system the company runs on. The volume climbs, because the larger party on
          the other end is automating faster than the smaller one can absorb. Off-the-shelf
          software does not solve it, because the work is specific to each counterparty and there
          is no recurring license in it, so no vendor builds it.
        </p>
        <p>
          In manufacturing that shows up in quotes arriving through customer procurement systems.
          In logistics it is booking requests coming in through half a dozen channels. In
          construction it is the paperwork a smaller firm has to produce inside every large
          client{"’"}s system.
        </p>
        <p>If you run an operation like this, I would like to hear about it.</p>
      </section>

      <section className="contact">
        <h2>Contact</h2>
        <p>
          <a href="mailto:joe@joewaltman.com">joe@joewaltman.com</a>
        </p>
        <p>
          <a href="tel:+14153435637">415 343 5637</a>
        </p>
        <p>San Diego, California</p>
      </section>
    </main>
  );
}
