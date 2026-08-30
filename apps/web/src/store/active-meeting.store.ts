import { create } from 'zustand';

interface ActiveMeetingState {
  meetingId: number | null;
  setMeetingId: (id: number | null) => void;
}

export const useActiveMeetingStore = create<ActiveMeetingState>((set) => ({
  meetingId: null,
  setMeetingId: (id) => set({ meetingId: id }),
}));
