import { create } from 'zustand';

export interface VoiceParticipant {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  micMuted: boolean;
  isSpeaking: boolean;
  isSelf: boolean;
}

interface VoiceState {
  /** Currently active voice channel ID */
  activeChannelId: string | null;
  /** Group ID owning the active voice channel */
  activeGroupId: string | null;
  /** Group name for display in the overlay */
  activeGroupName: string | null;
  /** Whether the current user has joined as a speaker */
  isJoined: boolean;
  /** Whether the user has ANY voice connection (speaker or listener) */
  isActive: boolean;
  /** Whether the user is muted */
  isMuted: boolean;
  /** Participants in the voice channel */
  participants: VoiceParticipant[];
  /** Whether voice request is pending */
  requestPending: boolean;
  /** Callback to leave — set by the group page so the overlay can trigger leave */
  onLeaveRequested: (() => void) | null;
  /** Callback to toggle mic — set by the group page so the overlay can mute/unmute the real mic */
  onMicToggled: ((muted: boolean) => void) | null;

  // Actions
  setActive: (channelId: string, groupId: string, groupName: string) => void;
  setJoined: (joined: boolean) => void;
  setIsActive: (active: boolean) => void;
  setMuted: (muted: boolean) => void;
  setParticipants: (participants: VoiceParticipant[]) => void;
  updateParticipant: (userId: string, updates: Partial<VoiceParticipant>) => void;
  setRequestPending: (pending: boolean) => void;
  setOnLeaveRequested: (fn: (() => void) | null) => void;
  setOnMicToggled: (fn: ((muted: boolean) => void) | null) => void;
  /** Clean up all state */
  clear: () => void;
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  activeChannelId: null,
  activeGroupId: null,
  activeGroupName: null,
  isJoined: false,
  isActive: false,
  isMuted: true,
  participants: [],
  requestPending: false,
  onLeaveRequested: null,
  onMicToggled: null,

  setActive: (channelId, groupId, groupName) =>
    set({
      activeChannelId: channelId,
      activeGroupId: groupId,
      activeGroupName: groupName,
    }),

  setJoined: (joined) => set({ isJoined: joined }),

  setIsActive: (active) => set({ isActive: active }),

  setMuted: (muted) => set({ isMuted: muted }),

  setParticipants: (participants) => set({ participants }),

  updateParticipant: (userId, updates) =>
    set((state) => ({
      participants: state.participants.map((p) =>
        p.id === userId ? { ...p, ...updates } : p,
      ),
    })),

  setRequestPending: (pending) => set({ requestPending: pending }),

  setOnLeaveRequested: (fn) => set({ onLeaveRequested: fn }),

  setOnMicToggled: (fn) => set({ onMicToggled: fn }),

  clear: () =>
    set({
      activeChannelId: null,
      activeGroupId: null,
      activeGroupName: null,
      isJoined: false,
      isActive: false,
      isMuted: true,
      participants: [],
      requestPending: false,
      onLeaveRequested: null,
      onMicToggled: null,
    }),
}));
