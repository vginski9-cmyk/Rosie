"use client";

import { useEffect, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { saveCourseDates } from "@/lib/actions";

export interface SeqCourse {
  id: string;
  code?: string | null;
  name: string;
  termId: string;
  requisites?: string | null;
  classCount: number;
  labCount: number;
  clinicalCount: number;
}
export interface SeqTerm {
  id: string;
  name: string;
  courseCount?: number;
}

const CODE_RE = /[A-Z]{2,4}-\d{3}/g;

function CourseCard({ course, dragging, issues }: { course: SeqCourse; dragging?: boolean; issues?: string[] }) {
  return (
    <div className={`rounded-lg border bg-white p-3 shadow-sm ${issues && issues.length ? "border-amber-400 ring-1 ring-amber-200" : dragging ? "border-rose-400 shadow-md" : "border-slate-200"}`}>
      <div className="text-sm font-medium">
        {course.code ? <span className="text-slate-400">{course.code} · </span> : null}
        {course.name}
      </div>
      <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
        {course.classCount > 0 && <span className="badge bg-sky-100 text-sky-700">{course.classCount} class sessions</span>}
        {course.labCount > 0 && <span className="badge bg-violet-100 text-violet-700">{course.labCount} lab sessions</span>}
        {course.clinicalCount > 0 && <span className="badge bg-rose-100 text-rose-700">{course.clinicalCount} clinical sessions</span>}
      </div>
      {issues && issues.length > 0 && (
        <div className="mt-1.5 rounded bg-amber-50 px-1.5 py-1 text-[10px] font-medium text-amber-800">
          ⚠ prerequisite{issues.length > 1 ? "s" : ""} {issues.join(", ")} scheduled after this course
        </div>
      )}
    </div>
  );
}

function SortableCourse({ course, issues, dateSlot }: { course: SeqCourse; issues?: string[]; dateSlot?: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: course.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  return (
    <div ref={setNodeRef} style={style}>
      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing">
        <CourseCard course={course} issues={issues} />
      </div>
      {dateSlot}
    </div>
  );
}

function TermColumn({ term, courses, issuesByCourse, onRemove, dateSlotFor }: { term: SeqTerm; courses: SeqCourse[]; issuesByCourse: Record<string, string[]>; onRemove: (id: string) => void; dateSlotFor?: (course: SeqCourse) => React.ReactNode }) {
  // The column itself is droppable via an empty sortable context that accepts the term id.
  const { setNodeRef } = useSortable({ id: `term:${term.id}`, data: { isContainer: true, termId: term.id } });
  return (
    <div className="flex w-72 shrink-0 flex-col">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">{term.name}</span>
        <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
          {courses.length} course{courses.length === 1 ? "" : "s"}
          {courses.length === 0 && (
            <button onClick={() => onRemove(term.id)} className="text-slate-300 hover:text-rose-600" title="remove empty term">✕</button>
          )}
        </span>
      </div>
      <SortableContext items={courses.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="min-h-[120px] space-y-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 p-2">
          {courses.map((c) => (
            <SortableCourse key={c.id} course={c} issues={issuesByCourse[c.id]} dateSlot={dateSlotFor?.(c)} />
          ))}
          {courses.length === 0 && <div className="py-6 text-center text-xs text-slate-400">drop a course here</div>}
        </div>
      </SortableContext>
    </div>
  );
}

export function CourseSequencer({ programId, terms: initialTerms, initialCourses, cohortId, courseDates = {} }: {
  programId: string; terms: SeqTerm[]; initialCourses: SeqCourse[];
  /** When set, each course card gets start/end date inputs for THIS offering (8/12/16-week courses inside a term). */
  cohortId?: string;
  courseDates?: Record<string, { start: string | null; end: string | null }>;
}) {
  const [courses, setCourses] = useState<SeqCourse[]>(initialCourses);
  const [terms, setTerms] = useState<SeqTerm[]>(initialTerms);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Persist the working layout in the browser so it survives a reload.
  const storeKey = `rosie:sequence:${programId}`;
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved.terms) && saved.terms.length) setTerms(saved.terms);
        if (Array.isArray(saved.courses) && saved.courses.length) {
          // Merge saved termId/order onto the authoritative course list.
          const pos = new Map(saved.courses.map((c: { id: string; termId: string }) => [c.id, c.termId]));
          setCourses((prev) => prev.map((c) => (pos.has(c.id) ? { ...c, termId: pos.get(c.id) as string } : c)));
        }
      }
    } catch { /* ignore */ }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeKey]);
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(storeKey, JSON.stringify({ terms, courses: courses.map((c) => ({ id: c.id, termId: c.termId })) })); } catch { /* ignore */ }
  }, [hydrated, storeKey, terms, courses]);

  let termSeq = terms.length;
  function addTermLocal() {
    setTerms((prev) => [...prev, { id: `new:${++termSeq}:${prev.length}`, name: `Term ${prev.length + 1}`, courseCount: 0 }]);
    setDirty(true);
  }
  function removeTermLocal(id: string) {
    if (byTerm(id).length > 0) return; // only empty terms
    setTerms((prev) => prev.filter((t) => t.id !== id));
    setDirty(true);
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Per-offering course windows, ON the drag-drop cards: 8-, 12-, 16-week
  // courses inside the same term each get real start/end dates. The form sits
  // outside the drag listeners, so typing never starts a drag.
  const dateSlotFor = cohortId
    ? (c: SeqCourse) => {
        const d = courseDates[c.id];
        return (
          <form
            action={saveCourseDates.bind(null, cohortId, c.id, programId)}
            onPointerDown={(e) => e.stopPropagation()}
            className="mt-1 flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px]"
          >
            <span className="font-semibold uppercase tracking-wide text-slate-400">Runs</span>
            <input type="date" name="startDate" defaultValue={d?.start ?? ""} className="rounded border border-blue-200 bg-blue-50/70 px-1 py-0.5 text-[10px] text-blue-900" />
            <span className="text-slate-400">→</span>
            <input type="date" name="endDate" defaultValue={d?.end ?? ""} className="rounded border border-blue-200 bg-blue-50/70 px-1 py-0.5 text-[10px] text-blue-900" />
            <button className="rounded bg-rose-600 px-1.5 py-0.5 font-medium text-white hover:bg-rose-700">Set</button>
            {d?.start && <span className="rounded-full bg-amber-200 px-1.5 py-0.5 text-[8px] font-semibold text-amber-800">custom</span>}
          </form>
        );
      }
    : undefined;

  const byTerm = (termId: string) => courses.filter((c) => c.termId === termId);
  const findTermOf = (id: string): string | null => {
    if (id.startsWith("term:")) return id.slice(5);
    return courses.find((c) => c.id === id)?.termId ?? null;
  };

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeTerm = findTermOf(String(active.id));
    const overTerm = findTermOf(String(over.id));
    if (!activeTerm || !overTerm || activeTerm === overTerm) return;
    // Move the active course into the over container.
    setCourses((prev) => prev.map((c) => (c.id === active.id ? { ...c, termId: overTerm } : c)));
    setDirty(true);
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    setActiveId(null);
    if (!over) return;
    const activeTerm = findTermOf(String(active.id));
    const overTerm = findTermOf(String(over.id));
    if (!activeTerm || !overTerm) return;

    setCourses((prev) => {
      const inTerm = prev.filter((c) => c.termId === overTerm);
      const others = prev.filter((c) => c.termId !== overTerm);
      const oldIndex = inTerm.findIndex((c) => c.id === active.id);
      let newIndex = inTerm.findIndex((c) => c.id === over.id);
      if (newIndex === -1) newIndex = inTerm.length - 1;
      const reordered = [...inTerm];
      if (oldIndex !== -1) {
        const [moved] = reordered.splice(oldIndex, 1);
        reordered.splice(newIndex, 0, moved);
      }
      return [...others, ...reordered].map((c) =>
        c.termId === overTerm ? { ...c, sequenceOrder: reordered.findIndex((r) => r.id === c.id) } : c,
      );
    });
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      const payload = courses.map((c) => {
        const idx = byTerm(c.termId).findIndex((x) => x.id === c.id);
        return { id: c.id, termId: c.termId, sequenceOrder: idx };
      });
      const res = await fetch(`/api/programs/${programId}/sequence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courses: payload }),
      });
      if (res.ok) {
        setDirty(false);
        setSavedAt(new Date().toLocaleTimeString());
      }
    } finally {
      setSaving(false);
    }
  }

  const active = activeId ? courses.find((c) => c.id === activeId) : null;

  // Live prerequisite check: a course's requisite codes should sit in EARLIER
  // terms. Flag any prereq currently scheduled in a later term (out of order).
  const termPos = new Map(terms.map((t, i) => [t.id, i]));
  const codeToTerm = new Map(courses.filter((c) => c.code).map((c) => [c.code as string, c.termId]));
  const issuesByCourse: Record<string, string[]> = {};
  for (const c of courses) {
    if (!c.requisites) continue;
    const refs = [...new Set((c.requisites.match(CODE_RE) ?? []))].filter((code) => code !== c.code && codeToTerm.has(code));
    const myPos = termPos.get(c.termId) ?? 0;
    const bad = refs.filter((code) => (termPos.get(codeToTerm.get(code)!) ?? 0) > myPos);
    if (bad.length) issuesByCourse[c.id] = bad;
  }
  const issueCount = Object.keys(issuesByCourse).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={save} disabled={!dirty || saving} className="btn-primary disabled:opacity-40">
          {saving ? "Saving…" : "Save layout"}
        </button>
        {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
        {!dirty && savedAt && <span className="text-xs text-emerald-600">Saved at {savedAt}</span>}
        {issueCount > 0 ? (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">⚠ {issueCount} course{issueCount === 1 ? "" : "s"} with out-of-order prerequisites</span>
        ) : (
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">✓ prerequisite order looks valid</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-3 py-2">
        <span className="text-xs text-slate-500">{terms.length} term{terms.length === 1 ? "" : "s"} — drag courses within a term to re-order, or across terms to re-sequence.</span>
        <button onClick={addTermLocal} disabled={terms.length >= 12} className="btn-primary ml-auto text-xs disabled:opacity-40">+ Add term</button>
        {terms.length >= 12 && <span className="text-[11px] text-amber-600">12-term cap</span>}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {terms.map((t) => (
            <TermColumn key={t.id} term={t} courses={byTerm(t.id)} issuesByCourse={issuesByCourse} onRemove={removeTermLocal} dateSlotFor={dateSlotFor} />
          ))}
        </div>
        <DragOverlay>{active ? <CourseCard course={active} dragging /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}
