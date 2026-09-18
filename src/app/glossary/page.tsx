import { GLOSSARY } from "@/lib/glossary";

export const dynamic = "force-static";

// The glossary — the same content as docs/glossary.md, generated from src/lib/glossary.ts.
export default function GlossaryPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Glossary</h1>
        <p className="mt-1 text-sm text-slate-500">One term per concept, used the same way on every screen. Retired words used to mean the same thing somewhere in Rosie and no longer appear.</p>
        <nav className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {GLOSSARY.flatMap((s) => s.terms).map((t) => <a key={t.key} href={`#${t.key}`} className="text-rose-700 hover:underline">{t.term}</a>)}
        </nav>
      </div>
      {GLOSSARY.map((s) => (
        <section key={s.title} className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{s.title}</h2>
          {s.terms.map((t) => (
            <article key={t.key} id={t.key} className="rounded-xl border border-slate-200 bg-white p-4 scroll-mt-4">
              <h3 className="text-base font-semibold text-slate-900">{t.term}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-700">{t.definition}</p>
              <dl className="mt-2 space-y-1 text-xs text-slate-500">
                {t.retired?.length ? <div><dt className="inline font-semibold text-slate-600">Retired: </dt><dd className="inline">{t.retired.join(", ")}</dd></div> : null}
                {t.notThe ? <div><dt className="inline font-semibold text-slate-600">Not the same as: </dt><dd className="inline">{t.notThe}</dd></div> : null}
                {t.where ? <div><dt className="inline font-semibold text-slate-600">Where: </dt><dd className="inline">{t.where}</dd></div> : null}
              </dl>
            </article>
          ))}
        </section>
      ))}
      <p className="text-xs text-slate-400">Source of truth: <code>src/lib/glossary.ts</code>; <code>docs/glossary.md</code> is generated from it.</p>
    </div>
  );
}
