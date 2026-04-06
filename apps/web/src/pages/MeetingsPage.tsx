import { useEffect, useState } from 'react';
import { DndContext, rectIntersection, type DragEndEvent, MouseSensor, TouchSensor, useSensor, useSensors, useDroppable, useDraggable, DragOverlay } from '@dnd-kit/core';
import { meetingsApi } from '../api/meetings.api';
import { projectsApi } from '../api/projects.api';
import { MeetingDetailPanel } from '../components/meetings/MeetingDetailPanel';
import { ProjectFilter } from '../components/filters/ProjectFilter';
import { useFiltersStore } from '../store';
import type { Meeting, Project } from '@pis/shared';

function DraggableMeetingCard({ meeting, onClick }: { meeting: Meeting; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: meeting.id });
  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className="bg-white rounded-xl border border-gray-200 p-4 w-64 cursor-pointer hover:border-indigo-300 hover:shadow-sm transition-all"
    >
      <div className="font-medium text-gray-800 truncate">{meeting.title}</div>
      <div className="text-sm text-gray-400 mt-1">{meeting.date}</div>
      {meeting.summary_raw && (
        <p className="text-xs text-gray-500 mt-2 line-clamp-2 leading-relaxed">{meeting.summary_raw}</p>
      )}
    </div>
  );
}

function MeetingDropZone({
  projectId,
  project,
  groupMeetings,
  onClickMeeting,
}: {
  projectId: number | null;
  project: Project | null;
  groupMeetings: Meeting[];
  onClickMeeting: (m: Meeting) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `meeting-zone-${projectId ?? 'none'}` });

  return (
    <div className="flex">
      <div className="w-40 min-w-[160px] flex-shrink-0 pr-3 pt-3">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: project?.color ?? '#9ca3af' }} />
          <span className="text-sm font-semibold text-gray-700 truncate">{project?.name ?? 'No project'}</span>
        </div>
        <div className="text-xs text-gray-400 mt-1 ml-5">
          {groupMeetings.length} meeting{groupMeetings.length !== 1 ? 's' : ''}
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={`flex gap-3 flex-wrap flex-1 min-h-[60px] rounded-xl p-2 transition-colors ${isOver ? 'bg-indigo-50 border-2 border-dashed border-indigo-300' : ''}`}
      >
        {groupMeetings.map((m) => (
          <DraggableMeetingCard key={m.id} meeting={m} onClick={() => onClickMeeting(m)} />
        ))}
        {groupMeetings.length === 0 && (
          <div className="text-gray-300 text-xs self-center">Drop here</div>
        )}
      </div>
    </div>
  );
}

export function MeetingsPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const { selectedProjectIds: filterProjectIds } = useFiltersStore();
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [draggingMeeting, setDraggingMeeting] = useState<Meeting | null>(null);

  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newProjectId, setNewProjectId] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    meetingsApi.list().then(setMeetings);
    projectsApi.list().then(setProjects);
  };
  useEffect(load, []);

  const submit = async () => {
    if (!newTitle.trim()) return;
    setSubmitting(true);
    try {
      await meetingsApi.create({
        title: newTitle.trim(),
        date: newDate || new Date().toISOString().slice(0, 10),
        project_id: newProjectId !== '' ? Number(newProjectId) : undefined,
        summary_raw: '',
      });
      setNewTitle('');
      setNewDate('');
      setNewProjectId('');
      setAdding(false);
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const projectMap = new Map<number, Project>(projects.map((p) => [p.id, p]));

  const groupMap = new Map<number | null, Meeting[]>();
  for (const meeting of meetings) {
    const pid = meeting.project_id ?? null;
    if (!groupMap.has(pid)) groupMap.set(pid, []);
    groupMap.get(pid)!.push(meeting);
  }

  const grouped: Array<{ project: Project | null; meetings: Meeting[] }> = [];
  for (const [pid, groupMeetings] of groupMap.entries()) {
    grouped.push({
      project: pid !== null ? (projectMap.get(pid) ?? null) : null,
      meetings: groupMeetings,
    });
  }

  grouped.sort((a, b) => {
    if (a.project === null) return 1;
    if (b.project === null) return -1;
    return (a.project.order_index ?? 0) - (b.project.order_index ?? 0);
  });

  const filteredGrouped =
    filterProjectIds === null
      ? grouped
      : grouped.filter((g) => g.project !== null && filterProjectIds.has(g.project.id));

  const activeProjects = projects.filter((p) => !p.archived);

  const mouseSensor = useSensor(MouseSensor, { activationConstraint: { distance: 3 } });
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } });
  const sensors = useSensors(mouseSensor, touchSensor);

  const handleDragEnd = async (e: DragEndEvent) => {
    setDraggingMeeting(null);
    const { active, over } = e;
    if (!over) return;
    const meetingId = Number(active.id);
    const overId = String(over.id);
    if (!overId.startsWith('meeting-zone-')) return;
    const targetStr = overId.replace('meeting-zone-', '');
    const targetPid = targetStr === 'none' ? null : Number(targetStr);
    const meeting = meetings.find((m) => m.id === meetingId);
    if (!meeting) return;
    const currentPid = meeting.project_id ?? null;
    if (currentPid === targetPid) return;
    await meetingsApi.update(meetingId, { project_id: targetPid });
    load();
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-800">Meetings</h1>
        <div className="flex items-center gap-3">
          <ProjectFilter projects={projects} />
          {!adding && (
            <button
              onClick={() => setAdding(true)}
              className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 flex-shrink-0"
            >
              + New meeting
            </button>
          )}
        </div>
      </div>

      {adding && (
        <div className="bg-white rounded-xl border border-indigo-200 shadow-lg p-4 mb-6 max-w-md space-y-3">
          <input
            autoFocus
            className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:border-indigo-300"
            placeholder="Meeting title *"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setAdding(false); }}
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-gray-500 mb-1">Date</div>
              <input
                type="date"
                className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:border-indigo-300"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
              />
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Project</div>
              <select
                className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:border-indigo-300 bg-white"
                value={newProjectId}
                onChange={(e) => setNewProjectId(e.target.value !== '' ? Number(e.target.value) : '')}
              >
                <option value="">No project</option>
                {activeProjects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setAdding(false)}
              className="text-sm text-gray-400 hover:text-gray-600 px-3 py-1.5"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!newTitle.trim() || submitting}
              className="text-sm bg-indigo-600 text-white px-4 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? '...' : 'Add meeting'}
            </button>
          </div>
        </div>
      )}

      {meetings.length === 0 && !adding && (
        <div className="text-gray-400 text-sm">No meetings yet</div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={rectIntersection}
        onDragStart={(e) => setDraggingMeeting(meetings.find((m) => m.id === Number(e.active.id)) ?? null)}
        onDragEnd={handleDragEnd}
      >
        <div className="space-y-4">
          {filteredGrouped.map(({ project, meetings: groupMeetings }) => (
            <MeetingDropZone
              key={project?.id ?? 'unassigned'}
              projectId={project?.id ?? null}
              project={project}
              groupMeetings={groupMeetings}
              onClickMeeting={setSelected}
            />
          ))}
        </div>
        <DragOverlay>
          {draggingMeeting && (
            <div className="bg-white rounded-xl border-2 border-indigo-400 shadow-xl p-4 w-64 opacity-90">
              <div className="font-medium text-gray-800 truncate">{draggingMeeting.title}</div>
              <div className="text-sm text-gray-400 mt-1">{draggingMeeting.date}</div>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <MeetingDetailPanel
        meeting={selected}
        projects={projects}
        onClose={() => setSelected(null)}
        onUpdated={() => {
          load();
          setSelected((prev) => (prev ? { ...prev } : null));
        }}
      />
    </div>
  );
}
