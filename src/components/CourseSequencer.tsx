"use client";

import { useState } from "react";
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

export interface SeqCourse {
  id: string;
  code?: string | null;
  name: string;
  termId: string;
  classCount: number;
  labCount: number;
  clinicalCount: number;
}
export interface SeqTerm {
  id: string;
  name: string;
}

function CourseCard({ course, dragging }: { course: SeqCourse; dragging?: boolean }) {
  return (
    <div className={`rounded-lg border bg-white p-3 shadow-sm ${dragging ? "border-rose-400 shadow-md" : "border-slate-200"}`}>
      <div className="text-sm font-medium">
        {course.code ? <span className="text-slate-400">{course.code} · </span> : null}
        {course.name}
      </div>
      <div className="mt-1 flex gap-1 text-[11px]">
        {course.classCount > 0 && <span className="badge bg-sky-100 text-sky-700">{course.classCount} class</span>}
        {course.labCount > 0 && <span className="badge bg-violet-100 text-violet-700">{course.labCount} lab</span>}
        {course.clinicalCount > 0 && <span className="badge bg-rose-100 text-rose-700">{course.clinicalCount} clinical</span>}
      </div>
    </div>
  );
}

function SortableCourse({ course }: { course: SeqCourse }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: course.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing">
      <CourseCard course={course} />
    </div>
  );
}

function TermColumn({ term, courses }: { term: SeqTerm; courses: SeqCourse[] }) {
  // The column itself is droppable via an empty sortable context that accepts the term id.
  const { setNodeRef } = useSortable({ id: `term:${term.id}`, data: { isContainer: true, termId: term.id } });
  return (
    <div className="flex w-72 shrink-0 flex-col">
      <div className="mb-2 text-sm font-semibold">{term.name}</div>
      <SortableContext items={courses.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="min-h-[120px] space-y-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 p-2">
          {courses.map((c) => (
            <SortableCourse key={c.id} course={c} />
          ))}
          {courses.length === 0 && <div className="py-6 text-center text-xs text-slate-400">drop a course here</div>}
        </div>
      </SortableContext>
    </div>
  );
}

export function CourseSequencer({ programId, terms, initialCourses }: { programId: string; terms: SeqTerm[]; initialCourses: SeqCourse[] }) {
  const [courses, setCourses] = useState<SeqCourse[]>(initialCourses);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={!dirty || saving} className="btn-primary disabled:opacity-40">
          {saving ? "Saving…" : "Save layout"}
        </button>
        {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
        {!dirty && savedAt && <span className="text-xs text-emerald-600">Saved at {savedAt}</span>}
        <span className="text-xs text-slate-400">Drag courses within a term to re-order, or across terms to re-sequence.</span>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {terms.map((t) => (
            <TermColumn key={t.id} term={t} courses={byTerm(t.id)} />
          ))}
        </div>
        <DragOverlay>{active ? <CourseCard course={active} dragging /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}
